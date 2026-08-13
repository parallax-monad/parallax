import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";

const migrationsDirectory = fileURLToPath(
  new URL("../../migrations", import.meta.url),
);

/** Runs versioned migrations with node-pg-migrate's advisory lock. */
export function migratePostgres(databaseUrl: string) {
  return runner({
    databaseUrl,
    dir: migrationsDirectory,
    direction: "up",
    migrationsTable: "pgmigrations",
    advisoryLockMode: "wait",
    singleTransaction: true,
    verbose: false,
  });
}
