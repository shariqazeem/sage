import "server-only";

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

/**
 * The database, isolated here so swapping the driver is a one-file change.
 *
 * Local/dev: better-sqlite3 at var/sage.db. On a serverless deploy (Vercel) this
 * file has no persistence — swap this module to Neon Postgres (DATABASE_URL) or
 * Turso/libsql (which keeps the same SQLite dialect + these migrations). Nothing
 * else in the app imports a driver directly; everything imports `db` from here.
 *
 * Initialization is LAZY (see the proxy below): the file open + migrations run on
 * the first query at runtime, never at import time — so `next build` can collect
 * these routes without opening the database.
 */
type DB = BetterSQLite3Database<typeof schema>;

const DB_PATH =
  process.env.SAGE_DB_PATH ?? join(process.cwd(), "var", "sage.db");

function init(): DB {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  const database = drizzle(sqlite, { schema });
  try {
    migrate(database, { migrationsFolder: join(process.cwd(), "drizzle") });
  } catch (err) {
    console.error("[db] migration failed:", err);
  }
  return database;
}

// Memoize across Next HMR / hot reloads so we don't reopen the file each render.
const g = globalThis as unknown as { __sageDb?: DB };
function getDb(): DB {
  return (g.__sageDb ??= init());
}

/**
 * Lazily-initialized handle. Property access triggers init() on first use, so
 * importing this module (at build time, or from a route that never queries) is
 * side-effect free.
 */
export const db = new Proxy({} as DB, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
