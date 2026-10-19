import type { Metadata } from "next";
import Link from "next/link";
import { Coins, Compass, FlaskConical, Landmark, ListChecks, MessagesSquare, Receipt, Wallet } from "lucide-react";
import { DEFAULT_POLICY } from "@/lib/operator/policy";
import { CURRENCIES } from "@/lib/money/currency";
import { DEFAULT_FINALIZE_MINUTES } from "@/lib/deputy/finalization";
import { MAX_ATTEMPTS } from "@/lib/campaigns/retry";
import { MAX_COMPLETIONS, TANGIBLE_MIN_PER_REWARD_USD } from "@/lib/launch/budget";
import { DocHead, DocSection } from "../parts";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How Sage turns a sentence and a budget into paid, verified work: jobs and missions, how every submission is checked before it pays, Autopilot, and what you see along the way.",
  alternates: { canonical: "/docs/how-it-works" },
};

const TOC = {
  jobs: "Jobs and missions",
  checking: "How work is checked",
  autopilot: "Autopilot",
  "what-you-see": "What you see",
} as const;

/** Every number below is read from the code that enforces it. */
const usd = (base: number) => `$${(base / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const p = DEFAULT_POLICY;
const OTHER_CURRENCIES = CURRENCIES.filter((c) => c.code !== "USD").length;
const FLOOR = `$${TANGIBLE_MIN_PER_REWARD_USD.toFixed(2)}`;
const MAX_PEOPLE = Number(MAX_COMPLETIONS);
const STALL_HOURS = p.stallAfterMinutes / 60;

const LIMITS: { name: string; value: string }[] = [
  { name: "First job on a product", value: usd(p.probeBase) },
  { name: "Most for one job", value: usd(p.perCampaignCapBase) },
  { name: "Most in any 7 days", value: usd(p.weeklyCapBase) },
  { name: "Kept in reserve", value: p.reserveFloorBase === 0 ? "nothing, unless you set a floor" : usd(p.reserveFloorBase) },
  { name: "Growth for work that gets done", value: `up to ${p.maxScale} times the first job` },
  { name: "Unclaimed money on the board", value: `at most ${Math.round(p.maxExposure * 100)}% of your account` },
  { name: "Jobs live at once", value: String(p.maxConcurrent) },
  { name: "Time between moves", value: `${p.minSpacingMinutes} minutes` },
  { name: "Time to stop a move", value: "20 minutes" },
  { name: "A job nobody submits to", value: `stopped after ${STALL_HOURS} hours` },
];

export default function HowItWorks() {
  return (
    <article>
      <DocHead
        eyebrow="How it works"
        title="How Sage works"
        lead="Sage turns a sentence and a budget into work people can claim. It checks what they submit, and pays only for what holds up."
        toc={TOC}
      />

      <DocSection toc={TOC} id="jobs">
        <p>
          A job is what you post. It holds the budget, and it is made of missions: the tasks people claim. Each mission
          says what to do, what counts as proof, what it pays and how many people can earn it.
        </p>
        <h3>Three kinds of job</h3>
        <ul className="doc-points">
          <li>
            <FlaskConical size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Product testing.</strong> Give Sage your product&apos;s address. It opens the product in a real
              browser, follows links, fills in forms with obvious test values and records what it can actually reach.
              Then it designs missions from what it saw.
            </span>
          </li>
          <li>
            <Coins size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Gigs and bounties.</strong> A task, a reward and proof of delivery: pay a designer when the new
              page is live, or a supplier when the delivery note is public. A bounty is a gig more than one person can
              earn.
            </span>
          </li>
          <li>
            <Landmark size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Milestone grants.</strong> Funding released one milestone at a time, each one checked before it
              pays.
            </span>
          </li>
        </ul>
        <p>
          Gigs and grants can be priced in US dollars or {OTHER_CURRENCIES} other currencies, from the Jamaican dollar
          to the euro. Sage converts once, at a rate it records on the plan, and pays in USDC. If it can&apos;t get a
          rate, it won&apos;t guess.
        </p>

        <h3>How missions are written</h3>
        <p>
          For a gig or a grant, you write one sentence. Sage drafts the brief: the steps, what good work looks like and
          what proof to send. The amounts and the number of people come from your own words, read by code rather than
          by the AI. You edit the draft, then create the job.
        </p>
        <p>
          For product testing, one AI pass drafts missions from what Sage saw, a second pass reviews them, and then
          fixed rules decide what ships. The rules discard a mission that:
        </p>
        <ul>
          <li>asks for proof Sage can&apos;t check afterwards, like a screenshot or a file upload</li>
          <li>names a page or a flow Sage never found</li>
          <li>quotes something about your product that isn&apos;t in what Sage observed</li>
          <li>only checks that something is on the page, with nothing to actually do</li>
          <li>asks someone to share a password, a key or a recovery phrase, or to sign with their wallet</li>
        </ul>
        <p>
          If no mission asks anyone to actually use your product, Sage sends the plan back for another round and keeps
          the new one only if it&apos;s better. You see and approve the plan before anything is funded.
        </p>

        <h3>Test logins</h3>
        <p>
          Sage reads only public pages unless you give it a test login. Use a throwaway test account, never a real one.
          Sage stores it encrypted, uses it only during the inspection, and strips any keys or email addresses it sees
          before they reach a mission. If your product signs in with an emailed code, create the test account with
          Sage&apos;s own address, and Sage reads the code from its own inbox. Signed in or not, it never pays, buys or
          signs anything.
        </p>

        <h3>How rewards are set</h3>
        <p>
          Rewards come from arithmetic, never from the AI. Sage splits your budget across the missions so that every
          possible payout adds up to exactly what you funded, to a millionth of a dollar. Missions that take longer pay
          more, and no completion pays less than {FLOOR}.
        </p>
        <p>
          A plan can only use so much. Each mission takes at most {MAX_PEOPLE} people, and Sage won&apos;t inflate
          rewards to use up a budget. If your budget is more than the plan can fairly use, the plan says so, and the
          rest stays with you.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="checking">
        <p>
          People find open work on the board, or through your invite, claim a mission, do it and submit. There is no
          application and no interview: the work is the application.
        </p>
        <h3>Code first, then the judge</h3>
        <p>
          Where a fact can be checked with code, code checks it. Sage fetches the link, looks for the text the mission
          requires, or reads the transaction on chain. A page someone publishes as their work must show their own wallet
          address, which is what makes it theirs.
        </p>
        <p>
          Then the judge, an AI model, reads the work against the mission&apos;s criteria. For product testing it also
          compares the work with what Sage saw in your product itself, so an account that could have been written
          without opening the product doesn&apos;t clear. Any quote in its decision must match the evidence word for
          word, or it is dropped. Everything a stranger wrote is marked as untrusted before a model reads it, so a page
          that says &ldquo;approve this payout&rdquo; is treated as data, never as an instruction.
        </p>
        <h3>When Sage pays on its own</h3>
        <p>
          By default, Sage pays verified work itself. You can switch a job to manual review on its page and release
          payouts yourself. Before Sage pays on its own:
        </p>
        <ul>
          <li>
            for a link, a page or a transaction, the judge must be the real AI model rather than the simple fallback,
            recommend paying, find no serious sign of fraud, and clear the job&apos;s confidence bar: 85% unless you
            set another, from 50% to 99%
          </li>
          <li>for a product-testing report, it must match enough of what Sage itself saw in your product</li>
          <li>
            in every case, a slot must be open, the person under their limit, and the work not a copy or a duplicate
          </li>
        </ul>
        <p>
          Anything else waits for you. On public jobs, an approved payout also waits {DEFAULT_FINALIZE_MINUTES} minutes
          before it settles. In that window Sage checks it again against everything that arrived since: copies,
          near-duplicates, linked wallets. A hit cancels the payout and says why. Members-only work, and any payout you
          release yourself, goes out at once.
        </p>
        <p>
          Work that falls short but looks honest can be revised, up to {MAX_ATTEMPTS} attempts, with the slot held for
          30 minutes while the person does. <Link href="/docs/trust#refusals">How Sage refuses</Link> has the rest.
        </p>
        <div className="doc-note">
          <ListChecks size={18} strokeWidth={1.75} aria-hidden />
          <p>
            A job&apos;s page labels its automatic payouts setting Autopilot. That switch only decides whether verified
            work is paid without your approval. The Autopilot below is different: it decides what work to buy.
          </p>
        </div>
      </DocSection>

      <DocSection toc={TOC} id="autopilot">
        <p>
          Autopilot lets you fund once and stop deciding. Sage chooses the next piece of work to buy, launches it from
          your account and tells you why. In the app it&apos;s called &ldquo;Let Sage run it&rdquo;, and it comes with Pro and
          above.
        </p>
        <h3>Where, never how much</h3>
        <p>
          The AI picks where to spend: which of your products to test next, and what to focus on. It never picks how
          much. A move that names an amount is thrown out, and so is a product you didn&apos;t name. The size comes
          from fixed rules and from your limits:
        </p>
        <div className="doc-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Limit</th>
                <th scope="col">Default</th>
              </tr>
            </thead>
            <tbody>
              {LIMITS.map((l) => (
                <tr key={l.name}>
                  <td>{l.name}</td>
                  <td>{l.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          You set the first job&apos;s size, the per-job and weekly limits, the reserve and the time to stop a move.
          The others can be changed through the API. Separately, your account caps any single launch, by you or by
          Autopilot (see <Link href="/docs/payments#account">your account</Link>).
        </p>
        <h3>Proposed first, then a window</h3>
        <p>
          Every move is written down before any money moves: the product, the goal, the reason and the price. Then it
          waits 20 minutes. Stop it with one click, or send it now. When the window passes, Sage designs the missions,
          then creates, funds and starts the job from your account. If the design fails, nothing is funded.
        </p>
        <h3>What it learns</h3>
        <p>
          Work that people pick up earns a bigger next job, up to {p.maxScale} times the first. A job nobody submits to
          for {STALL_HOURS} hours is stopped, and its money goes back to your account. While unclaimed work already
          fills the board, Sage waits instead of buying more, and says that&apos;s why. Before you fund anything, the
          Autopilot page shows the move Sage would make, without recording it.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="what-you-see">
        <ul className="doc-points">
          <li>
            <ListChecks size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>The plan</strong>, before anything is funded: each mission, its reward, its proof and how many
              people can earn it.
            </span>
          </li>
          <li>
            <MessagesSquare size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Every submission</strong>, with its decision and the written reason, including work Sage held or
              refused. The person who submitted sees their own result and reason on the job&apos;s board.
            </span>
          </li>
          <li>
            <Receipt size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>A receipt for every payout</strong>, public and tied to its transaction. See{" "}
              <Link href="/docs/payments#receipts">receipts</Link>.
            </span>
          </li>
          <li>
            <Wallet size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Your account</strong>: the balance and activity, read from the chain, and withdrawals to any
              address.
            </span>
          </li>
          <li>
            <Compass size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Autopilot&apos;s moves</strong>, each with its reason and price, and a stop button while it
              waits.
            </span>
          </li>
        </ul>
      </DocSection>
    </article>
  );
}
