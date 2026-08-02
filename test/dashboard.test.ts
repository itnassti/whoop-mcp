import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createDashboardRouter } from "../src/dashboard/routes.js";

describe("dashboard", () => {
  it("rejects /connected when the state does not match the session (CSRF guard)", async () => {
    const exchangeAuthorizationCode = vi.fn();
    const a = express();
    a.use(
      createDashboardRouter({
        provider: { exchangeAuthorizationCode, verifyAccessToken: vi.fn() } as any,
        tokenStore: { issueMcpToken: vi.fn(), revokeMcpToken: vi.fn(), deleteUser: vi.fn() } as any,
        sessionSecret: "test-session-secret-1234567890",
      }),
    );
    // No prior /connect -> the session carries no oauthState, so a forged callback is rejected
    // before the code is ever redeemed.
    const r = await request(a).get("/connected?code=abc&state=forged");
    expect(r.status).toBe(403);
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("serves the SPA index.html at the dashboard root", async () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-dist-"));
    fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>WHOOP</title><div id=root></div>");
    const a = express();
    a.use(
      "/dashboard",
      createDashboardRouter({ provider: {} as any, tokenStore: {} as any, sessionSecret: "x".repeat(20), webDistDir: dist }),
    );
    const r = await request(a).get("/dashboard/");
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/id=root/);
    fs.rmSync(dist, { recursive: true, force: true });
  });

  it("does not let the SPA fallback swallow /dashboard/api routes", async () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), "whoop-dist-"));
    fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>WHOOP</title><div id=root></div>");
    const a = express();
    a.use(
      "/dashboard",
      createDashboardRouter({
        provider: {} as any,
        tokenStore: { issueMcpToken: vi.fn(), revokeMcpToken: vi.fn(), deleteUser: vi.fn() } as any,
        sessionSecret: "x".repeat(20),
        webDistDir: dist,
      }),
    );
    const r = await request(a).get("/dashboard/api/session");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/json/);
    expect(r.body).toEqual({ connected: false });
    fs.rmSync(dist, { recursive: true, force: true });
  });
});
