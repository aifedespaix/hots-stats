import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

const migrationClient = postgres(databaseUrl, { max: 1 });
const db = drizzle(migrationClient);

// fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/...",
// which no longer resolves to the migrations folder.
await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
await migrationClient.end();

console.log("Migrations applied successfully.");
