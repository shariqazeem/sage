import type { Metadata } from "next";
import Link from "next/link";
import { Ban, Flame, Gift, KeyRound, Receipt } from "lucide-react";
import { chainConfig, isPausedNetwork, PRIMARY_NETWORKS, SECONDARY_NETWORKS } from "@/lib/deputy/networks";
import { PERIOD_DAYS, PLANS } from "@/lib/plans/catalog";
import { planPriceUsd } from "@/lib/plans/billing-math";
import { DocHead, DocSection } from "../parts";

export const metadata: Metadata = {
  title: "Payments and networks",
  description:
    "How Sage pays: each payout settles in USDC from the job's vault on Metis, with a public receipt. No fee on payouts. Plans are paid in USDC on Metis and renew like a card subscription.",
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

/** The networks table reads the same two lists every other screen does: Metis, and GOAT (paused). */
const NETWORK_ROWS = [
  ...PRIMARY_NETWORKS.map((id) => ({ id, tier: "Everything runs here" })),
  ...SECONDARY_NETWORKS.map((id) => ({ id, tier: isPausedNetwork(id) ? "Paused: what's there keeps working" : "Where you already hold something" })),
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
        lead="Sage pays in USDC. Your budget goes to the people you pay: Sage takes no fee from payouts, and pays the network fee on every one. Your own account pays its own small fees, in METIS."
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
          Sage runs on one network, <strong>Metis Andromeda</strong>. Every job launches there, every account opens
          there, every payout settles there in USDC, and plans are paid there. Test networks are never shown.
        </p>
        <div className="doc-table wide">
          <table>
            <thead>
              <tr>
                <th scope="col">Network</th>
                <th scope="col">Status</th>
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
          <strong>GOAT Network is paused.</strong> Sage paid its first people there, from July 2026. Its USDC was bridged
          by Stargate, which ended support for GOAT on 23 October 2026, so no new job, account or plan payment starts
          there. Everything already on GOAT keeps working: receipts, records, withdrawals and stopping a job. It resumes
          when GOAT has a USDC with a supported way in and out.
        </p>
        <p>
          Payouts Sage made earlier on Arc and Starknet keep their receipts and records, and a Starknet claim link still
          pays. Nothing new starts on either.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="account">
        <p>
          Your account is a wallet Sage keeps for you on Metis, held by Privy. It opens when you create your workspace,
          and it is the same account whether you signed in with your email or with MetaMask. The balance and activity
          you see are read from the chain. You can do three things with the money in it:
        </p>
        <ul>
          <li>
            <strong>Add money.</strong> Withdraw METIS from Binance, OKX or another exchange and choose the Metis network,
            send USDC or METIS from any Metis wallet, or bridge USDC from Ethereum with the{" "}
            <a href="https://bridge.metis.io">official Metis bridge</a>. There&apos;s a QR code to scan.
          </li>
          <li>
            <strong>Swap</strong> METIS and USDC inside the account, through the Netswap pool, the deepest on Metis. The
            quote is the pool&apos;s own; you see the least you&apos;ll receive before you confirm, and if the price moves
            below it nothing is swapped. The swap can only pay back into your account.
          </li>
          <li>
            <strong>Send</strong> USDC or METIS to any address, at any time.
          </li>
        </ul>
        <p>
          Sage launches your jobs from it, inside spending rules the wallet provider enforces: no single job can be
          funded above your per-job cap, $50 unless you change it, anywhere from $1 to $10,000. That holds for jobs you
          post and for <Link href="/docs/how-it-works#autopilot">Autopilot</Link> alike.
        </p>
        <p>
          Every move outside those rules (a send, a swap) gets a one-time permit for that move alone, and the account
          locks back to its rules straight after. Stopping a job returns what&apos;s left to wherever the job was funded
          from.
        </p>
        <p>
          Every job launches from the account, in one step, for every sign-in. Money in MetaMask or on an exchange goes
          to the account&apos;s address first; the Account page shows it with a QR code.
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
          Sage. A payout made earlier on Starknet has its own receipt, which names the vault that paid.
        </p>
        <p>
          When a vault refuses a payout on chain, its receipt says so: payout blocked, no funds
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
              <strong>Your account pays its own fees.</strong> Launching a job, a send, a swap or a plan payment is a
              small transaction from your account, paid in the network&apos;s own token: METIS on Metis (about 0.05 METIS
              launches a job, and most other moves cost well under 0.005). Keep a little METIS in the
              account; the Account page shows how much it holds and what it covers.
            </span>
          </li>
          <li>
            <Gift size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Getting METIS is easy.</strong> Most exchanges that list METIS withdraw it straight onto the Metis
              network, and you can swap a little of your USDC to METIS inside the account once it can pay for the swap.
            </span>
          </li>
          <li>
            <Receipt size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Collecting a private payout is free.</strong> For one made earlier on Starknet, Sage sends the
              collection and pays its fee.
            </span>
          </li>
        </ul>
      </DocSection>

      <DocSection toc={TOC} id="plans">
        <p>{PLANS_LINE}</p>
        <ul>
          <li>
            Pay in USDC on Metis: in one click from your Sage balance, or from MetaMask or any wallet that&apos;s
            yours.
          </li>
          <li>Sage reads the payment on chain and starts your plan at once. No card is needed.</li>
          <li>
            A plan runs {PERIOD_DAYS} days. Paid from your Sage balance, it renews itself at the end of each period,
            like a card subscription, with a reminder three days before. Turn renewal off in Settings any time; the
            plan then runs to the end of its period. Paid from a wallet, Sage reminds you instead.
          </li>
          <li>Paying again before a plan ends adds the new days on top, so paying early never loses a day.</li>
          <li>
            A payment from your balance pays its own network fee, a fraction of a cent of METIS. Every payment gets a
            receipt in Settings.
          </li>
          <li>
            A promo code goes in at checkout. It gives free days of a plan, or money off the first payment; each
            workspace can use a code once.
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
