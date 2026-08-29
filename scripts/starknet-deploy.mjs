/**
 * Declare and deploy SageClaims with starknet.js.
 *
 * WHY NOT starkli, AND WHY NOT sncast:
 *
 *   starkli 0.4.2 is the latest release (July 2025) and is too old for mainnet in two independent
 *   ways. It computes the compiled-class hash with a superseded algorithm — reading OUR CASM file
 *   directly it still reported 0x03acfcf3…, where the correct hash is 0x59cebdb3… — and it asks
 *   for the `pending` block tag, which mainnet retired in favour of `pre_confirmed`.
 *
 *   sncast 0.56 documents `--keystore` as taking a starkli account file and does not honour it:
 *   pointing it at a path that does not exist produces the identical error as the real one,
 *   because it silently falls through to ~/.starknet_accounts.
 *
 * So the signing is done here. The keystore is Web3 Secret Storage v3, decrypted in this process
 * and nowhere else.
 *
 * THE PASSPHRASE IS TYPED, NEVER PASSED. It is read from the terminal with echo off, held only for
 * the scrypt derivation, and never written to a file, an argument, an environment variable or a
 * log. Shell history never sees it.
 *
 *   node scripts/starknet-deploy.mjs \
 *     --keystore ~/.starkli-wallets/lumen/keystore.json \
 *     --account  ~/.starkli-wallets/lumen/account.json
 */
import { createDecipheriv, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

import { keccak_256 } from "@noble/hashes/sha3";
import { Account, RpcProvider, hash } from "starknet";

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

/**
 * The contracts this script can put on chain.
 *
 * SageVault is DECLARE-ONLY. A vault belongs to one campaign and is deployed by the founder's own
 * wallet, so that they — not Sage — are its owner; declaring the class once is the whole of Sage's
 * part. Deploying one from this script would produce a vault owned by the operator, which is the
 * exact arrangement the vault exists to avoid.
 */
const CONTRACTS = {
  claims: { name: "SageClaims", declareOnly: false },
  vault: { name: "SageVault", declareOnly: true },
};

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
};

/** Read a line from the terminal without echoing it. */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Suppress the echo of typed characters, but keep the prompt itself visible.
    let shown = false;
    rl._writeToOutput = (s) => {
      if (!shown) {
        process.stdout.write(question);
        shown = true;
      } else if (s.includes("\n")) process.stdout.write("\n");
    };
    rl.question(question, (answer) => {
      rl.close();
      if (answer) resolve(answer);
      else reject(new Error("no passphrase entered"));
    });
  });
}

/**
 * Decrypt a Web3 Secret Storage v3 keystore.
 *
 * The MAC is checked before the plaintext is used, and with a constant-time comparison: a wrong
 * passphrase must fail as a wrong passphrase, not as a garbage key that goes on to sign something.
 */
function decryptKeystore(keystore, passphrase) {
  const { cipher, ciphertext, cipherparams, kdf, kdfparams, mac } = keystore.crypto;
  if (cipher !== "aes-128-ctr") throw new Error(`unsupported cipher: ${cipher}`);
  if (kdf !== "scrypt") throw new Error(`unsupported kdf: ${kdf}`);

  const { n: N, r, p, dklen, salt } = kdfparams;
  const derived = scryptSync(Buffer.from(passphrase), Buffer.from(salt, "hex"), dklen, {
    N, r, p,
    // Node's default maxmem is too small for N=8192·r=8; scrypt needs ~128·N·r bytes.
    maxmem: 256 * N * r,
  });

  const ct = Buffer.from(ciphertext, "hex");
  const expected = Buffer.from(mac, "hex");
  const actual = Buffer.from(keccak_256(Buffer.concat([derived.subarray(16, 32), ct])));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("wrong passphrase");
  }

  const d = createDecipheriv(
    "aes-128-ctr",
    derived.subarray(0, 16),
    Buffer.from(cipherparams.iv, "hex"),
  );
  return `0x${Buffer.concat([d.update(ct), d.final()]).toString("hex")}`;
}

async function main() {
  const keystorePath = arg("keystore");
  const accountPath = arg("account");
  const rpcUrl = arg("rpc") ?? "https://rpc.starknet.lava.build:443";
  const which = arg("contract") ?? "claims";
  const target = CONTRACTS[which];
  if (!keystorePath || !accountPath || !target) {
    console.error(
      "usage: node scripts/starknet-deploy.mjs --keystore <path> --account <path> [--contract claims|vault]",
    );
    process.exit(1);
  }
  const SIERRA_PATH = `contracts-starknet/target/dev/sage_claims_${target.name}.contract_class.json`;
  const CASM_PATH = `contracts-starknet/target/dev/sage_claims_${target.name}.compiled_contract_class.json`;

  const keystore = JSON.parse(readFileSync(keystorePath, "utf8"));
  const accountFile = JSON.parse(readFileSync(accountPath, "utf8"));
  const address = accountFile.deployment?.address;
  if (!address) throw new Error("account file has no deployment.address");

  const sierra = JSON.parse(readFileSync(SIERRA_PATH, "utf8"));
  const casm = JSON.parse(readFileSync(CASM_PATH, "utf8"));

  const classHash = hash.computeContractClassHash(sierra);
  const casmHash = hash.computeCompiledClassHash(casm);
  console.log(`contract   ${target.name}${target.declareOnly ? " (declare only)" : ""}`);
  console.log(`account    ${address}`);
  console.log(`class hash ${classHash}`);
  console.log(`casm hash  ${casmHash}`);

  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  console.log(`rpc        ${rpcUrl} (spec ${await provider.getSpecVersion()})\n`);

  const passphrase = await promptHidden("Keystore passphrase: ");
  const privateKey = decryptKeystore(keystore, passphrase);
  const account = new Account({ provider, address, signer: privateKey });

  // Declare only if the class is not already on chain, so re-running after a
  // partial failure costs nothing.
  let declared = false;
  try {
    await provider.getClassByHash(classHash);
    console.log("class is already declared — skipping\n");
    declared = true;
  } catch {
    /* not declared yet */
  }

  if (!declared) {
    console.log("declaring…");
    const res = await account.declareIfNot({ contract: sierra, casm });
    if (res.transaction_hash) {
      console.log(`  tx ${res.transaction_hash}`);
      await provider.waitForTransaction(res.transaction_hash);
    }
    // Confirm against the CHAIN, not against the response.
    await provider.getClassByHash(classHash);
    console.log("  declared\n");
  }

  if (target.declareOnly) {
    console.log(`\n${target.name} class hash: ${classHash}`);
    console.log("\nDeclare only — a vault is deployed per campaign by the FOUNDER's wallet, so that");
    console.log("they own it. Put this class hash in .env as STARKNET_VAULT_CLASS_HASH.");
    return;
  }

  console.log("deploying…");
  const dep = await account.deployContract({ classHash, constructorCalldata: [POOL] });
  console.log(`  tx ${dep.transaction_hash}`);
  await provider.waitForTransaction(dep.transaction_hash);
  const deployed = dep.contract_address;
  console.log(`  at ${deployed}\n`);

  // Never trust a succeeded transaction. Read a view function back and assert it.
  const got = await provider.callContract({
    contractAddress: deployed,
    entrypoint: "get_pool",
    calldata: [],
  });
  if (BigInt(got[0]) !== BigInt(POOL)) {
    console.error(`VERIFY FAILED: get_pool() returned ${got[0]}, expected ${POOL}`);
    process.exit(1);
  }
  console.log("verified: get_pool() returns the pinned pool\n");

  console.log(`SAGE_CLAIMS_ADDRESS=${deployed}`);
  console.log(`class hash          ${classHash}`);
  console.log(`\nvoyager: https://voyager.online/contract/${deployed}`);
}

main().catch((e) => {
  console.error(`\n${e?.message ?? e}`);
  process.exit(1);
});
