import { spawn } from "node:child_process";

function field(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\t\r\n]/g, " ");
}

async function main() {
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/commands/export.js"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => { out += c.toString(); });
    child.stderr.on("data", (c) => { err += c.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(out) : reject(new Error(err || `export exited ${code}`)));
  });

  const daily: string[][] = [];
  const workouts: string[][] = [];
  let counts = "";

  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("DAILY ")) {
      const { recovery: r, sleep: s, cycle: c } = JSON.parse(line.slice(6));
      const st = s?.score?.stage_summary;
      const sleepHours = st ? (st.total_in_bed_time_milli - st.total_awake_time_milli - st.total_no_data_time_milli) / 3600000 : null;
      daily.push([
        r?.created_at?.slice(0, 10), r?.score?.recovery_score, r?.score?.hrv_rmssd_milli,
        r?.score?.resting_heart_rate, r?.score?.spo2_percentage, r?.score?.skin_temp_celsius,
        s?.score?.sleep_performance_percentage, sleepHours, s?.score?.sleep_efficiency_percentage,
        s?.score?.respiratory_rate, c?.score?.strain, c?.score?.average_heart_rate,
        c?.score?.max_heart_rate, c?.score?.kilojoule, r?.updated_at, ""
      ].map(field));
    } else if (line.startsWith("WORKOUT ")) {
      const w = JSON.parse(line.slice(8));
      const z = w?.score?.zone_durations || {};
      workouts.push([
        w?.start, w?.end, w?.sport_name, w?.score?.strain, w?.score?.average_heart_rate,
        w?.score?.max_heart_rate, w?.score?.kilojoule, w?.score?.distance_meter,
        z.zone_zero_milli, z.zone_one_milli, z.zone_two_milli, z.zone_three_milli,
        z.zone_four_milli, z.zone_five_milli, w?.updated_at, ""
      ].map(field));
    } else if (line.startsWith("COUNTS ")) {
      counts = line.slice(7);
    }
  }

  daily.sort((a, b) => a[0].localeCompare(b[0]));
  workouts.sort((a, b) => a[0].localeCompare(b[0]));

  console.log("DROW|" + ["date","recovery_score","hrv_rmssd_ms","resting_hr_bpm","spo2_pct","skin_temp_c","sleep_performance_pct","sleep_duration_h","sleep_efficiency_pct","respiratory_rate","day_strain","avg_hr","max_hr","kilojoule","updated_at","raw_json"].join("\t"));
  for (const row of daily) console.log("DROW|" + row.join("\t"));
  console.log("WROW|" + ["start","end","sport","strain","avg_hr","max_hr","kilojoule","distance_m","zone_0_ms","zone_1_ms","zone_2_ms","zone_3_ms","zone_4_ms","zone_5_ms","updated_at","raw_json"].join("\t"));
  for (const row of workouts) console.log("WROW|" + row.join("\t"));
  console.log("TSV_COUNTS|" + counts);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "TSV export failed");
  process.exitCode = 1;
});
