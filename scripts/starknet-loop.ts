/**
 * PROVE THE CLOSED LOOP ON STARKNET — agent judges, agent pays, money lands in a wallet.
 *
 * This is the GOAT loop with a different last mile and nothing else changed: the same Mission
 * Brain designed the work, the same Payout Brain judges it, the same rule that no model ever
 * computes an amount still holds. Only the settlement differs, and the person being paid does
 * NOTHING — no claiming, no collecting, no link. It arrives.
 *
 *   npm run starknet:loop -- --to 0x05db1a… --amount 0.10
 *
 * IT SPENDS REAL MONEY, so it asks first and says exactly how much.
 *
 * `--to` is the worker's Starknet address. In the product that address comes from their signed-in
 * session and never from an argument — a payout may only reach a wallet that proved control of
 * itself. Here it is supplied because there is no browser in the loop; that is the one thing this
 * script does which the product does not.
 */
import { createInterface } from "node:readline";

import { config } from "dotenv";

config({ path: ".env" });

const arg = (n: string): string | null => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

/** Dollars → 6-decimal base units, integer-exact. Never a float at the boundary. */
function toBase(dollars: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(dollars.trim());
  if (!m) throw new Error(`not an amount: "${dollars}"`);
  return BigInt(m[1]!) * BigInt(1_000_000) + BigInt((m[2] ?? "").padEnd(6, "0"));
}

function ask(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => (rl.close(), res(a))));
}

async function main(): Promise<void> {
  const to = arg("to");
  const amount = arg("amount") ?? "0.10";
  if (!to || !/^0x[0-9a-fA-F]{1,64}$/.test(to)) {
    console.error("usage: npm run starknet:loop -- --to <starknet address> [--amount 0.10]");
    process.exit(1);
  }

  const { starknetConfig } = await import("../src/lib/starknet/config");
  const { payableBalance } = await import("../src/lib/starknet/pay");
  const { createCampaign, createSubmission, getSubmission } = await import("../src/lib/db/campaigns");
  const { settleOnStarknet } = await import("../src/lib/campaigns/settle-starknet");

  const cfg = starknetConfig();
  if (!cfg) {
    console.error(
      "Starknet settlement is not configured. Run:\n" +
        "  node scripts/starknet-arm-key.mjs --keystore ~/.starkli-wallets/lumen/keystore.json",
    );
    process.exit(1);
  }

  const rewardBase = toBase(amount);
  const balance = await payableBalance();
  console.log(`payer    ${cfg.accountAddress}`);
  console.log(`balance  $${(Number(balance) / 1e6).toFixed(2)}`);
  console.log(`paying   $${(Number(rewardBase) / 1e6).toFixed(2)} to ${to}\n`);
  if (balance < rewardBase) {
    console.error("Not enough USDC to make that payment.");
    process.exit(1);
  }

  const ok = await ask("This spends real money on Starknet mainnet. Continue? [y/N] ");
  if (ok.trim().toLowerCase() !== "y") {
    console.log("stopped.");
    return;
  }

  // A Sage-owned campaign on the Starknet rail. Sage's own money, so there is no founder vault to
  // stand behind it — which is exactly the condition under which the rail rule allows Starknet.
  const campaign = createCampaign({
    title: `Starknet settlement proof — $${(Number(rewardBase) / 1e6).toFixed(2)}`,
    descriptionMd: "A single verified payout, settled directly to the worker's Starknet wallet.",
    criteria: ["Evidence of completed work, judged by Sage."],
    conditionType: "approval",
    onchainCheck: null,
    rewardAmount: Number(rewardBase),
    maxRecipients: 1,
    vaultAddress: cfg.accountAddress,
    posterWallet: cfg.accountAddress,
    ownerIsSage: true,
    status: "live",
    autonomy: "autopilot",
    settlementRail: "starknet",
  });
  console.log(`\ncampaign ${campaign.id}`);

  const sub = createSubmission({
    campaignId: campaign.id,
    wallet: to,
    note: "Work completed and submitted for verification.",
  });
  if (!sub.ok) {
    console.error(`could not create the submission: ${sub.error}`);
    process.exit(1);
  }
  console.log(`submission ${sub.submission.id}`);

  console.log("\nsettling…");
  const outcome = await settleOnStarknet(campaign, sub.submission);

  if (!outcome.settled) {
    console.error(`\nHELD: ${outcome.reason}`);
    console.error("The submission is untouched and can be retried — nothing was paid.");
    process.exit(1);
  }

  console.log(`\nPAID $${(Number(outcome.rewardBase ?? BigInt(0)) / 1e6).toFixed(2)} to ${outcome.recipient}`);
  console.log(outcome.explorerUrl);

  // Read it back rather than trusting the return value.
  const after = getSubmission(sub.submission.id);
  console.log(`\nsubmission status: ${after?.status} · payout tx recorded: ${after?.payoutTx ? "yes" : "NO"}`);
  console.log(`payer balance now: $${(Number(await payableBalance()) / 1e6).toFixed(2)}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
