import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * LOAD .env FOR LIVE BATTERIES ONLY.
 *
 * Next loads `.env` itself, so production and `scripts/*.mjs` (which read it explicitly) both see
 * the keys. Vitest does neither: a battery run with the documented command sees only the ambient
 * shell, and on the VM the keys live in `.env`, not the shell. P-DIRECT reported 33 provider
 * failures and "no concierge api key in env" while `lane-audit` printed that same key as present —
 * the battery was never given credentials, and only its own guard stopped it from scoring the run.
 *
 * 17 of the 20 live batteries have no such guard, so for those this renders as a quality failure
 * on every row. That is the broken-ruler family again (P-GEN anonymous, the x402 portal, the stale
 * GOAT node): the reading looks like the world and is actually the instrument.
 *
 * Guarded on a live flag so the ordinary suite is byte-identical — those tests deliberately run
 * with no keys (the brain must degrade to the heuristic that can never auto-pay), and handing them
 * real credentials would change branches and could spend money. A real env var always wins, so an
 * explicit `FOO=bar npx vitest` still overrides the file.
 */
const LIVE_FLAGS = [
  "DIRECT_EVAL", "ROUTE_EVAL", "JUDGE_EVAL", "OBS_LIVE_EVAL", "VERIFY_LIVE",
  "STARKNET_DRYRUN", "WORK_ONLY", "LIVE_EVAL", "PROMOTION_EVAL", "ENTAILMENT_EVAL",
  "SAGE_TEST_ENV",
];
if (LIVE_FLAGS.some((f) => process.env[f])) {
  const path = join(process.cwd(), ".env");
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, k, raw] = m;
      if (process.env[k] !== undefined) continue; // the shell always wins
      process.env[k] = raw.trim().replace(/^["']|["']$/g, "");
    }
  }
}

afterEach(() => {
  cleanup();
});
