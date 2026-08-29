/**
 * Escrow payouts on Starknet and print the claim links.
 *
 * This is Sage's side of the rail, and it is deliberately headless: no wallet, no prompt, no
 * human. Sage decides what a piece of work is worth, escrows it behind a commitment, and hands
 * over a link. The person collecting needs nothing at all.
 *
 *   npm run starknet:payout -- --amounts 1.40,0.65,1.15
 *   npm run starknet:payout -- --amounts 0.50 --irrevocable
 *
 * (The npm script supplies `--conditions=react-server`, which is what lets `server-only` resolve
 * to its empty module outside Next rather than to the guard that throws.)
 *
 * AMOUNTS ARE AN INPUT, NEVER A COMPUTATION. They come from the operator or from the
 * deterministic budget compiler; nothing here derives, adjusts or rounds them beyond parsing
 * dollars into the 6-decimal base units the token actually moves.
 *
 * THE SECRETS FILE IS THE MONEY. Every claim secret is written to disk before the transaction is
 * sent, because a secret lost after funding is a payout nobody can ever collect — recoverable only
 * by waiting out the expiry. Written first, on purpose: a crash between send and write would
 * otherwise strand real funds.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { claimUrl, mintClaimSecrets } from "../src/lib/starknet/claim-link";
import { escrowPayouts, type PayoutLeg } from "../src/lib/starknet/claims";
import { starknetConfig } from "../src/lib/starknet/config";

const OUT = "var/starknet-claims.json";
const ORIGIN = process.env.SAGE_ORIGIN ?? "https://sagepays.xyz";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

/** Dollars to 6-decimal base units, integer-exact. Never floats at the boundary. */
function toBase(dollars: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(dollars.trim());
  if (!m) throw new Error(`not an amount: "${dollars}" (use e.g. 1.40)`);
  return BigInt(m[1]!) * BigInt(1_000_000) + BigInt((m[2] ?? "").padEnd(6, "0"));
}

async function main(): Promise<void> {
  const cfg = starknetConfig();
  if (!cfg) {
    console.error(
      "Starknet is not configured. Set STARKNET_RPC_URL, STARKNET_CLAIMS_ADDRESS,\n" +
        "STARKNET_ACCOUNT_ADDRESS and STARKNET_PRIVATE_KEY together — a partial group\n" +
        "is treated as absent, deliberately.",
    );
    process.exit(1);
  }

  const raw = arg("amounts");
  if (!raw) {
    console.error("usage: npx tsx scripts/starknet-payout.ts --amounts 1.40,0.65 [--irrevocable]");
    process.exit(1);
  }

  const irrevocable = flag("irrevocable");
  const expiryDays = Number(arg("expiry-days") ?? 30);
  const expiryUnix = irrevocable
    ? 0
    : Math.floor(Date.now() / 1000) + Math.round(expiryDays * 86_400);

  const amounts = raw.split(",").filter(Boolean).map(toBase);
  const minted = amounts.map(() => mintClaimSecrets());

  const legs: PayoutLeg[] = amounts.map((amountBase, i) => ({
    claimCommitment: minted[i]!.claimCommitment,
    refundCommitment: irrevocable ? null : minted[i]!.refundCommitment,
    amountBase,
  }));

  const record = {
    escrowedAt: new Date().toISOString(),
    contract: cfg.claimsAddress,
    token: cfg.tokenAddress,
    expiryUnix,
    claims: minted.map((m, i) => ({
      amountBase: amounts[i]!.toString(),
      amountUsd: Number(amounts[i]) / 1_000_000,
      claimSecret: m.claimSecret,
      refundSecret: irrevocable ? null : m.refundSecret,
      claimCommitment: m.claimCommitment,
      url: claimUrl(ORIGIN, m.claimSecret),
    })),
    transactionHash: null as string | null,
  };

  // Written BEFORE sending. A crash after funding but before writing would strand real money.
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(record, null, 2));
  console.log(`secrets written to ${OUT} — this file is the money, keep it\n`);

  const total = amounts.reduce((a, b) => a + b, BigInt(0));
  console.log(
    `escrowing ${legs.length} payout(s), $${(Number(total) / 1_000_000).toFixed(2)} total` +
      (irrevocable ? ", irrevocable" : `, refundable after ${expiryDays}d`),
  );

  const result = await escrowPayouts(legs, expiryUnix);
  record.transactionHash = result.transactionHash;
  writeFileSync(OUT, JSON.stringify(record, null, 2));

  console.log(`\nescrowed in ${result.transactionHash}`);
  console.log(`https://voyager.online/tx/${result.transactionHash}\n`);
  for (const c of record.claims) console.log(`  $${c.amountUsd.toFixed(2)}  ${c.url}`);
  console.log(
    "\nEach link collects once, to any address, with Sage paying the gas.\n" +
      "Send each to exactly one person.",
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
