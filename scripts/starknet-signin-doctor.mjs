/**
 * WHY WON'T THIS WALLET SIGN IN?
 *
 * Reads the public facts about one Starknet account and reports what would happen to a sign-in
 * from it. Sends nothing, signs nothing, and needs no key — every question here is answerable
 * from the chain, which is exactly why the answers are safe to print.
 *
 *   node scripts/starknet-signin-doctor.mjs 0x05db1a00…
 */
import { RpcProvider, hash, num } from "starknet";

const RPC = process.env.STARKNET_RPC_URL ?? "https://rpc.starknet.lava.build:443";
const raw = process.argv[2];
if (!raw) {
  console.error("usage: node scripts/starknet-signin-doctor.mjs <address>");
  process.exit(1);
}

const normalize = (v) => {
  const t = v.trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(t)) return null;
  const s = t.slice(2).replace(/^0+/, "");
  return s && s.length <= 63 ? `0x${s}` : null;
};

const address = normalize(raw);
if (!address) {
  console.error(`"${raw}" is not a Starknet address.`);
  process.exit(1);
}

const provider = new RpcProvider({ nodeUrl: RPC });
console.log(`account   ${address}`);
console.log(`network   ${RPC}\n`);

let classHash = null;
try {
  classHash = await provider.getClassHashAt(address, "latest");
  console.log(`  ✓ deployed on mainnet — class ${classHash.slice(0, 18)}…`);
} catch {
  console.log("  ✗ NOT deployed on this network — no code at this address.");
  console.log("    A Starknet account is a CONTRACT, deployed by the wallet's own first OUTGOING");
  console.log("    transaction. Receiving funds does not deploy it, so a wallet can hold a real");
  console.log("    balance and still be uninitialised. Send one transaction from it (wallets call");
  console.log("    this deploying or activating the account), then sign in.");
  try {
    const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
    const r = await provider.callContract({ contractAddress: STRK, entrypoint: "balance_of", calldata: [address] });
    const strk = Number(BigInt(r[0])) / 1e18;
    console.log(`\n    It holds ${strk.toFixed(4)} STRK — ${strk > 0.01 ? "enough to pay for its own deployment." : "it needs a little STRK for gas first."}`);
  } catch {
    /* balance is a nicety, not the diagnosis */
  }
  process.exit(0);
}

// Does the account expose the entrypoint a sign-in verifies against?
try {
  const cls = await provider.getClassAt(address, "latest");
  const names = (cls.abi ?? [])
    .flatMap((e) => (e.type === "interface" ? e.items ?? [] : [e]))
    .filter((f) => f?.type === "function")
    .map((f) => f.name);
  const valid = names.filter((n) => /is_?valid_?signature/i.test(n));
  console.log(
    valid.length
      ? `  ✓ exposes ${valid.join(", ")} — a signature can be checked against it`
      : "  ✗ exposes NO is_valid_signature entrypoint — this account cannot prove ownership by signature",
  );
} catch (e) {
  console.log(`  ? could not read the class ABI: ${String(e.message).slice(0, 90)}`);
}

// A live call with a deliberately wrong signature: a healthy account REFUSES it (that is a pass).
try {
  const res = await provider.callContract({
    contractAddress: address,
    entrypoint: "is_valid_signature",
    calldata: [num.toHex(hash.starknetKeccak("sage-doctor-probe")), "2", "0x1", "0x2"],
  });
  console.log(`  · answered a deliberately WRONG signature with [${res.join(", ")}]`);
  console.log("    (an answer at all means the entrypoint is callable; refusing it is correct)");
} catch (e) {
  const m = String(e.message);
  console.log(`  · rejected a deliberately wrong signature: ${m.slice(0, 110)}`);
  console.log("    (a revert here is normal — it means the account checks signatures strictly)");
}
