import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Prepares the database the tests run against.
 *
 * Set TEST_DATABASE_URL to use a Postgres you already have (CI does this with
 * a service container). Point it at an empty, throwaway database: the schema
 * is applied with `prisma migrate deploy`, and every test empties the tables
 * before it runs. If you change a migration, drop and recreate that database.
 * With nothing set, a temporary PostgreSQL is started through
 * `embedded-postgres` (which cannot run as root) and removed afterwards.
 */
export default async function setup() {
  let url = process.env.TEST_DATABASE_URL;
  let stop: (() => Promise<void>) | undefined;

  if (!url) {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voidsuggest-test-pg-"));
    const port = 56000 + Math.floor(Math.random() * 1000);
    const pg = new EmbeddedPostgres({ databaseDir: dir, user: "test", password: "test", port, persistent: false });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("voidsuggest_test");
    url = `postgresql://test:test@127.0.0.1:${port}/voidsuggest_test`;
    stop = async () => {
      await pg.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    };
  }

  // The tests delete every row, so refuse to run against anything that does
  // not look like a test database.
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run tests against database "${dbName}": its name must contain "test".`);
  }

  process.env.DATABASE_URL = url;
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
    stdio: "pipe",
  });

  return async () => {
    await stop?.();
  };
}
