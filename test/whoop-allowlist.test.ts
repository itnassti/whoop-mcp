import { describe, it, expect } from "vitest";
import { isWhoopEmailAllowed } from "../src/auth/whoop-callback.js";

describe("isWhoopEmailAllowed", () => {
  it("allows anyone when restriction is off, regardless of the list", () => {
    expect(isWhoopEmailAllowed("x@y.com", [], false)).toBe(true);
    expect(isWhoopEmailAllowed("x@y.com", ["only@allowed.com"], false)).toBe(true);
    expect(isWhoopEmailAllowed(null, [], false)).toBe(true);
  });

  it("when restricted, allows only listed emails (case-insensitive)", () => {
    const list = ["friend@example.com"];
    expect(isWhoopEmailAllowed("Friend@Example.com", list, true)).toBe(true);
    expect(isWhoopEmailAllowed("stranger@example.com", list, true)).toBe(false);
    expect(isWhoopEmailAllowed(null, list, true)).toBe(false);
  });

  it("when restricted with an empty list, allows no one", () => {
    expect(isWhoopEmailAllowed("anyone@example.com", [], true)).toBe(false);
  });
});
