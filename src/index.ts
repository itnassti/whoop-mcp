import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { runMigrations } from "./migrate.js";

const config = loadConfig(process.env);
if (config.restrictAccess && config.allowedWhoopEmails.length === 0) {
  console.warn("⚠️  RESTRICT_ACCESS is on but ALLOWED_WHOOP_EMAILS is empty — no one can connect.");
} else if (!config.restrictAccess && config.allowedWhoopEmails.length > 0) {
  console.warn("⚠️  ALLOWED_WHOOP_EMAILS is set but RESTRICT_ACCESS is not true — the server is still open to anyone.");
}
try {
  await runMigrations(config.databaseUrl);
} catch (e) {
  console.error("migration failed at startup:", e);
  process.exit(1);
}
createApp(config).listen(config.port, () => console.log(`listening on ${config.port}`));
