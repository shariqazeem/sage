/**
 * PUBLIC STATS — the numbers Sage is allowed to say about itself, straight from the ledger.
 *
 *   node scripts/public-stats.mjs            # run on the VM, where var/sage.db lives
 *   node scripts/public-stats.mjs --json     # machine-readable
 *
 * WHY THIS EXISTS: a number copied into a post, a grant form, or a LinkedIn recommendation is
 * permanent and public, and a wrong one is worse than no number at all. A hand-carried figure goes
 * stale the day after it is written — "54 products inspected" was quoted into a recommendation
 * draft while the ledger said something else entirely, because the inspection count includes every
 * evaluation-battery run against motherfuckingwebsite.com and friends.
 *
 * So: every figure here is derived, labelled SAFE or CAUTION, and the caution ones say why.
 * Money and judgment counts are inherently real (they moved USDC or refused to). Inspection counts
 * are not, unless the battery URLs are excluded — which this does.
 */
import Database from "better-sqlite3";

const DB = process.env.SAGE_DB ?? "./var/sage.db";
const db = new Database(DB, { readonly: true });
const one = (sql, ...a) => db.prepare(sql).get(...a);
const many = (sql, ...a) => db.prepare(sql).all(...a);

/** URLs Sage inspects only to TEST ITSELF. They are real inspections; they are not real customers. */
const BATTERY_HOSTS = [
  "motherfuckingwebsite.com", "tailwindcss.com", "plausible.io", "excalidraw.com", "play2048.co",
  "yara.garden", "allbirds.com", "web.telegram.org", "brittanychiang.com", "gitlab.com",
  "cnn.com", "useagora.vercel.app", "app.uniswap.org", "sagepays.xyz",
];
const isBattery = (url) => BATTERY_HOSTS.some((h) => String(url ?? "").includes(h));

const paid = one("SELECT COUNT(*) n FROM submissions WHERE status='paid'").n;
const rejected = one("SELECT COUNT(*) n FROM submissions WHERE status='rejected'").n;
const decided = paid + rejected;
const earners = one("SELECT COUNT(DISTINCT wallet) n FROM submissions WHERE status='paid'").n;
const submitters = one("SELECT COUNT(DISTINCT wallet) n FROM submissions").n;
const campaigns = one("SELECT COUNT(*) n FROM campaigns").n;

const allJobs = many("SELECT product_url, status FROM inspection_jobs");
const realJobs = allJobs.filter((j) => !isBattery(j.product_url));
const realProducts = new Set(realJobs.map((j) => j.product_url)).size;

const stats = {
  peopleWhoSubmitted: submitters,
  submissionsJudged: decided,
  paid,
  distinctEarners: earners,
  refused: rejected,
  refusalRatePct: decided ? Math.round((rejected / decided) * 100) : 0,
  campaignsLaunched: campaigns,
  productsInspected: realProducts,
  inspectionRunsTotal: allJobs.length,
  batteryRunsExcluded: allJobs.length - realJobs.length,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(stats, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
console.log("\nSAGE — PUBLIC STATS (from the ledger, " + new Date().toISOString().slice(0, 10) + ")\n");
console.log("SAFE TO PUBLISH — these moved money or refused to, so they cannot be inflated by testing:");
console.log("  " + pad("people who submitted work", 30) + stats.peopleWhoSubmitted);
console.log("  " + pad("submissions judged", 30) + stats.submissionsJudged);
console.log("  " + pad("paid", 30) + `${stats.paid} payouts to ${stats.distinctEarners} different people`);
console.log("  " + pad("refused", 30) + `${stats.refused}  (${stats.refusalRatePct}% refusal rate)`);
console.log("  " + pad("campaigns launched", 30) + stats.campaignsLaunched);
console.log("\nCAUTION — inspection counts include Sage testing itself:");
console.log("  " + pad("products inspected", 30) + `${stats.productsInspected}   (battery URLs excluded)`);
console.log("  " + pad("total inspection runs", 30) + `${stats.inspectionRunsTotal}  (${stats.batteryRunsExcluded} were evaluation runs — do NOT quote this)`);
console.log("\nREADY-MADE LINES\n");
console.log(`  "It judged ${stats.submissionsJudged} submissions, paid ${stats.distinctEarners} different people, and refused ${stats.refused}. No human approved a single payment."`);
console.log(`  "A ${stats.refusalRatePct}% refusal rate. Anyone can build an agent that pays. Building one that reads the work and says no is the whole difficulty."`);
console.log(`  "${stats.peopleWhoSubmitted} people submitted work to an agent that decides on its own."\n`);
console.log("Do not quote a dollar total unless asked: the counts show the system works, the total\nunderstates it because the campaigns were deliberately run small.\n");
