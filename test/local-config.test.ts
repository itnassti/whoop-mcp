import { describe, it, expect } from "vitest";
import { loadLocalConfig } from "../src/local/config.js";

const base = { WHOOP_CLIENT_ID: "id", WHOOP_CLIENT_SECRET: "secret", XDG_CONFIG_HOME: "/cfg" };

describe("loadLocalConfig", () => {
  it("reads creds and derives configDir + default redirectUri", () => {
    const c = loadLocalConfig(base as any);
    expect(c.clientId).toBe("id");
    expect(c.clientSecret).toBe("secret");
    expect(c.configDir).toBe("/cfg/whoop-mcp");
    expect(c.redirectUri).toMatch(/^https:\/\/.+\/callback\/?$/);
  });
  it("honours an explicit WHOOP_REDIRECT_URI", () => {
    const c = loadLocalConfig({ ...base, WHOOP_REDIRECT_URI: "https://x.y/cb/" } as any);
    expect(c.redirectUri).toBe("https://x.y/cb/");
  });
  it("throws when a required credential is missing", () => {
    expect(() => loadLocalConfig({ XDG_CONFIG_HOME: "/cfg" } as any)).toThrow();
  });
});
