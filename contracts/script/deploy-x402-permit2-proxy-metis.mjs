// DEPLOY THE x402 PERMIT2 PROXY ON METIS ANDROMEDA (chain 1088), through the deterministic CREATE2
// deployer, so x402 payments in m.USDC can settle there (src/lib/x402/metis/).
//
//   node contracts/script/deploy-x402-permit2-proxy-metis.mjs          checks everything, sends nothing
//   node contracts/script/deploy-x402-permit2-proxy-metis.mjs --send   deploys (the founder)
//
// Run from the repo root (it uses the repo's viem). The deployer key is X402_METIS_DEPLOYER_PRIVATE_KEY,
// else X402_METIS_FACILITATOR_PRIVATE_KEY, read from the environment, contracts/.env or .env, and
// never printed. Anyone can deploy this contract: the address depends on the code and the salt, not
// on who sends the transaction, so any key with a little METIS will do.
//
// WHICH BUILD. x402's canonical x402ExactPermit2Proxy (0x402085c248EeA27D92E8b30b2C58ed07f9E20001) is
// built for Cancun, and its settle() copies a string with MCOPY. Andromeda has no MCOPY (measured
// 19 Oct 2026 on three public RPCs; PUSH0 works, MCOPY, TSTORE and BASEFEE do not). Deployed there,
// the canonical proxy would answer its views and revert on every payment. So this script probes the
// chain first:
//   - MCOPY works  -> the canonical initcode, at the canonical address (x402's own Deploy.s.sol);
//   - MCOPY absent -> the "paris" build: the same source and compiler settings with evm_version
//                     "paris", the same deployer and salt, at 0xC5Df359394de02F8E04bfb650E250b20a33BEe6a.
// The canonical build is never deployed where it cannot run. --paris forces the paris build anywhere.
//
// The paris initcode is vendored in data/ with its hash pinned below. To rebuild it yourself: take
// x402 commit 0e6e8c55d86b4f14234fb6e49a4052074fb93e57 (contracts/evm/src/x402BasePermit2Proxy.sol,
// x402ExactPermit2Proxy.sol, interfaces/ISignatureTransfer.sol) with OpenZeppelin commit
// fcbae5394ae8ad52d8e580a3477db99814b9d565 (v5.5.0); solc 0.8.28, optimizer on, 200 runs, via_ir
// false, cbor_metadata false, bytecode_hash "none", evm_version "paris"; initcode = creation code ++
// abi.encode(0x000000000022D473030F116dDEE9F6B43aC78BA3). keccak256 must be the paris initCodeHash
// below. The same recipe with evm_version "cancun" reproduces the canonical runtime byte for byte,
// less its CBOR metadata, which is how the recipe was checked. docs/next/metis-x402.md has the rest.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { concat, createPublicClient, formatEther, getAddress, getCreate2Address, http, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CHAIN_ID = 1088;
const RPC = process.env.METIS_MAINNET_RPC_URL?.trim() || "https://andromeda.metis.io/?owner=1088";
const EXPLORER = "https://andromeda-explorer.metis.io";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const PERMIT2_DOMAIN_SEPARATOR_1088 = "0x55927daba8f95df73da537f4d02fbc6f1e611c904f58e25a7a0cf8395596b6e8";
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const PROXY_SALT = "0x0000000000000000000000000000000000000000000000003000000007263b0e";
const WITNESS_TYPE_STRING =
  "Witness witness)TokenPermissions(address token,uint256 amount)Witness(address to,uint256 validAfter)";
const WITNESS_TYPEHASH = "0xd97b3239a7f32295517bd14cb074edfdd188dfe5eb42f802bb26d4fd1eb12c37";
const BUILDS = {
  canonical: {
    address: "0x402085c248EeA27D92E8b30b2C58ed07f9E20001",
    initCodeHash: "0xe774d1d5a07218946ab54efe010b300481478b86861bb17d69c98a57f68a604c",
    runtimeCodeHash: "0xce6429c0bb49284660683287c0a8fe548a88379072327d026626909d202048b9",
    file: "data/x402-exact-permit2-proxy.canonical.initcode.hex",
  },
  paris: {
    address: "0xC5Df359394de02F8E04bfb650E250b20a33BEe6a",
    initCodeHash: "0x8ae99ed2d883dd962ff32f75cacad05f2259012ffb7aaf7c37926321c5fbf6c9",
    runtimeCodeHash: "0x471bf94146d66f9cf16eb685be3342b030a7cdf25938c549a53df2d0ed3f1452",
    file: "data/x402-exact-permit2-proxy.paris.initcode.hex",
  },
};
// The deployer must hold at least this, or twice the deploy's estimated cost if that is more. The
// deploy measures ~724k gas (simulated on 1088, 19 Oct 2026), ~0.012 METIS at ~16 gwei.
const MIN_BALANCE_WEI = 20_000_000_000_000_000n; // 0.02 METIS
// PUSH1 aa, PUSH1 0, MSTORE8, MCOPY(32, 0, 1), RETURN(0, 64): returns 64 bytes if MCOPY exists.
const MCOPY_PROBE = "0x60aa6000536001600060205e60406000f3";
const MCOPY_EXPECTED = `0xaa${"00".repeat(31)}aa${"00".repeat(31)}`;
const PROBE_FROM = "0x000000000000000000000000000000000000dEaD";

const HERE = dirname(fileURLToPath(import.meta.url)); // contracts/script
const SEND = process.argv.includes("--send");
const FORCE_PARIS = process.argv.includes("--paris");

const proxyAbi = parseAbi([
  "function PERMIT2() view returns (address)",
  "function WITNESS_TYPEHASH() view returns (bytes32)",
  "function WITNESS_TYPE_STRING() view returns (string)",
]);
const permit2Abi = parseAbi(["function DOMAIN_SEPARATOR() view returns (bytes32)"]);

const say = (line) => console.log(line);
function refuse(line) {
  console.log(`REFUSED: ${line}`);
  process.exit(1);
}

function envFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function deployerKey() {
  const files = { ...envFile(join(HERE, "..", "..", ".env")), ...envFile(join(HERE, "..", ".env")) };
  const pick = (name) => process.env[name]?.trim() || files[name]?.trim() || "";
  const raw = pick("X402_METIS_DEPLOYER_PRIVATE_KEY") || pick("X402_METIS_FACILITATOR_PRIVATE_KEY");
  if (!raw) return null;
  const hex = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) refuse("the deployer key is not a 32-byte hex key");
  return privateKeyToAccount(hex);
}

async function readView(client, address, functionName) {
  try {
    return await client.readContract({ address, abi: proxyAbi, functionName });
  } catch {
    return null;
  }
}

/** The same functional check the facilitator runs before it opens (src/lib/x402/metis/proxy-core.ts). */
async function proxyWorks(client, address, build) {
  const code = await client.getCode({ address });
  if (!code || code === "0x") return "no code";
  if (keccak256(code) !== build.runtimeCodeHash) return `unexpected runtime hash ${keccak256(code)}`;
  const permit2 = await readView(client, address, "PERMIT2");
  if (!permit2 || getAddress(permit2) !== getAddress(PERMIT2)) return "PERMIT2() is not the canonical Permit2";
  if ((await readView(client, address, "WITNESS_TYPEHASH")) !== WITNESS_TYPEHASH) return "unexpected WITNESS_TYPEHASH()";
  if ((await readView(client, address, "WITNESS_TYPE_STRING")) !== WITNESS_TYPE_STRING) {
    return "WITNESS_TYPE_STRING() reverted: this build cannot run its settle path on this chain";
  }
  return null;
}

function printEnv(address) {
  say("");
  say("Set on the VM (.env), then restart Sage:");
  say(`  X402_METIS_PERMIT2_PROXY_ADDRESS=${address}`);
  say("  X402_METIS_FACILITATOR_PRIVATE_KEY=<a key of its own, never a payout operator key; fund it with ~0.5 METIS>");
  say(`  METIS_MAINNET_RPC_URL=${RPC}`);
  say("  X402_METIS_ENABLED=1");
  say("Optional:");
  say("  X402_METIS_PAY_TO_ALLOWLIST=<other sellers, comma-separated, or * for anyone> (unset: only Sage's own sales settle)");
  say("  X402_METIS_ACCEPT_USDT=1");
}

async function main() {
  const client = createPublicClient({ transport: http(RPC, { timeout: 30_000 }) });
  say(`Metis Andromeda via ${RPC}`);

  const chainId = await client.getChainId();
  if (chainId !== CHAIN_ID) refuse(`${RPC} is chain ${chainId}, not Metis Andromeda (${CHAIN_ID})`);
  say(`  chain id ${chainId}: ok`);

  const permit2Code = await client.getCode({ address: PERMIT2 });
  if (!permit2Code || permit2Code === "0x") refuse(`no Permit2 at ${PERMIT2}`);
  const separator = await client.readContract({ address: PERMIT2, abi: permit2Abi, functionName: "DOMAIN_SEPARATOR" });
  if (separator !== PERMIT2_DOMAIN_SEPARATOR_1088) refuse(`Permit2's DOMAIN_SEPARATOR ${separator} is not the one for 1088`);
  say(`  Permit2 ${PERMIT2}: present, domain separator matches chain 1088`);
  const deployerCode = await client.getCode({ address: CREATE2_DEPLOYER });
  if (!deployerCode || deployerCode === "0x") refuse(`no CREATE2 deployer at ${CREATE2_DEPLOYER}`);
  say(`  CREATE2 deployer ${CREATE2_DEPLOYER}: present`);

  let mcopy = false;
  try {
    mcopy = (await client.call({ data: MCOPY_PROBE })).data === MCOPY_EXPECTED;
  } catch {
    mcopy = false;
  }
  const buildName = mcopy && !FORCE_PARIS ? "canonical" : "paris";
  const build = BUILDS[buildName];
  say(`  MCOPY (EIP-5656): ${mcopy ? "supported" : "NOT supported"} -> deploying the ${buildName} build${FORCE_PARIS ? " (--paris)" : ""}`);

  const initHex = readFileSync(join(HERE, build.file), "utf8").trim();
  const initcode = initHex.startsWith("0x") ? initHex : `0x${initHex}`;
  if (keccak256(initcode) !== build.initCodeHash) refuse(`${build.file} does not hash to ${build.initCodeHash}`);
  const address = getCreate2Address({ from: CREATE2_DEPLOYER, salt: PROXY_SALT, bytecodeHash: build.initCodeHash });
  if (address !== getAddress(build.address)) refuse(`the CREATE2 address computes to ${address}, not ${build.address}`);
  say(`  initcode ${build.file}: ${(initcode.length - 2) / 2} bytes, hash ok, CREATE2 address ${address}`);

  const existing = await client.getCode({ address });
  if (existing && existing !== "0x") {
    const problem = await proxyWorks(client, address, build);
    if (problem) refuse(`code already at ${address}, but ${problem}`);
    say(`  already deployed at ${address} and working: nothing to send`);
    say(`  ${EXPLORER}/address/${address}`);
    printEnv(address);
    return;
  }

  const account = deployerKey();
  if (!account && SEND) refuse("set X402_METIS_DEPLOYER_PRIVATE_KEY (or X402_METIS_FACILITATOR_PRIVATE_KEY) to send");
  const from = account ? account.address : PROBE_FROM;
  const data = concat([PROXY_SALT, initcode]);

  const simulated = (await client.call({ account: from, to: CREATE2_DEPLOYER, data })).data;
  if (!simulated || getAddress(`0x${simulated.slice(-40)}`) !== address) {
    refuse(`simulating the deploy returned ${simulated ?? "nothing"}, not ${address}`);
  }
  say(`  simulated deploy (eth_call, nothing sent) returns ${address}`);

  const estimate = await client.estimateGas({ account: from, to: CREATE2_DEPLOYER, data });
  const gas = (estimate * 12n) / 10n;
  const gasPrice = ((await client.getGasPrice()) * 12n) / 10n; // legacy, +20% as Sage's Metis writes do
  const cost = gas * gasPrice;
  const required = cost * 2n > MIN_BALANCE_WEI ? cost * 2n : MIN_BALANCE_WEI;
  say(`  gas: estimate ${estimate}, limit ${gas}, legacy gasPrice ${gasPrice} wei, at most ${formatEther(cost)} METIS`);

  if (!account) {
    say(`  deployer: no key set, so the balance check is skipped (it needs ${formatEther(required)} METIS)`);
  } else {
    const balance = await client.getBalance({ address: account.address });
    say(`  deployer ${account.address} holds ${formatEther(balance)} METIS (needs ${formatEther(required)})`);
    if (balance < required) refuse(`fund ${account.address} with at least ${formatEther(required)} METIS on Metis first`);
  }

  if (!SEND) {
    say("");
    say(`Nothing sent. Add --send to deploy the ${buildName} build to ${address}.`);
    return;
  }

  const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
  const serialized = await account.signTransaction({
    type: "legacy",
    chainId: CHAIN_ID,
    to: CREATE2_DEPLOYER,
    data,
    gas,
    gasPrice,
    nonce,
    value: 0n,
  });
  const hash = await client.sendRawTransaction({ serializedTransaction: serialized });
  say(`  sent ${hash}`);
  say(`  ${EXPLORER}/tx/${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") refuse(`the deploy transaction reverted (${EXPLORER}/tx/${hash})`);
  const problem = await proxyWorks(client, address, build);
  if (problem) refuse(`deployed, but ${problem}`);
  say(`Deployed and working: x402ExactPermit2Proxy (${buildName} build) at ${address}`);
  say(`  ${EXPLORER}/address/${address}`);
  printEnv(address);
}

main().catch((e) => {
  console.log(`FAILED: ${e?.shortMessage ?? e?.name ?? "unknown error"}`);
  process.exit(1);
});
