import { loadConfig } from "../config.js";
import { getDb, schema } from "../db/client.js";
import { TokenStore } from "../auth/token-store.js";
import { refreshWhoopTokens } from "../whoop/oauth.js";
import { WhoopClient } from "../whoop/client.js";

async function main() {
  const config = loadConfig(process.env);
  const db = getDb(config.databaseUrl);
  const creds = { clientId: config.whoopClientId, clientSecret: config.whoopClientSecret };
  const tokenStore = new TokenStore(db, config.encryptionKey, (rt) => refreshWhoopTokens(rt, creds));

  const users = await db.select({ id: schema.users.id }).from(schema.users).limit(2);
  if (users.length !== 1) throw new Error(`Expected exactly one connected WHOOP user; found ${users.length}`);

  const userId = users[0].id;
  const client = new WhoopClient(
    () => tokenStore.getValidAccessToken(userId),
    () => tokenStore.forceRefreshAccessToken(userId),
  );

  const end = new Date().toISOString();
  const start = "2015-01-01T00:00:00.000Z";
const range = { start, end, limit: 10000 };
  
  const [recovery, sleep, cycles, workouts, bodyMeasurement] = await Promise.all([
    client.getRecovery(range),
    client.getSleep(range),
    client.getCycles(range),
    client.getWorkouts(range),
    client.getBodyMeasurement(),
  ]);

const sleepByCycle = new Map(sleep.map((x) => [x.cycle_id, x]));
const cycleById = new Map(cycles.map((x) => [x.id, x]));

for (const r of recovery) {
  const s = sleepByCycle.get(r.cycle_id);
  const c = cycleById.get(r.cycle_id);

  console.log("DAILY " + JSON.stringify({
    recovery: r,
    sleep: s ?? null,
    cycle: c ?? null
  }));
}

for (const w of workouts) {
  console.log("WORKOUT " + JSON.stringify(w));
}

console.log("BODY " + JSON.stringify(bodyMeasurement));

console.log("COUNTS " + JSON.stringify({
  recovery: recovery.length,
  sleep: sleep.length,
  cycles: cycles.length,
  workouts: workouts.length
}));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "WHOOP snapshot export failed";
  console.error(message);
  process.exitCode = 1;
});
