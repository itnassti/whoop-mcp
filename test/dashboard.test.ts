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
});
