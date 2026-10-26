import type { Metadata } from "next";
import Link from "next/link";
import {
  BadgeCheck,
  CircleSlash,
  Copy,
  Fingerprint,
  Gauge,
  Hourglass,
  KeyRound,
  Link2,
  Repeat,
  Sprout,
  Undo2,
  UsersRound,
} from "lucide-react";
import { OFAC_SDN_SNAPSHOT_DATE, SANCTIONS_LIST_SIZE } from "@/lib/deputy/sanctions";
import { DEFAULT_FINALIZE_MINUTES } from "@/lib/deputy/finalization";
import { MAX_ATTEMPTS } from "@/lib/campaigns/retry";
import { DocHead, DocSection } from "../parts";

export const metadata: Metadata = {
  title: "Safety and limits",
  description:
    "Why Sage can be trusted with money: an on-chain vault no model can talk past, farm and sybil defences, how and why Sage refuses work, and sanctions screening.",
  alternates: { canonical: "/docs/trust" },
};

const TOC = {
  vault: "The vault's limits",
  ai: "What the AI can't do",
  farms: "Farm defences",
  refusals: "How Sage refuses",
  privacy: "Private payouts",
  compliance: "Compliance",
  limits: "What this doesn't cover",
} as const;

const SNAPSHOT = new Date(`${OFAC_SDN_SNAPSHOT_DATE}T00:00:00Z`).toLocaleDateString("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export default function Trust() {
  return (
    <article>
      <DocHead
        eyebrow="Safety"
        title="Safety and limits"
        lead="The AI proposes. The vault disposes. Sage's promises don't depend on a model behaving well: they live in code and in a contract on chain, where no prompt can reach them."
        toc={TOC}
      />

      <DocSection toc={TOC} id="vault">
        <p>
          Every job has its own vault: a contract on chain that holds the job&apos;s budget. Sage&apos;s AI can only ask
          it to pay. The vault decides, by rules fixed when the job was created:
        </p>
        <ul className="doc-points">
          <li>
            <BadgeCheck size={18} strokeWidth={1.75} aria-hidden />
            <span>It works out the reward itself, from the mission. A request to pay can&apos;t name an amount.</span>
          </li>
          <li>
            <UsersRound size={18} strokeWidth={1.75} aria-hidden />
            <span>Each mission pays no more people than it was created for, and each wallet at most once.</span>
          </li>
          <li>
            <Repeat size={18} strokeWidth={1.75} aria-hidden />
            <span>The same approval can never be paid twice.</span>
          </li>
          <li>
            <Gauge size={18} strokeWidth={1.75} aria-hidden />
            <span>It pays out no more than the job&apos;s budget, and no more than its daily limit.</span>
          </li>
          <li>
            <KeyRound size={18} strokeWidth={1.75} aria-hidden />
            <span>
              Only the operator named when the job was created can ask it to pay, and only its owner can take money out.
            </span>
          </li>
          <li>
            <Undo2 size={18} strokeWidth={1.75} aria-hidden />
            <span>
              Stop the job and the vault closes. Everything left goes back to whoever funded it: your wallet, or your
              Sage account.
            </span>
          </li>
        </ul>
        <p>
          A job goes live only after its vault is funded, so the rewards on the board are already paid for. When the
          vault says no, it doesn&apos;t fail silently: it records the refusal on chain, with a code for the reason.
        </p>
        <p>
          Sage adds its own rules before it ever asks the vault, such as one payout per person across a whole job. Those
          live in Sage&apos;s code. The vault&apos;s limits hold even if that code is wrong.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="ai">
        <ul className="doc-points">
          <li>
            <CircleSlash size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Set an amount.</strong> Rewards are fixed by arithmetic when the job is made. The judge isn&apos;t
              allowed to state an amount. The chat assistant never does its own money math: it passes on your numbers
              and Sage&apos;s, and Sage checks the plan against what you actually said.
            </span>
          </li>
          <li>
            <CircleSlash size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Invent a quote.</strong> Any quote in a decision must match the evidence exactly, or it is
              dropped.
            </span>
          </li>
          <li>
            <CircleSlash size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Take orders from the work.</strong> Pages, evidence and notes are wrapped as untrusted text before
              a model reads them, and a detector looks for eight kinds of prompt injection.
            </span>
          </li>
          <li>
            <CircleSlash size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Pay when it&apos;s unsure.</strong> Below the job&apos;s confidence bar, or with a serious sign of
              fraud, the work waits for a person.
            </span>
          </li>
          <li>
            <CircleSlash size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Pay on a guess.</strong> If no AI model is available, the judge falls back to a keyword check, and
              its verdicts wait for a person. Work can still clear only on checks that need no model at all.
            </span>
          </li>
        </ul>
        <p>
          So a jailbroken model can do one thing: recommend a payout. The vault still works out the amount, applies
          every limit, and can say no.
        </p>
        <div className="doc-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Setting</th>
                <th scope="col">What it does</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Confidence bar</td>
                <td>Set per job: 0.85 by default, anywhere from 0.50 to 0.99</td>
              </tr>
              <tr>
                <td>
                  <code>DEPUTY_AUTOPILOT_MAINNET</code>
                </td>
                <td>
                  Sage&apos;s own switch for automatic real-money payouts of link, page and transaction work. Off by
                  default; with it off, verified work waits for a person to release it.
                </td>
              </tr>
              <tr>
                <td>
                  <code>OBSERVATION_AUTOPAY</code>
                </td>
                <td>The same switch for product-testing reports</td>
              </tr>
              <tr>
                <td>Re-check window</td>
                <td>
                  {DEFAULT_FINALIZE_MINUTES} minutes by default (<code>AUTOPAY_FINALIZE_MINUTES</code>); none for
                  members-only work
                </td>
              </tr>
              <tr>
                <td>Injection detector</td>
                <td>
                  Eight families: overriding instructions, dictating a verdict, dictating a confidence, claiming
                  authority, approve commands, fake decision JSON, jailbreak wording, hidden control characters
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </DocSection>

      <DocSection toc={TOC} id="farms">
        <p>
          A payout only means something if one person can&apos;t collect it many times. Sage stacks several defences,
          from hard refusals to signals a person reviews.
        </p>
        <ul className="doc-points">
          <li>
            <Fingerprint size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>One person, one slot.</strong> On public work, claiming a slot can ask for a one-time World ID
              proof that you&apos;re a unique person. Sage keeps a number tied to that proof, never a name or a document.
              Every wallet that shares it, and every wallet linked on chain or declared as yours, counts as one person.
            </span>
          </li>
          <li>
            <Copy size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Copies.</strong> Near-duplicate writing and copied pages are found by comparison and held for
              review.
            </span>
          </li>
          <li>
            <Link2 size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Linked wallets.</strong> Sage reads the chain to see when submitters were funded by each other, or
              by the same wallet.
            </span>
          </li>
          <li>
            <Sprout size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>New wallets.</strong> A wallet with no history counts against a submission, but never decides it
              alone.
            </span>
          </li>
          <li>
            <Gauge size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Limits.</strong> One payout per person per job by default (one per milestone on a grant), and a
              daily cap on submissions from each wallet.
            </span>
          </li>
          <li>
            <Hourglass size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>The window.</strong> On public jobs, every approved payout waits {DEFAULT_FINALIZE_MINUTES}{" "}
              minutes and is checked again against everything that arrived since. A hit cancels it, with the reason.
            </span>
          </li>
        </ul>
        <p>
          A signal like a new wallet or a shared funder doesn&apos;t refuse anyone on its own. Together, signals can hold
          work for review. These defences were built against a real farm, where one person ran many wallets on a live
          job and was caught on chain.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="refusals">
        <p>
          The AI judge never refuses on its own. When it isn&apos;t sure, it holds the work for a person. Refusals come
          from rules, and each one Sage makes carries a written reason the person can read.
        </p>
        <ul>
          <li>
            <strong>At the door:</strong> a sanctioned wallet, a missing proof of personhood where one is asked, a second
            slot for the same person, a person already at their limit, too many submissions in a day, or someone who
            isn&apos;t on the job&apos;s invite list.
          </li>
          <li>
            <strong>After judging:</strong> the mission filled, or the person reached their limit. These reasons say
            plainly that they aren&apos;t a judgement on the work.
          </li>
          <li>
            <strong>In the window:</strong> a copy, a near-duplicate or a linked wallet found after approval cancels the
            payout, with the reason.
          </li>
          <li>
            <strong>When a job is stopped:</strong> its open submissions are closed, and the reason says so.
          </li>
        </ul>
        <p>You can also approve or reject submissions by hand, from the job&apos;s page.</p>
        <h3>Feedback only after judging</h3>
        <p>
          Sage never scores work before it&apos;s submitted: no meter, no &ldquo;you matched three of five&rdquo; hint. A
          signal like that would let someone read the answers off the meter without doing the work. Feedback comes after
          a judged submission, and someone whose honest work fell short can revise it, up to {MAX_ATTEMPTS} attempts.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="privacy">
        <p>
          An ordinary payout on chain writes a permanent public line: this address earned this much, on this day. For
          someone who lives on that income, being paid shouldn&apos;t publish it. Sage paid privately on Starknet until 26
          October 2026, when it moved to one network, Metis. New work doesn&apos;t offer it; a private payout already
          made collects exactly as below.
        </p>
        <ol>
          <li>
            <strong>The vault releases the reward, and Sage puts it straight into an escrow</strong>, not into the
            worker&apos;s wallet. The escrow holds it against a sealed code that names nobody.
          </li>
          <li>
            <strong>The worker collects with a one-time claim link</strong>, to any Starknet address they choose. Sage
            sends the collection and pays its fee, so someone with no tokens, and no Starknet account set up, can still
            be paid.
          </li>
          <li>
            <strong>A wallet registered with the STRK20 privacy pool</strong> can collect straight into a private
            balance instead, from the worker&apos;s own wallet.
          </li>
        </ol>
        <p>On a vault created from Sage&apos;s current Starknet contract, this is what the chain shows:</p>
        <div className="doc-table">
          <table>
            <thead>
              <tr>
                <th scope="col">What</th>
                <th scope="col">Who can see it on chain</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Who was on a payout list, and who collected</td>
                <td>No one: the escrow names nobody</td>
              </tr>
              <tr>
                <td>Where the money ends up</td>
                <td>
                  No one, unless the worker collects in public, and then only that address, for that one payment. It
                  never lands in the wallet that did the work unless the worker names it.
                </td>
              </tr>
              <tr>
                <td>How much was funded, and when</td>
                <td>Everyone</td>
              </tr>
              <tr>
                <td>The vault&apos;s spending: every amount, mission and decision fingerprint</td>
                <td>Everyone, with no name attached</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Every figure Sage reports can still be checked on chain. Privacy removes the line back to a person, not the
          receipts. Two things to know. Sage keeps the claim link&apos;s secret so it can deliver the link to you, so
          the privacy is from the public, not from Sage. And older vaults, created before the current contract and
          still live, also name the worker in their payout and refusal records.
        </p>
        <div className="doc-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Part</th>
                <th scope="col">Technical detail</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Vault</td>
                <td>
                  <code>SageVault</code> (Cairo). <code>request_payout</code> takes no amount; a refusal returns a code
                  (0 paid, 1 to 11 the reason) in a <code>PayoutRefused</code> event instead of reverting
                </td>
              </tr>
              <tr>
                <td>Escrow</td>
                <td>
                  <code>SageClaims</code>, keyed by <code>poseidon(&apos;SAGE_CLAIM:V1&apos;, secret)</code>. No owner,
                  no admin, no upgrade path. <code>claim_to_address</code> is ungated: the secret is the authority
                </td>
              </tr>
              <tr>
                <td>Event keys</td>
                <td>
                  Current class: <code>mission_id</code> and <code>intent_hash</code>. Earlier classes also index the
                  recipient address
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </DocSection>

      <DocSection toc={TOC} id="compliance">
        <h3>Sanctions screening</h3>
        <p>
          Every Ethereum-style wallet is checked against the US Treasury&apos;s sanctions list (the OFAC SDN list of
          digital currency addresses) when it submits work, and again before Sage pays it automatically. A listed
          address is refused before its work is recorded. The list is a copy kept in Sage&apos;s code, not a live
          lookup: {SANCTIONS_LIST_SIZE} addresses, as of {SNAPSHOT}. Updating it is a reviewed change, never a silent
          download. Starknet addresses aren&apos;t on the list, so Starknet payouts aren&apos;t screened.
        </p>
        <h3>No identity checks</h3>
        <p>
          People are wallets, not names. Sage can ask for proof that someone is one person, never for a name or a
          document. If you need named recipients, use members-only work or an invite list, where you choose who can
          take part.
        </p>
        <h3>Who holds what</h3>
        <p>
          Your Sage account is a wallet held by Privy, a wallet provider, under spending rules that limit what Sage can
          do with it: launch your jobs, within your per-job cap. It&apos;s convenient and bounded, but it isn&apos;t
          self-custody. You can withdraw to any address at any time, and if you want sole control of your keys, sign in
          with your own wallet and fund jobs from it. People invited through Telegram are paid into a wallet Sage keeps
          for them, and can cash out from the chat to any address, with Sage paying the fee.
        </p>
        <h3>An audit trail by default</h3>
        <p>
          Every payout settles on chain with a public receipt, and lands on the person&apos;s record of verified work.
          Refusals are counted in public too. See <Link href="/docs/payments#receipts">receipts</Link>.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="limits">
        <ul>
          <li>
            A founder who funds work on a product built to harm people is a policy problem, not a contract problem.
          </li>
          <li>Honest work that Sage can&apos;t verify gets refused. That is a real cost, and honest people bear it.</li>
          <li>
            These guarantees cover how money moves. They say nothing about whether a job was a good one to run. That
            call is still yours.
          </li>
        </ul>
      </DocSection>
    </article>
  );
}
