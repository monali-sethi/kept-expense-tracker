# Kept: Expense Tracker

A calm, fast expense tracker with a pastel blue and purple design. Log spending in seconds, see where your money goes, set a monthly budget, and keep your data in your own account.

**Live demo:** _add your deployed link here_

## Features
- **Expense tracking:** add and delete expenses with a description, amount, date and category (Food, Transport, Housing, Bills, Health, Fun, Other).
- **Monthly overview:** total spent, a category breakdown bar, and a month filter.
- **Budget:** set a monthly budget and see how much is left. The bar changes color as you get close to the limit.
- **Accounts:** sign up and sign in, so your expenses are saved to the database and available on every device.
- **Guest mode:** use the tracker without an account (saved in the browser). Signing in uploads those expenses to your account.
- **Currency and export:** choose ₹, $, € or £, and download your expenses as a CSV file.
- **Contact form:** messages are validated and saved to the database.
- **Website:** a responsive, sliding multi-page layout with a light and dark theme toggle, built for keyboard and screen-reader use.

## Tech stack
| Part | Technology |
|---|---|
| Frontend | HTML, CSS and vanilla JavaScript (single file, no build step) |
| Backend | Node.js and Express |
| Database | SQLite (`better-sqlite3`) |
| Auth | JSON Web Tokens, passwords hashed with `bcryptjs` |
| Protection | Input validation on every endpoint, rate limiting (`express-rate-limit`) |

## Project structure
```
kept-app/
├── public/
│   └── index.html      # the whole frontend
├── server.js           # API, database setup and static file serving
├── package.json
├── .env.example        # copy to .env
└── README.md
```

## Getting started
You need Node.js 20 or newer.

```bash
npm install
cp .env.example .env     # on Windows: copy .env.example .env
npm start
```
Then open http://localhost:3000.

Before the first run, open `.env` and set `JWT_SECRET` to a long random string. You can generate one with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Environment variables
| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | Yes | Signs login tokens. If missing, a temporary one is used and everyone is signed out on each restart. |
| `PORT` | No | Server port (default `3000`). |
| `ADMIN_KEY` | No | Lets you read contact messages at `GET /api/messages`. |
| `DB_PATH` | No | Location of the SQLite file (default `./data/kept.db`). |

## API
Send the login token as `Authorization: Bearer <token>`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | no | `{email, password}` returns `{token, user}` |
| POST | `/api/auth/login` | no | `{email, password}` returns `{token, user}` |
| GET | `/api/me` | yes | Current user |
| GET | `/api/expenses` | yes | List your expenses |
| POST | `/api/expenses` | yes | Add one: `{desc, amount, date, cat}` |
| POST | `/api/expenses/bulk` | yes | Add many: `{items: [...]}` (max 500) |
| DELETE | `/api/expenses/:id` | yes | Delete one |
| DELETE | `/api/expenses` | yes | Delete all |
| GET / PUT | `/api/settings` | yes | `{budget, currency}` |
| POST | `/api/contact` | no | `{name, email, message}` |
| GET | `/api/messages` | admin key | Contact messages (header `x-admin-key`) |

To read contact messages:
```bash
curl -H "x-admin-key: YOUR_ADMIN_KEY" http://localhost:3000/api/messages
```

## Deploying on Render
1. Push this project to a GitHub repository. `.env`, `data` and `node_modules` are git-ignored.
2. On [render.com](https://render.com) choose **New**, then **Web Service**, and connect the repository.
3. Set the build command to `npm install` and the start command to `npm start`.
4. Under **Environment**, add `JWT_SECRET` (and `ADMIN_KEY` if you want to read messages).
5. Deploy, then paste the live link at the top of this README.

Railway and Fly.io work the same way.

> **Important:** SQLite is a single file. On Render's free plan the disk is wiped on every restart or redeploy, so accounts and expenses would be lost. For lasting data, attach a persistent disk and set `DB_PATH` to a path on it (for example `/var/data/kept.db`), or move to a hosted database such as PostgreSQL.

## Known limitations
- No password reset or email verification yet.
- Contact messages are stored in the database, not emailed.
- Data is not shared between users. Each account sees only its own expenses.

## Author
_Your name_ · _your course or institution_
