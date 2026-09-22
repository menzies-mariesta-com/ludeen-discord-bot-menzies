import path from "node:path";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { db } from "./index";

export async function runMigrations(): Promise<void> {
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  await migrate(db, { migrationsFolder });
  console.log("[db] Migrations applied");
}
