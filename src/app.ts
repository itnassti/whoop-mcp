import express from "express";
import type { AppConfig } from "./config.js";
export function createApp(_config: AppConfig): express.Express {
  const app = express();
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  return app;
}
