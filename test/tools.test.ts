import { describe, it, expect, vi } from "vitest";
import { makeToolHandlers } from "../src/mcp/tools.js";

describe("get_recovery tool", () => {
  it("returns recovery records for the authed user", async () => {
    const client = { getRecovery: vi.fn(async () => [{ id: 1, score: 88 }]) };
    const handlers = makeToolHandlers(() => client as any);
    const result = await handlers.get_recovery({ limit: 1 }, { userId: "u1" });
    expect(result.structuredContent.records[0].score).toBe(88);
    expect(client.getRecovery).toHaveBeenCalledWith({ limit: 1, start: undefined, end: undefined });
  });
  it("returns a reconnect hint when WHOOP not connected", async () => {
    const client = { getRecovery: vi.fn(async () => { throw new Error("WHOOP not connected"); }) };
    const handlers = makeToolHandlers(() => client as any);
    const result = await handlers.get_recovery({}, { userId: "u1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/connect/i);
  });
});
