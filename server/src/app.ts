import path from "path";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth";
import { familiesRouter, invitesRouter } from "./routes/families";
import { errorHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRouter);
  app.use("/api/families", familiesRouter);
  app.use("/api/invites", invitesRouter);

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
