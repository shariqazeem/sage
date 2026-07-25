/**
 * Public-MCP END-TO-END — the checklist a marketplace reviewer would actually run, driven by the
 * OFFICIAL SDK client from outside the app process, with no key.
 *
 *   node scripts/mcp-public-e2e.mjs
 *
 * Covers: initialize · tools/list · start a fresh inspection · poll to a terminal stage · force and
 * answer a needs_input · approval URL reachable · read a campaign · read a real payout proof ·
 * bounded errors · repeated identical calls never hand back a stale plan.
 *
 * Starts REAL inspections (they cost browsing + model time), so it is not part of the unit suite.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ENDPOINT = process.env.MCP_URL || "https://sagepays.xyz/mcp/public";
const READY_TX =
  process.env.PROOF_TX ||
  "0x2936293ef62364ffb04e6968593f135af2508e4574110aa32d6d9939e3331299";

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
};

async function connect(name) {
  const c = new Client({ name, version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(ENDPOINT)));
  return c;
}
const json = (r) => {
  try {
    return JSON.parse(r.content?.[0]?.text ?? "{}");
  } catch {
    return { __raw: r.content?.[0]?.text };
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollUntilTerminal(client, id, maxMs = 420_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < maxMs) {
    await sleep(10_000);
    last = json(await client.callTool({ name: "sage_get_inspection", arguments: { inspectionId: id } }));
    if (last.ready || last.stage === "needs_input" || last.stage === "failed") return last;
  }
  return last;
}

console.log(`Public MCP end-to-end → ${ENDPOINT}\n`);

// ── client A: the happy path ────────────────────────────────────────────────
const a = await connect("okx-review-sim-a");
check("1. initialize succeeds with no credentials", a.getServerVersion()?.name === "sage");

const tools = (await a.listTools()).tools;
check("2. lists all five tools", tools.length === 5, tools.map((t) => t.name).join(","));

const GOAL =
  "A tester should land on the site, walk into the world, find the Yara character and have a real conversation with her.";
const startArgs = {
  productUrl: "https://yara.garden",
  goal: GOAL,
  targetUsers: "first-time visitors",
  budgetUsd: 1.5,
};
const started = json(await a.callTool({ name: "sage_start_inspection", arguments: startArgs }));
check("3. starts a fresh inspection", started.ok === true && !!started.inspectionId, JSON.stringify(started).slice(0, 200));

let view = null;
if (started.ok) {
  view = await pollUntilTerminal(a, started.inspectionId);
  check(
    "4. polls to a terminal stage",
    !!view && (view.ready || view.stage === "needs_input" || view.stage === "failed"),
    `stage=${view?.stage}`,
  );
  check(
    "4b. the plan echoes the goal it was asked to answer",
    view?.goal === GOAL,
    `got: ${String(view?.goal).slice(0, 80)}`,
  );

  const url = view?.approvalUrl;
  if (url) {
    const res = await fetch(url, { redirect: "follow" });
    check("6. the approval URL it hands back actually loads", res.status === 200, `HTTP ${res.status} ${url}`);
  } else {
    check("6. the approval URL it hands back actually loads", false, "no approvalUrl returned");
  }

  if (view?.ready && view.plan) {
    const m = view.plan.missions?.[0];
    const exact =
      BigInt(view.plan.totalBudgetBase) ===
      (view.plan.missions ?? []).reduce(
        (s, x) => s + BigInt(x.rewardBase) * BigInt(x.maxCompletions),
        0n,
      );
    check("4c. the budget adds up exactly", exact, `${m?.rewardUsd} x ${m?.maxCompletions}`);
  }
}

// ── 10. repeated identical calls must not hand back a stale plan ────────────
const again = json(await a.callTool({ name: "sage_start_inspection", arguments: startArgs }));
check(
  "10. an identical repeat call is a NEW request, not a recycled plan",
  again.ok === true && again.inspectionId !== started.inspectionId && again.planningRequestId !== started.planningRequestId,
  `first=${started.inspectionId}/${started.planningRequestId} second=${again.inspectionId}/${again.planningRequestId}`,
);

// ── 7 + 8: real reads ───────────────────────────────────────────────────────
const proof = json(await a.callTool({ name: "sage_get_proof", arguments: { txHash: READY_TX } }));
check(
  "8. reads a REAL payout proof, verified against the chain",
  proof.ok === true && proof.verified === true && !!proof.explorerUrl,
  JSON.stringify(proof).slice(0, 160),
);

const campaignId = process.env.CAMPAIGN_ID || "launch-yara-garden-8frabo";
const campaign = json(await a.callTool({ name: "sage_get_campaign", arguments: { campaignId } }));
check("7. reads a REAL campaign", campaign.ok === true, JSON.stringify(campaign).slice(0, 160));

// ── 9: errors are bounded and readable ──────────────────────────────────────
const bad = [
  ["unknown inspection", "sage_get_inspection", { inspectionId: "nope-not-real" }],
  ["unknown campaign", "sage_get_campaign", { campaignId: "nope-not-real" }],
  ["malformed tx", "sage_get_proof", { txHash: "not-a-hash" }],
  ["missing required arg", "sage_start_inspection", { productUrl: "https://example.com" }],
  ["non-public url", "sage_start_inspection", { productUrl: "http://localhost:3000", goal: "g", targetUsers: "t", budgetUsd: 5 }],
];
let bounded = true;
for (const [label, name, args] of bad) {
  const r = await a.callTool({ name, arguments: args });
  const body = json(r);
  const msg = String(body.error ?? body.__raw ?? "");
  const ok = r.isError === true && msg.length > 0 && msg.length < 400 && !/stack|node_modules|at Object|\.ts:\d/.test(msg);
  if (!ok) bounded = false;
  console.log(`        · ${label} → ${msg.slice(0, 110)}`);
}
check("9. every error is a bounded, readable result (no stack traces)", bounded);
await a.close();

// ── client B: force a needs_input and answer it ─────────────────────────────
const b = await connect("okx-review-sim-b");
const thin = json(
  await b.callTool({
    name: "sage_start_inspection",
    arguments: {
      productUrl: "https://www.allbirds.com",
      goal: "Testers should complete a full checkout and report the confirmation number.",
      targetUsers: "online shoppers",
      budgetUsd: 2,
    },
  }),
);
if (!thin.ok) {
  check("5. reaches a needs_input and accepts an answer", false, JSON.stringify(thin).slice(0, 200));
} else {
  const v = await pollUntilTerminal(b, thin.inspectionId);
  if (v?.stage === "needs_input") {
    console.log(`        · Sage asked: ${String(v.needsInput?.[0] ?? "").slice(0, 120)}`);
    const answered = json(
      await b.callTool({
        name: "sage_answer_questions",
        arguments: {
          inspectionId: thin.inspectionId,
          answer:
            "There is no login. Use the public demo store and treat adding one item to the cart as the outcome to prove.",
        },
      }),
    );
    check("5. reaches a needs_input and accepts an answer", answered.ok === true, JSON.stringify(answered).slice(0, 200));
  } else {
    check(
      "5. reaches a needs_input and accepts an answer",
      false,
      `expected needs_input, got stage=${v?.stage} (not a defect — this product answered outright)`,
    );
  }
}
await b.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
