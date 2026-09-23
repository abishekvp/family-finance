# Family Finance

A family money-management app: shared "common" accounts alongside private personal accounts, role-based family
membership (Admin / Member / Viewer), transactions, categories, and dashboards.

## Stack

- **Server**: Node.js, Express, TypeScript, Prisma ORM, PostgreSQL, JWT auth (access + rotating refresh tokens)
- **Client**: React, Vite, TypeScript, Tailwind CSS, React Router
- **Deployment**: single server — the client builds to static assets that the Express server serves directly
  alongside the API, so production runs as one Node process on one port.


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

The built app talks to `https://finance-family-manager.vercel.app/api` by default (see
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

Then build a **release** APK. This is the only variant worth distributing: an `assembleDebug`
APK contains no JavaScript at all — it fetches the bundle from the Metro dev server at
`localhost:8081` on every launch, so installed on a phone with no Metro running it opens
straight to a red "Unable to load script" screen. The release build runs Metro at build time
and embeds `index.android.bundle` (Hermes bytecode) inside the APK, so it runs standalone.

It is still signed with the auto-generated debug keystore (see `signingConfigs` in
`mobile/android/app/build.gradle`) — installable on any device with "unknown sources" allowed,
not intended for the Play Store. By default this builds all four ABIs, which makes for a large
APK; restrict it to `arm64-v8a` (covers virtually every real phone from the last ~8 years) for
a much smaller, still-installable build:

```bash
cd mobile/android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

**Windows only:** the checkout's own path plus the mirrored source-tree suffix CMake/ninja
append for out-of-tree object files can exceed Windows' 260-character path limit, failing
native codegen for react-native-gesture-handler/rnscreens/rnsvg with "Filename longer than 260
characters". `mobile/android/app/build.gradle` already redirects the CMake staging directory to
`%USERPROFILE%\ffcxx` to avoid this — no action needed unless you've customized that file.

The APK lands at `mobile/android/app/build/outputs/apk/release/app-release.apk`.

**Publishing it** (so `/get-the-app` and the in-app update checker pick it up — no server
redeploy needed): set `ASSET_STORE_ID` and `BLOB_READ_WRITE_TOKEN` from a
[Vercel Blob store](https://vercel.com/dashboard/stores) in the repo-root `.env`, then run the
release build through npm so the postbuild hook uploads it automatically:

```bash
cd mobile
npm run build:android:release   # runs the gradlew command above, then uploads to Vercel Blob
```

That uploads the APK plus a small version manifest (read from `app.json`) to Blob storage under
fixed filenames, so re-running it always replaces the previous build at the same URL. `GET
/api/app/version` (`server/src/routes/app.ts`) reads the manifest to answer both the web download
page and the mobile app's update prompt; without `ASSET_STORE_ID` configured it falls back to
serving a static `client/public/downloads/family-finance.apk` if one has been committed there.

For a full release, run `npm run build:all -- --notes "What changed"` from the repo root instead:
it builds the web app, bumps `expo.version` (patch by default; `--bump minor|major`) and
`expo.android.versionCode` in `mobile/app.json`, then runs the Android build + upload above with
those notes attached. Without `--notes` it prompts for them. If the Android build fails, the
version bump is rolled back. Commit `mobile/app.json` afterwards.

Installed apps check for a newer build on launch and when returning to the foreground (Settings →
App updates also has a manual "Check for updates"). When one exists they post an "Update available"
notification and show a prompt with the release notes; "Update now" downloads the APK in-app and
hands it to Android's package installer.

### Recording transactions from SMS (Android)

More → SMS transactions is an opt-in switch that reads bank, card and UPI alerts from the phone's
inbox and records each as a transaction (tagged `sms`). It runs on launch, whenever the app returns
to the foreground, and on "Scan now"; it only reads messages newer than the last scan, skips OTPs,
reminders, money requests and promotions, and drops the same spend alerted twice within 10 minutes.
Card/account last digits seen in alerts can be mapped to app accounts; everything else goes to the
default account. Payee → category is learned from the family's existing transactions.

The native reader is a local Expo module in `mobile/modules/sms-reader` (autolinked; it adds the
`READ_SMS` permission to the manifest), and the parser is `mobile/src/lib/smsParser.ts`. It needs
a native build — it isn't available in Expo Go. `READ_SMS` is restricted on Google Play, which is
fine for the sideloaded APK but would need Google's SMS-permission declaration to publish there.

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
4. Deploy. The mobile app's default `EXPO_PUBLIC_API_URL` expects
   `https://finance-family-manager.vercel.app` — update `mobile/src/api/client.ts` if the
   project's domain ever changes.

### Sign-in, email and security configuration

All optional — each feature reports a clear "not configured" error until its variables are set.
See `.env.example` for the full list.

| Feature | Variables | Notes |
| --- | --- | --- |
| Public URL | `PUBLIC_APP_URL` | e.g. `https://finance-family-manager.vercel.app`. Used for OAuth redirect URIs and the WebAuthn RP ID. |
| Email (forgot password, email change) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Any SMTP provider (Gmail app password, Resend, SES…). In development without SMTP, codes are printed to the server log. |
| Sign in with Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud → OAuth client of type **Web application**, authorized redirect URI `${PUBLIC_APP_URL}/api/auth/oauth/google/callback`. Serves web and the Android app. |
| Sign in with Microsoft | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT` (default `common`) | Entra ID app registration, **Web** platform redirect URI `${PUBLIC_APP_URL}/api/auth/oauth/microsoft/callback`. |
| Passkeys in the Android app | `ANDROID_CERT_SHA256` | SHA-256 fingerprint(s) of the APK signing certificate (`keytool -list -v -keystore mobile/android/app/debug.keystore -alias androiddebugkey -storepass android`). Published at `/.well-known/assetlinks.json`. Web passkeys need nothing extra. |

**End-to-end encryption.** Account → Security lets a member set a master password. An admin can
then encrypt the family: transaction payees and notes are encrypted on-device with a family key
that is sealed to each member's key pair. The server stores only ciphertext and can't read them.
Amounts, dates and categories stay in plaintext so balances and budgets still compute server-side.
The master password can't be recovered: a member who resets it gets the family key re-shared the
next time another member unlocks the app.

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
