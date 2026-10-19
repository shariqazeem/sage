#!/usr/bin/env node
/**
 * GRANT A PLAN (design partners, the founder's own accounts, a Programs deal).
 *
 * Sets a founder's workspace to a plan until a date, the same row a USDC payment extends. If the founder
 * has no workspace yet, one is created for them (named "My workspace", renamable in Settings). DRY RUN by
 * default: it prints what it would change and changes nothing until you pass --apply.
 *
 * USAGE (on the VM, from /home/ubuntu/sage, so it uses the app's own database driver):
 *   node scripts/grant-plan.mjs --founder 0xABC… --plan programs --days 3650            # dry run
 *   node scripts/grant-plan.mjs --founder 0xABC… --plan team --days 90 --apply          # writes
 *   node scripts/grant-plan.mjs --list                                                  # who is on what
 *
 * Plans: free | pro | team | programs (src/lib/plans/catalog.ts). A grant never charges anyone and never
 * touches money; it only lifts what the founder may LAUNCH next.
 */
import Database from "better-sqlite3";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);

const DB_PATH = flag("db") ?? process.env.SAGE_DB_PATH ?? join(process.cwd(), "var", "sage.db");
const PLANS = ["free", "pro", "team", "programs"];
const db = new Database(DB_PATH);
const now = Math.floor(Date.now() / 1000);
const day = (sec) => (sec ? new Date(sec * 1000).toISOString().slice(0, 10) : "—");

if (has("list")) {
  const rows = db.prepare("select id, name, owner_key, plan, plan_until from workspaces order by created_at").all();
  for (const r of rows) {
    const live = r.plan !== "free" && (r.plan_until ?? 0) > now ? r.plan : "free";
    console.log(`${r.id}  ${live.padEnd(8)} until ${day(r.plan_until)}  owner ${r.owner_key}  "${r.name}"`);
  }
  process.exit(0);
}

const founder = (flag("founder") ?? "").trim().toLowerCase();
const plan = (flag("plan") ?? "").trim().toLowerCase();
const days = Number(flag("days") ?? "30");
if (!/^0x[0-9a-f]{40}$/.test(founder)) {
  console.error("--founder must be an Ethereum address (0x + 40 hex).");
  process.exit(1);
}
if (!PLANS.includes(plan)) {
  console.error(`--plan must be one of: ${PLANS.join(", ")}`);
  process.exit(1);
}
if (!Number.isFinite(days) || days <= 0 || days > 3650) {
  console.error("--days must be between 1 and 3650.");
  process.exit(1);
}

const until = plan === "free" ? null : now + Math.round(days * 86_400);
const ws = db.prepare("select * from workspaces where owner_key = ? order by created_at limit 1").get(founder);
console.log(`founder   ${founder}`);
console.log(`workspace ${ws ? `${ws.id} "${ws.name}" (now ${ws.plan} until ${day(ws.plan_until)})` : "none yet: one will be created"}`);
console.log(`grant     ${plan} until ${day(until)}`);
if (!has("apply")) {
  console.log("\nDry run. Nothing changed. Re-run with --apply to write it.");
  process.exit(0);
}

const tx = db.transaction(() => {
  let id = ws?.id;
  if (!id) {
    id = `ws_${randomBytes(5).toString("hex")}`;
    const slug = `my-workspace-${randomBytes(2).toString("hex")}`;
    db.prepare("insert into workspaces (id, name, slug, owner_key, plan, plan_until, created_at, updated_at) values (?,?,?,?,?,?,?,?)").run(id, "My workspace", slug, founder, "free", null, now, now);
    db.prepare("insert or ignore into workspace_members (workspace_id, member_key, address, role, display_name, invited_by, joined_at) values (?,?,?,?,?,?,?)").run(id, founder, founder, "owner", null, null, now);
  }
  db.prepare("update workspaces set plan = ?, plan_until = ?, updated_at = ? where id = ?").run(plan, until, now, id);
  return id;
});
const id = tx();
const after = db.prepare("select id, name, plan, plan_until from workspaces where id = ?").get(id);
console.log(`\nDone: ${after.id} "${after.name}" is on ${after.plan} until ${day(after.plan_until)}.`);
