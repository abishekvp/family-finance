# Family Finance

A family money-management app: shared "common" accounts alongside private personal accounts, role-based family
membership (Admin / Member / Viewer), transactions, categories, and dashboards.

## Stack

- **Server**: Node.js, Express, TypeScript, Prisma ORM, PostgreSQL, JWT auth (access + rotating refresh tokens)
- **Client**: React, Vite, TypeScript, Tailwind CSS, React Router
- **Deployment**: single server — the client builds to static assets that the Express server serves directly
  alongside the API, so production runs as one Node process on one port.

## Project layout

```
server/   Express API + Prisma schema/migrations
client/   React app (Vite)
```

In development, the two run as separate processes (Vite on :5173 proxies `/api` to Express on :4000) for fast
hot-reloading. In production, only the server process runs: it serves the built client from `client/dist` and
answers `/api/*` itself, with a catch-all route so client-side routing (React Router) works on a full page load.

## Setup

1. Have a local PostgreSQL server running.
2. Create a database and a role for the app (see `server/.env` for the expected connection string shape), or reuse
   an existing one.
3. Copy `.env.example` to `server/.env` and fill in `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`.
4. Install dependencies and set up the database schema:

```bash
npm install
npm run prisma:migrate
```

## Development

```bash
npm run dev
```

Runs the API (http://localhost:4000) and the Vite dev server (http://localhost:5173) together. Open the app at
http://localhost:5173.

## Production build

```bash
npm run build
NODE_ENV=production npm start
```

Serves the whole app — API and client — from a single process at http://localhost:4000 (configurable via
`API_PORT` in `server/.env`).

## What's implemented so far

- Registration/login with JWT access tokens + rotating refresh tokens (httpOnly cookie)
- Family workspace creation, with a starter set of income/expense categories seeded automatically
- Role-based family membership (Admin / Member / Viewer) with an enforced permission matrix
- Email-based invite links (no email provider wired up yet — the invite link is shown directly in the UI)
- Common (shared) vs. private accounts, with balance calculation and a Family/Personal dashboard scope toggle

See the in-conversation feature spec for the full mandatory/recommended feature list across every domain
(transactions engine, budgets & goals, audit/export, security/notifications, and the web + React Native mobile
UI/UX design systems) — this is a foundation to build the rest of that spec on top of, not the finished product.
