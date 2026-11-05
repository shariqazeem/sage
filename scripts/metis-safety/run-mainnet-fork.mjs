/**
 * METIS MAINNET, REHEARSED ON A FORK: the account launch and a payout through production's own code, with
 * no real money and no real key.
 *
 *   node scripts/metis-safety/run-mainnet-fork.mjs
 *
 * Starts anvil forking Metis Andromeda (chain 1088) at its latest block, with a pre-London hardfork so the
 * fork refuses EIP-1559 transactions the way Metis does. Then runs mainnet-fork.exercise.ts with every Metis
 * setting pointed at the fork:
 * - the factory is the real deployed V2 factory, and m.USDC is the real token;
 * - the operator is an anvil test account, so no real key is read or needed;
 * - no model key, Telegram or x402 setting is passed: the judge degrades to its keyword heuristic, and the
 *   founder's approval pays.
 *
 * Nothing here can reach mainnet: the only RPC handed to the code is the local fork, and the exercise
 * refuses to run against anything else.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { mnemonicToAccount } from "viem/accounts";

const FORK_FROM = process.env.METIS_FORK_FROM || "https://andromeda.metis.io/?owner=1088";
const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
// anvil's public test mnemonic: these accounts exist only on the fork
const MNEMONIC = "test test test test test test test test test test test junk";
const toHex = (b) => `0x${Buffer.from(b).toString("hex")}`;
const operator = mnemonicToAccount(MNEMONIC, { addressIndex: 1 });

const anvil = spawn("anvil", ["--fork-url", FORK_FROM, "--port", String(PORT), "--chain-id", "1088", "--hardfork", "berlin", "--silent"], { stdio: "inherit" });
const ready = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
      if ((await r.json()).result === "0x440") return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

let code = 1;
try {
  if (!(await ready())) throw new Error("anvil did not come up on the fork");
  if (!existsSync("var")) mkdirSync("var");
  const db = "var/fork-metis-mainnet.db";
  rmSync(db, { force: true });
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "test",
    SAGE_DB_PATH: db,
    METIS_MAINNET_RPC_URL: RPC,
    METIS_RPC: RPC,
    METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS: "0xdD9a45c181dD95e48CDdC0149C8b821D604C45C9",
    METIS_MAINNET_OPERATOR_ADDRESS: operator.address,
    METIS_MAINNET_OPERATOR_PRIVATE_KEY: toHex(operator.getHdKey().privateKey),
    SAGE_PLAN_LIMITS: "off",
    METIS_FORK_RPC: RPC,
  };
  const r = spawnSync("npx", ["vitest", "run", "--config", "scripts/metis-safety/vitest.exercise.config.ts", "mainnet-fork"], { stdio: "inherit", env });
  code = r.status ?? 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
} finally {
  anvil.kill("SIGTERM");
}
process.exit(code);
