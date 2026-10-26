// SWEEP SAGE'S STARKNET POT TO A WALLET (26 Oct 2026, the founder's call). Starknet is closed for new
// work and the /record advance has no borrowers, so what the operator's Starknet account holds goes to the
// founder's own wallet. It moves real money, so the founder runs it.
//
//   node scripts/vm/starknet-sweep-pot.mjs <starknet wallet>          dry run: what is there, what would move, the fee
//   node scripts/vm/starknet-sweep-pot.mjs <starknet wallet> --send   sends it, in one transaction, then re-reads
//
// Runs on the server, where the operator's Starknet key (.env) and the claim secrets (the database) live,
// and prints neither. ONE multicall from the operator account (STARKNET_ACCOUNT_ADDRESS):
//   1. all of its USDC to the wallet;
//   2. every advance escrow still uncollected, collected straight to the wallet (`claim_to_address`, the
//      same call the claim page relays for a worker);
//   3. its STRK, less a reserve for this transaction's own fee, to the wallet.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, Contract, RpcProvider, uint256 } from "starknet";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const MAINNET_USDC = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
const EXPLORER = "https://starkscan.co";

const env = {};
for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const say = (s = "") => console.log(s);
const stop = (s) => {
  console.error(`REFUSED: ${s}`);
  process.exit(1);
};
const isFelt = (v) => /^0x[0-9a-fA-F]{1,64}$/.test(v) && BigInt(v) < 2n ** 251n;
const same = (a, b) => BigInt(a) === BigInt(b);
const fmt = (base, dp) => (Number(base) / 10 ** dp).toLocaleString("en-US", { maximumFractionDigits: 6 });
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const args = process.argv.slice(2);
const SEND = args.includes("--send");
const recipient = args.find((a) => !a.startsWith("--"));
if (!recipient) stop("usage: node scripts/vm/starknet-sweep-pot.mjs <starknet wallet> [--send]");
if (!isFelt(recipient)) stop(`${recipient} is not a Starknet address`);

const { STARKNET_RPC_URL: rpc, STARKNET_ACCOUNT_ADDRESS: pot, STARKNET_PRIVATE_KEY: key, STARKNET_CLAIMS_ADDRESS: claimsAddress } = env;
if (!rpc || !pot || !key || !claimsAddress) stop("the server's .env lacks the Starknet operator settings");
if (same(recipient, pot)) stop("that is the pot itself");
const usdc = env.STARKNET_USDC_ADDRESS || MAINNET_USDC;

const provider = new RpcProvider({ nodeUrl: rpc });
const account = new Account({ provider, address: pot, signer: key });
const balance = async (token) => {
  const [low, high] = await provider.callContract({ contractAddress: token, entrypoint: "balance_of", calldata: [pot] });
  return BigInt(low) + (BigInt(high) << 128n);
};
const u256 = (n) => {
  const x = uint256.bnToUint256(n);
  return [x.low.toString(), x.high.toString()];
};

// Advance escrows Sage still holds a claim secret for, and that are open on chain.
const abi = JSON.parse(readFileSync(join(ROOT, "src/lib/starknet/claims-abi.json"), "utf8"));
const claims = new Contract({ abi, address: claimsAddress, providerOrAccount: provider });
const Database = require("better-sqlite3");
const db = new Database(env.SAGE_DB_PATH || join(ROOT, "var/sage.db"), { readonly: true });
const advances = db
  .prepare("select id, disburse_claim_commitment as commitment, disburse_claim_secret as secret from advances where disburse_claim_secret is not null and disburse_claim_commitment is not null")
  .all();
db.close();
const open = [];
for (const a of advances) {
  const c = await claims.call("get_claim", [a.commitment]);
  if (BigInt(c.token) !== 0n && !c.claimed) open.push({ id: a.id, secret: a.secret, amount: BigInt(c.amount), expiry: Number(c.expiry) });
}

const [usdcBal, strkBal] = await Promise.all([balance(usdc), balance(STRK)]);
say(`Sage's Starknet pot (the operator account) ${pot}`);
say(`  holds ${fmt(usdcBal, 6)} USDC and ${fmt(strkBal, 18)} STRK`);
say(`  ${open.length ? `${open.length} advance escrow(s) still uncollected` : "no advance escrow left to collect"}`);

const calls = [];
if (usdcBal > 0n) calls.push({ contractAddress: usdc, entrypoint: "transfer", calldata: [recipient, ...u256(usdcBal)] });
for (const o of open) calls.push({ contractAddress: claimsAddress, entrypoint: "claim_to_address", calldata: [BigInt(o.secret).toString(), recipient] });

// The fee is paid in STRK from this account, so the STRK leg leaves a reserve for it: three times the
// estimate (never less than 0.01 STRK). What the fee does not use stays behind as dust.
let strkSend = 0n;
let fee = 0n;
if (strkBal > 10n ** 16n) {
  const probe = [...calls, { contractAddress: STRK, entrypoint: "transfer", calldata: [recipient, ...u256(strkBal / 2n)] }];
  fee = (await account.estimateInvokeFee(probe)).overall_fee;
  const reserve = fee * 3n > 10n ** 16n ? fee * 3n : 10n ** 16n;
  if (strkBal > reserve) strkSend = strkBal - reserve;
} else if (calls.length) {
  fee = (await account.estimateInvokeFee(calls)).overall_fee;
}
if (strkSend > 0n) calls.push({ contractAddress: STRK, entrypoint: "transfer", calldata: [recipient, ...u256(strkSend)] });
if (!calls.length) stop("there is nothing to move");

say();
say(`To ${recipient} (${short(recipient)}), in ONE transaction:`);
let n = 1;
if (usdcBal > 0n) say(`  ${n++}. ${fmt(usdcBal, 6)} USDC, all the pot holds`);
for (const o of open) say(`  ${n++}. ${fmt(o.amount, 6)} USDC, the uncollected advance ${o.id}, collected straight to you`);
if (strkSend > 0n) say(`  ${n++}. ${fmt(strkSend, 18)} STRK, all but ${fmt(strkBal - strkSend, 18)} kept for this transaction's fee`);
say(`Network fee: about ${fmt(fee, 18)} STRK, paid from the pot.`);

if (!SEND) {
  say();
  say("Nothing sent. Run again with --send to send it.");
  process.exit(0);
}

const { transaction_hash: hash } = await account.execute(calls);
say();
say(`Sent: ${EXPLORER}/tx/${hash}`);
const receipt = await provider.waitForTransaction(hash);
const status = receipt.execution_status ?? receipt.value?.execution_status ?? "unknown";
say(`Status: ${status}`);
const [usdcAfter, strkAfter] = await Promise.all([balance(usdc), balance(STRK)]);
say(`The pot now holds ${fmt(usdcAfter, 6)} USDC and ${fmt(strkAfter, 18)} STRK.`);
if (status !== "SUCCEEDED") process.exit(1);
