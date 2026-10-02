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

type Snapshot = {
  exportedAt: string;
  daily: unknown[];
  workouts: unknown[];
  body: unknown;
  counts: unknown;
};

async function runExport(): Promise<Snapshot> {
  return await new Promise<Snapshot>((resolve, reject) => {
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
let cached: Snapshot | null = null;
let running: Promise<Snapshot> | null = null;

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json");

  if (url.pathname === "/health") {
    res.writeHead(200);
    return res.end(JSON.stringify({ ok: true }));
  }
  if (url.searchParams.get("key") !== key) {
    res.writeHead(401);
    return res.end(JSON.stringify({ error: "unauthorized" }));
  }
  if (url.pathname !== "/export") {
    res.writeHead(404);
    return res.end(JSON.stringify({ error: "not found" }));
  }

  try {
    if (!cached) {
      running ??= runExport();
      cached = await running;
    }
    const kind = url.searchParams.get("kind") || "counts";
    if (kind === "counts") {
      res.writeHead(200);
      return res.end(JSON.stringify({ exportedAt: cached.exportedAt, counts: cached.counts }));
    }
    if (kind === "body") {
      res.writeHead(200);
      return res.end(JSON.stringify({ exportedAt: cached.exportedAt, body: cached.body }));
    }
    const source = kind === "daily" ? cached.daily : kind === "workouts" ? cached.workouts : null;
    if (!source) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: "kind must be counts, body, daily, or workouts" }));
    }
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 25)));
    res.writeHead(200);
    return res.end(JSON.stringify({
      exportedAt: cached.exportedAt,
      kind,
      offset,
      limit,
      total: source.length,
      items: source.slice(offset, offset + limit),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "export failed";
    res.writeHead(500);
    res.end(JSON.stringify({ error: message }));
  }
}).listen(port, "0.0.0.0", () => console.log(`export bridge listening on ${port}`));
