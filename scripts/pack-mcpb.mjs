#!/usr/bin/env node
// Stages a minimal directory for `mcpb pack`: the built local stdio server
// plus only the runtime dependencies it actually imports (@modelcontextprotocol/sdk, zod).
// Packing the repo root directly would pull in src/, the web workspace, tests, and
// unrelated multi-user-server deps (express, pg, drizzle-orm, cookie-session), so
// mcpb/ is used as a staging directory instead. mcpb/manifest.json is hand-authored
// and tracked in git; everything else here is generated and gitignored.
import { cpSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const stageDir = join(repoRoot, "mcpb");
const distSrc = join(repoRoot, "dist");
const distDest = join(stageDir, "dist");

const rootPkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

// Clean previous generated output (manifest.json is hand-authored, left untouched).
rmSync(distDest, { recursive: true, force: true });
rmSync(join(stageDir, "node_modules"), { recursive: true, force: true });

// Copy only what dist/local/index.js imports: local/, mcp/, whoop/.
for (const sub of ["local", "mcp", "whoop"]) {
  cpSync(join(distSrc, sub), join(distDest, sub), { recursive: true });
}

// Minimal package.json so `npm install` only pulls the runtime deps the local
// server actually needs, not the full multi-user-server dependency list.
const stagePkg = {
  name: "whoop-mcp-local",
  version: "0.1.0",
  private: true,
  type: "module",
  dependencies: {
    "@modelcontextprotocol/sdk": rootPkg.dependencies["@modelcontextprotocol/sdk"],
    zod: rootPkg.dependencies.zod,
  },
};
writeFileSync(join(stageDir, "package.json"), JSON.stringify(stagePkg, null, 2) + "\n");

execFileSync("npm", ["install", "--omit=dev"], { cwd: stageDir, stdio: "inherit" });

execFileSync("mcpb", ["pack", "mcpb", "whoop-mcp.mcpb"], { cwd: repoRoot, stdio: "inherit" });
