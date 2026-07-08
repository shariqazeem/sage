#!/usr/bin/env node
/**
 * ERC-8004 agent registration on GOAT Mainnet — the Stage-1 identity gate.
 *
 * Registers Sage's Payout Deputy on the ERC-8004 registry so it appears on
 * https://8004scan.io/agents?chain=2345. Registration is idempotent-ish: the
 * signing wallet BECOMES the agent identity, so its future settlements are the
 * agent's reputation. Run this once, when the signing wallet has GOAT gas.
 *
 * USAGE
 *   node scripts/register-erc8004.mjs [agentName]
 *
 * KEY (in priority order):
 *   - GOAT_AGENT_PRIVATE_KEY env  (a dedicated agent key — recommended long-term)
 *   - else OPERATOR_PRIVATE_KEY / PRIVATE_KEY in contracts/.env
 * The resulting address is printed first; FUND IT with a little GOAT gas
 * (the $3 mainnet-gas form) before the write runs. The script refuses to send
 * if the balance is zero.
 *
 * WHY the operator key by default: it's the address that signs vault settlements,
 * so making it the ERC-8004 identity ties "reputation = real payout history"
 * together. If you'd rather a separate identity, set GOAT_AGENT_PRIVATE_KEY.
 *
 * CANONICAL AGENT URI: the machine-readable card lives at
 *   {NEXT_PUBLIC_SITE_URL}/api/agent/card      (human page: /agents/sage)
 * It serves { name, description, url, wallet, agentId?, chainId, registry, stats }
 * — the identity AND its grounded reputation (real settled payouts / blocks /
 * decisions). Once this script writes ERC8004_AGENT_ID / _ADDRESS / _NAME to .env,
 * the card and page flip to the registered state automatically on next boot.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/* ─────────────────────────────────────────── config (from the guide) ──── */
const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const AGENT_NAME = process.argv[2] || process.env.SAGE_AGENT_NAME || "Sage";

const goat = defineChain({
  id: 2345,
  name: "GOAT Network",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.goat.network"] } },
  blockExplorers: {
    default: { name: "GOAT Explorer", url: "https://explorer.goat.network" },
  },
});

// Minimal registry ABI: register + the agent-wallet view + the ERC-721 mint event.
const registryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ type: "string", name: "name" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "agentId" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { type: "address", name: "from", indexed: true },
      { type: "address", name: "to", indexed: true },
      { type: "uint256", name: "tokenId", indexed: true },
    ],
  },
];

/* ─────────────────────────────────────────────────── key loading ──────── */
function loadKey() {
  let raw = process.env.GOAT_AGENT_PRIVATE_KEY;
  if (!raw) {
    try {
      const text = readFileSync(join(ROOT, "contracts", ".env"), "utf8");
      const found = {};
      for (const line of text.split(/\r?\n/)) {
        const m =
          /^\s*(GOAT_AGENT_PRIVATE_KEY|OPERATOR_PRIVATE_KEY|PRIVATE_KEY)\s*=\s*(.+?)\s*$/.exec(
            line,
          );
        if (m) found[m[1]] = m[2];
      }
      // Prefer the dedicated agent key; fall back to the operator key.
      raw =
        found.GOAT_AGENT_PRIVATE_KEY ||
        found.OPERATOR_PRIVATE_KEY ||
        found.PRIVATE_KEY;
    } catch {
      /* no contracts/.env */
    }
  }
  if (!raw) {
    console.error(
      "No key found. Set GOAT_AGENT_PRIVATE_KEY in contracts/.env (or OPERATOR_PRIVATE_KEY / PRIVATE_KEY).",
    );
    process.exit(1);
  }
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

/* ───────────────────────────────────────────────────────── run ────────── */
async function main() {
  const account = privateKeyToAccount(loadKey());
  const pub = createPublicClient({ chain: goat, transport: http() });
  const wallet = createWalletClient({ account, chain: goat, transport: http() });

  console.log(`\nERC-8004 registration on GOAT Network (chain 2345)`);
  console.log(`  registry:   ${REGISTRY}`);
  console.log(`  agent name: "${AGENT_NAME}"`);
  console.log(`  signer:     ${account.address}   <-- this becomes the agent identity`);

  const balance = await pub.getBalance({ address: account.address });
  console.log(`  gas balance: ${formatEther(balance)} BTC`);
  if (balance === 0n) {
    console.error(
      `\nThis wallet has no GOAT gas. Fund ${account.address} (mainnet-gas form: https://forms.gle/mjqCfinRfWT51xeh7), then re-run.`,
    );
    process.exit(1);
  }

  console.log(`\nSending register("${AGENT_NAME}")…`);
  let hash;
  try {
    hash = await wallet.writeContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: "register",
      args: [AGENT_NAME],
    });
  } catch (err) {
    // Some Bitcoin-L2 RPCs want a legacy (non-1559) tx. Retry once with gasPrice.
    console.warn(`  1559 send failed (${err.shortMessage ?? err.message}); retrying legacy…`);
    const gasPrice = ((await pub.getGasPrice()) * 12n) / 10n;
    hash = await wallet.writeContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: "register",
      args: [AGENT_NAME],
      gasPrice,
    });
  }

  console.log(`  tx: https://explorer.goat.network/tx/${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    console.error(`  register reverted. Name may be taken or the wallet already registered.`);
    process.exit(1);
  }

  // Recover the agent id from the ERC-721 mint (Transfer from 0x0 to us).
  const events = parseEventLogs({ abi: registryAbi, logs: receipt.logs, eventName: "Transfer" });
  const mint = events.find(
    (e) => e.args.to?.toLowerCase() === account.address.toLowerCase(),
  );
  const agentId = mint?.args.tokenId;
  if (agentId === undefined) {
    console.log(`  Registered, but no Transfer log matched — check the tx on the explorer.`);
    process.exit(0);
  }

  const registeredWallet = await pub.readContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "getAgentWallet",
    args: [agentId],
  });

  console.log(`\n✅ Registered.`);
  console.log(`  agentId:        ${agentId}`);
  console.log(`  getAgentWallet: ${registeredWallet}`);
  console.log(`  verify match:   ${registeredWallet.toLowerCase() === account.address.toLowerCase()}`);
  console.log(`\n  Appears on: https://8004scan.io/agents?chain=2345`);

  // Persist to .env so the app's identity panel populates automatically.
  try {
    const envPath = join(ROOT, ".env");
    let env = "";
    try {
      env = readFileSync(envPath, "utf8");
    } catch {
      /* no root .env yet */
    }
    const setVar = (k, v) => {
      const re = new RegExp(`^${k}=.*$`, "m");
      if (re.test(env)) env = env.replace(re, `${k}=${v}`);
      else env += `${env === "" || env.endsWith("\n") ? "" : "\n"}${k}=${v}\n`;
    };
    setVar("ERC8004_AGENT_ID", String(agentId));
    setVar("ERC8004_AGENT_ADDRESS", account.address);
    setVar("ERC8004_AGENT_NAME", AGENT_NAME);
    writeFileSync(envPath, env);
    console.log(`  wrote ERC8004_AGENT_ID / _ADDRESS / _NAME to .env — restart the app and the identity panel shows it.\n`);
  } catch (e) {
    console.warn(`  (couldn't write .env: ${e.message}) — set ERC8004_AGENT_ID=${agentId} manually.\n`);
  }
}

main().catch((err) => {
  console.error("\nRegistration failed:", err.shortMessage ?? err.message ?? err);
  process.exit(1);
});
