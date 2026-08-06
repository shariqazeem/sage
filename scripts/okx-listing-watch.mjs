/**
 * Is the OKX listing alive, and do the endpoints still answer the way the reviewer tests them?
 *
 * A rejection costs days. Every one so far was a small, specific, findable thing that was live on
 * production the whole time — a 404 on a path the tool list advertised, a challenge in a header
 * name nobody reads, a bodiless POST answered with 200 where a priced service must answer 402. None
 * of them were visible from the listing page, and all of them were visible from one curl.
 *
 * So this checks both halves and prints them together: what OKX says about the listing, and what a
 * reviewer would actually see if they probed it right now.
 *
 *   node scripts/okx-listing-watch.mjs          # status + endpoint probe
 *   node scripts/okx-listing-watch.mjs --quiet  # one line, for a watcher loop
 *
 * Exit codes: 0 listed/approved · 2 under review · 3 rejected · 4 endpoints wrong · 1 could not check.
 * The endpoint probe needs no credentials; the listing status shells out to `onchainos`, whose
 * keyring is machine-bound, so this only runs where that CLI is logged in.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const AGENT_ID = "9211";
const ORIGIN = "https://sagepays.xyz";
const quiet = process.argv.includes("--quiet");

/** The four priced services, and the price each must quote. Mirrors src/lib/mcp/pricing.ts. */
const PAID = [
  ["sage_first_look", 0.05],
  ["sage_check_evidence", 0.1],
  ["sage_goal_checkpoints", 0.05],
  ["sage_start_inspection", 0.3],
];

/* ── 1. what a reviewer would see ─────────────────────────────────────────────────────────────── */

/**
 * Probe BOTH verbs. OKX's validator defaults to GET and the written guide shows a bodiless POST, so
 * a service can pass one and fail the other — which is exactly how a working endpoint got rejected
 * while answering 402 to every check we happened to run by hand.
 */
async function probe(tool, priceUsd) {
  const url = `${ORIGIN}/mcp/public/${tool}`;
  const out = { tool, ok: false, notes: [] };
  for (const method of ["GET", "POST"]) {
    let res;
    try {
      res = await fetch(url, { method, signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      out.notes.push(`${method} unreachable (${err?.message ?? err})`);
      return out;
    }
    if (res.status !== 402) {
      out.notes.push(`${method} returned ${res.status}, a priced service must return 402`);
      continue;
    }
    const header = res.headers.get("payment-required");
    if (!header) {
      out.notes.push(`${method} 402 carries no payment-required header`);
      continue;
    }
    let accepts = [];
    try {
      accepts = JSON.parse(Buffer.from(header, "base64").toString("utf8")).accepts ?? [];
    } catch {
      out.notes.push(`${method} payment-required header is not decodable`);
      continue;
    }
    const a = accepts[0];
    const want = String(Math.round(priceUsd * 1e6));
    if (!a) out.notes.push(`${method} challenge has no accepts entry`);
    else if (a.amount !== want) out.notes.push(`${method} quotes ${a.amount}, the listing says ${want}`);
    else if (!/^0x[0-9a-fA-F]{40}$/.test(a.payTo ?? "")) out.notes.push(`${method} has no payTo address`);
  }
  out.ok = out.notes.length === 0;
  return out;
}

/* ── 2. what OKX says ─────────────────────────────────────────────────────────────────────────── */

async function listingStatus() {
  const { stdout } = await exec("onchainos", ["agent", "get-my-agents"], {
    maxBuffer: 40 * 1024 * 1024,
    timeout: 180_000,
  });
  const data = JSON.parse(stdout);
  let found = null;
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === "object") {
      if (String(o.agentId) === AGENT_ID) found = o;
      Object.values(o).forEach(walk);
    }
  };
  walk(data);
  if (!found) throw new Error(`agent ${AGENT_ID} not found in get-my-agents`);
  return {
    label: found.approvalLabel ?? "(no label)",
    display: found.approvalDisplayStatus,
    sold: found.soldCount ?? 0,
    // Only the FIRST rejection sentence: the notice repeats itself once per service.
    reason: (found.approvalRemark || "").split("\n")[0].slice(0, 300),
  };
}

/* ── report ───────────────────────────────────────────────────────────────────────────────────── */

const probes = await Promise.all(PAID.map(([t, p]) => probe(t, p)));
const badEndpoints = probes.filter((p) => !p.ok);

let status;
try {
  status = await listingStatus();
} catch (err) {
  console.log(`[okx] could not read listing status: ${err?.message ?? err}`);
  if (badEndpoints.length) for (const p of badEndpoints) console.log(`  · ${p.tool}: ${p.notes.join("; ")}`);
  process.exit(1);
}

const endpointLine = badEndpoints.length
  ? `${badEndpoints.length}/${PAID.length} endpoints WRONG`
  : `all ${PAID.length} endpoints answer 402 on GET and POST at the listed price`;

if (quiet) {
  console.log(`[okx] ${status.label} (display ${status.display}) · sold ${status.sold} · ${endpointLine}`);
} else {
  console.log(`\nListing    ${status.label}  (approvalDisplayStatus ${status.display})`);
  console.log(`Sold       ${status.sold}`);
  console.log(`Endpoints  ${endpointLine}`);
  for (const p of badEndpoints) console.log(`  · ${p.tool}: ${p.notes.join("; ")}`);
  if (status.reason) console.log(`\nReason     ${status.reason}`);
  console.log();
}

if (badEndpoints.length) process.exit(4);
if (status.display === 5) process.exit(3);
if (status.display === 2) process.exit(2);
process.exit(0);
