// REHEARSAL FOUNDER (scripts/fc/rehearse-founder.mjs) — drives prod exactly like the web form: SIWE-lite sign-in, Sage drafts the job
// from one sentence, the job is created, then launched from the founder's own account.
//   node scripts/fc/rehearse-founder.mjs draft "<sentence>"          → draft.json
//   node founder.mjs create draft.json [opts]     → job (opts: --local 160 --currency JMD --unlisted)
//   node founder.mjs launch <jobId> <chainId>     → campaign
//   node founder.mjs job <jobId>                  → the job as the founder sees it
// The key is the local dev founder key (ARC_OPERATOR_PRIVATE_KEY in the repo's .env); never printed.
import { readFileSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
const BASE = process.env.SAGE_BASE ?? "https://sagepays.xyz";
const env = Object.fromEntries(readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n").map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")]));
const raw = env.ARC_OPERATOR_PRIVATE_KEY; const account = privateKeyToAccount(raw.startsWith("0x") ? raw : `0x${raw}`);
const jar = new Map();
const cookies = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const drink = (r) => { for (const l of r.headers.getSetCookie?.() ?? []) { const [p] = l.split(";"); const i = p.indexOf("="); if (i > 0) jar.set(p.slice(0, i).trim(), p.slice(i + 1).trim()); } };
async function api(path, init = {}) {
  const r = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", cookie: cookies(), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(300_000) });
  drink(r); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 400) }; }
  return { status: r.status, body: j };
}
async function signIn() {
  let r = await fetch(`${BASE}/api/auth/nonce`); drink(r); const { nonce } = await r.json();
  const issuedAt = new Date().toISOString();
  const message = ["Sage — sign in", "", `Wallet: ${account.address}`, `Nonce: ${nonce}`, `Issued At: ${issuedAt}`, "", "Signing proves you control this wallet. It authorizes no transaction and moves no funds."].join("\n");
  const signature = await account.signMessage({ message });
  const v = await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ address: account.address, signature, issuedAt }) });
  if (v.status !== 200) throw new Error(`sign-in refused ${v.status} ${JSON.stringify(v.body).slice(0, 200)}`);
}
const [cmd, a1, a2] = process.argv.slice(2);
const opt = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
await signIn();
console.error(`signed in as founder ${account.address}`);
if (cmd === "draft") {
  const t0 = Date.now();
  const r = await api("/api/campaigns/direct/draft", { method: "POST", body: JSON.stringify({ intent: a1 }) });
  console.error(`draft ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  writeFileSync("job-draft.json", JSON.stringify(r.body, null, 2)); console.log(JSON.stringify(r.body, null, 2));
} else if (cmd === "create") {
  const d = JSON.parse(readFileSync(a1, "utf8")).draft;
  const local = opt("local") ? Number(opt("local")) : undefined;
  const body = {
    kind: d.milestones.length > 1 ? "grant" : "gig",
    title: (opt("title") ?? d.title ?? "Pay for work").slice(0, 80),
    milestones: d.milestones.map((m) => ({ title: m.title, instructions: m.instructions, criteria: m.criteria, evidence: m.evidence.kind === "artifact_url" ? { ...m.evidence, markerKind: m.evidence.markerKind ?? "wallet" } : m.evidence, slots: 1, ...(local ? { rewardLocal: local } : { rewardUsd: Number(opt("usd") ?? 1) }), ...(m.effortMinutes ? { effortMinutes: m.effortMinutes } : {}) })),
    ...(d.whyItMatters && d.whyItMatters.length >= 10 ? { whyItMatters: d.whyItMatters.slice(0, 600) } : {}),
    ...(opt("currency") ? { currency: opt("currency") } : {}),
    ...(process.argv.includes("--unlisted") ? { visibility: "unlisted" } : {}),
  };
  const r = await api("/api/campaigns/direct", { method: "POST", body: JSON.stringify(body) });
  console.log(JSON.stringify(r, null, 2));
} else if (cmd === "launch") {
  const t0 = Date.now();
  const r = await api(`/api/launch/${a1}/treasury`, { method: "POST", body: JSON.stringify({ chainId: Number(a2) }) });
  console.error(`launch ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(JSON.stringify(r, null, 2));
} else if (cmd === "job") {
  console.log(JSON.stringify(await api(`/api/launch/${a1}`), null, 2));
}
