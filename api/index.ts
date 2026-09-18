// Vercel entry point: wraps the same Express app used for local/self-hosted deployment as a
// single serverless function. vercel.json rewrites every /api/* request here; everything else
// is served as a static asset from client/dist by Vercel itself, so app.ts's own catch-all
// static route never runs in this environment (harmless to leave in place for the non-Vercel
// deployment path described in README.md).
import "dotenv/config";
import { createApp } from "../server/src/app";

export default createApp();
