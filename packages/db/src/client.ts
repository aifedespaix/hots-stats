import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

const queryClient = postgres(databaseUrl);

export const db = drizzle(queryClient, { schema });
export type Database = typeof db;
// Extracted from `db.transaction`'s own callback signature (rather than
// hand-importing drizzle-orm's internal `PgTransaction<...>` generic
// parameters) so it's guaranteed to match whatever `tx` really is -- used by
// service functions that need to run inside a caller's transaction, e.g.
// spatial-rollup.service.ts's `applySpatialRollupDelta`, called from
// replay-upsert.service.ts's own `db.transaction(...)` block.
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
