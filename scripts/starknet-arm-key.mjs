/**
 * Put the Starknet signing key into .env, without it ever being visible.
 *
 * Sage pays autonomously, so the server must hold a signing key — the same arrangement
 * GOAT_AGENT_PRIVATE_KEY already has. This decrypts the keystore in-process and appends the key
 * to .env, so it is never typed into a terminal, pasted into a chat, or left in shell history.
 *
 *   node scripts/starknet-arm-key.mjs --keystore ~/.starkli-wallets/lumen/keystore.json
 *
 * The value is written to .env and nowhere else. Nothing is printed but a confirmation.
 */
import { appendFileSync, readFileSync } from "node:fs";

import { decryptKeystore, promptHidden } from "./lib/keystore.mjs";

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : null;
};

const keystorePath = arg("keystore");
if (!keystorePath) {
  console.error("usage: node scripts/starknet-arm-key.mjs --keystore <path>");
  process.exit(1);
}

const envPath = arg("env") ?? ".env";
const existing = readFileSync(envPath, "utf8");
if (/^STARKNET_PRIVATE_KEY=/m.test(existing)) {
  console.error(
    "STARKNET_PRIVATE_KEY is already set in .env. Remove that line first if you mean to replace it.",
  );
  process.exit(1);
}

const keystore = JSON.parse(readFileSync(keystorePath, "utf8"));
const passphrase = await promptHidden("Keystore passphrase: ");
const key = decryptKeystore(keystore, passphrase);

appendFileSync(envPath, `${existing.endsWith("\n") ? "" : "\n"}STARKNET_PRIVATE_KEY=${key}\n`);
console.log(`\nSTARKNET_PRIVATE_KEY written to ${envPath}. It was not printed and is not in your shell history.`);
console.log("Restart the dev server (or pm2 --update-env on prod) to pick it up.");
