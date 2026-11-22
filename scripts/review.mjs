#!/usr/bin/env node
/**
 * Operator backstop for reviewing HELD submissions — the fallback for when the Telegram concierge
 * can't (list / release / reject a held submission by id). A thin client over the secret-gated
 * /api/admin/review endpoint, so it reuses the SAME settle path the chat tools + decide route use —
 * no money logic lives here.
 *
 * USAGE
 *   node scripts/review.mjs list <campaignId>
 *   node scripts/review.mjs release <submissionId>
 *   node scripts/review.mjs reject <submissionId> [why...]
 *
 * A PRODUCT the safety screen held or refused (src/lib/safety/) is reviewed here too:
 *   node scripts/review.mjs products
 *   node scripts/review.mjs clear-product <host | host/path> [note...]    lifts the hold; its tests go public
 *   node scripts/review.mjs refuse-product <host | host/path> [note...]   closes it to new launches
 *
 * ENV
 *   SAGE_ADMIN_SECRET   required — must match the server's SAGE_ADMIN_SECRET.
 *   SAGE_ADMIN_URL      optional — default http://localhost:3000.
 */

const secret = process.env.SAGE_ADMIN_SECRET;
const base = (process.env.SAGE_ADMIN_URL || "http://localhost:3000").replace(/\/$/, "");
const [action, id, ...rest] = process.argv.slice(2);

if (!secret) {
  console.error("Set SAGE_ADMIN_SECRET (must match the server's value).");
  process.exit(1);
}
const PRODUCT_ACTIONS = { products: "products", "clear-product": "clear_product", "refuse-product": "refuse_product" };
const isProduct = action in PRODUCT_ACTIONS;
if ((!["list", "release", "reject"].includes(action) && !isProduct) || (!id && action !== "products")) {
  console.error(
    "Usage:\n  node scripts/review.mjs list <campaignId>\n  node scripts/review.mjs release <submissionId>\n  node scripts/review.mjs reject <submissionId> [why...]\n  node scripts/review.mjs products\n  node scripts/review.mjs clear-product <host | host/path> [note...]\n  node scripts/review.mjs refuse-product <host | host/path> [note...]",
  );
  process.exit(1);
}

const payload = isProduct
  ? { action: PRODUCT_ACTIONS[action], product: id, why: rest.join(" ") || undefined }
  : action === "list"
    ? { action, campaignId: id }
    : { action, submissionId: id, why: rest.join(" ") || undefined };

const res = await fetch(`${base}/api/admin/review`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-sage-admin-secret": secret },
  body: JSON.stringify(payload),
});
const json = await res.json().catch(() => ({}));

if (!res.ok) {
  console.error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  process.exit(1);
}

if (action === "products") {
  const products = json.products || [];
  if (!products.length) console.log("No product is held or refused.");
  for (const p of products) {
    console.log(`  ${p.subject}  ${p.decision ? `[${p.decision} by a person]` : `[${p.outcome}, waiting]`}  ${p.heldTests.length ? `held tests: ${p.heldTests.join(", ")}` : ""}`);
    for (const r of p.reasons) console.log(`      ${r}`);
  }
} else if (isProduct) {
  console.log(action === "clear-product" ? `Cleared ${json.subject}. ${json.released} held test(s) are public again.` : `Refused ${json.subject}. New launches are closed; a test already live stays held and keeps paying.`);
} else if (action === "list") {
  const held = json.held || [];
  if (!held.length) {
    console.log("Nothing is held for review.");
  } else {
    console.log(`${held.length} held:`);
    for (const h of held) {
      console.log(
        `  ${h.submissionId}  ${h.confidencePct ?? "?"}%  [${h.reasonClass}]  ${h.missionTitle}  ${h.evidenceUrl ?? ""}`,
      );
    }
  }
} else if (action === "release") {
  console.log(
    json.settled
      ? `Released + paid — tx ${json.txHash}`
      : `Not settled: ${json.reason ?? json.error ?? "unknown"} (submission is approved; you can retry)`,
  );
} else {
  console.log(json.ok ? "Rejected — no payout." : `Failed: ${json.error ?? "unknown"}`);
}
