import { describe, it, expect } from "vitest";
import { isWhoopEmailAllowed } from "../src/auth/whoop-callback.js";

describe("isWhoopEmailAllowed", () => {
  it("allows anyone when the allowlist is empty", () => {
    expect(isWhoopEmailAllowed("x@y.com", [])).toBe(true);
    expect(isWhoopEmailAllowed(null, [])).toBe(true);
  });

  it("allows only listed emails (case-insensitive) when set", () => {
    const list = ["friend@example.com"];
    expect(isWhoopEmailAllowed("Friend@Example.com", list)).toBe(true);
    expect(isWhoopEmailAllowed("stranger@example.com", list)).toBe(false);
    expect(isWhoopEmailAllowed(null, list)).toBe(false);
  });
});
