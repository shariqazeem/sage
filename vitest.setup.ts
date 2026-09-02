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
/**
 * Every flag that GATES a live battery, derived from the batteries themselves.
 *
 * This was hand-written and immediately wrong: it missed WORK_EVAL, PAYOUT_DRILL, RENDER_LIVE and
 * the whole GROUNDING_* family, and listed two flags that exist nowhere. A battery whose gate is
 * missing here runs with NO credentials — the brain degrades to the keyword heuristic and every row
 * reads as a quality failure, which is indistinguishable from a real regression.
 *
 * `live-flags.test.ts` scans the live tests for their `process.env.X === "1"` gates and fails if any
 * is absent, so the next battery someone adds cannot quietly run blind.
 */
export const LIVE_FLAGS = [
  "AUTH_ROUTE_TEST", "CANARY_CLOSURE", "CANARY_CLOSURE_DET", "CANARY_CLOSURE_V2",
  "CANARY_CLOSURE_V2_DRY", "DIRECT_EVAL", "ENTAIL_EVAL", "ESCROW_PROVE", "FINAL_COMPOSITION",
  "GROUNDING_CANARY_SMOKE", "GROUNDING_CANARY_SMOKE_DRYRUN", "GROUNDING_CRITIC2",
  "GROUNDING_CRITIC2_DRYRUN", "GROUNDING_CRITIC_BAKEOFF", "GROUNDING_CRITIC_DRYRUN",
  "GROUNDING_SEMANTIC", "GROUNDING_SEMANTIC_DRYRUN", "GROUNDING_SMOKE", "GROUNDING_SMOKE_DRYRUN",
  "GROUNDING_SMOKE_RESUME", "GROUNDING_STRUCTURED", "GROUNDING_STRUCTURED_DRYRUN", "JUDGE_EVAL",
  "LIVE_JUDGE_EVAL", "OBS_LIVE_EVAL", "PAYOUT_DRILL", "PROMOTION_EVAL", "PROMO_RESUME",
  "RENDER_LIVE", "ROUTE_EVAL", "STARKNET_DEPLOY_DRYRUN", "STARKNET_DRYRUN",
  "STARKNET_PROVENANCE_LIVE", "VERIFY_LIVE", "WORK_EVAL", "WORK_PROBE",
  // Not a gate — an explicit escape hatch for running any live file by hand.
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
