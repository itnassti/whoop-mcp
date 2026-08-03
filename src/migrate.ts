import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

// Runtime migrations via drizzle-orm's migrator (a production dependency), NOT the
// drizzle-kit CLI. The CLI renders a TTY spinner and can keep its DB connection open
// in a non-interactive container, so `drizzle-kit migrate && npm start` could hang
// after applying migrations and never reach the server start. This script applies
// pending migrations, closes the pool, and exits deterministically.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  console.log("migrations applied");
  await pool.end();
  process.exit(0);
} catch (e) {
  console.error("migration failed:", e);
  await pool.end().catch(() => {});
  process.exit(1);
}
