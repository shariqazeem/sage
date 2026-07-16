import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";

// Dedicated config for the Metis Sepolia safety exercise ONLY. Kept out of the
// default `npm run test` glob so a real-broadcast harness can never run in CI.
// Inherits the server-only shim + @/ path resolution; does NOT force an
// in-memory DB (the staging file DB comes from SAGE_DB_PATH in the process env).
const emptyModule = fileURLToPath(new URL("../../vitest.empty.ts", import.meta.url));

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: { alias: { "server-only": emptyModule, "client-only": emptyModule } },
  test: {
    environment: "node",
    globals: false,
    include: ["scripts/metis-safety/*.exercise.ts"],
    testTimeout: 240000,
    hookTimeout: 240000,
    pool: "forks",
  },
});
