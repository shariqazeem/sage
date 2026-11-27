import type { Metadata } from "next";
import Link from "next/link";
import { Ban, Flame, Gift, KeyRound, Receipt } from "lucide-react";
import { chainConfig, isPausedNetwork, PRIMARY_NETWORKS, SECONDARY_NETWORKS } from "@/lib/deputy/networks";
import { DocHead, DocSection } from "../parts";
import { PAY_FROM_EMAIL_WALLET, TEST } from "../facts";

export const metadata: Metadata = {
  title: "Payments and networks",
  description:
    "How Sage pays: each payout settles in USDC from the test's own vault on Metis, with a public receipt. No fee on payouts. You pay for a test from your own wallet, and what isn't paid comes back.",
  alternates: { canonical: "/docs/payments" },
};

const TOC = {
  settlement: "How a payout settles",
  networks: "Networks",
  account: "Paying for a test",
  receipts: "Receipts",
  fees: "Fees and gas",
  plans: "What Sage costs",
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

export default function Payments() {
  return (
    <article>
      <DocHead
        eyebrow="Payments"
        title="Payments and networks"
        lead="Sage pays in USDC on Metis. What you pay for a test goes to the people who try your product: Sage takes no fee from payouts, and pays the network fee on every one. Your own wallet pays its own small fees, in METIS."
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
          Sage runs on one network, <strong>Metis Andromeda</strong>. Every test is paid for there, and every payout
          settles there in USDC. Test networks are never shown.
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
          by Stargate, which ended support for GOAT on 23 October 2026, so nothing new starts there. It appears only
          where someone already holds something on it. Everything already on GOAT keeps working: receipts, records, withdrawals and stopping a job. It resumes
          when GOAT has a USDC with a supported way in and out.
        </p>
        <p>
          Payouts Sage made earlier on Arc and Starknet keep their receipts and records, and a Starknet claim link still
          pays. Nothing new starts on either.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="account">
        <p>
          You pay for a test from a wallet you control, in USDC on Metis.{" "}
          {PAY_FROM_EMAIL_WALLET
            ? "That is MetaMask, or the wallet your email sign-in holds."
            : "That is MetaMask. A builder who signed in with an email pays from a Sage account, described below."}
        </p>
        <ul>
          <li>The test&apos;s page reads your wallet and says what it holds: USDC for the test, METIS for the network fee.</li>
          <li>
            If it is short, the page says by how much. Holding METIS but not enough USDC, you can swap on the page,
            through the Netswap pool on Metis.
          </li>
          <li>You confirm each step in your own wallet. A step that was already made is never asked for twice.</li>
          <li>The money goes into the test&apos;s own vault, and the places open once Sage has read that vault on Metis.</li>
          <li>What isn&apos;t paid to testers comes back to the wallet that paid, whenever you stop the test.</li>
        </ul>
        <p>
          To get USDC or METIS onto Metis: withdraw from an exchange and choose the Metis network, send from another
          Metis wallet, or bridge USDC from Ethereum with the <a href="https://bridge.metis.io">official Metis bridge</a>.
        </p>
        <h3>A Sage account</h3>
        <p>
          A Sage account is the other way to pay: a wallet Sage keeps for you on Metis, held by Privy. It is the same
          account whether you signed in with your email or with MetaMask. You add money to it from anywhere, swap METIS
          and USDC inside it, and send to any address at any time. The balance and activity you see are read from the
          chain.
        </p>
        <p>
          Sage can fund work from it only inside spending rules the wallet provider enforces: nothing can be funded
          above your per-job cap, $50 unless you change it, anywhere from $1 to $10,000. Every other move (a send, a
          swap) gets a one-time permit for that move alone, and the account locks back to its rules straight after. It
          is convenient and bounded, but it isn&apos;t a wallet only you control.
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
          moved. Most refusals happen before anything reaches the chain. Their reasons go to the person who answered
          and to the test&apos;s builder.
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
              <strong>Your wallet pays its own fees.</strong> Paying for a test is a few small transactions from your
              wallet, each paid in METIS, the network&apos;s own token. So is a send or a swap. The test&apos;s page reads
              the fee from the network and tells you how much METIS you need before you confirm anything.
            </span>
          </li>
          <li>
            <Gift size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Getting METIS.</strong> Most exchanges that list METIS withdraw it straight onto the Metis
              network. Sage does not send anyone network fees, builders or testers.
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
        <p>
          Sage is free to use. A test costs what its testers earn and nothing else: {TEST.people} people at {TEST.each}{" "}
          each is {TEST.total}, all of it to them. Testers never pay.
        </p>
        <ul>
          <li>An answer Sage can&apos;t check isn&apos;t paid, and what isn&apos;t paid is still yours when you end the test.</li>
          <li>Sending money on Metis costs the network&apos;s own fee, paid in METIS to the network, not to Sage.</li>
          <li>
            Paid plans exist in Sage&apos;s code for teams that run other kinds of work. They are not offered on the
            front, and a plan only ever decides what can be launched next. A live test keeps paying its people,
            whatever happens to a plan.
          </li>
        </ul>
        <p>
          <Link href="/pricing">Pricing</Link> shows one test&apos;s sum.
        </p>
      </DocSection>
    </article>
  );
}
