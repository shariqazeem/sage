// STAGE 1 — fresh disposable Metis Sepolia operator (owner/operator separation).
// Generates a crypto-secure key, stores it 0600 in a gitignored staging env,
// prints ONLY the public address, and funds it with a tiny amount of tMETIS gas.
// DISPOSABLE testnet-only infra — never reuse for GOAT/mainnet/production/ERC-8004/x402.
import fs from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  getAddress,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const RPC = process.env.METIS_SEPOLIA_RPC ?? "https://sepolia.metisdevops.link";
const STAGING_ENV = ".env.staging.metissafety";
const RECIPIENT = getAddress("0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3");

function loadEnv(p) {
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
}
const env = { ...loadEnv("contracts/.env"), ...loadEnv(".env"), ...process.env };
const norm = (k) => (k.startsWith("0x") ? k : "0x" + k);

const CHAIN = {
  id: 59902,
  name: "Metis Sepolia",
  nativeCurrency: { name: "Metis", symbol: "tMETIS", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};

const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) });

// ---- HARD chain guard before ANY broadcast ----
const chainId = await pub.getChainId();
if (chainId !== 59902) {
  console.error(`ABORT: chainId ${chainId} !== 59902`);
  process.exit(1);
}

const deployer = privateKeyToAccount(norm(env.PRIVATE_KEY));

// Reuse an existing staging operator if present; else generate a fresh one.
let opKey = loadEnv(STAGING_ENV).OPERATOR_PRIVATE_KEY;
let generated = false;
if (!opKey) {
  opKey = generatePrivateKey(); // crypto-secure (node crypto under the hood)
  generated = true;
  const body =
    `# DISPOSABLE Metis Sepolia (59902) safety-exercise operator — testnet only.\n` +
    `# NEVER reuse for GOAT / mainnet / production / ERC-8004 / x402.\n` +
    `OPERATOR_PRIVATE_KEY=${opKey}\n`;
  fs.writeFileSync(STAGING_ENV, body, { mode: 0o600 });
  fs.chmodSync(STAGING_ENV, 0o600);
}
const operator = privateKeyToAccount(norm(opKey));

// ---- separation assertions ----
const owner = deployer.address;
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
if (same(operator.address, owner)) throw new Error("operator == owner");
if (same(operator.address, RECIPIENT)) throw new Error("operator == recipient");
if (same(owner, RECIPIENT)) throw new Error("owner == recipient");

const balOp0 = await pub.getBalance({ address: operator.address });
// Fund only if under ~0.02 (idempotent on re-run).
let fundTx = null;
if (balOp0 < parseEther("0.015")) {
  const wallet = createWalletClient({ account: deployer, chain: CHAIN, transport: http(RPC) });
  // re-assert chain immediately before the broadcast group
  if ((await pub.getChainId()) !== 59902) throw new Error("chain drift");
  fundTx = await wallet.sendTransaction({ to: operator.address, value: parseEther("0.02") });
  await pub.waitForTransactionReceipt({ hash: fundTx });
}
const balOp1 = await pub.getBalance({ address: operator.address });

console.log(
  JSON.stringify(
    {
      stage: "01-operator-setup",
      chainId,
      generated_new_operator: generated,
      staging_env_file: STAGING_ENV,
      staging_env_perms: (fs.statSync(STAGING_ENV).mode & 0o777).toString(8),
      addresses: { owner_deployer: owner, operator: operator.address, recipient: RECIPIENT },
      separation_ok: !same(operator.address, owner) && !same(operator.address, RECIPIENT) && !same(owner, RECIPIENT),
      operator_balance_before: formatEther(balOp0),
      fund_tx: fundTx,
      operator_balance_after: formatEther(balOp1),
    },
    null,
    2,
  ),
);
