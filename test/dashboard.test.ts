import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createDashboardRouter } from "../src/dashboard/routes.js";

function app() {
  const a = express();
  a.use(
    createDashboardRouter({
      provider: {} as any,
      tokenStore: {
        issueMcpToken: vi.fn(),
        revokeMcpToken: vi.fn(),
        deleteUser: vi.fn(),
      } as any,
    }),
  );
  return a;
}

describe("dashboard", () => {
  it("landing page invites WHOOP connection", async () => {
    const r = await request(app()).get("/");
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/Connect WHOOP/i);
  });

  it("rejects PAT creation without session", async () => {
    const r = await request(app()).post("/pat");
    expect(r.status).toBe(401);
  });
});
