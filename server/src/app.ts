import path from "path";
import express from "express";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth";
import { familiesRouter, invitesRouter } from "./routes/families";
import { appRouter } from "./routes/app";
import { errorHandler } from "./middleware/errorHandler";
import { ANDROID_PACKAGE_NAMES, androidCertFingerprints } from "./lib/config";

export function createApp() {
  const app = express();
  // Behind Vercel's (or any) proxy: req.protocol and req.ip come from X-Forwarded-*.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // Merging a busy person sends every moved entry's notes (sealed, for an encrypted family).
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Digital Asset Links: lets the Android app use this domain's passkeys (Credential Manager) and
  // share saved sign-ins with it. On Vercel, /.well-known/assetlinks.json is rewritten to /api/assetlinks.
  const assetLinks = (_req: express.Request, res: express.Response) => {
    const fingerprints = androidCertFingerprints();
    res.json(
      fingerprints.length === 0
        ? []
        : ANDROID_PACKAGE_NAMES.map((packageName) => ({
            relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
            target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: fingerprints },
          }))
    );
  };
  app.get("/.well-known/assetlinks.json", assetLinks);
  app.get("/api/assetlinks", assetLinks);
  app.use("/api/auth", authRouter);
  app.use("/api/families", familiesRouter);
  app.use("/api/invites", invitesRouter);
  app.use("/api/app", appRouter);

  if (process.env.NODE_ENV === "production") {
    const clientDist = path.join(__dirname, "..", "..", "client", "dist");
    app.use(express.static(clientDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  app.use(errorHandler);

  return app;
}
