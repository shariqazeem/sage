#!/usr/bin/env node
/**
 * A LOCAL PREVIEW OF A LIVE TEST, FOR LOOKING AT THE BUILDER'S PAGE (27 Nov 2026). Never run against prod.
 *
 *   node scripts/dev/seed-cockpit.mjs [--db var/preview.db]
 *   SAGE_DB_PATH=var/preview.db npm run dev
 *   open http://localhost:3000/api/dev/session?address=0xB0B0000000000000000000000000000000000b0b&next=/t/t-cockpit-preview
 *
 * It copies var/sage.db to the preview file, applies every migration, and writes one invented test of an
 * invented product (example.app) with seven invented people at every stage: paid, approved and waiting,
 * held for the builder, not paid, and just answered, plus visits from each source. Every value is fake and
 * labelled so; the addresses are not anyone's. The dev session route is a 404 in production.
 */
import { copyFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const args = process.argv.slice(2);
const at = args.indexOf("--db");
const DB = resolve(at >= 0 ? args[at + 1] : "var/preview.db");
if (/sage\.db$/.test(DB))
  throw new Error("refusing to seed var/sage.db itself: use a preview copy");
if (process.env.NODE_ENV === "production")
  throw new Error("refusing to run in production");

copyFileSync(resolve("var/sage.db"), DB);
const sqlite = new Database(DB);
migrate(drizzle(sqlite), { migrationsFolder: join(process.cwd(), "drizzle") });

const ID = "t-cockpit-preview";
const BUILDER = "0xB0B0000000000000000000000000000000000b0b";
const now = Math.floor(Date.now() / 1000);
const h = 3600;
const hex = (n, len = 64) => `0x${n.toString(16).padStart(len, "0")}`;
const person = (i) =>
  `0x${String(i).repeat(40).slice(0, 40)}`.replace(/^0x(.)/, "0x$1");
const has = (table) =>
  !!sqlite
    .prepare("select name from sqlite_master where type='table' and name=?")
    .get(table);

for (const t of ["test_visits", "builder_notices"])
  if (has(t)) sqlite.prepare(`delete from ${t} where campaign_id=?`).run(ID);
for (const t of [
  "events",
  "decisions",
  "core_answers",
  "keep_posted",
  "submissions",
  "missions",
  "campaign_sharing",
])
  sqlite.prepare(`delete from ${t} where campaign_id=?`).run(ID);
sqlite
  .prepare("delete from inspection_jobs where public_campaign_id=?")
  .run(ID);
sqlite.prepare("delete from campaigns where id=?").run(ID);

sqlite
  .prepare(
    `insert into campaigns (id, title, description_md, criteria, condition_type, reward_amount, max_recipients, vault_address, poster_wallet, owner_is_sage, status, created_at, autonomy, autopilot_threshold, chain_id, sandbox, vault_kind, campaign_id_hash, commitment_version, per_wallet_cap, kind, settlement_rail, visibility)
     values (?, ?, ?, '[]', 'approval', 2000000, 10, ?, ?, 0, 'live', ?, 'autopilot', 0.85, 1088, 0, 'campaign_v2', ?, 1, 1, 'testing', 'evm', 'listed')`,
  )
  .run(
    ID,
    "Test example.app",
    "An invented test for the local preview.",
    hex(0xbeef, 40),
    BUILDER,
    now - 48 * h,
    hex(0xc0ffee),
  );

sqlite
  .prepare(
    `insert into inspection_jobs (id, founder_wallet, idempotency_key, status, public_campaign_id, product_url, total_budget_base, created_at, updated_at, result)
     values (?, ?, ?, 'ready', ?, 'https://example.app', 20000000, ?, ?, ?)`,
  )
  .run(
    `job-${ID}`,
    BUILDER,
    `seed-${ID}`,
    ID,
    now - 49 * h,
    now - 48 * h,
    JSON.stringify({
      map: { productName: "Example", category: "productivity" },
    }),
  );

const MISSION = hex(0x1);
sqlite
  .prepare(
    `insert into missions (id, campaign_id, mission_key, mission_id_hash, title, criteria, reward_amount, max_completions, status, display_order, created_at, updated_at, objective, instructions)
     values (?, ?, 'core-first-try', ?, 'Try Example as a first-time visitor', '[]', 2000000, 10, 'active', 0, ?, ?, ?, ?)`,
  )
  .run(
    `m-${ID}`,
    ID,
    MISSION,
    now - 48 * h,
    now - 48 * h,
    "Open Example, find where to start, and try the main thing.",
    "Open the product, try what it is for, and say where you stopped.",
  );

sqlite
  .prepare(
    "insert into campaign_sharing (campaign_id, post_mission, post_result, findings_public, updated_at) values (?, 1, 0, 0, ?)",
  )
  .run(ID, now - 48 * h);

// seven invented people, oldest first
const PEOPLE = [
  {
    i: 1,
    status: "paid",
    ago: 40,
    words:
      "I signed up with Google and made my first board in about four minutes. The invite step asked for a team name twice, which confused me.",
    reached: "finished",
    again: "yes",
  },
  {
    i: 2,
    status: "paid",
    ago: 30,
    words:
      "The landing page says it is for teams, but I could not find how to add anyone. I made a board and stopped at the share screen.",
    reached: "started",
    again: "maybe",
  },
  {
    i: 3,
    status: "paid",
    ago: 20,
    words:
      "After sign up the page stayed blank for a long time. When it loaded I found the start button and made a board.",
    reached: "finished",
    again: "yes",
  },
  {
    i: 4,
    status: "approved",
    ago: 0.2,
    words:
      "I found the start button but the email code never arrived, so I could not begin.",
    reached: "found-start",
    again: "no",
  },
  {
    i: 5,
    status: "pending",
    ago: 2,
    words: "Looks good, nice design.",
    reached: "first-screen",
    again: "maybe",
    held: true,
  },
  {
    i: 6,
    status: "rejected",
    ago: 6,
    words: "This is a calendar app for dentists.",
    reject: "The answer describes a different product.",
  },
  {
    i: 7,
    status: "pending",
    ago: 0.05,
    words:
      "I stopped on the pricing page: it did not say what the free plan includes.",
  },
];

for (const p of PEOPLE) {
  const sid = `s-${ID}-${p.i}`;
  const created = now - Math.round(p.ago * h) - 600;
  const decided = p.status === "pending" && !p.held ? null : created + 90;
  const tx = p.status === "paid" ? hex(0xa000 + p.i) : null;
  sqlite
    .prepare(
      `insert into submissions (id, campaign_id, wallet, note, dedupe_key, status, reject_reason, payout_tx, decided_at, created_at, mission_id_hash, attempt)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      sid,
      ID,
      person(p.i),
      p.words,
      `seed-${sid}`,
      p.status,
      p.reject ?? null,
      tx,
      decided,
      created,
      MISSION,
    );
  if (decided) {
    const recommendation =
      p.status === "rejected" ? "reject" : p.held ? "hold" : "pay";
    sqlite
      .prepare(
        "insert into decisions (id, submission_id, campaign_id, engine, brief, created_at, mission_id_hash) values (?, ?, ?, 'llm', ?, ?, ?)",
      )
      .run(
        `d-${sid}`,
        sid,
        ID,
        JSON.stringify({
          recommendation,
          confidence: p.held ? 0.55 : 0.93,
          summary: "Invented for the preview.",
        }),
        decided,
        MISSION,
      );
  }
  if (p.reached)
    sqlite
      .prepare(
        "insert into core_answers (submission_id, campaign_id, reached, again, created_at) values (?, ?, ?, ?, ?)",
      )
      .run(sid, ID, p.reached, p.again, created);
  if (tx) {
    sqlite
      .prepare(
        "insert into events (id, campaign_id, submission_id, kind, detail, tx_hash, amount, created_at) values (?, ?, ?, 'settled', ?, ?, 2000000, ?)",
      )
      .run(
        `e-${sid}-paid`,
        ID,
        sid,
        person(p.i).slice(0, 6),
        tx,
        created + 300,
      );
  }
  if (p.held)
    sqlite
      .prepare(
        "insert into events (id, campaign_id, submission_id, kind, detail, created_at) values (?, ?, ?, 'autopay_held', ?, ?)",
      )
      .run(
        `e-${sid}-held`,
        ID,
        sid,
        "No sign of a try: the answer names nothing behind the first screen.",
        decided,
      );
  if (p.status === "rejected")
    sqlite
      .prepare(
        "insert into events (id, campaign_id, submission_id, kind, detail, created_at) values (?, ?, ?, 'submission_rejected', ?, ?)",
      )
      .run(`e-${sid}-no`, ID, sid, p.reject, decided);
}
sqlite
  .prepare(
    "insert into events (id, campaign_id, kind, detail, created_at) values (?, ?, 'work_announced', 'Told 12 of 15 on the roster about this work', ?)",
  )
  .run(`e-${ID}-ann`, ID, now - 47 * h);

// visits, when the tracking table exists: 30 invented visitors from every source
if (has("test_visits")) {
  const cols = sqlite
    .prepare("pragma table_info(test_visits)")
    .all()
    .map((c) => c.name);
  const sources = [
    "x",
    "x",
    "x",
    "x",
    "x",
    "x",
    "x",
    "x",
    "x",
    "x",
    "x",
    "x",
    "telegram",
    "telegram",
    "telegram",
    "telegram",
    "telegram",
    "earn",
    "earn",
    "earn",
    "earn",
    "earn",
    "earn",
    "alert",
    "alert",
    "alert",
    "alert",
    "direct",
    "direct",
    "direct",
  ];
  sources.forEach((source, n) => {
    const wallet =
      n < 7
        ? person(n + 1).toLowerCase()
        : n < 11
          ? person(n + 1).toLowerCase()
          : null;
    const first = now - (46 - n) * h;
    const row = {
      campaign_id: ID,
      visitor: hex(0x9000 + n, 32).slice(2),
      source,
      wallet,
      first_at: first,
      last_at: first + 120,
      views: 1 + (n % 3),
      signed_in_at: wallet ? first + 60 : null,
      opened_at: n < 9 ? first + 90 : null,
    };
    const keys = Object.keys(row).filter((k) => cols.includes(k));
    sqlite
      .prepare(
        `insert into test_visits (${keys.join(", ")}) values (${keys.map(() => "?").join(", ")})`,
      )
      .run(...keys.map((k) => row[k]));
  });
  console.log("visits: 30");
} else {
  console.log("visits: skipped (no test_visits table yet)");
}

console.log(`seeded ${ID} in ${DB}`);
console.log(
  `builder session: http://localhost:3000/api/dev/session?address=${BUILDER}&next=/t/${ID}`,
);
console.log(existsSync(DB) ? "ok" : "missing");
