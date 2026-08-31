#!/usr/bin/env node
/**
 * Operator client for the Sage Advance pot — a thin wrapper over the secret-gated
 * /api/admin/advance endpoint. The published formula binds the operator too: the server refuses
 * any amount past advanceCapacityUsd(record, multiple), computed from the live record.
 *
 * USAGE
 *   node scripts/advance.mjs capacity <wallet> [multiple]          # dry-run: what COULD go out
 *   node scripts/advance.mjs disburse <wallet> <usd> [multiple] [bps]   # real money, claim link ONCE
 *   node scripts/advance.mjs history <wallet>
 *
 * ENV
 *   SAGE_ADMIN_SECRET   required — must match the server's value.
 *   SAGE_ADMIN_URL      optional — default http://localhost:3000.
 *
 * The disburse response's claimUrl is BEARER CASH: hand it to the borrower, never paste it
 * anywhere that persists.
 */
const secret = process.env.SAGE_ADMIN_SECRET;
const base = (process.env.SAGE_ADMIN_URL || "http://localhost:3000").replace(/\/$/, "");
const [action, wallet, usdArg, multipleArg, bpsArg] = process.argv.slice(2);

if (!secret) {
  console.error("Set SAGE_ADMIN_SECRET (must match the server's value).");
  process.exit(1);
}
if (!["capacity", "disburse", "history"].includes(action) || !wallet) {
  console.error(
    "Usage:\n  node scripts/advance.mjs capacity <wallet> [multiple]\n  node scripts/advance.mjs disburse <wallet> <usd> [multiple] [bps]\n  node scripts/advance.mjs history <wallet>",
  );
  process.exit(1);
}

const body =
  action === "history"
    ? { action: "history", wallet }
    : action === "capacity"
      ? { action: "disburse", wallet, usd: 0.01, multiple: Number(multipleArg ?? 1), dryRun: true }
      : {
          action: "disburse",
          wallet,
          usd: Number(usdArg),
          multiple: Number(multipleArg ?? 1),
          waterfallBps: Number(bpsArg ?? 5000),
        };

const res = await fetch(`${base}/api/admin/advance`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-sage-admin-secret": secret },
  body: JSON.stringify(body),
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
process.exit(res.ok ? 0 : 1);
