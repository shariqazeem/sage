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

const payload = services.map((s) => {
  const p = PARAMS[s.tool];
  if (!p) {
    console.error(`[okx] No parameter spec for ${s.tool}. Add one before listing it.`);
    process.exit(1);
  }
  return {
    operation: "create",
    serviceName: s.serviceName,
    serviceDescription: [s.summary, p.spec, s.tool, curlFor(s.tool, p.example)].join("\n"),
    serviceType: "A2MCP",
    fee: String(s.priceUsd),
    endpoint: `${ORIGIN}/mcp/public/${s.tool}`,
  };
});

/* ── optional: prove each endpoint answers a valid 402 before advertising it ─────────────────── */

if (process.argv.includes("--check")) {
  let bad = 0;
  for (const s of services) {
    const url = `${ORIGIN}/mcp/public/${s.tool}`;
    const example = PARAMS[s.tool].example;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(example),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      console.log(`  FAIL ${s.tool}: unreachable (${err?.message ?? err})`);
      bad++;
      continue;
    }
    const header = res.headers.get("payment-required");
    let accepts = [];
    try {
      accepts = JSON.parse(Buffer.from(header ?? "", "base64").toString("utf8")).accepts ?? [];
    } catch {
      /* leave empty — reported below */
    }
    const a = accepts[0];
    const wantMinimal = String(Math.round(s.priceUsd * 1e6));
    const ok =
      res.status === 402 && a?.scheme === "exact" && a?.amount === wantMinimal && /^0x[0-9a-fA-F]{40}$/.test(a?.payTo ?? "");
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${s.tool.padEnd(22)} HTTP ${res.status} ${a ? `${a.amount} on ${a.network} → ${a.payTo}` : "no accepts in the payment-required header"}`,
    );
    if (!ok) bad++;
  }
  if (bad) {
    console.log(`\n${bad} endpoint(s) would be advertised at a price they do not actually ask for.`);
    console.log(`Fix them before updating the listing: a price mismatch reads as a broken service.\n`);
    process.exit(2);
  }
  console.log(`\nAll ${services.length} endpoints answer a valid, correctly priced 402.\n`);
}

/* ── output ─────────────────────────────────────────────────────────────────────────────────── */

const json = JSON.stringify(payload);
console.log(`\n${services.length} services, ${services.reduce((n, s) => n + s.priceUsd, 0).toFixed(2)} USDT to buy the whole catalogue once:\n`);
for (const s of services) console.log(`  $${String(s.priceUsd).padEnd(5)} ${s.serviceName.padEnd(30)} ${ORIGIN}/mcp/public/${s.tool}`);
console.log(`\nRun this to publish (review it first):\n`);
console.log(`onchainos agent update --agent-id ${AGENT_ID} --service '${json.replace(/'/g, "'\\''")}'\n`);
console.log(`To MODIFY an already-listed service, change its element to {"operation":"update","id":"<service id>",…}`);
console.log(`Existing ids come from: onchainos agent service-list --agent-id ${AGENT_ID}\n`);
