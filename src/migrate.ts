import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "./db/client.js";

// Runtime migrations via drizzle-orm's migrator (a production dependency), run
// IN-PROCESS from the server entrypoint before it starts listening — NOT as a
// separate `drizzle-kit migrate && npm start` step. The drizzle-kit CLI renders a
// TTY spinner that can hang in a non-interactive container, and a standalone
// migrate process that closes its own pool can hang on pool.end(); either breaks
// the `&&` chain so the server never starts. Reusing the shared getDb() pool and
// leaving it open (the server goes on to use it) avoids both failure modes.
export async function runMigrations(databaseUrl: string): Promise<void> {
  const db = getDb(databaseUrl);
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("migrations applied");
}
