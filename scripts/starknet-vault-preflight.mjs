/**
 * PREFLIGHT FOR A PRIVATE-CAPABLE LAUNCH.
 *
 * Plans a real founder's vault from a real approved plan and checks every assumption against
 * Starknet mainnet — the class is declared, the address is derivable, the calls encode, and the
 * verifier's inputs are readable. Sends nothing and signs nothing.
 *
 *   node scripts/starknet-vault-preflight.mjs <jobId> [founderAddress]
 */
import Database from "better-sqlite3";
import { RpcProvider, CallData, hash, num, cairo } from "starknet";

const RPC = process.env.STARKNET_RPC_URL ?? "https://rpc.starknet.lava.build:443";
const CLASS = process.env.STARKNET_VAULT_CLASS_HASH ??
  "0x603be1eb5305099466675ed500c819d3880aa3cd950498a47eb938abf39d49a";
const OPERATOR = process.env.STARKNET_ACCOUNT_ADDRESS ??
  "0x46a1747d854e74e5082c3215841b26dcff182a6a6fd7a1f83c3e1d045996101";
const TOKEN = process.env.STARKNET_USDC_ADDRESS ??
  "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
const UDC = "0x041a78e741e5af2fec34b695679bc6891742439f7afb8484ecd7766661ad02bf";

const jobId = process.argv[2];
const founder = process.argv[3] ?? "0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";
if (!jobId) { console.error("usage: starknet-vault-preflight.mjs <jobId> [founderAddress]"); process.exit(1); }

const db = new Database("var/sage.db", { readonly: true });
const rev = db.prepare(
  "select plan_json, approved_at from plan_revisions where job_id = ? and approved_at is not null order by revision_number desc limit 1",
).get(jobId);
if (!rev) { console.error(`no APPROVED plan for job ${jobId}`); process.exit(1); }

const plan = JSON.parse(rev.plan_json);
const missions = plan.missions ?? [];
const FELT_MASK = (1n << 252n) - 1n;
const toFelt = (v) => `0x${(BigInt(v) & FELT_MASK).toString(16)}`;

console.log(`job ${jobId} — ${missions.length} missions, approved`);
let total = 0n;
for (const m of missions) {
  if (!m.missionIdHash) { console.log(`  ✗ "${m.title}" has NO missionIdHash — this rail would refuse it`); process.exit(1); }
  total += BigInt(m.rewardBase) * BigInt(m.maxCompletions);
  console.log(`  · ${m.title.slice(0, 46).padEnd(46)} $${(Number(m.rewardBase)/1e6).toFixed(2)} × ${m.maxCompletions}  id ${toFelt(m.missionIdHash).slice(0,14)}…`);
}
console.log(`  total $${(Number(total)/1e6).toFixed(2)}\n`);

const salt = num.toHex(BigInt(hash.starknetKeccak(`sage:vault:${jobId}`).toString()) & ((1n << 248n) - 1n));
const ctor = CallData.compile({
  owner: founder, operator: OPERATOR, token: TOKEN,
  budget_ceiling: total.toString(), daily_cap: total.toString(),
});
const vault = num.toHex(hash.calculateContractAddressFromHash(
  hash.computePedersenHash(founder, salt), CLASS, ctor, UDC));

const calls = [
  { contractAddress: UDC, entrypoint: "deployContract", calldata: CallData.compile({ classHash: CLASS, salt, unique: 1, calldata: ctor }) },
  { contractAddress: TOKEN, entrypoint: "approve", calldata: CallData.compile({ spender: vault, amount: cairo.uint256(total) }) },
  { contractAddress: vault, entrypoint: "fund", calldata: CallData.compile({ amount: total.toString() }) },
  ...missions.map((m) => ({ contractAddress: vault, entrypoint: "add_mission",
    calldata: CallData.compile({ mission_id: toFelt(m.missionIdHash), reward: String(m.rewardBase), max_completions: String(m.maxCompletions) }) })),
];

console.log(`salt         ${salt}`);
console.log(`vault will be ${vault}`);
console.log(`calls         ${calls.length} in one signature (deploy + approve + fund + ${missions.length} missions)\n`);

const provider = new RpcProvider({ nodeUrl: RPC });
const check = async (label, fn) => {
  try { console.log(`  ✓ ${label}: ${await fn()}`); return true; }
  catch (e) { console.log(`  ✗ ${label}: ${String(e.message).slice(0, 110)}`); return false; }
};
console.log("against Starknet mainnet:");
await check("vault class is declared", async () => {
  const c = await provider.getClass(CLASS, "latest");
  return `${c.sierra_program.length} felts, ${c.entry_points_by_type.EXTERNAL.length} entry points`;
});
await check("operator account exists", async () => (await provider.getClassHashAt(OPERATOR)).slice(0, 14) + "…");
await check("settlement token responds", async () => {
  const r = await provider.callContract({ contractAddress: TOKEN, entrypoint: "decimals", calldata: [] });
  return `${BigInt(r[0])} decimals`;
});
await check("the vault address is free (not already deployed)", async () => {
  try { await provider.getClassHashAt(vault); return "ALREADY DEPLOYED — the flow would resume at attach"; }
  catch { return "free, as expected for a fresh launch"; }
});
await check("founder can afford it", async () => {
  const r = await provider.callContract({ contractAddress: TOKEN, entrypoint: "balance_of", calldata: [founder] });
  const bal = BigInt(r[0]);
  return `${(Number(bal)/1e6).toFixed(2)} USDC held vs $${(Number(total)/1e6).toFixed(2)} needed` +
    (bal < total ? "  ← SHORT" : "");
});
