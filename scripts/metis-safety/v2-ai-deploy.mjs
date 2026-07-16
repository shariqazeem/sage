import { readFileSync } from "node:fs";
import { createWalletClient, createPublicClient, http, getAddress, parseEventLogs, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// TX1–5 of the AI-proof exercise: deploy the fresh minimal vault via the existing
// factory, mint + approve + fund the exact budget, activate. Owner-signed only; the
// operator does NOT sign here. Hard chain guard + predicted-address guard: aborts
// before the money txs if anything drifts from the frozen preview.

const RPC = "https://sepolia.metisdevops.link";
const chain = defineChain({ id: 59902, name: "Metis Sepolia", nativeCurrency: { name: "Metis", symbol: "METIS", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC, { timeout: 60000, retryCount: 2 }) });
if (await pub.getChainId() !== 59902) { console.log("ABORT chain"); process.exit(1); }

const kf = (f, n) => { const m = new RegExp(`^\\s*${n}\\s*=\\s*(.+?)\\s*$`, "m").exec(readFileSync(f, "utf8")); let k = m[1].trim(); return k.startsWith("0x") ? k : "0x" + k; };
const owner = privateKeyToAccount(kf("contracts/.env", "PRIVATE_KEY"));
if (getAddress(owner.address) !== getAddress("0xb77e6f5466cf52524e8465859277f192Be0bCfe4")) { console.log("ABORT owner"); process.exit(1); }
const wallet = createWalletClient({ account: owner, chain, transport: http(RPC, { timeout: 60000, retryCount: 2 }) });

const FACTORY = getAddress("0x2249b773aFEd5594985F7D350581A1b55f279C7f");
const OPERATOR = getAddress("0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35");
const GUARDIAN = getAddress(owner.address);
const TOKEN = getAddress("0xF176f521290A937d81cc5878dfc19908f4D681A1");
const CID = "0x4a5024d5af6dfe32e1ae40fb73978a8e1c793ef157109316ed2db31d868d10e7";
const MID = "0x9af3313cb0b13822c9caaab12045888fbf36fcfa80ef85ddb76bb5b3c000c6f3";
const REWARD = 100000n, CAP = 1n, VELOCITY = 100000n, DURATION = 604800n, BUDGET = REWARD * CAP; // 100000
const PREDICTED = getAddress("0x73Ce425A84B1c2e4F19c7cB9f5d745EE529e4972");

const facAbi = JSON.parse(readFileSync("contracts/out/CampaignVaultFactory.sol/CampaignVaultFactory.json", "utf8")).abi;
const vaultAbi = JSON.parse(readFileSync("contracts/out/CampaignVault.sol/CampaignVault.json", "utf8")).abi;
const usdcAbi = JSON.parse(readFileSync("contracts/out/MockUSDC.sol/MockUSDC.json", "utf8")).abi;
const gp = (await pub.getGasPrice()) * 12n / 10n;
const send = async (o) => { const h = await wallet.writeContract({ ...o, gasPrice: gp }); const r = await pub.waitForTransactionReceipt({ hash: h }); return { h, r }; };
const rd = (fn, a = []) => pub.readContract({ address: PREDICTED, abi: vaultAbi, functionName: fn, args: a });
const bal = (a) => pub.readContract({ address: TOKEN, abi: usdcAbi, functionName: "balanceOf", args: [getAddress(a)] });

// TX1 — deploy vault (or reuse if a prior partial run already deployed it)
const existing = await pub.getBytecode({ address: PREDICTED });
if (existing && existing !== "0x") {
  console.log("TX1_SKIP vault already deployed at " + PREDICTED + " isVault=" + await pub.readContract({ address: FACTORY, abi: facAbi, functionName: "isVault", args: [PREDICTED] }));
} else {
  const { h, r } = await send({ address: FACTORY, abi: facAbi, functionName: "createCampaignVault", args: [OPERATOR, GUARDIAN, TOKEN, CID, [MID], [REWARD], [CAP], VELOCITY, DURATION] });
  console.log("TX1_CREATE_VAULT " + h + " status=" + r.status + " block=" + r.blockNumber);
  if (r.status !== "success") { console.log("ABORT createVault reverted"); process.exit(1); }
  const ev = parseEventLogs({ abi: facAbi, logs: r.logs, eventName: "CampaignVaultCreated" })[0];
  const vault = getAddress(ev.args.vault);
  console.log("VAULT_ADDR " + vault);
  if (vault !== PREDICTED) { console.log("ABORT vault != predicted"); process.exit(1); }
}

// read config back
console.log("V_OWNER " + await rd("getOwner"));
console.log("V_OPERATOR " + await rd("getOperator"));
console.log("V_TOKEN " + await rd("getToken"));
console.log("V_CID " + await rd("getCampaignIdHash"));
console.log("V_PLAN " + await rd("getMissionPlanDigest"));
console.log("V_MISSION_REWARD " + await rd("getMissionReward", [MID]));
console.log("V_VELOCITY " + await rd("getDailyVelocityCap"));
let state = await rd("getState");
console.log("V_STATE_BEFORE " + state + " (2=Active)");

if (Number(state) === 2) {
  console.log("ALREADY_ACTIVE — skipping mint/approve/fund/activate");
} else {
  // TX2 — mint budget to owner (only what's needed)
  const ownerBal = await bal(owner.address);
  if (ownerBal < BUDGET) { const { h } = await send({ address: TOKEN, abi: usdcAbi, functionName: "mint", args: [owner.address, BUDGET - ownerBal] }); console.log("TX2_MINT " + h); }
  else console.log("TX2_MINT_SKIP owner already holds " + ownerBal);
  // TX3 — approve vault
  { const { h } = await send({ address: TOKEN, abi: usdcAbi, functionName: "approve", args: [PREDICTED, BUDGET] }); console.log("TX3_APPROVE " + h); }
  // TX4 — fund the shortfall up to BUDGET
  const vaultBal = await bal(PREDICTED);
  if (vaultBal < BUDGET) { const { h, r } = await send({ address: PREDICTED, abi: vaultAbi, functionName: "fund", args: [BUDGET - vaultBal] }); console.log("TX4_FUND " + h + " status=" + r.status); }
  else console.log("TX4_FUND_SKIP vault already holds " + vaultBal);
  // TX5 — activate
  { const { h, r } = await send({ address: PREDICTED, abi: vaultAbi, functionName: "activate", args: [] }); console.log("TX5_ACTIVATE " + h + " status=" + r.status); }
}

state = await rd("getState");
const stats = await rd("getSpendStats");
console.log("V_STATE_AFTER " + state + " (2=Active)");
console.log("V_BUDGET_CEILING " + await rd("getBudgetCeiling"));
console.log("V_SPENT " + stats[0] + " REMAINING " + stats[1] + " PAYOUTS " + stats[2]);
console.log("V_MISSION_REMAINING " + await rd("getMissionRemaining", [MID]));
console.log("V_TOKEN_BAL " + await bal(PREDICTED));
console.log("GROUP_DEPLOY_DONE");
