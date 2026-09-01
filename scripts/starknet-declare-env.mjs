/**
 * Declare a class with the operator key the VM already holds in its environment.
 *
 * `starknet-deploy.mjs` decrypts a keystore with a typed passphrase — the right shape for a key
 * that lives ONLY in a keystore. The production operator key also lives in the VM's `.env`
 * (`STARKNET_PRIVATE_KEY`, the same key the settler signs every payout with), so requiring a
 * passphrase there protects nothing the environment does not already hold. This script signs
 * with that key, prints estimate / bound / balance BEFORE anything is signed, declares, waits
 * for acceptance, and prints the class hash and transaction. It never prints the key.
 *
 *   node scripts/starknet-declare-env.mjs --contract vault
 */
import { readFileSync } from "node:fs";
import { Account, RpcProvider, hash } from "starknet";

const NAMES = { claims: "SageClaims", vault: "SageVault" };
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };

async function main() {
  const which = arg("contract") ?? "vault";
  const name = NAMES[which];
  if (!name) throw new Error("usage: --contract claims|vault");
  const rpcUrl = arg("rpc") ?? process.env.STARKNET_RPC_URL;
  const address = process.env.STARKNET_ACCOUNT_ADDRESS;
  const privateKey = process.env.STARKNET_PRIVATE_KEY;
  if (!rpcUrl || !address || !privateKey) throw new Error("STARKNET_RPC_URL / STARKNET_ACCOUNT_ADDRESS / STARKNET_PRIVATE_KEY required");

  const sierra = JSON.parse(readFileSync(`contracts-starknet/target/dev/sage_claims_${name}.contract_class.json`, "utf8"));
  const casm = JSON.parse(readFileSync(`contracts-starknet/target/dev/sage_claims_${name}.compiled_contract_class.json`, "utf8"));
  const classHash = hash.computeContractClassHash(sierra);
  const casmHash = hash.computeCompiledClassHash(casm);
  console.log(`contract   ${name} (declare only)`);
  console.log(`account    ${address}`);
  console.log(`class hash ${classHash}`);
  console.log(`casm hash  ${casmHash}`);

  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  console.log(`rpc        ${rpcUrl} (spec ${await provider.getSpecVersion()})\n`);
  const account = new Account({ provider, address, signer: privateKey });

  try {
    await provider.getClassByHash(classHash);
    console.log("class is already declared — nothing to do");
    return;
  } catch { /* not declared */ }

  const est = await account.estimateDeclareFee({ contract: sierra, casm });
  const strk = (v) => `${(Number(BigInt(v)) / 1e18).toFixed(3)} STRK`;
  const rb = est.resourceBounds;
  const ceiling =
    BigInt(rb.l2_gas.max_amount) * BigInt(rb.l2_gas.max_price_per_unit) +
    BigInt(rb.l1_data_gas.max_amount) * BigInt(rb.l1_data_gas.max_price_per_unit) +
    BigInt(rb.l1_gas.max_amount) * BigInt(rb.l1_gas.max_price_per_unit);
  const STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
  const bal = BigInt((await provider.callContract({ contractAddress: STRK_TOKEN, entrypoint: "balanceOf", calldata: [address] }))[0]);
  console.log(`estimated  ${strk(est.overall_fee)}`);
  console.log(`bound      ${strk(ceiling)}  (the account must cover this, not the estimate)`);
  console.log(`balance    ${strk(bal)}`);
  if (bal < ceiling) throw new Error("balance below the resource bound — top up STRK before declaring");

  const res = await account.declare({ contract: sierra, casm }, { resourceBounds: est.resourceBounds });
  console.log(`\ndeclare tx ${res.transaction_hash}`);
  console.log("waiting for acceptance…");
  const receipt = await provider.waitForTransaction(res.transaction_hash);
  console.log(`status     ${receipt.execution_status ?? receipt.finality_status}`);
  console.log(`class hash ${res.class_hash}`);
  const onchain = await provider.getClassByHash(res.class_hash).then(() => true).catch(() => false);
  console.log(`readback   ${onchain ? "class is on chain" : "CLASS NOT READABLE — do not trust the status alone"}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
