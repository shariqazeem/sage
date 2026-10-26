// THE ADVANCE POT'S OWN KEY, on the server only (26 Oct 2026: advances run on Metis).
//   node scripts/vm/pot-key.mjs address   prints the pot's address, or nothing
//   node scripts/vm/pot-key.mjs create    makes the key once, in .env (mode 600), prints the address
// The key itself is never printed and never leaves this machine. It must be a key of its own: the app
// refuses one that also signs payouts or x402 settlements (one key is one nonce sequence). Fund the
// address with m.USDC to lend and a little METIS for its own fees, then restart Sage.
import { appendFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
const NAME = "ADVANCE_POT_PRIVATE_KEY";

function read() {
  if (!existsSync(ENV)) return "";
  const line = readFileSync(ENV, "utf8").split("\n").find((l) => l.startsWith(`${NAME}=`)) || "";
  return line.slice(NAME.length + 1).trim().replace(/^["']|["']$/g, "");
}
const address = (k) => privateKeyToAccount(k.startsWith("0x") ? k : `0x${k}`).address;

const cmd = process.argv[2];
const existing = read();
if (cmd === "address") {
  if (existing) console.log(address(existing));
} else if (cmd === "create") {
  if (!existing) {
    appendFileSync(ENV, `\n${NAME}=${generatePrivateKey()}\n`);
    chmodSync(ENV, 0o600);
  }
  console.log(address(read()));
} else {
  console.error("usage: node scripts/vm/pot-key.mjs address|create");
  process.exit(1);
}
