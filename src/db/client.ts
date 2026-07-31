import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

let db: NodePgDatabase<typeof schema> | undefined;
export function getDb(databaseUrl: string) {
  if (!db) db = drizzle(new pg.Pool({ connectionString: databaseUrl }), { schema });
  return db;
}
export { schema };
