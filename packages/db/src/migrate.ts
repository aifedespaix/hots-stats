import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

const migrationClient = postgres(databaseUrl, { max: 1 });
const db = drizzle(migrationClient);

await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
await migrationClient.end();

console.log("Migrations applied successfully.");
