import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../src/crypto.js";

const key = "a".repeat(64);

describe("crypto", () => {
  it("round-trips a value", () => {
    const p = "refresh-token-xyz";
    expect(decrypt(encrypt(p, key), key)).toBe(p);
  });

  it("produces different ciphertext each call (random IV)", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });

  it("fails to decrypt with wrong key", () => {
    expect(() => decrypt(encrypt("x", key), "b".repeat(64))).toThrow();
  });
});
