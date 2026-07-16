// STAGE 3 — verify the deployed vault on-chain, prove the OPERATOR cannot do
// owner-only governance, then have the OWNER approve the recipient. Chain 59902.
import fs from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  keccak256,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "https://sepolia.metisdevops.link";
const FACTORY = getAddress("0x43C4823873DE9979f4B12bAedE201AFBc832b0B8");
const VAULT = getAddress("0xa37DE5781c297CbB0F5e10AD89C638517506416d");
const TOKEN = getAddress("0xF176f521290A937d81cc5878dfc19908f4D681A1");
const RECIPIENT = getAddress("0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3");
const PROBE = keccak256(stringToHex("sage.capability.probe.v1"));

const loadEnv = (p) => {
  try {
    const o = {};
    for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/.exec(l);
      if (m) o[m[1]] = m[2];
    }
    return o;
  } catch {
    return {};
  }
};
const env = { ...loadEnv("contracts/.env"), ...loadEnv(".env"), ...process.env };
const opKey = loadEnv(".env.staging.metissafety").OPERATOR_PRIVATE_KEY;
const norm = (k) => (k.startsWith("0x") ? k : "0x" + k);

const vaultAbi = JSON.parse(fs.readFileSync("contracts/out/PolicyVault.sol/PolicyVault.json", "utf8")).abi;
const factoryAbi = JSON.parse(fs.readFileSync("contracts/out/PolicyVaultFactory.sol/PolicyVaultFactory.json", "utf8")).abi;

const CHAIN = { id: 59902, name: "Metis Sepolia", nativeCurrency: { name: "Metis", symbol: "tMETIS", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) });
if ((await pub.getChainId()) !== 59902) throw new Error("ABORT: not 59902");

const owner = privateKeyToAccount(norm(env.PRIVATE_KEY));
const operator = privateKeyToAccount(norm(opKey));
const rd = (fn, args = []) => pub.readContract({ address: VAULT, abi: vaultAbi, functionName: fn, args });

// ---- read-only verification ----
const [state, vOwner, vOperator, policy, stats, isVault, intentUsedProbe, recipApprovedBefore] =
  await Promise.all([
    rd("getState"),
    rd("getOwner"),
    rd("getOperator"),
    rd("getPolicy"),
    rd("getSpendStats"),
    pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "isVault", args: [VAULT] }),
    rd("isIntentUsed", [PROBE]),
    rd("isVendorApproved", [RECIPIENT]),
  ]);

// ---- prove the OPERATOR cannot approve a vendor (owner-only) ----
let operatorApproveReverts = false;
let operatorRevertMsg = "";
try {
  await pub.simulateContract({ account: operator.address, address: VAULT, abi: vaultAbi, functionName: "queueAddVendor", args: [RECIPIENT] });
} catch (e) {
  operatorApproveReverts = true;
  operatorRevertMsg = (e.shortMessage ?? e.message ?? "").split("\n")[0];
}

// ---- OWNER approves the recipient (timelock 0 → queue + execute) ----
const ownerWallet = createWalletClient({ account: owner, chain: CHAIN, transport: http(RPC) });
if ((await pub.getChainId()) !== 59902) throw new Error("chain drift");
const gp = ((await pub.getGasPrice()) * 12n) / 10n;
const qTx = await ownerWallet.writeContract({ address: VAULT, abi: vaultAbi, functionName: "queueAddVendor", args: [RECIPIENT], gasPrice: gp });
await pub.waitForTransactionReceipt({ hash: qTx });
const eTx = await ownerWallet.writeContract({ address: VAULT, abi: vaultAbi, functionName: "executeAddVendor", args: [RECIPIENT], gasPrice: gp });
await pub.waitForTransactionReceipt({ hash: eTx });
const recipApprovedAfter = await rd("isVendorApproved", [RECIPIENT]);
const intentProbeStillUnused = await rd("isIntentUsed", [PROBE]);

console.log(JSON.stringify({
  stage: "03-verify-and-approve",
  chainId: 59902,
  vault_state_active: Number(state) === 2,
  owner_ok: vOwner.toLowerCase() === owner.address.toLowerCase(),
  operator_ok: vOperator.toLowerCase() === operator.address.toLowerCase(),
  token_ok: policy.paymentToken.toLowerCase() === TOKEN.toLowerCase(),
  policy: { budget: policy.budgetCeiling.toString(), perTx: policy.perTransactionCap.toString(), velocity: policy.dailyVelocityCap.toString(), duration: policy.duration.toString() },
  spendStats: { totalSpent: stats[0].toString(), remaining: stats[1].toString(), count: stats[2].toString() },
  factory_recognizes_vault: isVault,
  replay_capability_supported: intentUsedProbe === false, // fn exists + probe not consumed
  probe_not_consumed: intentProbeStillUnused === false,
  operator_cannot_approve: operatorApproveReverts,
  operator_revert: operatorRevertMsg,
  recipient_approved_before: recipApprovedBefore,
  owner_queue_tx: qTx,
  owner_execute_tx: eTx,
  recipient_approved_after: recipApprovedAfter,
}, null, 2));
