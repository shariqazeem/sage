/**
 * RUN ONE REAL INSPECTION AS A SIGNED-IN FOUNDER, AND PRINT WHY IT DID WHAT IT DID.
 *
 * THE BLIND SPOT THIS EXISTS FOR: `mission-eval-matrix.mjs` calls the launch API anonymously, so
 * `resolveCanaryAuthority` refuses every row and the whole battery exercises the LEGACY planner. The
 * GROUNDED planner — the one that compiles the founder's goal into checkpoints, drives the browser
 * toward them, and gates which missions may ship — is the half the battery cannot see. It was
 * silently broken for three days (a ```json fence the strict reader refused) while the grid stayed
 * green and founders got plans that ignored their goal.
 *
 * So this signs in over SIWE exactly as the browser does, launches through the real HTTP route, and
 * polls to completion — then prints the evidence that actually explains a plan: whether the
 * architect parsed, what the compiler rejected and under which code, which affordances the browser
 * actually reached, and whether the founder's goal survived into the missions.
 *
 *   node scripts/inspect-live.mjs --goal "…" --expect feedback [--url …] [--budget 25]
 *
 * Needs a signing key (GOAT_AGENT_PRIVATE_KEY or --key) and costs real model spend. `--expect <word>`
 * exits non-zero when no shipped mission mentions the word, so it can gate a change.
 */
import { privateKeyToAccount } from "viem/accounts";

const args = process.argv.slice(2);
const flag = (n, d = "") => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const base = flag("base", "http://localhost:3000").replace(/\/+$/, "");
const url = flag("url", "https://sagepays.xyz/launch");
const budget = Number(flag("budget", "25"));
const goal = flag("goal", "");
const expect = flag("expect", "").toLowerCase();
const key = flag("key", process.env.GOAT_AGENT_PRIVATE_KEY ?? "");
if (!key) {
  console.error("need a signing key: --key 0x… or GOAT_AGENT_PRIVATE_KEY in the environment");
  process.exit(1);
}

const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const keep = (res) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return res;
};
const call = async (path, init = {}) =>
  keep(
    await fetch(`${base}${path}`, {
      ...init,
      headers: { "content-type": "application/json", cookie: cookieHeader(), ...(init.headers ?? {}) },
    }),
  );

const siwe = (address, nonce, issuedAt) =>
  [
    "Sage — sign in",
    "",
    `Wallet: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    "",
    "Signing proves you control this wallet. It authorizes no transaction and moves no funds.",
  ].join("\n");

async function signIn() {
  const { nonce } = await (await call("/api/auth/nonce")).json();
  const issuedAt = new Date().toISOString();
  const signature = await account.signMessage({ message: siwe(account.address, nonce, issuedAt) });
  const res = await call("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ address: account.address, signature, issuedAt }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`sign-in failed: ${JSON.stringify(body)}`);
  return body.address;
}

const line = (k, v) => console.log(`${k.padEnd(14)}${v}`);

async function main() {
  const who = await signIn();
  console.log(`signed in as ${who}`);
  const watch = flag("watch", "");

  let id = watch;
  if (!id) {
    const res = await call("/api/launch", {
      method: "POST",
      body: JSON.stringify({ productUrl: url, goal, budgetUsd: budget, requestId: `harness-${Date.now()}` }),
    });
    const started = await res.json();
    if (!started.ok) throw new Error(`launch failed: ${JSON.stringify(started)}`);
    id = started.job.id;
  }
  console.log(`job ${id} · ${url} · $${budget}`);
  console.log(`goal: ${goal.slice(0, 200)}${goal.length > 200 ? "…" : ""}\n`);

  const t0 = Date.now();
  let job = null;
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    job = await (await call(`/api/launch/${id}`)).json();
    // TERMINAL statuses only. Reading it the other way round ("not queued/running") broke out on
    // `field_test` four seconds in and reported 0 missions on a run that was still working.
    const st = job?.job?.status ?? job?.status;
    if (st === "ready" || st === "needs_input" || st === "failed") break;
    if (i % 5 === 0) process.stdout.write(".");
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`\n`);

  // the view omits the diagnostics, so read the raw row through the admin lens the harness owns
  const raw = await (await call(`/api/launch/${id}?raw=1`)).json();
  const view = raw?.job ?? job?.job ?? job ?? {};
  const missions = view.plan?.missions ?? view.missions ?? [];

  line("status", `${view.status} in ${secs}s`);
  line("missions", missions.length);
  for (const m of missions) console.log(`   · ${m.title}`);
  console.log(`\n(plan page: ${url.startsWith("http") ? new URL(base).origin : base}/launch/${id})`);

  if (expect) {
    const hay = JSON.stringify(missions).toLowerCase();
    const hit = hay.includes(expect);
    console.log(`\nEXPECT "${expect}" in a shipped mission: ${hit ? "YES" : "NO"}`);
    process.exit(hit ? 0 : 2);
  }
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
