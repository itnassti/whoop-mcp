import { describe, it, expect } from "vitest";
import { getDb, schema } from "../src/db/client.js";
import { eq } from "drizzle-orm";

const url = process.env.DATABASE_URL;
describe.skipIf(!url)("db users table", () => {
  it("inserts and reads a user", async () => {
    const db = getDb(url!);
    const wid = "whoop_" + Math.random().toString(36).slice(2);
    await db.insert(schema.users).values({ whoopUserId: wid });
    const [row] = await db.select().from(schema.users).where(eq(schema.users.whoopUserId, wid));
    expect(row.whoopUserId).toBe(wid);
  });
});
