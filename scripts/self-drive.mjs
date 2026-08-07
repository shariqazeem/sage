#!/usr/bin/env node
/**
 * THE NIGHTLY REHEARSAL — Sage drives its own founder and tester paths before anyone else does.
 *
 * Every walletless defect found on 2026-08-07 — stopping a campaign broken since it was written, no
 * campaign lookup on Telegram, no gas answer — existed because those paths had never been run. They
 * were discovered by the operator, in their own chat, at the exact moment they mattered. This script
 * exists so the NEXT such defect is discovered here, at 04:30, in front of nobody.
 *
 * Runs ON the VM against the live app (pm2 cron). Read-only against money: it never funds, launches,
 * releases, or stops anything. What it does exercise, and assert:
 *
 *   1. SURFACES   — the founder-facing pages answer 200.
 *   2. LEDGER     — no submission stuck non-terminal, no inspection idle past the reaper bound.
 *   3. BOARD      — the marketplace payability invariant holds against the real DB (no observation
 *                   mission advertised with a corpus below the judging bar).
 *   4. CONCIERGE  — three synthetic Telegram turns (status, campaigns, gas) complete without a
 *                   "turn failed" and without an UNBACKED CLAIM block.
 *   5. INSPECTION — one real inspection of a stable public product reaches a terminal stage in
 *                   time, exercising the field test + mission brain end to end nightly.
 *
 * Any failure is sent to the operator chat over the same notifyTelegram channel the sweep uses.
 * Exit 0 all green · 1 checks failed · 2 could not run.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const ROOT = process.env.SAGE_ROOT ?? "/home/ubuntu/sage";
const BASE = process.env.SELF_DRIVE_BASE ?? "http://localhost:3000";
/** A chat id no human owns. Telegram sends to it fail silently (sendTelegram never throws), which
 *  is fine — the turn, the tool loop, and the guards all still run and log. */
const DRILL_CHAT = 999000999;
const failures = [];
const note = (s) => console.log(`  ${s}`);
const fail = (s) => {
  failures.push(s);
  console.log(`  FAIL ${s}`);
};

const env = (() => {
  const text = readFileSync(path.join(ROOT, ".env"), "utf8");
  return (k) => (text.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim() ?? null;
})();

/* ── 1. surfaces ─────────────────────────────────────────────────────────────────────────────── */
console.log("[1] founder-facing surfaces");
for (const p of ["/", "/marketplace", "/launch"]) {
  try {
    const r = await fetch(BASE + p, { signal: AbortSignal.timeout(20_000) });
    if (r.status === 200) note(`ok   ${p}`);
    else fail(`${p} answered ${r.status}`);
  } catch (e) {
    fail(`${p} unreachable (${e?.message ?? e})`);
  }
}

/* ── 2 + 3. ledger and board invariants, straight off the real DB ────────────────────────────── */
console.log("[2] ledger + [3] board invariants");
try {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(path.join(ROOT, "var/sage.db"), { readonly: true });
  const now = Math.floor(Date.now() / 1000);

  const stuckSubs = db
    .prepare("select count(*) c from submissions where status in ('pending','settling') and created_at < ?")
    .get(now - 3600).c;
  if (stuckSubs === 0) note("ok   no submission stuck non-terminal past an hour");
  else fail(`${stuckSubs} submission(s) stuck non-terminal past an hour`);

  // 20 min: the reaper fires at 15 and the sweep ticks ~5 — anything older means the reaper itself
  // is not doing its job, which is precisely worth an alarm.
  const stuckJobs = db
    .prepare(
      "select count(*) c from inspection_jobs where status not in ('ready','failed','needs_input') and updated_at < ?",
    )
    .get(now - 1200).c;
  if (stuckJobs === 0) note("ok   no inspection idle past the reaper bound");
  else fail(`${stuckJobs} inspection(s) idle past the reaper bound — is the sweep running?`);

  const unpayable = db
    .prepare(
      `select count(*) c from missions m join campaigns c on c.id = m.campaign_id
       where c.status = 'live' and c.sandbox = 0 and m.status != 'closed'
         and m.verifiability_class = 'observation-based' and coalesce(c.private_corpus_sources, 0) < 5`,
    )
    .get().c;
  if (unpayable === 0) note("ok   nothing advertised that the judge cannot pay");
  else fail(`${unpayable} live observation mission(s) with a corpus below the judging bar`);
  db.close();
} catch (e) {
  fail(`db checks could not run (${e?.message ?? e})`);
}

/* ── 4. concierge turns ──────────────────────────────────────────────────────────────────────── */
console.log("[4] concierge drill");
const webhookSecret = env("TELEGRAM_WEBHOOK_SECRET");
if (!webhookSecret) {
  note("skip — no TELEGRAM_WEBHOOK_SECRET");
} else {
  const turns = ["what is my wallet balance?", "which campaigns do I have?", "how much BTC do I have for gas?"];
  for (const [i, text] of turns.entries()) {
    try {
      const r = await fetch(`${BASE}/api/telegram/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": webhookSecret },
        body: JSON.stringify({
          update_id: Date.now() + i,
          message: {
            message_id: i + 1,
            date: Math.floor(Date.now() / 1000),
            chat: { id: DRILL_CHAT, type: "private", first_name: "SelfDrive" },
            from: { id: DRILL_CHAT, is_bot: false, first_name: "SelfDrive" },
            text,
          },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (r.status !== 200) fail(`webhook answered ${r.status} for turn ${i + 1}`);
    } catch (e) {
      fail(`webhook turn ${i + 1} unreachable (${e?.message ?? e})`);
    }
  }
  // The turns answer asynchronously (after()); give them time, then read the outcome off the log.
  await new Promise((r) => setTimeout(r, 150_000));
  try {
    const log = execSync("pm2 logs sage --lines 400 --nostream 2>/dev/null", { encoding: "utf8" });
    const window = log.split("\n").slice(-400).join("\n");
    const replies = (window.match(new RegExp(`concierge reply chat=${DRILL_CHAT}`, "g")) || []).length;
    const failed = (window.match(/turn failed/g) || []).length;
    const unbacked = (window.match(/UNBACKED CLAIM/g) || []).length;
    if (replies >= turns.length) note(`ok   ${replies}/${turns.length} drill turns replied`);
    else fail(`only ${replies}/${turns.length} drill turns produced a reply`);
    if (failed === 0) note("ok   no turn failed");
    else fail(`${failed} concierge turn(s) failed in the window`);
    if (unbacked === 0) note("ok   no unbacked claim was blocked");
    else fail(`${unbacked} UNBACKED CLAIM block(s) — the model tried to narrate something it did not do`);
  } catch (e) {
    fail(`could not read pm2 logs (${e?.message ?? e})`);
  }
}

/* ── 5. one real inspection, end to end ──────────────────────────────────────────────────────── */
console.log("[5] inspection sentinel");
const agentKey = env("SAGE_AGENT_API_KEY");
if (!agentKey) {
  note("skip — no SAGE_AGENT_API_KEY");
} else {
  try {
    // The budget varies by day so the idempotent create makes a FRESH job nightly.
    const day = Math.floor(Date.now() / 86_400_000) % 7;
    const r = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${agentKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "sage_start_inspection",
          arguments: {
            productUrl: "https://excalidraw.com",
            goal: "Verify a first-time visitor can draw a shape and see it on the canvas.",
            targetUsers: "First-time visitors",
            budgetUsd: 5 + day,
            clientRef: "selfdrive",
          },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const raw = await r.text();
    const line = (raw.split("\n").find((l) => l.startsWith("data:")) || raw).replace(/^data:\s*/, "");
    const id = JSON.parse(JSON.parse(line).result.content[0].text).inspectionId;
    note(`started ${id}`);

    const { default: Database } = await import("better-sqlite3");
    let status = null;
    for (let i = 0; i < 45; i++) {
      await new Promise((rr) => setTimeout(rr, 20_000));
      const db = new Database(path.join(ROOT, "var/sage.db"), { readonly: true });
      status = db.prepare("select status from inspection_jobs where id = ?").get(id)?.status ?? null;
      db.close();
      if (["ready", "failed", "needs_input"].includes(status)) break;
    }
    // needs_input is an honest terminal answer for some products; FAILED or never-terminal is the alarm.
    if (status === "ready") note("ok   inspection reached ready");
    else if (status === "needs_input") note("ok   inspection terminal (needs_input — honest for this product)");
    else fail(`inspection ended ${status ?? "still running"} after 15 minutes`);
  } catch (e) {
    fail(`inspection sentinel could not run (${e?.message ?? e})`);
  }
}

/* ── report ──────────────────────────────────────────────────────────────────────────────────── */
console.log(failures.length === 0 ? "\nSELF-DRIVE GREEN" : `\nSELF-DRIVE: ${failures.length} FAILURE(S)`);
if (failures.length > 0) {
  const token = env("TELEGRAM_BOT_TOKEN");
  const chat = env("TELEGRAM_CHAT_ID");
  if (token && chat) {
    const text = `🌙 <b>Self-drive found ${failures.length} problem(s)</b>\n${failures
      .map((f) => `· ${f}`)
      .join("\n")}\n\nFound in rehearsal, before a founder did.`;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, parse_mode: "HTML", text }),
    }).catch(() => {});
  }
  process.exit(1);
}
process.exit(0);
