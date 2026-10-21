/**
 * Local development database. Runs a real PostgreSQL server as a child
 * process via the `embedded-postgres` package, so contributors don't need
 * Docker or a system Postgres. Production never uses this: Docker Compose
 * runs a normal `postgres` container.
 *
 *   pnpm dev:db        # leave running in its own terminal
 *
 * PostgreSQL refuses to run as root, so run this as a normal user.
 */
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.env.PGDATA_DIR ?? ".pgdata");
const port = Number(process.env.PGPORT ?? 55432);
const user = process.env.PGUSER_NAME ?? "voidsuggest";
const password = process.env.PGPASSWORD_VALUE ?? "voidsuggest_dev";
const dbName = process.env.PGDATABASE_NAME ?? "voidsuggest";

async function main() {
  const initialised = fs.existsSync(path.join(dataDir, "PG_VERSION"));

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user,
    password,
    port,
    persistent: true,
  });

  if (!initialised) {
    console.log("[dev-db] initialising a new local cluster...");
    await pg.initialise();
  }

  await pg.start();
  if (!initialised) {
    await pg.createDatabase(dbName);
  }

  console.log(`[dev-db] listening on 127.0.0.1:${port}`);
  console.log(`[dev-db] DATABASE_URL=postgresql://${user}:${password}@127.0.0.1:${port}/${dbName}`);
  console.log("[dev-db] leave this running while you develop. Ctrl+C to stop.");

  const shutdown = async () => {
    console.log("\n[dev-db] stopping...");
    await pg.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[dev-db] failed to start:", err);
  process.exit(1);
});
