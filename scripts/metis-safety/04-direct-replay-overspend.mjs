// PHASE 6b + 7 — direct contract-level checks by the OPERATOR:
//  (a) REPLAY the consumed intent  -> SpendRejected(failedCheckIndex = 7), 0 tokens.
//  (b) OVERSPEND above the 0.5 cap -> SpendRejected(failedCheckIndex = 4), 0 tokens.
// Distinct from the application-level replay (Phase 6). Chain 59902 only.
import fs from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  keccak256,
  stringToHex,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "https://sepolia.metisdevops.link";
const VAULT = getAddress("0xa37DE5781c297CbB0F5e10AD89C638517506416d");
const TOKEN = getAddress("0xF176f521290A937d81cc5878dfc19908f4D681A1");
const RECIPIENT = getAddress("0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3");
const CONSUMED_INTENT = "0x9d03692c5f14c982069717b8fce24b90aa18b9cdab54340f64d3b176aed7cd40"; // from Stage 4
const FRESH_INTENT = keccak256(stringToHex("metis-safety-overspend-v1"));

const loadEnv = (p) => {
  const o = {};
  try {
    for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/.exec(l);
      if (m) o[m[1]] = m[2];
    }
  } catch {}
  return o;
};
const opKey = loadEnv(".env.staging.metissafety").OPERATOR_PRIVATE_KEY;
const norm = (k) => (k.startsWith("0x") ? k : "0x" + k);
const vaultAbi = JSON.parse(fs.readFileSync("contracts/out/PolicyVault.sol/PolicyVault.json", "utf8")).abi;

const CHAIN = { id: 59902, name: "Metis Sepolia", nativeCurrency: { name: "Metis", symbol: "tMETIS", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) });
if ((await pub.getChainId()) !== 59902) throw new Error("ABORT: not 59902");

const operator = privateKeyToAccount(norm(opKey));
const wallet = createWalletClient({ account: operator, chain: CHAIN, transport: http(RPC) });
const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }];
const balOf = (a) => pub.readContract({ address: TOKEN, abi: erc20, functionName: "balanceOf", args: [a] });
const rd = (fn, args = []) => pub.readContract({ address: VAULT, abi: vaultAbi, functionName: fn, args });

async function requestSpend(amount, intent) {
  const gp = ((await pub.getGasPrice()) * 12n) / 10n;
  const tx = await wallet.writeContract({ address: VAULT, abi: vaultAbi, functionName: "requestSpend", args: [RECIPIENT, amount, intent], gasPrice: gp });
  const receipt = await pub.waitForTransactionReceipt({ hash: tx });
  const events = parseEventLogs({ abi: vaultAbi, logs: receipt.logs, eventName: ["SpendSettled", "SpendRejected"] });
  const rej = events.find((e) => e.eventName === "SpendRejected");
  return { tx, status: receipt.status, settled: events.some((e) => e.eventName === "SpendSettled"), failedCheckIndex: rej ? Number(rej.args.failedCheckIndex) : null };
}

const recipBefore = await balOf(RECIPIENT);
const spentBefore = (await rd("getSpendStats"))[0];

// (a) direct replay of the CONSUMED intent → check 7
const replay = await requestSpend(500000n, CONSUMED_INTENT);
// (b) overspend 0.6 > 0.5 cap, fresh intent → check 4
const overspend = await requestSpend(600000n, FRESH_INTENT);

const recipAfter = await balOf(RECIPIENT);
const spentAfter = (await rd("getSpendStats"))[0];
const freshUsed = await rd("isIntentUsed", [FRESH_INTENT]);
const consumedStillUsed = await rd("isIntentUsed", [CONSUMED_INTENT]);

console.log(JSON.stringify({
  stage: "04-direct-replay-overspend",
  chainId: 59902,
  direct_replay: { tx: replay.tx, txStatus: replay.status, settled: replay.settled, failedCheckIndex: replay.failedCheckIndex, expected: 7 },
  overspend: { tx: overspend.tx, txStatus: overspend.status, settled: overspend.settled, failedCheckIndex: overspend.failedCheckIndex, expected: 4 },
  recipient_unchanged: recipAfter === recipBefore,
  vault_spent_unchanged: spentAfter === spentBefore,
  recipient_balance_base: recipAfter.toString(),
  vault_spent_base: spentAfter.toString(),
  consumed_intent_still_used: consumedStillUsed,
  overspend_intent_not_consumed: freshUsed === false,
}, null, 2));
