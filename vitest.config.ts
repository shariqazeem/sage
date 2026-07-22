import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";

// `server-only` / `client-only` are Next build-time markers with no runtime
// package — alias them to an empty module so server code unit-tests directly.
const emptyModule = fileURLToPath(new URL("./vitest.empty.ts", import.meta.url));

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      "server-only": emptyModule,
      "client-only": emptyModule,
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    css: false,
    // Per-file PROCESS isolation (pinned explicitly, not relied on as a default): each test file runs in
    // its own forked process with its own module registry, its own `process.env`, and — with the in-memory
    // SQLite below — its own database. So a test that mutates env (ENTAILMENT_MODE, autopay flags, …) or the
    // DB can never bleed into a concurrently-running file. This is what makes the suite contention-safe.
    pool: "forks",
    isolate: true,
    // Headroom over the 5s default: several integration tests do real DB seeding + crypto (identity
    // hashing) + the full settle pipeline. Under scheduler contention on a loaded CI machine that can creep
    // past 5s and time out spuriously (the observed flake). 15s absorbs contention while a GENUINE hang
    // (unresolved promise) still fails — this is headroom, not retry-based hiding.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // DB-backed drills run against an isolated in-memory SQLite — real schema +
    // real atomic CAS/locks, never the dev database.
    env: { SAGE_DB_PATH: ":memory:" },
  },
});
