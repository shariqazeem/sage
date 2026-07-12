import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright runs against the Next.js dev server. The webServer block boots
 * `npm run dev` and waits for it to respond before the suite starts.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      // The founder-deployment E2E drives the REAL routes + state machine with an injected
      // wallet and a deterministic fake chain (SAGE_E2E). The launch chain is configured
      // with the golden testnet addresses so the server can build valid settings; no key,
      // no broadcast. A dedicated temp DB keeps E2E rows out of the dev database.
      SAGE_E2E: "1",
      SAGE_SESSION_SECRET: "e2e-session-secret-not-for-production",
      SAGE_DB_PATH: process.env.SAGE_E2E_DB_PATH ?? "./var/e2e.db",
      NEXT_PUBLIC_USDC_ADDRESS: "0xF176f521290A937d81cc5878dfc19908f4D681A1",
      METIS_CAMPAIGN_FACTORY_ADDRESS: "0x2249b773aFEd5594985F7D350581A1b55f279C7f",
      NEXT_PUBLIC_OPERATOR_ADDRESS: "0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35",
    },
  },
});
