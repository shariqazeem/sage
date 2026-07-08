/**
 * Local dev sweep runner. In production Vercel Cron hits /api/deputy/sweep every
 * 5 minutes; in dev there's no cron, so this POSTs the sweep on an interval with
 * the DEPUTY_CRON_SECRET header. Run: `npm run deputy:watch` (loads .env).
 *
 * Env: DEPUTY_CRON_SECRET (required), SWEEP_URL (default localhost:3000),
 * SWEEP_INTERVAL_MS (default 5 min).
 */
const URL = process.env.SWEEP_URL ?? "http://localhost:3000/api/deputy/sweep";
const SECRET = process.env.DEPUTY_CRON_SECRET ?? "";
const EVERY_MS = Number(process.env.SWEEP_INTERVAL_MS ?? 5 * 60 * 1000);

if (!SECRET) {
  console.error(
    "[deputy:watch] DEPUTY_CRON_SECRET is not set — the sweep endpoint would reject us. Set it in .env.",
  );
  process.exit(1);
}

async function tick() {
  const stamp = new Date().toISOString();
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "x-deputy-cron-secret": SECRET },
    });
    const body = await res.json().catch(() => ({}));
    console.log(stamp, res.status, JSON.stringify(body));
  } catch (e) {
    console.error(stamp, "sweep failed:", e instanceof Error ? e.message : e);
  }
}

console.log(`[deputy:watch] sweeping ${URL} every ${Math.round(EVERY_MS / 1000)}s`);
tick();
setInterval(tick, EVERY_MS);
