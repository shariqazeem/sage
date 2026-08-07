/**
 * Build the OKX marketplace service payload from Sage's own price table.
 *
 * The listing and the paywall must agree on the price of every service, because OKX validates
 * price-match between what a service is registered at and what its endpoint's 402 actually asks
 * for. Typing the catalogue twice is how they drift, so this reads `src/lib/mcp/pricing.ts` and
 * emits the `--service` JSON; nothing here restates a price.
 *
 *   node scripts/okx-listing.mjs            # print the payload and the command to run
 *   node scripts/okx-listing.mjs --check    # verify each endpoint answers a valid 402 first
 *
 * It never calls the marketplace itself. Listing changes go through `onchainos agent update`, run
 * deliberately, because a listing that fails review is expensive to get back.
 *
 * A2MCP serviceDescription is four lines and all four are required at listing QA:
 *   1 what the service does · 2 parameter spec · 3 request method · 4 a working curl example.
 */

import { readFileSync } from "node:fs";

const AGENT_ID = "9211";
const ORIGIN = "https://sagepays.xyz";

/* ── the catalogue, read from the code that charges for it ───────────────────────────────────── */

const src = readFileSync(new URL("../src/lib/mcp/pricing.ts", import.meta.url), "utf8");
const block = src.slice(src.indexOf("PAID_SERVICES"), src.indexOf("] as const;"));
const services = [...block.matchAll(/\{\s*tool:\s*"([^"]+)",\s*serviceName:\s*"([^"]+)",\s*priceUsd:\s*([\d.]+),\s*summary:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)].map(
  (m) => ({ tool: m[1], serviceName: m[2], priceUsd: Number(m[3]), summary: JSON.parse(`"${m[4]}"`) }),
);

if (services.length === 0) {
  console.error("[okx] Could not read PAID_SERVICES out of src/lib/mcp/pricing.ts.");
  console.error("      Refusing to emit a listing rather than emit an empty one.");
  process.exit(1);
}

/** The arguments each tool takes, for line 2 and line 4 of the description. */
const PARAMS = {
  sage_first_look: {
    spec: "productUrl (string, required): the public https URL to open",
    example: { productUrl: "https://stripe.com" },
  },
  sage_check_evidence: {
    spec: "productUrl (string, required): the product the account describes; account (string, required): what the person wrote about using it",
    example: {
      productUrl: "https://plausible.io",
      account: "I opened it and saw the headline about ditching Google Analytics, and a Start free trial button.",
    },
  },
  sage_goal_checkpoints: {
    spec: "goal (string, required): what a user should be able to do, in plain language",
    example: { goal: "Make sure a first-time visitor can book a room and see a confirmation." },
  },
  sage_start_inspection: {
    spec: "productUrl (string, required): the product to test; goal (string, required): what testers must verify; targetUsers (string, required): who should test it; budgetUsd (number, required): total testing budget in whole USDC",
    example: {
      productUrl: "https://example.com",
      goal: "Confirm a new user can complete signup and reach the dashboard",
      targetUsers: "First-time users on desktop",
      budgetUsd: 5,
    },
  },
};

const curlFor = (tool, example) =>
  `curl -X POST ${ORIGIN}/mcp/public/${tool} -H "Content-Type: application/json" -d '${JSON.stringify(example)}'`;

/**
 * WHAT THE ENDPOINT ACTUALLY DOES DECIDES WHAT THE LISTING ADVERTISES.
 *
 * OKX accepts two shapes — "① Free endpoint — returns the result directly on call; no billing, no
 * x402. ② x402 pay-per-call endpoint" — and validates that a service's registered fee matches what
 * its endpoint really asks for. The fee used to be read from the price table while the endpoint was
 * governed by a server env var, so the two could disagree without anyone noticing, and a mismatch
 * reads to their reviewer as a broken service.
 *
 * So the live probe is now the authority: `--check` observes each endpoint and the fee is whatever
 * it saw. Advertising is refused outright unless every endpoint was observed and they all agree on
 * one shape.
 */
const observed = new Map(); // tool -> "free" | "paid"

const buildPayload = () =>
  services.map((s) => {
    const p = PARAMS[s.tool];
    if (!p) {
      console.error(`[okx] No parameter spec for ${s.tool}. Add one before listing it.`);
      process.exit(1);
    }
    const mode = observed.get(s.tool);
    return {
      operation: "create",
      serviceName: s.serviceName,
      serviceDescription: [s.summary, p.spec, s.tool, curlFor(s.tool, p.example)].join("\n"),
      serviceType: "A2MCP",
      fee: mode === "paid" ? String(s.priceUsd) : "0",
      endpoint: `${ORIGIN}/mcp/public/${s.tool}`,
    };
  });

/* ── prove what each endpoint ACTUALLY does, then advertise exactly that ────────────────────── */

if (process.argv.includes("--check")) {
  let bad = 0;
  for (const s of services) {
    const url = `${ORIGIN}/mcp/public/${s.tool}`;
    const example = PARAMS[s.tool].example;

    // Both verbs, because OKX probes both: their guide's test is a bodiless POST and their
    // x402-check validator defaults to GET. A service that answers one and not the other reads as
    // broken, and that asymmetry is what sank an earlier submission.
    const probe = async (init) => {
      try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      } catch (err) {
        return { status: 0, err: err?.message ?? String(err), headers: { get: () => null } };
      }
    };
    const withBody = await probe({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(example),
    });
    const bareGet = await probe({ method: "GET" });
    const barePost = await probe({ method: "POST" });

    const codes = [withBody.status, bareGet.status, barePost.status];
    if (codes.includes(0)) {
      console.log(`  FAIL ${s.tool.padEnd(22)} unreachable (${withBody.err ?? bareGet.err ?? barePost.err})`);
      bad++;
      continue;
    }

    if (codes.every((c) => c === 200)) {
      // Shape ①. Nothing to verify, which is the entire point — but it must actually RETURN
      // something, or "free" is just a 200 with an empty promise in it.
      let body = null;
      try {
        body = await withBody.json();
      } catch {
        /* reported below */
      }
      const returnsResult = !!body && typeof body === "object" && Object.keys(body).length > 0;
      console.log(
        `  ${returnsResult ? "ok  " : "FAIL"} ${s.tool.padEnd(22)} FREE — 200 on GET, bodiless POST and POST+args${returnsResult ? "" : ", but returned no result body"}`,
      );
      if (returnsResult) observed.set(s.tool, "free");
      else bad++;
      continue;
    }

    if (codes.every((c) => c === 402)) {
      // Shape ②. The advertised price must equal what the challenge really asks for.
      const header = withBody.headers.get("payment-required");
      let accepts = [];
      try {
        accepts = JSON.parse(Buffer.from(header ?? "", "base64").toString("utf8")).accepts ?? [];
      } catch {
        /* leave empty — reported below */
      }
      const a = accepts[0];
      const wantMinimal = String(Math.round(s.priceUsd * 1e6));
      const ok = a?.scheme === "exact" && a?.amount === wantMinimal && /^0x[0-9a-fA-F]{40}$/.test(a?.payTo ?? "");
      console.log(
        `  ${ok ? "ok  " : "FAIL"} ${s.tool.padEnd(22)} PAID — ${a ? `${a.amount} on ${a.network} → ${a.payTo}` : "no accepts in the payment-required header"}`,
      );
      if (ok) observed.set(s.tool, "paid");
      else bad++;
      continue;
    }

    console.log(`  FAIL ${s.tool.padEnd(22)} inconsistent across verbs: POST+args ${codes[0]}, GET ${codes[1]}, bare POST ${codes[2]}`);
    bad++;
  }

  const shapes = new Set(observed.values());
  if (bad === 0 && shapes.size > 1) {
    console.log(`\nMIXED SHAPES: ${[...shapes].join(" + ")}. Every service must be free, or every service priced.`);
    bad++;
  }
  if (bad) {
    console.log(`\n${bad} endpoint(s) are not advertisable as observed. Fix them before updating the listing.\n`);
    process.exit(2);
  }
  console.log(`\nAll ${services.length} endpoints verified as ${[...shapes][0]?.toUpperCase()}.\n`);
} else {
  console.log(`\nRefusing to print an update command without --check: the fee must come from what the`);
  console.log(`endpoints actually do, not from the price table. Re-run with --check.\n`);
  process.exit(2);
}

/* ── output ─────────────────────────────────────────────────────────────────────────────────── */

const payload = buildPayload();
const json = JSON.stringify(payload);
const free = payload.every((p) => p.fee === "0");
console.log(
  free
    ? `\n${services.length} services, listed FREE (endpoints return the result directly):\n`
    : `\n${services.length} services, ${services.reduce((n, s) => n + s.priceUsd, 0).toFixed(2)} USDT to buy the whole catalogue once:\n`,
);
for (const p of payload)
  console.log(`  ${(p.fee === "0" ? "free" : "$" + p.fee).padEnd(6)} ${p.serviceName.padEnd(30)} ${p.endpoint}`);
console.log(`\nRun this to publish (review it first):\n`);
console.log(`onchainos agent update --agent-id ${AGENT_ID} --service '${json.replace(/'/g, "'\\''")}'\n`);
console.log(`To MODIFY an already-listed service, change its element to {"operation":"update","id":"<service id>",…}`);
console.log(`Existing ids come from: onchainos agent service-list --agent-id ${AGENT_ID}\n`);
