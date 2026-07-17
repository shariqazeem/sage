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
if (!["list", "release", "reject"].includes(action) || !id) {
  console.error(
    "Usage:\n  node scripts/review.mjs list <campaignId>\n  node scripts/review.mjs release <submissionId>\n  node scripts/review.mjs reject <submissionId> [why...]",
  );
  process.exit(1);
}

const payload =
  action === "list"
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

if (action === "list") {
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
