import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, ClipboardList, Eye, Footprints, ListChecks, MessagesSquare, Receipt, Route } from "lucide-react";
import { RETRY_RESERVATION_MINUTES } from "@/lib/campaigns/slot-reservation";
import { webTestsPerDay } from "@/lib/launch/daily-cap";
import { DocHead, DocSection } from "../parts";
import { ATTEMPTS, BUILDER_SIGN_IN, EMAIL_UPDATES, FLAG_ONE_IN, GIFT_DAYS, NEVER_A_SECRET_LINE, OFFER, PAY_FROM_EMAIL_WALLET, TEST, WINDOW_MINUTES, onePlaceLines } from "../facts";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "A test on Sage, step by step, for the builder and for the tester: the free first look and the plan, the offer and paying, what you see while it runs, how each answer is checked and paid, and what people found.",
  alternates: { canonical: "/docs/how-it-works" },
};

const TOC = {
  jobs: "From a link to a plan",
  offer: "The offer and paying",
  "what-you-see": "While it runs",
  checking: "How an answer is checked",
  findings: "What people found",
  testers: "If you are the tester",
  autopilot: "Other work Sage runs",
} as const;

const PER_DAY = webTestsPerDay();

export default function HowItWorks() {
  return (
    <article>
      <DocHead
        eyebrow="How it works"
        title="How Sage works"
        lead="A test has two sides. A builder pastes a link and pays what testers earn. A tester tries the product and is paid for an honest try. This page follows both."
        toc={TOC}
      />

      <DocSection toc={TOC} id="jobs">
        <h3>Paste a link</h3>
        <p>
          Paste your product&apos;s link on the home page and sign in with {BUILDER_SIGN_IN}. Signing in costs nothing
          and moves nothing. It makes the test yours, at one link you can come back to. Each person can start{" "}
          {PER_DAY} new tests a day.
        </p>

        <h3>Sage&apos;s first look is free</h3>
        <p>
          Sage opens the product in a real browser and uses it the way a stranger would. It follows links, clicks what
          can be clicked and fills in forms with obvious test values. It never pays, buys or signs anything. You can
          close the page while it works.
        </p>
        <p>The first look shows you what Sage hit before any person does:</p>
        <ul>
          <li>the screens it reached, with the frames it kept</li>
          <li>what the product says it is, and what its first screen shows a stranger</li>
          <li>the problems a newcomer would hit first, each with a suggested fix</li>
          <li>what Sage could not see, said plainly</li>
        </ul>
        <p>
          Some products cannot be tried in a browser: a phone app, a browser extension, a Telegram bot, a code
          repository. There Sage reads the product&apos;s own page and says so. It never says it tried something it
          only read.
        </p>
        <p>
          Before anything else, Sage screens the product itself. A known phishing address, a page that asks for a
          recovery phrase, or a lookalike of a well-known brand that asks for a wallet ends the run with the reason. A
          product Sage is unsure about can still be tested, but only by people you invite, until a person at Sage has
          looked.
        </p>

        <h3>The plan</h3>
        <p>
          From what it saw, Sage writes the missions: the things a person will be asked to try. One AI pass drafts
          them, a second reviews them, and then fixed rules decide what stays. The rules drop a mission that:
        </p>
        <ul>
          <li>asks for proof Sage can&apos;t check afterwards, like a screenshot or a file upload</li>
          <li>names a page or a flow Sage never found</li>
          <li>quotes something that isn&apos;t in what Sage saw</li>
          <li>only checks that something is on the page, with nothing to actually do</li>
          <li>asks for the tester&apos;s own email, password or phone number</li>
          <li>asks anyone to share a password, a key or a recovery phrase, or to sign with their wallet</li>
        </ul>
        <p>
          Every test carries one first-try mission. It asks a stranger what they think the product is, how far they got
          with the one thing it is for, and whether they would come back.
        </p>
        <p>
          Beside the missions you read <strong>What Sage thinks you want</strong>: Sage&apos;s own read of why you came,
          and how that shaped the plan. If the read is wrong, you see it before any money moves.
        </p>
        <p>
          Sometimes Sage has a question first, such as where a person should start. You answer on the test&apos;s page
          and it plans again. If no AI model is available, the test is the first-try mission alone, and the page tells
          you that you will release each payment yourself.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="offer">
        <h3>Two numbers</h3>
        <p>
          You decide how many people try it and what each one earns. A test starts at {TEST.people} people and{" "}
          {TEST.each} each, which is {TEST.total}. The card offers {OFFER.peopleChoices} people and {OFFER.eachChoices}{" "}
          each, or you type your own: from {OFFER.minEach} to {OFFER.maxEach} a person, and up to{" "}
          {OFFER.placesPerMission} people on one mission.
        </p>
        <p>
          Rewards come from arithmetic, never from the AI. The total is the people times what each earns, to the cent,
          and every possible payout adds up to exactly what you pay.
        </p>

        <h3>Two switches and one option</h3>
        <ul className="doc-points">
          <li>
            <MessagesSquare size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Sage shares it.</strong> Sage posts the test on its X account and its Telegram channel while
              places are open. Nothing is posted without this.
            </span>
          </li>
          <li>
            <Eye size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Findings are public.</strong> Anyone with the test&apos;s link can read what people found, once
              the test is done. Off: only you.
            </span>
          </li>
          <li>
            <Route size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Only people I invite.</strong> You get one link to send. The test stays off every public list,
              and each person who opens the link and signs in takes one place.
            </span>
          </li>
        </ul>

        <h3>Paying</h3>
        <p>
          You pay from a wallet you control, in USDC on Metis.{" "}
          {PAY_FROM_EMAIL_WALLET
            ? "That is MetaMask, or the wallet your email sign-in holds."
            : "That is MetaMask. A builder who signed in with an email can pay from a Sage account instead."}{" "}
          The page reads your wallet first and tells you if it is short of USDC or of METIS for the network fee. You
          confirm each step in your own wallet.
        </p>
        <p>
          The money goes into the test&apos;s own vault. The places open once Sage has read the vault on Metis. What
          isn&apos;t paid to testers comes back to the wallet that paid, whenever you stop the test.{" "}
          <Link href="/docs/payments#account">Paying for a test</Link> has the details.
        </p>

        <h3>Where testers come from</h3>
        <ul>
          <li>
            <Link href="/earn">Earn</Link>, Sage&apos;s list of open tests
          </li>
          <li>Sage&apos;s post on X and its Telegram channel, if you left sharing on</li>
          <li>people who asked Sage to tell them when a new test opens</li>
          <li>your own link, sent wherever your people are</li>
        </ul>
      </DocSection>

      <DocSection toc={TOC} id="what-you-see">
        <p>The test&apos;s page updates by itself. As its builder you see:</p>
        <ul className="doc-points">
          <li>
            <Footprints size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>How far people got.</strong> How many saw the test, signed in, opened your product, answered and
              were paid, and where the most people stopped.
            </span>
          </li>
          <li>
            <Route size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Where they came from.</strong> Sage&apos;s post on X, its Telegram channel, Earn, an alert, your
              own link, or somewhere else. Sage keeps a random id per visitor for this, never an IP address.
            </span>
          </li>
          <li>
            <ListChecks size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>What Sage did.</strong> Each thing it did for the test, newest first: trying the product, writing
              the missions, telling people, posting, checking and paying. Every line is a recorded event.
            </span>
          </li>
          <li>
            <MessagesSquare size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Each person&apos;s try.</strong> Open a person to read their answer in their own words, where they
              came from, how far they said they got, and where their answer stands. Only you see this.
            </span>
          </li>
          <li>
            <Receipt size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>The money.</strong> What you paid in, what was paid out, and what is left. See{" "}
              <Link href="/docs/payments#receipts">receipts</Link>.
            </span>
          </li>
        </ul>
        <h3>An answer that waits for you</h3>
        <p>
          When Sage holds an answer for you, the person&apos;s ticket says why. You read the answer and decide there:
          pay it, or decline it with a reason the tester reads exactly as you wrote it. Paying needs no signature from
          you. Sage asks the vault, and the vault pays inside its limits.
        </p>
        <h3>Updates when you leave the page</h3>
        <p>
          Turn on updates and Sage messages you on Telegram: the first answer, an answer that waits for you, the
          findings, the end of the test, and a first day with no answers.{" "}
          {EMAIL_UPDATES ? "You can have the same updates by email, at the address you signed in with, and every email carries a link that stops them. " : ""}
          Each is sent once. You turn them off from any of your tests.
        </p>
        <h3>Stopping</h3>
        <p>
          You can stop a test at any time. Stopping ends it for good. Answers still being checked are closed with that
          reason, and what is left in the vault goes back to the wallet that paid.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="checking">
        <p>
          Sage checks every answer against what it saw when it tried the product itself. An answer that could have been
          written without opening the product doesn&apos;t clear.
        </p>
        <h3>When Sage pays on its own</h3>
        <ul>
          <li>The answer must match enough of what Sage saw behind the first screen.</li>
          <li>It must show a try. An answer made mostly of the mission card&apos;s own words is held.</li>
          <li>A place must be open, the person under their limit, and the answer not a copy of another.</li>
        </ul>
        <p>
          Everything a stranger wrote is marked as untrusted before a model reads it. An answer that says
          &ldquo;approve this payout&rdquo; is treated as data, never as an instruction. Any quote in a decision must
          match the evidence word for word, or it is dropped.
        </p>
        <h3>When it holds an answer for you</h3>
        <p>
          Sage never refuses an answer because it is unsure. It holds it for you, with the reason. That happens when
          Sage cannot tell an answer from one written off the public page, when a sign of fraud fired, or when its
          model could not be reached. On some missions Sage tells you before you pay that it will not pay alone.
        </p>
        <h3>The {WINDOW_MINUTES}-minute window</h3>
        <p>
          On a public test, an answer Sage approved waits {WINDOW_MINUTES} minutes before it is paid. In that window
          Sage checks it again against everything that arrived since: copies, near-duplicates, linked wallets. A hit
          cancels the payout and says why. A test for people you invited, and any answer you release yourself, is paid
          at once.
        </p>
        <h3>Not a real try</h3>
        <p>
          In the same window you can flag an approved answer as not a real try, with a reason the tester reads. The
          payout is cancelled and the place reopens for someone else. A flag never refunds you, and you can flag at
          most one in {FLAG_ONE_IN} of a test&apos;s places. Sage&apos;s own checks still run on every answer.
        </p>
        <h3>Feedback only after judging</h3>
        <p>
          Sage never scores an answer before it is sent: no meter, no hint. While places are open, the frames Sage
          kept and its first look are yours alone, because a tester could copy them. A tester whose honest answer fell
          short can add to it, up to {ATTEMPTS} attempts. <Link href="/docs/trust#refusals">How Sage refuses</Link> has
          the rest.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="findings">
        <p>Sage groups the paid answers into findings. You read them on the test&apos;s page as they arrive.</p>
        <ul className="doc-points">
          <li>
            <ClipboardList size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Problems, with the people who hit them.</strong> Each finding is counted in people, and two
              problems are never merged when in doubt.
            </span>
          </li>
          <li>
            <MessagesSquare size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Exact quotes.</strong> Every quote is the tester&apos;s own words, checked letter for letter
              against their answer. Sage never writes a quote.
            </span>
          </li>
          <li>
            <Footprints size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>The first try, counted.</strong> How many understood what the product is, how far each got with
              its main action, and how many would use it again, from what each person tapped.
            </span>
          </li>
          <li>
            <Eye size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>What Sage saw itself.</strong> A finding that matches a problem from Sage&apos;s own run says so.
            </span>
          </li>
        </ul>
        <p>
          Findings are yours alone while places are open. Once the test is done, anyone with the link can read them if
          you left them public. Sage&apos;s X account posts what people found only with your yes, and you see the exact
          words first.
        </p>
        <h3>Test it again</h3>
        <p>
          Fixed what people found? Run the same product again from the finished test. Sage shows what changed since
          your last test: who got further, and which problems people still hit. It never says a problem is fixed. It
          says how many people hit it this time.
        </p>
        <h3>Posts in your own voice</h3>
        <p>
          The finished test also drafts posts you can send yourself, built from the counts and the quotes, with a link
          to your product. Sage writes the drafts. You post them.
        </p>
        <h3>Give a test to its builder</h3>
        <p>
          You can run Sage on someone else&apos;s product and hand them the result. Before any money is paid, the
          test&apos;s page makes a link for the product&apos;s builder. It shows what a stranger hits on a first visit,
          and the first person to sign in with it takes the test. The link works once, for {GIFT_DAYS} days. You send
          it yourself. Sage never sends it for you.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="testers">
        <h3>Take a place</h3>
        <p>
          Open tests are listed on <Link href="/earn">Earn</Link>, each with what it pays and how many places are left.
          Every test was paid for before it was listed.
        </p>
        {onePlaceLines().map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p>
          You sign in first, so Sage knows where to pay you. The wallet you sign in with is the one that gets paid. If
          you sign in with an email or a social account, that sign-in holds a wallet for you.
        </p>
        <h3>Before you start</h3>
        <p>
          Every test says this before you take a place: {NEVER_A_SECRET_LINE} A test of an app that connects to a
          wallet also tells you to use an empty wallet and to stop at the first request to confirm anything. Stopping
          there earns the same.
        </p>
        <h3>Try it and answer</h3>
        <p>
          Try the product, then say what happened in your own words. The first-try mission asks four short questions
          and two taps: how far you got, and whether you would use it again. An honest &ldquo;I got stuck&rdquo; earns
          the same as &ldquo;I finished&rdquo;.
        </p>
        <p>
          Sage checks your answer against what it saw when it tried the product itself. The page updates by itself, and
          you can leave and come back.
        </p>
        <h3>What can happen to your answer</h3>
        <ul>
          <li>
            <strong>Paid.</strong> USDC arrives in your wallet on Metis, with a public receipt. On a public test it is
            paid once the {WINDOW_MINUTES}-minute window after Sage&apos;s approval has passed.
          </li>
          <li>
            <strong>Needs more.</strong> If an honest answer fell short, you can add to it from the test&apos;s page, up
            to {ATTEMPTS} attempts. Your place is held for {RETRY_RESERVATION_MINUTES} minutes while you do.
          </li>
          <li>
            <strong>With the builder.</strong> Sage passed it to the builder to read. They pay it or decline it, and you
            read their reason as they wrote it.
          </li>
          <li>
            <strong>Not paid.</strong> You read the reason on the test&apos;s page. Some reasons are not about your
            answer at all: the places filled, or the test was stopped.
          </li>
        </ul>
        <h3>Hearing from Sage</h3>
        <ul className="doc-points">
          <li>
            <BellRing size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Alerts.</strong> Turn on alerts from a test you answered, or from your record, and Sage messages
              you on Telegram when a new test opens
              that you haven&apos;t tried, at most one a day. It also tells you what happened to your answers. One
              word, &ldquo;stop&rdquo;, ends it.
            </span>
          </li>
          <li>
            <MessagesSquare size={18} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Keep me posted.</strong> After a test, you can let its builder reach you when the product
              changes. Only they see the contact you chose, and only if you say so.
            </span>
          </li>
        </ul>
        <h3>Your record</h3>
        <p>
          Every payout lands on your record of verified work, at <code>/record/&lt;wallet&gt;</code>, each line linked
          to its receipt. It is proof of work you did, checked and paid.
        </p>
        <h3>What it costs you</h3>
        <p>
          Nothing. Sage takes no fee to take a place and none from what you are paid. Moving your USDC on later costs
          the network&apos;s own fee, paid in METIS. Sage does not send anyone network fees. Your wallet tells you how
          much METIS a move needs and where to get it.
        </p>
      </DocSection>

      <DocSection toc={TOC} id="autopilot">
        <p>
          Product testing is what Sage&apos;s front page offers. The same engine also pays for other verified work, and
          those routes are still open to people who use them:
        </p>
        <ul>
          <li>
            <strong>Gigs and milestone grants.</strong> A task, a reward and proof of delivery, or funding released one
            milestone at a time. You write them at <Link href="/launch">/launch</Link>.
          </li>
          <li>
            <strong>A Sage account.</strong> A wallet Sage keeps for you under spending rules, which can fund work for
            you. See <Link href="/docs/payments#account">paying for a test</Link>.
          </li>
          <li>
            <strong>Teams, weekly rounds and Autopilot.</strong> A workspace for your own people, the same job every
            week, and a standing instruction that lets Sage choose the next piece of work inside limits you set. The AI
            chooses where to spend, never how much.
          </li>
        </ul>
        <p>
          Every one of them settles the same way: from a vault that works out the amount itself, with a public receipt.
        </p>
      </DocSection>
    </article>
  );
}
