import dotenv from "dotenv";
dotenv.config();

import { createApp } from "./app";

const port = Number(process.env.PORT);
const app = createApp();

const server = app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[server] Port ${port} is already in use. Is another instance running?`);
  } else {
    console.error("[server] Fatal error:", err);
  }
  process.exit(1);
});

process.on("SIGTERM", () => {
  console.log("[server] SIGTERM received, shutting down gracefully.");
  server.close(() => process.exit(0));
});

process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason);
  process.exit(1);
});
