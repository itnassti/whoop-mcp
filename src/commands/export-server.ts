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

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

type Snapshot = { exportedAt: string; daily: any[]; workouts: any[]; body: unknown; counts: unknown };

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
      const daily: any[] = [];
      const workouts: any[] = [];
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

function dailyCsv(snapshot: Snapshot): string {
  const rows = snapshot.daily.map(({ recovery: r, sleep: s, cycle: c }) => {
    const st = s?.score?.stage_summary;
    const sleepHours = st ? (st.total_in_bed_time_milli - st.total_awake_time_milli - st.total_no_data_time_milli) / 3600000 : null;
    return [
      r?.created_at?.slice(0, 10), r?.score?.recovery_score, r?.score?.hrv_rmssd_milli,
      r?.score?.resting_heart_rate, r?.score?.spo2_percentage, r?.score?.skin_temp_celsius,
      s?.score?.sleep_performance_percentage, sleepHours, s?.score?.sleep_efficiency_percentage,
      s?.score?.respiratory_rate, c?.score?.strain, c?.score?.average_heart_rate,
      c?.score?.max_heart_rate, c?.score?.kilojoule, r?.updated_at, ""
    ];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return [
    csvRow(["date","recovery_score","hrv_rmssd_ms","resting_hr_bpm","spo2_pct","skin_temp_c","sleep_performance_pct","sleep_duration_h","sleep_efficiency_pct","respiratory_rate","day_strain","avg_hr","max_hr","kilojoule","updated_at","raw_json"]),
    ...rows.map(csvRow)
  ].join("\n");
}

function workoutsCsv(snapshot: Snapshot): string {
  const rows = snapshot.workouts.map((w) => {
    const z = w?.score?.zone_durations || {};
    return [
      w?.start, w?.end, w?.sport_name, w?.score?.strain, w?.score?.average_heart_rate,
      w?.score?.max_heart_rate, w?.score?.kilojoule, w?.score?.distance_meter,
      z.zone_zero_milli, z.zone_one_milli, z.zone_two_milli, z.zone_three_milli,
      z.zone_four_milli, z.zone_five_milli, w?.updated_at, ""
    ];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return [
    csvRow(["start","end","sport","strain","avg_hr","max_hr","kilojoule","distance_m","zone_0_ms","zone_1_ms","zone_2_ms","zone_3_ms","zone_4_ms","zone_5_ms","updated_at","raw_json"]),
    ...rows.map(csvRow)
  ].join("\n");
}

const key = process.env.EXPORT_KEY;
if (!key) throw new Error("EXPORT_KEY is required");
const port = Number(process.env.PORT || 8080);
let cached: Snapshot | null = null;
let running: Promise<Snapshot> | null = null;

async function getSnapshot(): Promise<Snapshot> {
  if (!cached) {
    running ??= runExport();
    cached = await running;
  }
  return cached;
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  res.setHeader("cache-control", "no-store");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (url.searchParams.get("key") !== key) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "unauthorized" }));
  }
  try {
    const snapshot = await getSnapshot();
    if (url.pathname === "/daily.csv") {
      res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
      return res.end(dailyCsv(snapshot));
    }
    if (url.pathname === "/workouts.csv") {
      res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
      return res.end(workoutsCsv(snapshot));
    }
    if (url.pathname === "/export") {
      const kind = url.searchParams.get("kind") || "counts";
      res.setHeader("content-type", "application/json");
      if (kind === "counts") return res.end(JSON.stringify({ exportedAt: snapshot.exportedAt, counts: snapshot.counts }));
      if (kind === "body") return res.end(JSON.stringify({ exportedAt: snapshot.exportedAt, body: snapshot.body }));
      const source = kind === "daily" ? snapshot.daily : kind === "workouts" ? snapshot.workouts : null;
      if (!source) { res.writeHead(400); return res.end(JSON.stringify({ error: "invalid kind" })); }
      const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 25)));
      return res.end(JSON.stringify({ exportedAt: snapshot.exportedAt, kind, offset, limit, total: source.length, items: source.slice(offset, offset + limit) }));
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "export failed";
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}).listen(port, "0.0.0.0", () => console.log(`export bridge listening on ${port}`));
