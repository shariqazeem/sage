import type { Metadata } from "next";
import Link from "next/link";
import { Ban, Flame, Gift, KeyRound, Receipt } from "lucide-react";
import { chainConfig, PRIMARY_NETWORKS, SECONDARY_NETWORKS, STARKNET_MAINNET_KEY } from "@/lib/deputy/networks";
import { PERIOD_DAYS, PLANS } from "@/lib/plans/catalog";
import { planPriceUsd } from "@/lib/plans/billing-math";
import { DocHead, DocSection } from "../parts";

export const metadata: Metadata = {
  title: "Payments and networks",
  description:
    "How Sage pays: each payout settles in USDC from the job's vault, on Metis and GOAT Network, and also on Arc and Starknet, with a public receipt. No fee on payouts. Plans are paid in USDC.",
  alternates: { canonical: "/docs/payments" },
};

const TOC = {
  settlement: "How a payout settles",
  networks: "Networks",
  account: "Your account",
  receipts: "Receipts",
  fees: "Fees and gas",
  plans: "How plans are billed",
} as const;

/** The networks table reads the same two lists every other screen does. */
const NETWORK_ROWS = [
  ...PRIMARY_NETWORKS.map((id) => ({ id, tier: "Primary" })),
  ...SECONDARY_NETWORKS.map((id) => ({ id, tier: id === STARKNET_MAINNET_KEY ? "More networks, private payouts" : "More networks" })),
].map(({ id, tier }) => {
  const c = chainConfig(id);
  return {
    key: id,
    name: c.name,
    tier,
    chain: c.evm ? String(c.chainId) : "Starknet mainnet",
    usdc: c.usdcAddress,
    gas: c.nativeSymbol,
  };
});

/** Prices and Free's limits, from the catalog the server enforces (the same source as /pricing). */
const free = PLANS.free;
const PLANS_LINE = [
  `Free runs ${free.liveJobs === 1 ? "one live job" : `${free.liveJobs} live jobs`} at a time, up to $${free.monthlyUsd.toLocaleString("en-US")} of work a month, with real money.`,
  `Pro is $${planPriceUsd("pro")} a month and Team $${planPriceUsd("team")}.`,
  `${PLANS.programs.name} is set up with you. People who get paid never pay.`,
].join(" ");

export default function Payments() {
  return (
    <article>
      <DocHead
        eyebrow="Payments"
        title="Payments and networks"
        lead="Sage pays in USDC. Your budget goes to the people you pay: Sage takes no fee from payouts, and pays the network fee on every one."
        toc={TOC}
      />

      <DocSection toc={TOC} id="settlement">
        <p>
          Once work is approved, Sage asks the job&apos;s vault to pay. The vault works out the reward, checks its
          limits, and either pays the person in USDC or records a refusal. That record on chain is the source of truth:
          Sage reads the outcome from the vault&apos;s own events, never from whether a transaction went through.
        </p>
        <p>Sending money safely takes care. Sage:</p>
        <ul>
          <li>adds a margin to every gas estimate, and uses a safe fixed amount if the estimate fails</li>
          <li>retries a payment the network turned away, as a fresh transaction</li>
          <li>counts a payout as made only when the vault&apos;s own event for that exact payout appears</li>
          <li>never pays a submission twice: one that already carries a payout transaction is done</li>
          <li>holds automatic payouts while its view of the chain looks out of date</li>
        </ul>
        <p>
          If something fails halfway, the submission goes back to waiting and the next pass picks it up. A request that
          dies never loses anyone&apos;s payout. See <Link href="/docs/trust#vault">the vault&apos;s limits</Link> for
          what the vault checks before it pays.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="networks">
        <p>
          Sage pays in USDC on two primary networks, Metis and GOAT Network. It also settles on Arc, under More
          networks, and on Starknet, for private payouts. Test networks are never shown.
        </p>
        <div className="doc-table wide">
          <table>
            <thead>
              <tr>
                <th scope="col">Network</th>
                <th scope="col">Where you see it</th>
                <th scope="col">Chain</th>
                <th scope="col">USDC</th>
                <th scope="col">Gas</th>
              </tr>
            </thead>
            <tbody>
              {NETWORK_ROWS.map((n) => (
                <tr key={n.key}>
                  <td>{n.name}</td>
                  <td>{n.tier}</td>
                  <td>{n.chain}</td>
                  <td>{n.usdc ? <code>{n.usdc}</code> : "native USDC"}</td>
                  <td>{n.gas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          On Arc, USDC is also the gas, so funding an account with USDC is all the setup there is. Jobs keep the
          network they were created on, and their receipts keep working.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="account">
        <p>
          Your account is a wallet Sage keeps for you, held by Privy, one per network. It opens on Sage&apos;s default
          network when you create your workspace, and you can add others from the Account page. Fund it by sending USDC
          to its address, from any wallet or exchange; there&apos;s a QR code to scan. The balance and activity you see
          are read from the chain.
        </p>
        <p>
          Sage launches your jobs from it, inside spending rules the wallet provider enforces: no single job can be
          funded above your per-job cap, $50 unless you change it, anywhere from $1 to $10,000. That holds for jobs you
          post and for <Link href="/docs/how-it-works#autopilot">Autopilot</Link> alike.
        </p>
        <p>
          Withdraw any amount to any address, at any time. Each withdrawal gets a one-time permit for that address and
          that amount, and the account locks back to its rules straight after. Stopping a job returns what&apos;s left
          to wherever the job was funded from.
        </p>
        <p>
          Signed in with a Starknet wallet? You fund each job from your own wallet, and payouts settle through the
          Starknet vault. A Starknet sign-in can&apos;t hold a Sage account, because the account needs an Ethereum
          address to send leftovers back to. You can also fund any job straight from a wallet you sign in with.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="receipts">
        <p>
          Every payout gets a public receipt at <code>/proof/&lt;transaction&gt;</code>. It shows:
        </p>
        <ul>
          <li>the transaction, with a link to the network&apos;s explorer</li>
          <li>who was paid, how much, and on which network</li>
          <li>the job, the mission, and the vault with its limits</li>
          <li>the judge&apos;s decision: its recommendation, confidence and reasons, the quotes it relied on, and any fraud signals</li>
        </ul>
        <p>
          The evidence itself isn&apos;t published, only a fingerprint of it (a hash), so a receipt proves what was
          judged without exposing someone&apos;s work. Anyone can check the transaction on the explorer without asking
          Sage. Starknet payouts get their own receipt, which names the vault that paid.
        </p>
        <p>
          On GOAT, Metis and Arc, when a vault refuses a payout on chain, its receipt says so: payout blocked, no funds
          moved. Most refusals happen before anything reaches the chain. Those are counted in public, and their reasons
          go to the person who submitted and to the job&apos;s owner.
        </p>
        <p>
          Every payout also lands on the person&apos;s record of verified work, at <code>/record/&lt;wallet&gt;</code>,
          with each line linked to its receipt. The <Link href="/ledger">ledger</Link> lists them all.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="fees">
        <ul className="doc-points">
          <li>
            <Ban size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>No fee on payouts.</strong> The vault pays the exact reward. Sage takes nothing from your budget,
              or from what people are paid.
            </span>
          </li>
          <li>
            <KeyRound size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Sage pays the payout gas.</strong> Its operator signs every payout and pays the network fee, on
              every network.
            </span>
          </li>
          <li>
            <Flame size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Launching uses a little gas.</strong> Creating and funding a job takes a few small transactions
              from your account, paid in the network&apos;s own token: BTC on GOAT, METIS on Metis, USDC on Arc.
            </span>
          </li>
          <li>
            <Gift size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Your first launch is covered.</strong> If your account holds the USDC for a job, or for a plan,
              but no gas yet, Sage sends it enough gas to go ahead, once per account.
            </span>
          </li>
          <li>
            <Receipt size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Collecting a private payout is free.</strong> On Starknet, Sage sends the collection and pays its
              fee.
            </span>
          </li>
        </ul>
      </DocSection>

      <DocSection toc={TOC} id="plans">
        <p>{PLANS_LINE}</p>
        <ul>
          <li>
            Pay in USDC on Metis or GOAT Network: in one click from your Sage account, or from any wallet that&apos;s
            yours.
          </li>
          <li>Sage reads the payment on chain and starts your plan at once. No card is needed.</li>
          <li>
            A plan runs {PERIOD_DAYS} days. Paying again before it ends adds the new days on top, so paying early never
            loses a day.
          </li>
          <li>Upgrading starts the new plan now and credits the days left on the old one.</li>
          <li>A smaller plan starts when your current one ends.</li>
          <li>
            Limits count real money only: how many jobs are live, and the budget of the jobs you launched in the last{" "}
            {PERIOD_DAYS} days, on any network.
          </li>
          <li>
            Limits decide what you can launch next, never what gets paid. A live job keeps paying its people, whatever
            happens to your plan.
          </li>
          <li>A plan belongs to a workspace. Its owner or an admin can change it.</li>
        </ul>
        <p>
          <Link href="/pricing">Pricing</Link> compares the plans.
        </p>
      </DocSection>
    </article>
  );
}
