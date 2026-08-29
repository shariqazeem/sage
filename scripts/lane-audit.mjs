/**
 * LANE AUDIT — print the provider each LLM lane actually resolves to, and flag partial config.
 *
 * A lane is ABSENT unless KEY + BASE_URL + MODEL are all set; partial config silently inherits the
 * shared chain, which is how mission design and the observation judge sat on a metered key for
 * weeks while everything else ran on a sponsored one. This makes that visible in one command.
 *
 *   node scripts/lane-audit.mjs
 *
 * IT LOADS .env ITSELF. Run under plain `node` it read only the ambient process.env, found
 * nothing, and printed `key=(unset)` for every lane — which is exactly what a genuinely
 * unconfigured deployment looks like, and which reads as "Sage cannot auto-pay at all". An
 * instrument whose failure is indistinguishable from the emergency it reports is worse than no
 * instrument, so it now says out loud which env file it used.
 */
import { existsSync, readFileSync } from "node:fs";

/** Minimal .env reader — enough for `KEY=value`, which is all this audit needs. */
function loadEnvFile(path) {
  if (!existsSync(path)) return false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k] !== undefined) continue; // a real env var always wins
    process.env[k] = raw.trim().replace(/^["']|["']$/g, "");
  }
  return true;
}

const envPath = process.argv[2] ?? ".env";
const loaded = loadEnvFile(envPath);
console.log(loaded ? `env               loaded from ${envPath}` : `env               NO ${envPath} — reading the ambient environment only`);
console.log("");

const LANES = ["PAYOUT", "CONCIERGE", "MISSION", "OBS_JUDGE", "VISION"];
const host = (u) => { try { return new URL(u).host; } catch { return u || "(unset)"; } };
const mask = (k) => (k ? `${k.slice(0, 8)}…` : "(unset)");

const sharedKey = process.env.LLM_API_KEY?.trim() || process.env.COMMONSTACK_API_KEY?.trim();
const sharedBase = process.env.LLM_BASE_URL?.trim() || process.env.COMMONSTACK_BASE_URL?.trim() || "https://api.commonstack.ai/v1";
const sharedModel = process.env.LLM_MODEL?.trim() || process.env.DEPUTY_MODEL?.trim() || "deepseek/deepseek-v4-flash";

console.log(`shared chain      key=${mask(sharedKey)}  host=${host(sharedBase)}  model=${sharedModel}\n`);
let partial = 0;
for (const lane of LANES) {
  const k = process.env[`${lane}_API_KEY`]?.trim();
  const b = process.env[`${lane}_BASE_URL`]?.trim();
  const m = process.env[`${lane}_MODEL`]?.trim();
  if (k && b && m) {
    console.log(`${lane.padEnd(11)} OWN      key=${mask(k)}  host=${host(b)}  model=${m}`);
  } else if (k || b) {
    // MODEL-only is the DOCUMENTED shared-chain override and is fine. A stray KEY or BASE_URL is
    // not: it says someone meant to route this lane elsewhere, and the lane is silently still on
    // the shared chain — the failure this rule exists to prevent.
    partial++;
    const set = [k && "KEY", b && "BASE", m && "MODEL"].filter(Boolean).join("+");
    console.log(`${lane.padEnd(11)} PARTIAL  only ${set} set -> ABSENT, silently inherits the shared chain`);
    console.log(`${" ".repeat(11)}          ^ set all three or none; a half-configured lane is never merged.`);
  } else if (m) {
    console.log(`${lane.padEnd(11)} shared   host=${host(sharedBase)}  model=${m}  (model override on the shared chain)`);
  } else {
    console.log(`${lane.padEnd(11)} shared   host=${host(sharedBase)}  model=${sharedModel}`);
  }
}
const fk = process.env.LLM_FALLBACK_API_KEY?.trim(), fb = process.env.LLM_FALLBACK_BASE_URL?.trim(), fm = process.env.LLM_FALLBACK_MODEL?.trim();
console.log(`\nfallback          ${fk && fb && fm ? `ARMED host=${host(fb)} model=${fm}` : "ABSENT — a primary outage drops to the heuristic, which can NEVER auto-pay"}`);
if (partial) { console.error(`\n${partial} lane(s) PARTIALLY configured — see above.`); process.exit(1); }
