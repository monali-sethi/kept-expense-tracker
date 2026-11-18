require("dotenv").config();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "kept.db");
const ADMIN_KEY = process.env.ADMIN_KEY || "";
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString("hex");
  console.warn("JWT_SECRET is not set. Using a temporary secret: everyone is signed out on each restart.");
}

/* ---------- database ---------- */
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
create table if not exists users(
  id integer primary key autoincrement,
  email text unique not null,
  password_hash text not null,
  budget real not null default 0,
  currency text not null default '₹',
  created_at text not null default (datetime('now')));
create table if not exists expenses(
  id integer primary key autoincrement,
  user_id integer not null references users(id) on delete cascade,
  description text not null,
  amount real not null,
  category text not null,
  date text not null,
  created_at text not null default (datetime('now')));
create index if not exists idx_expenses_user_date on expenses(user_id, date);
create table if not exists messages(
  id integer primary key autoincrement,
  name text not null,
  email text not null,
  message text not null,
  created_at text not null default (datetime('now')));
`);

/* ---------- helpers ---------- */
const CATS = ["Food", "Transport", "Housing", "Bills", "Health", "Fun", "Other"];
const CURS = ["₹", "$", "€", "£"];
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (s, n) => String(s ?? "").trim().slice(0, n);

function parseExpense(b) {
  b = b || {};
  const description = clean(b.desc, 80);
  const amount = Number(b.amount);
  const date = String(b.date || "");
  const category = String(b.cat || "");
  if (!description) return { error: "Description is required." };
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) return { error: "Amount must be greater than zero." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { error: "Date must look like YYYY-MM-DD." };
  if (!CATS.includes(category)) return { error: "Unknown category." };
  return { value: { description, amount: Math.round(amount * 100) / 100, date, category } };
}
const toExpense = (r) => ({ id: r.id, desc: r.description, amount: r.amount, date: r.date, cat: r.category });
const sign = (id) => jwt.sign({ sub: id }, SECRET, { expiresIn: "30d" });

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare("select id, email from users where id = ?").get(payload.sub);
    if (!user) throw new Error("no user");
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Please sign in again." });
  }
}

/* ---------- app ---------- */
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts. Try again in a few minutes." } });
const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: "You have sent several messages already. Please try again later." } });

app.get("/api/health", (req, res) => res.json({ ok: true }));

/* auth */
app.post("/api/auth/register", authLimiter, (req, res) => {
  const email = clean(req.body?.email, 254).toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!emailRe.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8 || password.length > 200) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (db.prepare("select 1 from users where email = ?").get(email)) return res.status(409).json({ error: "An account with this email already exists." });
  const info = db.prepare("insert into users(email, password_hash) values(?, ?)").run(email, bcrypt.hashSync(password, 10));
  res.status(201).json({ token: sign(info.lastInsertRowid), user: { id: info.lastInsertRowid, email } });
});

app.post("/api/auth/login", authLimiter, (req, res) => {
  const email = clean(req.body?.email, 254).toLowerCase();
  const password = String(req.body?.password ?? "");
  const u = db.prepare("select id, email, password_hash from users where email = ?").get(email);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error: "Invalid email or password." });
  res.json({ token: sign(u.id), user: { id: u.id, email: u.email } });
});

app.get("/api/me", auth, (req, res) => res.json({ user: req.user }));

/* expenses */
app.get("/api/expenses", auth, (req, res) => {
  const rows = db.prepare("select * from expenses where user_id = ? order by date desc, id desc").all(req.user.id);
  res.json({ expenses: rows.map(toExpense) });
});

app.post("/api/expenses", auth, (req, res) => {
  const p = parseExpense(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  const v = p.value;
  const info = db.prepare("insert into expenses(user_id, description, amount, category, date) values(?,?,?,?,?)")
    .run(req.user.id, v.description, v.amount, v.category, v.date);
  res.status(201).json({ expense: { id: info.lastInsertRowid, desc: v.description, amount: v.amount, date: v.date, cat: v.category } });
});

app.post("/api/expenses/bulk", auth, (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length > 500) return res.status(400).json({ error: "Send between 0 and 500 expenses." });
  const parsed = items.map(parseExpense);
  const bad = parsed.find((p) => p.error);
  if (bad) return res.status(400).json({ error: bad.error });
  const ins = db.prepare("insert into expenses(user_id, description, amount, category, date) values(?,?,?,?,?)");
  const out = db.transaction(() => parsed.map(({ value: v }) => {
    const info = ins.run(req.user.id, v.description, v.amount, v.category, v.date);
    return { id: info.lastInsertRowid, desc: v.description, amount: v.amount, date: v.date, cat: v.category };
  }))();
  res.status(201).json({ expenses: out });
});

app.delete("/api/expenses/:id", auth, (req, res) => {
  const info = db.prepare("delete from expenses where id = ? and user_id = ?").run(Number(req.params.id), req.user.id);
  if (!info.changes) return res.status(404).json({ error: "Expense not found." });
  res.json({ ok: true });
});

app.delete("/api/expenses", auth, (req, res) => {
  db.prepare("delete from expenses where user_id = ?").run(req.user.id);
  res.json({ ok: true });
});

/* settings */
app.get("/api/settings", auth, (req, res) => {
  const s = db.prepare("select budget, currency from users where id = ?").get(req.user.id);
  res.json(s);
});

app.put("/api/settings", auth, (req, res) => {
  const budget = Number(req.body?.budget ?? 0);
  const currency = String(req.body?.currency ?? "₹");
  if (!Number.isFinite(budget) || budget < 0 || budget > 1e9) return res.status(400).json({ error: "Budget must be zero or more." });
  if (!CURS.includes(currency)) return res.status(400).json({ error: "Unsupported currency." });
  db.prepare("update users set budget = ?, currency = ? where id = ?").run(budget, currency, req.user.id);
  res.json({ budget, currency });
});

/* contact form */
app.post("/api/contact", contactLimiter, (req, res) => {
  const name = clean(req.body?.name, 80);
  const email = clean(req.body?.email, 254);
  const message = clean(req.body?.message, 2000);
  if (name.length < 2) return res.status(400).json({ error: "Please enter your name." });
  if (!emailRe.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (message.length < 10) return res.status(400).json({ error: "Please write at least 10 characters." });
  db.prepare("insert into messages(name, email, message) values(?,?,?)").run(name, email, message);
  res.status(201).json({ ok: true });
});

app.get("/api/messages", (req, res) => {
  if (!ADMIN_KEY || req.headers["x-admin-key"] !== ADMIN_KEY) return res.status(401).json({ error: "Unauthorized." });
  res.json({ messages: db.prepare("select * from messages order by id desc limit 200").all() });
});

/* static site + errors */
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => console.log(`Kept is running at http://localhost:${PORT}`));
