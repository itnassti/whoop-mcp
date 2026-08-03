import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { runMigrations } from "./migrate.js";

const config = loadConfig(process.env);
try {
  await runMigrations(config.databaseUrl);
} catch (e) {
  console.error("migration failed at startup:", e);
  process.exit(1);
}
createApp(config).listen(config.port, () => console.log(`listening on ${config.port}`));
