import { Router } from "express";
import { APP_VERSION } from "../config/appVersion";

export const appRouter = Router();

appRouter.get("/version", (_req, res) => {
  res.json({ latestVersion: APP_VERSION.latest, apkUrl: APP_VERSION.apkPath });
});
