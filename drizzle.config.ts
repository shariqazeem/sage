import { defineConfig } from "drizzle-kit";

// Local dialect is SQLite (better-sqlite3). Deploy swap (Neon/Turso) changes the
// driver in src/lib/db/index.ts; keep migrations generated from this schema.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
});
