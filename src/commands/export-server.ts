import { createServer } from "node:http";
import { spawn } from "node:child_process";

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (["user_id", "v1_id", "id", "sleep_id", "cycle_id"].includes(key)) continue;
      out[key] = sanitize(child);
    }
    return out;
  }
  return value;
}

async function runExport() {
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/commands/export.js"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr || `export exited ${code}`));
      const daily: unknown[] = [];
      const workouts: unknown[] = [];
      let body: unknown = null;
      let counts: unknown = null;
      for (const line of stdout.split(/\r?\n/)) {
        if (line.startsWith("DAILY ")) daily.push(sanitize(JSON.parse(line.slice(6))));
        else if (line.startsWith("WORKOUT ")) workouts.push(sanitize(JSON.parse(line.slice(8))));
        else if (line.startsWith("BODY ")) body = sanitize(JSON.parse(line.slice(5)));
        else if (line.startsWith("COUNTS ")) counts = JSON.parse(line.slice(7));
      }
      resolve({ exportedAt: new Date().toISOString(), daily, workouts, body, counts });
    });
  });
}

const key = process.env.EXPORT_KEY;
if (!key) throw new Error("EXPORT_KEY is required");
const port = Number(process.env.PORT || 8080);
let cached: Record<string, unknown> | null = null;
let running: Promise<Record<string, unknown>> | null = null;

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.searchParams.get("key") !== key) {
    res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({ error: "unauthorized" }));
  }
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (url.pathname !== "/export") {
    res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({ error: "not found" }));
  }
  try {
    if (!cached) {
      running ??= runExport();
      cached = await running;
    }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(cached));
  } catch (error) {
    const message = error instanceof Error ? error.message : "export failed";
    res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ error: message }));
  }
}).listen(port, "0.0.0.0", () => console.log(`export bridge listening on ${port}`));
