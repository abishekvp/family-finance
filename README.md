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
`PORT` in `server/.env`).

## Design system

The web and mobile UIs share one visual language — "Aurora Ledger": frosted glass surfaces over a
soft aurora gradient, one brand ramp, one set of semantic colors (income/expense/warn/info). See
[DESIGN.md](DESIGN.md) for tokens, components and patterns before adding UI.

- Web primitives: `client/src/components/ui.tsx` (+ `figures.tsx` for `Money`/`StatTile`)
- Mobile primitives: `mobile/src/components/ui.tsx`, theme in `mobile/src/theme.ts` /
  `mobile/src/context/ThemeContext.tsx`
- Regenerate every app icon (favicons, PWA icons, Android adaptive icon) from the sources in
  `assets-src/` with `npm run icons`.

The web app is an installable PWA (manifest + offline shell service worker in `client/public/`),
and `/get-the-app` in the web app offers both the PWA install prompt and a direct Android APK
download once one has been built (see below).

## Mobile app (Expo / React Native)

```bash
cd mobile
npm install
npm start        # Expo dev server — press a for Android, i for iOS, w for web
```

The built app talks to `https://family-finance.vercel.app/api` by default (see
`mobile/src/api/client.ts`). For local development against your own server, override it:

```bash
EXPO_PUBLIC_API_URL=http://localhost:4000/api npm start
```

On a physical device or emulator reaching a server on your dev machine, forward the port first:
`adb reverse tcp:4000 tcp:4000`.

### Building an installable APK

`mobile/android` (and `ios`) are generated, gitignored folders — standard Expo "Continuous
Native Generation". Regenerate before every native build, and always after changing `app.json`,
adding a native dependency, or updating the icons in `assets-src/`:

```bash
cd mobile
npx expo prebuild --platform android --clean
```

Then build a debug APK (signed with the auto-generated debug keystore — installable on any
device with "unknown sources" allowed, not intended for the Play Store). By default this builds
all four ABIs, which makes for a large APK; restrict it to `arm64-v8a` (covers virtually every
real phone from the last ~8 years) for a much smaller, still-installable build:

```bash
cd mobile/android
./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
```

**Windows only:** the checkout's own path plus the mirrored source-tree suffix CMake/ninja
append for out-of-tree object files can exceed Windows' 260-character path limit, failing
native codegen for react-native-gesture-handler/rnscreens/rnsvg with "Filename longer than 260
characters". `mobile/android/app/build.gradle` already redirects the CMake staging directory to
`%USERPROFILE%\ffcxx` to avoid this — no action needed unless you've customized that file.

The APK lands at `mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Copy it to
`client/public/downloads/family-finance.apk` and rebuild the client so `/get-the-app` can serve
it for download.

## Deploying

### Vercel (the default `EXPO_PUBLIC_API_URL` target)

`vercel.json` and `api/index.ts` at the repo root wrap the same Express app as a single
serverless function; everything under `/api/*` is routed there, everything else is served as the
static `client/dist` build. To deploy:

1. Import the repo into Vercel.
2. Set the project's environment variables: `DATABASE_URL` (a Postgres reachable from Vercel —
   e.g. Vercel Postgres, Neon, or Supabase), `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`.
3. Run `npm run prisma:migrate` (or `prisma migrate deploy`) against that database once, from a
   machine that can reach it — Vercel's build step does not run migrations automatically.
4. Deploy. `family-finance.vercel.app` (or whatever domain the project gets) is what the mobile
   app's default `EXPO_PUBLIC_API_URL` expects.

### Self-hosted (single Node process)

```bash
npm run build
NODE_ENV=production npm start
```

Serves the whole app — API and client — from a single process at http://localhost:4000
(configurable via `PORT` in `server/.env`).

## What's implemented so far

- Registration/login with JWT access tokens + rotating refresh tokens (httpOnly cookie)
- Family workspace creation, with a starter set of income/expense categories seeded automatically
- Role-based family membership (Admin / Member / Viewer) with an enforced permission matrix
- Email-based invite links (no email provider wired up yet — the invite link is shown directly in the UI)
- Common (shared) vs. private accounts, with balance calculation and a Family/Personal dashboard scope toggle

See the in-conversation feature spec for the full mandatory/recommended feature list across every domain
(transactions engine, budgets & goals, audit/export, security/notifications, and the web + React Native mobile
UI/UX design systems) — this is a foundation to build the rest of that spec on top of, not the finished product.
