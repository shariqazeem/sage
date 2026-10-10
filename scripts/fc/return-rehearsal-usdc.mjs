// RETURN THE REHEARSAL USDC — the real Arc USDC used for the Demo Day rehearsals, back to the founder.
//
//   node scripts/fc/return-rehearsal-usdc.mjs --to 0x…              shows what would move (nothing is sent)
//   node scripts/fc/return-rehearsal-usdc.mjs --to 0x… --send       moves it
//
// Sources, each an ERC-20 transfer of USDC on Arc mainnet (where USDC is also the gas):
//   - the rehearsal seller (the throwaway key in WORKER_KEY_FILE): everything but one cent for the fee;
//   - the Sage operator (GOAT_AGENT_PRIVATE_KEY in contracts/.env): everything but --keep USDC
//     (default 0.25), the gas every Arc payout needs; --keep 0 takes it all, and Arc payouts then
//     cannot settle until it is refilled.
// Keys are read from local files and never printed.
import { readFileSync, existsSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, getAddress, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const SEND = process.argv.includes("--send");
const to = getAddress(arg("to", ""));
const keepOperator = BigInt(Math.round(Number(arg("keep", "0.25")) * 1e6));
const FEE_CENT = BigInt(10_000);
const USDC = "0x3600000000000000000000000000000000000000";
const RPC = "https://rpc.mainnet.arc.io";
const arc = defineChain({ id: 5042, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const abi = parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);
const pub = createPublicClient({ chain: arc, transport: http(RPC) });

const envFile = (f) => (existsSync(f) ? Object.fromEntries(readFileSync(f, "utf8").split("\n").map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")])) : {});
const hex = (k) => (k.startsWith("0x") ? k : `0x${k}`);
const sources = [];
if (process.env.WORKER_KEY_FILE && existsSync(process.env.WORKER_KEY_FILE)) {
  sources.push({ name: "rehearsal seller", account: privateKeyToAccount(hex(readFileSync(process.env.WORKER_KEY_FILE, "utf8").trim())), keep: FEE_CENT });
} else console.log("· rehearsal seller skipped (set WORKER_KEY_FILE to its key file)");
const op = envFile(new URL("../../contracts/.env", import.meta.url)).GOAT_AGENT_PRIVATE_KEY;
if (op) sources.push({ name: "Sage operator", account: privateKeyToAccount(hex(op)), keep: keepOperator > FEE_CENT ? keepOperator : FEE_CENT });
else console.log("· operator skipped (no GOAT_AGENT_PRIVATE_KEY in contracts/.env)");

const usd = (b) => (Number(b) / 1e6).toFixed(2);
let total = BigInt(0);
for (const s of sources) {
  const bal = await pub.readContract({ address: USDC, abi, functionName: "balanceOf", args: [s.account.address] });
  const amount = bal > s.keep ? ((bal - s.keep) / FEE_CENT) * FEE_CENT : BigInt(0); // whole cents
  console.log(`${s.name} ${s.account.address}: holds ${usd(bal)} USDC → ${SEND ? "sending" : "would send"} ${usd(amount)} to ${to} (keeps ${usd(bal - amount)})`);
  if (!SEND || amount === BigInt(0)) continue;
  const wallet = createWalletClient({ account: s.account, chain: arc, transport: http(RPC) });
  const hash = await wallet.writeContract({ address: USDC, abi, functionName: "transfer", args: [to, amount] });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${r.status === "success" ? "✓ sent" : "✗ REVERTED"}  https://explorer.arc.io/tx/${hash}`);
  if (r.status === "success") total += amount;
}
console.log(SEND ? `\nreturned ${usd(total)} USDC to ${to}` : "\nnothing sent: add --send to move it");
