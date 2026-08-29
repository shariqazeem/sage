/**
 * Decrypting a starkli keystore, shared by the deploy and payout scripts.
 *
 * THE PASSPHRASE IS TYPED, NEVER PASSED. It is read from the terminal with echo off, held only for
 * the scrypt derivation, and never reaches a file, an argument, an environment variable or shell
 * history. Nothing here logs it, and nothing returns it.
 */
import { createDecipheriv, scryptSync, timingSafeEqual } from "node:crypto";
import { createInterface } from "node:readline";

import { keccak_256 } from "@noble/hashes/sha3";

/** Read a line from the terminal without echoing it. */
export function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
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
 * The MAC is checked before the plaintext is used, with a constant-time comparison: a wrong
 * passphrase must fail AS a wrong passphrase, not as a garbage key that goes on to sign something.
 */
export function decryptKeystore(keystore, passphrase) {
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
