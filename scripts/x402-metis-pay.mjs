#!/usr/bin/env node
// PAY ONE OF SAGE'S TOOLS IN USDC ON METIS, over x402: the client a /mcp/metis/<tool> 402 points at.
//
//   PAYER_KEY=0x… node scripts/x402-metis-pay.mjs sage_first_look '{"url":"https://example.com"}'
//   PAYER_KEY=0x… node scripts/x402-metis-pay.mjs sage_first_look '{"url":"https://example.com"}' --approve
//
// What it does, in order:
//   1. calls the tool with no payment and reads the 402: the price in m.USDC, who is paid, the spender;
//   2. checks the payer holds that much m.USDC and has approved Permit2 for it. A first-time payer has
//      not: --approve sends that one approval (a transaction, so the payer needs a little METIS);
//   3. signs a Permit2 witness transfer for exactly the price, to exactly the payee, valid two minutes;
//   4. calls again with it in PAYMENT-SIGNATURE, and prints the tool's answer and the settlement.
// The payer key is read from PAYER_KEY and never printed. --base points it at another deployment.
import { randomBytes } from "node:crypto";
import { createPublicClient, createWalletClient, defineChain, formatUnits, getAddress, http, maxUint256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const RPC = process.env.METIS_MAINNET_RPC_URL?.trim() || "https://andromeda.metis.io/?owner=1088";
const EXPLORER = "https://andromeda-explorer.metis.io";
const metis = defineChain({ id: 1088, name: "Metis Andromeda", nativeCurrency: { name: "Metis", symbol: "METIS", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const TYPES = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "Witness" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  Witness: [
    { name: "to", type: "address" },
    { name: "validAfter", type: "uint256" },
  ],
};
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--base"));
const tool = positional[0];
const toolArgs = positional[1] ? JSON.parse(positional[1]) : {};
const base = (opt("--base") || "https://sagepays.xyz").replace(/\/$/, "");
if (!tool) {
  console.log("usage: PAYER_KEY=0x… node scripts/x402-metis-pay.mjs <tool> '<arguments as JSON>' [--approve] [--base URL]");
  process.exit(1);
}
const raw = process.env.PAYER_KEY?.trim();
if (!raw) {
  console.log("Set PAYER_KEY to the private key of the wallet that pays (it needs m.USDC, and a little METIS the first time).");
  process.exit(1);
}
const account = privateKeyToAccount(raw.startsWith("0x") ? raw : `0x${raw}`);
const url = `${base}/mcp/metis/${tool}`;
const pub = createPublicClient({ chain: metis, transport: http(RPC, { timeout: 30_000 }) });

console.log(`Paying ${url} from ${account.address}`);
const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(toolArgs) });
if (first.status !== 402) {
  console.log(`Expected 402 Payment Required, got ${first.status}: ${(await first.text()).slice(0, 300)}`);
  process.exit(1);
}
const challenge = await first.json();
const req = challenge.accepts?.[0];
if (!req || req.network !== "eip155:1088" || req.extra?.assetTransferMethod !== "permit2" || !req.extra?.permit2Proxy) {
  console.log("The 402 doesn't ask for an exact permit2 payment on Metis:", JSON.stringify(challenge.accepts));
  process.exit(1);
}
const amount = BigInt(req.amount);
const token = getAddress(req.asset);
const payTo = getAddress(req.payTo);
const spender = getAddress(req.extra.permit2Proxy);
console.log(`  price ${formatUnits(amount, 6)} USDC, paid to ${payTo}, spender ${spender}`);

const [balance, allowance, gas] = await Promise.all([
  pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [account.address] }),
  pub.readContract({ address: token, abi: erc20, functionName: "allowance", args: [account.address, PERMIT2] }),
  pub.getBalance({ address: account.address }),
]);
console.log(`  payer holds ${formatUnits(balance, 6)} USDC and ${formatUnits(gas, 18)} METIS`);
if (balance < amount) {
  console.log(`Not enough USDC: the call costs ${formatUnits(amount, 6)}.`);
  process.exit(1);
}
if (allowance < amount) {
  if (!flag("--approve")) {
    console.log("This wallet hasn't approved Permit2 yet. Run again with --approve to send that one transaction (it needs a little METIS for its fee).");
    process.exit(1);
  }
  const wallet = createWalletClient({ account, chain: metis, transport: http(RPC) });
  const gasPrice = ((await pub.getGasPrice()) * 12n) / 10n; // Metis prices gas legacy-style
  const hash = await wallet.writeContract({ address: token, abi: erc20, functionName: "approve", args: [PERMIT2, maxUint256], gasPrice, type: "legacy" });
  console.log(`  approving Permit2: ${EXPLORER}/tx/${hash}`);
  await pub.waitForTransactionReceipt({ hash });
}

const nonce = BigInt(`0x${randomBytes(32).toString("hex")}`);
const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(req.maxTimeoutSeconds || 120));
const message = { permitted: { token, amount }, spender, nonce, deadline, witness: { to: payTo, validAfter: 0n } };
const signature = await account.signTypedData({ domain: { name: "Permit2", chainId: 1088, verifyingContract: PERMIT2 }, types: TYPES, primaryType: "PermitWitnessTransferFrom", message });
const payload = {
  x402Version: 2,
  resource: challenge.resource,
  accepted: req,
  payload: {
    signature,
    permit2Authorization: {
      from: account.address,
      permitted: { token, amount: amount.toString() },
      spender,
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      witness: { to: payTo, validAfter: "0" },
    },
  },
};

const paid = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "payment-signature": Buffer.from(JSON.stringify(payload)).toString("base64") },
  body: JSON.stringify(toolArgs),
});
const settlementHeader = paid.headers.get("payment-response");
const settlement = settlementHeader ? JSON.parse(Buffer.from(settlementHeader, "base64").toString("utf8")) : null;
console.log(`  answered ${paid.status}`);
if (settlement?.transaction) console.log(`  settled: ${EXPLORER}/tx/${settlement.transaction}`);
console.log(JSON.stringify(await paid.json().catch(() => null), null, 2)?.slice(0, 4000));
process.exit(paid.ok ? 0 : 1);
