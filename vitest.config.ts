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
    // DB-backed drills run against an isolated in-memory SQLite — real schema +
    // real atomic CAS/locks, never the dev database.
    env: { SAGE_DB_PATH: ":memory:" },
  },
});
