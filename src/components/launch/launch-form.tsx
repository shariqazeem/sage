"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CURRENCIES } from "@/lib/money/currency";
import { X, HandCoins, Plus, ScanSearch } from "lucide-react";
import { rememberInspection } from "@/lib/launch/recent-inspections";
import { useSiwe } from "@/lib/auth/use-siwe";
import { useFounderSession } from "@/lib/auth/use-founder-session";
import { FounderSignIn } from "@/components/wallet/founder-sign-in";

/** The mailbox Sage owns and reads sign-in codes from. A founder registers their TEST account with
 *  this address when their product has no password, so nobody ever hands Sage an inbox credential. */
const SAGE_TESTER_EMAIL =
  process.env.NEXT_PUBLIC_SAGE_TESTER_EMAIL ?? "briefaiagent@gmail.com";

/** Proven goal shapes — the exact wording styles that produced good plans in real campaigns:
 *  action verbs the journey compiler recognizes, stable facts, no volatile counts. */
const GOAL_CHIPS: { label: string; goal: string }[] = [
  { label: "Let Sage decide", goal: "" },
  {
    label: "First impressions",
    goal: "Can a first-time visitor understand what this product does and find where to start? Report what you actually saw on each screen.",
  },
  {
    label: "Signup & onboarding",
    goal: "Can a new user sign up and get through onboarding without getting stuck? Report each step and anything confusing.",
  },
  {
    label: "Find pricing",
    goal: "Can a visitor find the pricing and understand what it costs to get started? Report what you actually saw.",
  },
  {
    label: "Docs vs reality",
    goal: "Follow the getting-started guide and check the docs match the real product. Identify confusing or missing information.",
  },
];

/**
 * THE SECOND DOOR — "Pay for work" (a gig, a bounty, a milestone grant). Nobody should have to
 * derive the structured paragraph the campaign compiler wants, so the founder finishes a SENTENCE
 * instead: who / $ / what must be true / how Sage verifies. The sentence compiles to the exact ask
 * the agent needs and is handed to chat — the form never grows a schema.
 */
const VERIFY_OPTIONS = [
  {
    value: "link",
    label: "the link they publish",
    ask: "fetching the public link each worker submits and checking it shows the finished work and carries their own wallet address",
  },
  {
    value: "page",
    label: "text on a public page",
    ask: "fetching the public page they submit and checking the required text appears on it",
  },
  {
    value: "onchain",
    label: "an on-chain transaction",
    ask: "reading the transaction they performed on-chain from the wallet they submit with",
  },
];

type PayDraft = { who: string; slots: string };

/** One payment line the founder composes — a tranche of a grant, or the whole of a gig. */
type Tranche = { amount: string; deliverable: string; verify: string; expectedText: string; toAddr: string };
const blankTranche = (verify = "link"): Tranche => ({ amount: "", deliverable: "", verify, expectedText: "", toAddr: "" });

/** Tap-to-fill examples — the blank-page killer. Each writes complete working sentences the
 *  founder edits, the same way the goal chips write proven goal shapes. */
const PAY_EXAMPLES: { label: string; who: string; slots: string; splitTotal?: string; currency?: string; tranches: Partial<Tranche>[] }[] = [
  { label: "Design gig", who: "my designer", slots: "1", tranches: [{ amount: "50", deliverable: "the new logo page is live", verify: "link" }] },
  { label: "Translation job", who: "a translator", slots: "1", tranches: [{ amount: "20", deliverable: "my menu is published in English as a public page", verify: "link" }] },
  { label: "Open bounty", who: "anyone", slots: "3", tranches: [{ amount: "5", deliverable: "they publish a working setup guide for my product", verify: "link" }] },
  {
    label: "Milestone grant",
    who: "a market seller I know",
    slots: "1",
    splitTotal: "40",
    tranches: [
      { deliverable: "she publishes her catalogue as a public page", verify: "link" },
      { deliverable: "she publishes her first customer review page", verify: "link" },
    ],
  },
  {
    label: "Grant in J$",
    who: "a market seller in Kingston",
    slots: "1",
    currency: "JMD",
    splitTotal: "10000",
    tranches: [
      { deliverable: "she publishes her catalogue as a public page", verify: "link" },
      { deliverable: "she publishes her first customer review page", verify: "link" },
    ],
  },
];

/** The one-line trust hint under each door — everything longer was deleted, not moved. */
const MODE_HINT = {
  test: "Sage only reads your product. Approve the plan, fund once — payouts run themselves, each with a public receipt.",
  pay: "You compose it; Sage compiles the plan deterministically — no chat, no model. Approve and fund once; work that fails verification is never paid.",
} as const;

/**
 * Step 1 — describe the launch as a GUIDED, cinematic sequence, kept deliberately short (P26): the
 * product + what to learn on one screen, then the budget. The optional GitHub repo hides behind an
 * "add repo" affordance so it never taxes the common path. On the final step it creates (or reuses) a
 * DURABLE inspection job and navigates to /launch/[inspectionId]; the id lives in the URL so refresh /
 * back-forward / reopen all resume the same state.
 */
const STEPS = [
  {
    q: "What do you want done?",
    hint: "", // step 0 renders MODE_HINT — the two doors carry the explanation structurally
  },
  {
    q: "Set the testing budget.",
    hint: "Sage allocates it precisely across the missions it designs. You fund it in the next step — nothing moves yet.",
  },
] as const;

function isHttpUrl(u: string): boolean {
  try {
    const x = new URL(u.trim());
    return x.protocol === "https:" || x.protocol === "http:";
  } catch {
    return false;
  }
}

export function LaunchForm() {
  const router = useRouter();
  /**
   * SIGN IN BEFORE INSPECTING — asked for HERE, not after four minutes of typing.
   *
   * An inspection costs real model spend and used to be open to anyone: a quarter came from
   * `anonymous`, and when one of those people later left feedback there was no way to tell whose
   * run it was. The server now refuses an unsigned request, so the form has to say so up front —
   * discovering it at the submit button would be the worst possible moment.
   *
   * It is a free signature: no gas, no transaction, no funds moved. The copy says that, because
   * "connect your wallet" reads like a charge to anyone who has not done it before.
   */
  const siwe = useSiwe();
  const founder = useFounderSession();
  const [showSignIn, setShowSignIn] = useState(false);
  const [step, setStep] = useState(0);
  // targetUsers is kept in state (the API still accepts it) but no longer asked — the goal carries intent.
  const [form, setForm] = useState({ productUrl: "", repoUrl: "", goal: "", targetUsers: "", budgetUsd: "5", testEmail: "", testPassword: "" });
  /** THE TWO DOORS (move 5): "test" = the bootcamp-winning inspection flow, byte-identical.
   *  "pay" = the sentence composer for funder-defined work. Both drafts survive a mode switch. */
  const [mode, setMode] = useState<"test" | "pay">("test");
  // A door elsewhere in the app can open THIS door directly (?do=pay) — the dashboard's
  // "Pay for work" card lands on the gig sentence, not on a toggle it must find first.
  // An EFFECT, not the state initializer: the initializer runs against the server-rendered
  // value during hydration and the param silently loses (measured — the toggle stayed on
  // "test" with ?do=pay in the address bar). Same pattern as the agent page's ?ask=.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("do") === "pay") setMode("pay");
  }, []);
  const [pay, setPay] = useState<PayDraft>({ who: "", slots: "1" });
  const [tranches, setTranches] = useState<Tranche[]>([blankTranche()]);
  /** "" = each tranche priced by the founder; a number = ONE stated total, split exactly by Sage. */
  const [splitTotal, setSplitTotal] = useState("");
  /**
   * THE FOUNDER'S OWN CURRENCY, VISIBLE — not hidden behind the dollar. A market seller is funded
   * in J$, a Trinidad hotel thinks in TT$, and the track is ABOUT those denominations. Settlement
   * stays USDC; Sage converts at a stamped, source-attributed rate at compile — the founder types
   * THEIR number and never does exchange arithmetic.
   */
  const [currency, setCurrency] = useState("USD");
  const [payBusy, setPayBusy] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  // One request id per form mount — the request-scoped idempotency token. A double-submit reuses it
  // (one job, not two); a fresh form (new page/reload) is a new turn. The server namespaces it.
  const [requestId] = useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const [showRepo, setShowRepo] = useState(false);
  /**
   * THE GOAL CONTROLS START CLOSED.
   *
   * The chips are genuinely useful — one tap instead of one paragraph — but they were
   * unconditional, so every founder paid their cost. MEASURED on the live page: step 1 offered 13
   * buttons and 2 inputs to do one thing, paste a URL and continue, and only three of those were
   * essential. That is the opposite of the product's own rule: ask only for genuine decisions, and
   * never ask what Sage can discover itself — a rule this form broke while literally offering
   * "Let Sage decide" as a chip.
   *
   * Open when a goal already exists so a returning founder never loses sight of their own words.
   */
  const [showGoal, setShowGoal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setP = (k: keyof PayDraft, v: string) => setPay((p) => ({ ...p, [k]: v }));

  const stepValid = (i = step): boolean => {
    // The goal is OPTIONAL — measured founder behavior: a paragraph-sized "what do you want to
    // learn?" is where people stall or close the tab. An empty goal is a delegation, not a gap:
    // the pipeline forces full exploration and Sage infers the first-visit goal from what it sees.
    if (i === 0) return isHttpUrl(form.productUrl) || describesWork();
    return Number(form.budgetUsd) >= 0.5;
  };

  const back = () => {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  };
  const next = () => {
    setError(null);
    // Describing work skips the budget step entirely — the agent asks for the money in its own words.
    if (describesWork()) return handOffToAgent();
    if (stepValid()) setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  /**
   * ONE FRONT DOOR (move 5). The founder answers ONE question. A URL is product testing — the path
   * that won the bootcamp, byte-identical below. Anything else is work they are defining (a grant, a
   * gig, a deliverable), which is the agent's job, not a second form: their own sentence is handed
   * to Sage in chat, where it structures the milestones and compiles the campaign.
   */
  const describesWork = (): boolean => {
    const t = form.productUrl.trim();
    return t.length >= 12 && !isHttpUrl(t) && /\s/.test(t);
  };

  const handOffToAgent = (ask?: string) => {
    const words = ask ?? [form.productUrl.trim(), form.goal.trim()].filter(Boolean).join(" — ");
    router.push(`/agent?ask=${encodeURIComponent(words)}`);
  };

  const setT = (i: number, key: keyof Tranche, v: string) =>
    setTranches((ts) => ts.map((t, j) => (j === i ? { ...t, [key]: v } : t)));

  const splitting = tranches.length > 1 && splitTotal.trim() !== "";

  const isLocal = currency !== "USD";
  const curSymbol = CURRENCIES.find((c) => c.code === currency)?.symbol ?? "$";

  const trancheValid = (t: Tranche): boolean => {
    if (t.deliverable.trim().length < 8) return false;
    // In a local currency the tangible floor is enforced SERVER-side after conversion (it refuses
    // in the founder's own units); the client only insists the number is a number.
    if (!splitting && !(isLocal ? Number(t.amount) > 0 : Number(t.amount) >= 0.5)) return false;
    if (t.verify === "page" && t.expectedText.trim().length < 3) return false;
    if (t.verify === "onchain" && !/^0x[0-9a-fA-F]{40}$/.test(t.toAddr.trim())) return false;
    return true;
  };

  const payValid = (): boolean =>
    pay.who.trim().length >= 2 &&
    tranches.every(trancheValid) &&
    (!splitting || (isLocal ? Number(splitTotal) > 0 : Number(splitTotal) >= 0.5 * tranches.length));

  /**
   * DISPLAY-ONLY mirror of the server's exact base-unit split (splitTotalBase): floor + remainder
   * one unit at a time. The server is the authority; this exists so the founder WATCHES the split
   * happen as they type the total — direct manipulation, the agent's arithmetic visible.
   */
  const splitPreview = (): string[] => {
    const totalBase = BigInt(Math.round(Number(splitTotal || 0) * 100)) * BigInt(10_000);
    const n = BigInt(tranches.length);
    if (n === BigInt(0) || totalBase <= BigInt(0)) return tranches.map(() => "—");
    const each = totalBase / n;
    const rem = totalBase % n;
    return tranches.map((_, i) =>
      (Number(BigInt(i) < rem ? each + BigInt(1) : each) / 1_000_000).toFixed(2),
    );
  };

  /**
   * THE SENTENCES COMPILE DIRECTLY — no chat, no model. The rows the founder composed become the
   * exact `DirectCampaignInput` the deterministic compiler takes; multi-tranche is a grant, one
   * line is a gig, and a stated total rides `splitTotalUsd` so Sage does the division in base
   * units. Errors come back as the compiler's own words, under the form.
   */
  const submitPay = async () => {
    if (!payValid() || payBusy) return;
    setPayErr(null);
    setPayBusy(true);
    try {
      const isGrant = tranches.length > 1;
      const who = pay.who.trim();
      const slots = isGrant ? 1 : Math.max(1, Math.min(50, Math.round(Number(pay.slots) || 1)));
      const title = `Pay ${who}`.slice(0, 80);
      const milestones = tranches.map((t, i) => {
        const d = t.deliverable.trim().replace(/\.+$/, "");
        const cap = d.charAt(0).toUpperCase() + d.slice(1);
        const evidence =
          t.verify === "page"
            ? { kind: "public_url", expectedText: [t.expectedText.trim()] }
            : t.verify === "onchain"
              ? { kind: "onchain_tx", chainId: 2345, to: t.toAddr.trim() }
              : { kind: "artifact_url", allowedHosts: [], markerKind: "wallet" };
        const proofLine =
          t.verify === "page"
            ? "Submit the public page showing the required text."
            : t.verify === "onchain"
              ? "Submit the transaction hash, sent from your own submitting wallet."
              : "Submit the public link to what you made — it must visibly carry your own wallet address.";
        return {
          title: (cap.length >= 4 ? cap : `Milestone ${i + 1}`).slice(0, 80),
          instructions: `You are paid when ${d}. ${proofLine}`,
          ...(splitting ? {} : isLocal ? { rewardLocal: Number(t.amount) } : {}),
          criteria: [
            cap,
            t.verify === "link"
              ? "The page carries the submitting wallet address"
              : t.verify === "page"
                ? `The page contains: "${t.expectedText.trim()}"`
                : "The transaction was sent by the submitting wallet",
          ],
          evidence,
          slots,
          ...(splitting || isLocal ? {} : { rewardUsd: Number(t.amount) }),
        };
      });
      const body = {
        kind: isGrant ? "grant" : "gig",
        title: title.length >= 4 ? title : "Pay for work",
        milestones,
        ...(isLocal ? { currency } : {}),
        ...(splitting
          ? isLocal
            ? { splitTotalLocal: Number(splitTotal) }
            : { splitTotalUsd: Number(splitTotal) }
          : {}),
      };
      const res = await fetch("/api/campaigns/direct", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; planUrl?: string };
      if (res.status === 401) {
        setShowSignIn(true);
        setPayErr("Sign in with your wallet to create this — then press Continue again.");
        return;
      }
      if (!res.ok || !data.ok || !data.planUrl) {
        throw new Error(data.error ?? "The plan could not be compiled.");
      }
      router.push(data.planUrl.replace(/^https?:\/\/[^/]+/, ""));
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPayBusy(false);
    }
  };

  const submit = async () => {
    if (describesWork()) return handOffToAgent();
    if (!stepValid()) return;
    // A founder signed in on EITHER chain may start an inspection. Before this the check was
    // `siwe.authed`, which is specifically "an EVM session matching the connected EVM wallet" —
    // so a founder holding only a Starknet wallet could never get past this line, for a campaign
    // that would settle entirely on Starknet.
    if (!founder.authed) {
      setError(null);
      setShowSignIn(true);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          requestId,
          // The EMAIL alone is enough: an email-code product has no password, and Sage reads the
          // sign-in code from its own mailbox. Requiring both would have silently dropped exactly
          // the credential this feature exists for. The server seals it before anything else.
          testAccount: form.testEmail.trim()
            ? { email: form.testEmail.trim(), password: form.testPassword }
            : null,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }
      rememberInspection(data.job.id, form.productUrl);
      router.push(`/launch/${data.job.id}`);
    } catch {
      setError("Could not reach Sage. Please try again.");
      setSubmitting(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if ((e.target as HTMLElement).tagName === "TEXTAREA" && !e.metaKey) return;
    e.preventDefault();
    if (mode === "pay" && step === 0) {
      if (payValid()) void submitPay();
      return;
    }
    if (step < STEPS.length - 1) next();
    else void submit();
  };

  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="lxo" onKeyDown={onKeyDown}>
      <div className="lxo-progress" aria-hidden>
        {mode === "test" &&
          STEPS.map((_, i) => (
            <span key={i} className={`lxo-pip${i === step ? " on" : ""}${i < step ? " done" : ""}`} />
          ))}
      </div>

      {/* key remounts the panel so the entrance animation replays on each step AND door switch */}
      <div className="lxo-step" key={`${step}-${mode}`}>
        <h2 className="lxo-q">{s.q}</h2>

        {/* THE TWO DOORS (move 5). The paths are STRUCTURE, not prose: two tappable answers to the
            one question. Picking one reframes the card — the explainer paragraph this replaced was
            deleted, not moved. */}
        {step === 0 && (
          <div className="lxo-modes" role="tablist" aria-label="What kind of work">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "test"}
              className={`lxo-mode${mode === "test" ? " on" : ""}`}
              onClick={() => setMode("test")}
            >
              <ScanSearch size={17} aria-hidden />
              <span className="lxo-mode-t">Test my product</span>
              <span className="lxo-mode-c">Sage opens it, designs paid missions, verifies every report.</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "pay"}
              className={`lxo-mode${mode === "pay" ? " on" : ""}`}
              onClick={() => setMode("pay")}
            >
              <HandCoins size={17} aria-hidden />
              <span className="lxo-mode-t">Pay for work</span>
              <span className="lxo-mode-c">A gig, a bounty, a milestone grant — verified, then paid.</span>
            </button>
          </div>
        )}

        {step === 0 && mode === "test" && (
          <>
            <input
              autoFocus
              className="lx-input lxo-input"
              type="text"
              placeholder="https://yourproduct.com"
              value={form.productUrl}
              onChange={(e) => set("productUrl", e.target.value)}
            />
            {describesWork() && (
              <p className="lxo-handoff">
                That&rsquo;s work you&rsquo;re defining, not a product to test — Sage will set it up with you in chat.
              </p>
            )}
            {/* ONE TAP INSTEAD OF ONE PARAGRAPH. Each chip writes a proven goal shape — the same
                wording that produced good mission plans in real campaigns — so the founder who
                cannot be bothered to write still hands Sage a sharp goal, and the founder who can
                write gets a head start to edit. "Let Sage decide" is a first-class choice, not a
                fallback: it clears the goal, and the pipeline treats that as full delegation. */}
            {showGoal || form.goal ? (
              <>
                <div className="lxo-chips" role="group" aria-label="Quick goals">
                  {GOAL_CHIPS.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      className={`lxo-chip${form.goal === c.goal ? " on" : ""}`}
                      onClick={() => set("goal", c.goal)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <textarea
                  className="lx-textarea"
                  style={{ marginTop: 10 }}
                  placeholder="Pick a chip, write your own, or leave empty and Sage decides what to test from what it sees."
                  value={form.goal}
                  onChange={(e) => set("goal", e.target.value)}
                />
              </>
            ) : (
              <button type="button" className="lx-edit-link lxo-addrepo" onClick={() => setShowGoal(true)}>
                <Plus size={14} /> Steer what gets tested <span className="muted">— optional, Sage decides from what it sees</span>
              </button>
            )}
            {showRepo ? (
              <input
                className="lx-input"
                style={{ marginTop: 10 }}
                type="url"
                placeholder="Public GitHub repo"
                value={form.repoUrl}
                onChange={(e) => set("repoUrl", e.target.value)}
              />
            ) : (
              <button type="button" className="lx-edit-link lxo-addrepo" onClick={() => setShowRepo(true)}>
                <Plus size={14} /> Add a GitHub repo <span className="muted">— optional</span>
              </button>
            )}
            {/* THE TEST ACCOUNT. Sage can only design and auto-verify work it can actually reach, so on
                a product whose value sits behind a login this is the difference between missions about
                the homepage and missions about the real thing. Encrypted at rest, used only to sign in
                during the inspection, and anything secret it sees is stripped before anyone reads it. */}
            {showAuth ? (
              <div style={{ marginTop: 10 }}>
                <input
                  className="lx-input"
                  type="email"
                  autoComplete="off"
                  placeholder="Test account email"
                  value={form.testEmail}
                  onChange={(e) => set("testEmail", e.target.value)}
                />
                <input
                  className="lx-input"
                  style={{ marginTop: 8 }}
                  type="password"
                  autoComplete="new-password"
                  placeholder="Test account password — leave empty for email-code logins"
                  value={form.testPassword}
                  onChange={(e) => set("testPassword", e.target.value)}
                />
                <p className="muted" style={{ fontSize: 12, lineHeight: 1.55, marginTop: 8 }}>
                  <b style={{ color: "var(--lx-ink)" }}>If your product uses a password:</b> put the
                  test account&apos;s email and password above.
                  <br />
                  <b style={{ color: "var(--lx-ink)" }}>
                    If it emails a sign-in code instead (no password):
                  </b>{" "}
                  create the test account using{" "}
                  <span className="mono">{SAGE_TESTER_EMAIL}</span>, enter that address above, and
                  leave the password empty — Sage reads the code from its own inbox.
                </p>
                <p className="muted" style={{ fontSize: 12, lineHeight: 1.55, marginTop: 6 }}>
                  Always a throwaway TEST account, never a real one. Sage signs in only during this
                  inspection, credentials are stored encrypted and never shown again, and any keys or
                  emails it sees are stripped before they reach a mission or a tester.
                </p>
              </div>
            ) : (
              <button type="button" className="lx-edit-link lxo-addrepo" onClick={() => setShowAuth(true)}>
                <Plus size={14} /> Add a test login <span className="muted">— optional, unlocks work behind your login</span>
              </button>
            )}
          </>
        )}

        {/* PAY FOR WORK — a sentence you finish, not a form (and never a paragraph to derive).
            The tokens compose the exact structured ask the agent needs; the examples fill the
            sentence in one tap. Continue hands the founder's finished sentence to Sage in chat. */}
        {/* PAY FOR WORK — sentences you finish, never a form to derive. One line is a gig; add a
            line and it is a milestone grant; type ONE total and watch Sage split it live. The rows
            compile DIRECTLY into the deterministic campaign compiler — no chat, no model. */}
        {step === 0 && mode === "pay" && (
          <div className="lxs">
            <div className="lxs-line">
              <span className="lxs-word">Pay</span>
              <input
                autoFocus
                className="lxs-token lxs-who"
                type="text"
                placeholder="my designer"
                value={pay.who}
                onChange={(e) => setP("who", e.target.value)}
                aria-label="Who gets paid"
              />
              <span className="lxs-word">in</span>
              <select
                className="lxs-token lxs-sel lxs-cur"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                aria-label="The currency you are pricing in"
              >
                {/* Caribbean receivers first — the denominations this exists for — then senders. */}
                {CURRENCIES.filter((c) => c.code === "USD" || c.region === "caribbean").map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.symbol} {c.code}
                  </option>
                ))}
                {CURRENCIES.filter((c) => c.region === "sender").map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.symbol} {c.code}
                  </option>
                ))}
              </select>
              {tranches.length === 1 && (
                <>
                  <span className="lxs-word">·</span>
                  <select
                    className="lxs-token lxs-sel"
                    value={pay.slots}
                    onChange={(e) => setP("slots", e.target.value)}
                    aria-label="How many people can earn it"
                  >
                    {["1", "2", "3", "5", "10"].map((c) => (
                      <option key={c} value={c}>
                        {c === "1" ? "1 person" : `${c} people`}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>

            {tranches.map((t, i) => (
              <div className="lxs-tranche" key={i}>
                <div className="lxs-line">
                  {tranches.length > 1 && <span className="lxs-n mono">{String(i + 1).padStart(2, "0")}</span>}
                  <span className="lxs-word">{curSymbol}</span>
                  {splitting ? (
                    <span className="lxs-token lxs-amt lxs-split-preview mono" aria-label="Computed share">
                      {splitPreview()[i]}
                    </span>
                  ) : (
                    <input
                      className="lxs-token lxs-amt"
                      type="number"
                      min="0.5"
                      step="0.5"
                      placeholder={tranches.length > 1 ? "20" : "50"}
                      value={t.amount}
                      onChange={(e) => setT(i, "amount", e.target.value)}
                      aria-label={`Amount for milestone ${i + 1}`}
                    />
                  )}
                  <span className="lxs-word">when</span>
                  <input
                    className="lxs-token lxs-when"
                    type="text"
                    placeholder={i === 0 ? "the new logo page is live" : "the next milestone is true"}
                    value={t.deliverable}
                    onChange={(e) => setT(i, "deliverable", e.target.value)}
                    aria-label={`What must be true for milestone ${i + 1}`}
                  />
                  {tranches.length > 1 && (
                    <button
                      type="button"
                      className="lxs-x"
                      aria-label={`Remove milestone ${i + 1}`}
                      onClick={() => setTranches((ts) => ts.filter((_, j) => j !== i))}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                <div className="lxs-line lxs-sub">
                  <span className="lxs-word">Sage verifies</span>
                  <select
                    className="lxs-token lxs-sel"
                    value={t.verify}
                    onChange={(e) => setT(i, "verify", e.target.value)}
                    aria-label={`How Sage verifies milestone ${i + 1}`}
                  >
                    {VERIFY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {t.verify === "page" && (
                    <>
                      <span className="lxs-word">showing</span>
                      <input
                        className="lxs-token lxs-when"
                        type="text"
                        placeholder="the exact text that must appear"
                        value={t.expectedText}
                        onChange={(e) => setT(i, "expectedText", e.target.value)}
                        aria-label="Required text on the page"
                      />
                    </>
                  )}
                  {t.verify === "onchain" && (
                    <>
                      <span className="lxs-word">to</span>
                      <input
                        className="lxs-token lxs-when mono"
                        type="text"
                        placeholder="0x… contract or recipient"
                        value={t.toAddr}
                        onChange={(e) => setT(i, "toAddr", e.target.value)}
                        aria-label="The address the transaction must go to"
                      />
                    </>
                  )}
                </div>
              </div>
            ))}

            <div className="lxs-line lxs-actions">
              <button
                type="button"
                className="lx-edit-link"
                onClick={() => setTranches((ts) => [...ts, blankTranche(ts[ts.length - 1]?.verify)])}
              >
                <Plus size={14} /> Add a milestone
                {tranches.length === 1 && <span className="muted"> — turns this into a grant, released tranche by tranche</span>}
              </button>
              {tranches.length > 1 && (
                <label className="lxs-splitlab">
                  <span className="lxs-word">or split one total:</span>
                  <span className="lxs-word">{curSymbol}</span>
                  <input
                    className="lxs-token lxs-amt"
                    type="number"
                    min="1"
                    step="0.5"
                    placeholder="40"
                    value={splitTotal}
                    onChange={(e) => setSplitTotal(e.target.value)}
                    aria-label="One total, split equally by Sage"
                  />
                  <span className="muted">Sage divides it exactly — you compute nothing</span>
                </label>
              )}
            </div>

            {isLocal && (
              <p className="lxs-fx muted">
                You price in {curSymbol} {currency}; recipients are paid in USDC, converted once at
                a stamped, source-attributed rate when you fund — Sage never does exchange
                arithmetic on your behalf mid-flight.
              </p>
            )}
            <div className="lxo-chips lxs-ex" role="group" aria-label="Start from an example">
              {PAY_EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  className="lxo-chip"
                  onClick={() => {
                    setPay({ who: ex.who, slots: ex.slots });
                    setTranches(ex.tranches.map((t) => ({ ...blankTranche(), ...t })));
                    setSplitTotal(ex.splitTotal ?? "");
                    setCurrency(ex.currency ?? "USD");
                    setPayErr(null);
                  }}
                >
                  {ex.label}
                </button>
              ))}
            </div>
            {payErr && (
              <p className="lxs-err" role="alert">
                {payErr}
              </p>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="lxo-budget">
            <input
              autoFocus
              className="lxo-budget-input"
              type="number"
              min="0.5"
              step="0.5"
              value={form.budgetUsd}
              onChange={(e) => set("budgetUsd", e.target.value)}
              aria-label="Testing budget"
            />
            <span className="lxo-budget-unit">USDC</span>
          </div>
        )}

        <div className="lxo-hint">{step === 0 ? MODE_HINT[mode] : s.hint}</div>
        {!founder.authed && last && !showSignIn && (
          <p className="lxo-hint" style={{ marginTop: 6, opacity: 0.85 }}>
            You&apos;ll sign a free message to start — no gas, no transaction, nothing spent. It just
            ties this inspection to you so your plan and any feedback stay yours.
          </p>
        )}
        {showSignIn && !founder.authed && (
          <div style={{ marginTop: 14 }}>
            <FounderSignIn
              explainer={
                <>
                  Sign in with any wallet you already have — <b>Ethereum or Starknet.</b> This just
                  ties the inspection to you; nothing is funded here.
                </>
              }
              onSignedIn={() => {
                setShowSignIn(false);
                void founder.refresh();
              }}
            />
          </div>
        )}
      </div>

      {error && (
        <div className="lx-err" role="alert">
          {error}
        </div>
      )}

      <div className="lxo-nav">
        {step > 0 ? (
          <button type="button" className="lx-btn ghost" onClick={back}>
            Back
          </button>
        ) : (
          <span className="lxo-step-count">
            {mode === "test" ? `Step ${step + 1} of ${STEPS.length}` : "One step — the plan compiles when you continue"}
          </span>
        )}
        {mode === "pay" && step === 0 ? (
          <button
            type="button"
            className="lx-btn"
            onClick={() => void submitPay()}
            disabled={!payValid() || payBusy}
          >
            {payBusy ? "Compiling the plan…" : tranches.length > 1 ? "Create the grant" : "Create the gig"}
            <span aria-hidden>→</span>
          </button>
        ) : last ? (
          <button type="button" className="lx-btn" onClick={submit} disabled={submitting || !stepValid() || siwe.connecting || siwe.signingIn}>
            {submitting
              ? "Starting…"
              : siwe.connecting || siwe.signingIn
                ? "Connecting…"
                : founder.authed
                  ? "Let Sage inspect"
                  : "Connect wallet & inspect"}
            <span aria-hidden>→</span>
          </button>
        ) : (
          <button type="button" className="lx-btn" onClick={next} disabled={!stepValid()}>
            Continue
            <span aria-hidden>→</span>
          </button>
        )}
      </div>
    </div>
  );
}
