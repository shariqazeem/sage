"use client";
import { chainConfig, DEFAULT_EVM_LAUNCH_CHAIN, isPausedNetwork, PRIMARY_NETWORKS, SECONDARY_NETWORKS } from "@/lib/deputy/networks";

/** Networks a worker's transaction can be checked on: real-money EVM networks, primary first. */
const TX_CHAINS: readonly number[] = [...PRIMARY_NETWORKS, ...SECONDARY_NETWORKS].filter((id) => chainConfig(id).evm && chainConfig(id).isMainnet);

import { prefillSlots } from "@/lib/launch/direct-fallback";
import { prefillMoneyFromWords } from "@/lib/launch/prefill-money";
import { missionTitleFrom } from "@/lib/launch/mission-title";
import { blankTranche, composeDirectBody, composerTotal, type Tranche } from "@/lib/launch/composer";
import { firstUrl, labelFor, looksLikeProductHome, wordsOnly } from "@/lib/launch/hand-over-text";
import { AmountChips, JobCard } from "./job-card";
import { launchReadiness, nativeAmount, type AccountRead } from "@/lib/treasury/launch-readiness";
import { UpgradeLink } from "@/components/plans/upgrade-link";
import type { PlanId } from "@/lib/plans/catalog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CURRENCIES } from "@/lib/money/currency";
import { X, HandCoins, Plus, ScanSearch, Sparkles, ArrowUpRight, Check, Loader2 } from "lucide-react";
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

/** What the drafter says about a link it was handed: opened and read, or why not. */
type HandedSource = { url: string; label: string; read: boolean; reason: string | null };

/** A drafted milestone, as the draft route returns it. */
type DraftMilestone = {
  title: string;
  deliverable: string;
  instructions: string;
  criteria: string[];
  evidence:
    | { kind: "artifact_url"; allowedHosts: string[]; minWords?: number; mustContain?: string[] }
    | { kind: "public_url"; expectedText: string[] }
    | { kind: "onchain_tx"; chainId?: number; to?: string };
  effortMinutes?: number;
};
type Draft = { kind: "grant" | "gig"; title: string; who: string; slots: number; whyItMatters?: string; milestones: DraftMilestone[] };

/** The composer's slot select offers fixed counts; a drafted count snaps to the nearest one it offers. */
const SLOT_OPTIONS = ["1", "2", "3", "5", "10"];
/**
 * THE FOUNDER'S HEADCOUNT IS NEVER ROUNDED. "8 people" once snapped to the nearest preset (10) and the
 * bounty silently grew by a quarter — the same invented-number defect the direct door's stated-terms
 * check refuses. The number in the sentence wins; the model's guess is clamped, never snapped; and the
 * chooser always offers the number that is set, whether or not it is a preset.
 */
const clampSlots = (n: number): string => String(Math.min(50, Math.max(1, Math.round(Number.isFinite(n) ? n : 1))));
const slotChoices = (current: string): string[] => (SLOT_OPTIONS.includes(current) ? SLOT_OPTIONS : [...SLOT_OPTIONS, current].sort((a, b) => Number(a) - Number(b)));

/** The one-line trust hint under each door — everything longer was deleted, not moved. */
const MODE_HINT = {
  test: "Sage only reads your product: it looks at it in a real browser, writes paid tasks from what it sees and shows you the plan. Nothing moves until you launch it, and every payout gets a public receipt.",
  pay: "Sage reads what you hand it and writes the job. You set the money, and no model ever sets an amount. Launching funds it from your account, and work that fails Sage's checks is never paid.",
} as const;

/**
 * Post, one screen per door (28 Oct 2026). Test my product takes the product's address and a budget on
 * one step, then creates (or reuses) a DURABLE inspection job and navigates to /launch/[inspectionId];
 * the id lives in the URL so refresh / back-forward / reopen all resume the same state. Pay for work
 * takes what the founder hands over and returns the job as one card.
 */
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
    const q = new URLSearchParams(window.location.search);
    if (q.get("do") === "pay") setMode("pay");
    // PAY ONE PERSON, VERIFIED: /launch?do=pay&invite=1&one=1 opens the composer preset for a
    // single named recipient behind an invite-only door — a supplier, a contractor, a grantee.
    if (q.get("invite") === "1") setInviteOnly(true);
    if (q.get("one") === "1") setP("slots", "1");
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
  // SAGE FOR TEAMS — off the public board; the campaign's own door is what the founder shares.
  const [inviteOnly, setInviteOnly] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);
  // THE GIG BRAIN: one sentence in, a complete brief out — Sage drafts the words, the founder keeps the money.
  const [draftText, setDraftText] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<string[]>([]);
  const [draftWhy, setDraftWhy] = useState("");
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
  const [showOptions, setShowOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // What Post starts from: the product Sage last tested for this founder (a test starts there, and a job
  // is drafted against it), and whether the workspace can admit invited people yet.
  const [product, setProduct] = useState<{ name: string | null; url: string | null }>({ name: null, url: null });
  const [canInvite, setCanInvite] = useState<boolean | null>(null);
  useEffect(() => {
    if (!founder.authed) return;
    let live = true;
    void (async () => {
      try {
        const r = await fetch("/api/launch/starters", { cache: "no-store" });
        const j = (await r.json()) as { product?: { name: string | null; url: string | null } | null; canInvite?: boolean };
        if (!live || !j.product) return;
        setProduct(j.product);
        setCanInvite(j.canInvite ?? null);
        const url = j.product.url;
        // testing again starts where the last test did; a URL already typed is never replaced
        if (url) setForm((f) => (f.productUrl.trim() ? f : { ...f, productUrl: url }));
      } catch {
        /* the jobs read "your product" */
      }
    })();
    return () => {
      live = false;
    };
  }, [founder.authed]);

  /**
   * ONE BUTTON (28 Oct 2026). "Create the gig" used to lead to a plan page, where a second button
   * launched it. The account is read here once, so the composer's own button can launch the job from
   * it, and say before the click what launching still needs. Readiness comes from the same helper the
   * plan page's door uses.
   */
  type ComposerAccount = AccountRead & { linked?: boolean; chainId?: number; nativeSymbol?: string; launchFloorWei?: string; canSwap?: boolean; gasWei?: string | null };
  const [account, setAccount] = useState<{ state: "loading" | "none" } | { state: "open"; read: ComposerAccount }>({ state: "loading" });
  const [accountReads, setAccountReads] = useState(0);
  useEffect(() => {
    if (mode !== "pay" || !founder.authed) return;
    let live = true;
    void (async () => {
      try {
        const r = await fetch("/api/treasury", { cache: "no-store" });
        const j = (await r.json()) as ComposerAccount;
        if (!live) return;
        setAccount(r.ok && j.linked && !(j.chainId != null && isPausedNetwork(j.chainId)) ? { state: "open", read: j } : { state: "none" });
      } catch {
        if (live) setAccount({ state: "none" });
      }
    })();
    return () => {
      live = false;
    };
  }, [mode, founder.authed, accountReads]);
  const [payPhase, setPayPhase] = useState<"plan" | "launch">("plan");
  const [launchedJob, setLaunchedJob] = useState<{ campaignId: string; url: string } | null>(null);
  const [planLink, setPlanLink] = useState<string | null>(null);
  // undefined: no plan refusal; null: no plan would help; a plan: the one that lifts it
  const [upgrade, setUpgrade] = useState<PlanId | null | undefined>(undefined);
  // the hand-over: what Sage opened and how long the job took to write, the card's title, the full form
  const [handed, setHanded] = useState<{ source: HandedSource | null; seconds: number | null } | null>(null);
  const [jobTitle, setJobTitle] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [productChoice, setProductChoice] = useState(false);
  // A LIVE CLOCK ON THE WORK, not a fake progress bar: the one thing genuinely happening is time passing.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!draftBusy) return;
    const t0 = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
  }, [draftBusy]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setP = (k: keyof PayDraft, v: string) => setPay((p) => ({ ...p, [k]: v }));

  const stepValid = (): boolean =>
    // The goal is OPTIONAL — measured founder behavior: a paragraph-sized "what do you want to
    // learn?" is where people stall or close the tab. An empty goal is a delegation, not a gap:
    // the pipeline forces full exploration and Sage infers the first-visit goal from what it sees.
    isHttpUrl(form.productUrl) && Number(form.budgetUsd) >= 0.5;

  /**
   * ONE FRONT DOOR (move 5). A URL is product testing — the path that won the bootcamp. Anything else
   * typed there is work they are defining (a grant, a gig, a deliverable), and it is handed to Sage
   * under Pay for work, the same words in the hand-over box, rather than sent away to a chat.
   */
  const describesWork = (): boolean => {
    const t = form.productUrl.trim();
    return t.length >= 12 && !isHttpUrl(t) && /\s/.test(t);
  };

  const moveToPay = () => {
    setDraftText([form.productUrl.trim(), form.goal.trim()].filter(Boolean).join(". "));
    set("productUrl", "");
    setMode("pay");
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

  /** Why the button waits, in words: the first thing payValid is missing, so a grey button is never a riddle. */
  const missing = (): string | null => {
    if (pay.who.trim().length < 2) return "Say who this is for.";
    for (const [i, t] of tranches.entries()) {
      const which = tranches.length > 1 ? ` for milestone ${i + 1}` : "";
      if (t.deliverable.trim().length < 8) return `Say what must be true${which}.`;
      if (!splitting && !(isLocal ? Number(t.amount) > 0 : Number(t.amount) >= 0.5)) return `Set what it pays${which}.`;
      if (t.verify === "page" && t.expectedText.trim().length < 3) return `Add the text that must appear${which}.`;
      if (t.verify === "onchain" && !/^0x[0-9a-fA-F]{40}$/.test(t.toAddr.trim())) return `Add the contract address the transaction must go to${which}.`;
    }
    if (splitting && !(isLocal ? Number(splitTotal) > 0 : Number(splitTotal) >= 0.5 * tranches.length)) return "Set the total.";
    return null;
  };

  const total = composerTotal({ tranches, slots: pay.slots, splitTotal });
  const readiness = account.state === "open" ? launchReadiness(account.read, total) : null;
  // A job priced in another currency is converted at compile, so its dollar total is known only on the plan page.
  const launchesHere = founder.authed && !isLocal && account.state === "open" && readiness?.ready === true;

  const linkOnly = !!firstUrl(draftText) && !/\s/.test(draftText.trim());
  const busyUrl = draftBusy ? firstUrl(draftText) : null;
  const hasJob = tranches.some((t) => t.deliverable.trim().length > 0);
  const cardTitle = jobTitle.trim() || (tranches[0]?.title ?? "").trim() || (tranches[0]?.deliverable.trim() ? missionTitleFrom(tranches[0].deliverable, 0) : "Your job");

  const launchButton = (
    <button type="button" className="lx-btn" onClick={() => (founder.authed ? void submitPay() : setShowSignIn(true))} disabled={payBusy || (founder.authed && !payValid())}>
      {payBusy
        ? payPhase === "launch"
          ? "Sage is launching it…"
          : "Writing the plan…"
        : !founder.authed
          ? "Sign in to launch"
          : !payValid()
            ? "Launch"
            : launchesHere
              ? `Launch · $${total.toFixed(2)} from your account`
              : tranches.length > 1
                ? "Create the grant"
                : "Create the gig"}
    </button>
  );

  /** After a launch: a clean composer, and the account read again (the job took its budget). */
  const postAnother = () => {
    setLaunchedJob(null);
    setHanded(null);
    setJobTitle("");
    setShowDetails(false);
    setPay({ who: "", slots: "1" });
    setTranches([blankTranche()]);
    setSplitTotal("");
    setCurrency("USD");
    setInviteOnly(false);
    setDraftText("");
    setDraftWhy("");
    setDraftNotes([]);
    setAccount({ state: "loading" });
    setAccountReads((n) => n + 1);
  };

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
   * HAND IT TO SAGE. What the founder pasted goes to the drafter, which opens a link in it and reads it
   * first (handed-over.ts); a front page alone is offered as a product test instead. Each hand-over is
   * a new job: the brief is Sage's, and the money and the headcount are the founder's own words (read
   * without the links, so "issues/42" is never 42 people) or a tap on the card, never the model's.
   */
  const handOver = async (asWork = false) => {
    const text = draftText.trim();
    if (text.length < 10 || draftBusy) return;
    if (!asWork && looksLikeProductHome(text)) {
      setProductChoice(true);
      return;
    }
    setProductChoice(false);
    setDraftErr(null);
    setDraftNotes([]);
    setHanded(null);
    setPayErr(null);
    setPlanLink(null);
    setUpgrade(undefined);
    setLaunchedJob(null);
    setDraftBusy(true);
    const started = Date.now();
    try {
      const context = !firstUrl(text) && product.url?.startsWith("https://") ? { productUrl: product.url } : {};
      const res = await fetch("/api/campaigns/direct/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: text, ...context }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; draft?: Draft; notes?: string[]; source?: HandedSource | null };
      if (res.status === 401) {
        setShowSignIn(true);
        setDraftErr("Sign in with your email or MetaMask, then hand it to Sage again.");
        return;
      }
      if (!res.ok || !data.ok || !data.draft) {
        if (data.source) setHanded({ source: data.source, seconds: null });
        throw new Error(data.error ?? "Sage couldn't set this up.");
      }
      const d = data.draft;
      const words = wordsOnly(text);
      // THE FOUNDER'S WORDS ARE THE MONEY: the currency, the total to split, or the price per person,
      // read from their sentence deterministically — never from the model or the page — and editable.
      const money = prefillMoneyFromWords(words, d.milestones.length);
      setPay({ who: d.who, slots: clampSlots(prefillSlots(words, d.milestones.length)) });
      setCurrency(money.currency ?? "USD");
      setSplitTotal(money.splitTotal != null ? String(money.splitTotal) : "");
      setTranches(
        d.milestones.map((m, i) => ({
          amount: i === 0 && money.perUnit != null ? String(money.perUnit) : "",
          title: m.title,
          deliverable: m.deliverable,
          verify: m.evidence.kind === "public_url" ? "page" : m.evidence.kind === "onchain_tx" ? "onchain" : "link",
          expectedText: m.evidence.kind === "public_url" ? (m.evidence.expectedText[0] ?? "") : "",
          toAddr: m.evidence.kind === "onchain_tx" ? (m.evidence.to ?? "") : "",
          ...(m.evidence.kind === "onchain_tx" && m.evidence.chainId && TX_CHAINS.includes(m.evidence.chainId) ? { txChain: m.evidence.chainId } : {}),
          instructions: m.instructions,
          criteria: m.criteria,
          ...(m.evidence.kind === "artifact_url" && m.evidence.minWords ? { minWords: m.evidence.minWords } : {}),
          ...(m.effortMinutes ? { effortMinutes: m.effortMinutes } : {}),
        })),
      );
      setDraftWhy(d.whyItMatters ?? "");
      setDraftNotes(data.notes ?? []);
      setJobTitle(d.title);
      // work for someone the founder names ("my designer", "our translator") is theirs to invite
      setInviteOnly(/^(my|our)\b/i.test(d.who.trim()));
      setHanded({ source: data.source ?? null, seconds: Math.max(1, Math.round((Date.now() - started) / 1000)) });
    } catch (e) {
      setDraftErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDraftBusy(false);
    }
  };

  /** A product's front page, handed over: the product test starts from it. */
  const tryProduct = () => {
    const url = firstUrl(draftText);
    if (url) setForm((f) => ({ ...f, productUrl: url }));
    setProductChoice(false);
    setMode("test");
  };

  const submitPay = async () => {
    if (!payValid() || payBusy) return;
    setPayErr(null);
    setPlanLink(null);
    setUpgrade(undefined);
    setPayPhase("plan");
    setPayBusy(true);
    try {
      const body = composeDirectBody({ who: pay.who, slots: pay.slots, tranches, splitTotal, currency, inviteOnly, why: draftWhy, title: jobTitle });
      const res = await fetch("/api/campaigns/direct", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; planUrl?: string; jobId?: string };
      if (res.status === 401) {
        setShowSignIn(true);
        setPayErr("Sign in (email or MetaMask) to create this — then press Continue again.");
        return;
      }
      if (!res.ok || !data.ok || !data.planUrl) {
        throw new Error(data.error ?? "The plan could not be compiled.");
      }
      const planPath = data.planUrl.replace(/^https?:\/\/[^/]+/, "");
      if (!launchesHere || !data.jobId || account.state !== "open") {
        router.push(planPath);
        return;
      }
      // the plan is saved and approved; the account deploys, funds and opens its vault
      setPayPhase("launch");
      const lr = await fetch(`/api/launch/${data.jobId}/treasury`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: account.read.chainId }),
      });
      const lj = (await lr.json()) as { campaignId?: string; url?: string; error?: string; reason?: string; upgradeTo?: PlanId | null };
      if (!lr.ok || !lj.campaignId) {
        setPayErr(lj.error ?? "Sage could not launch it from your account.");
        setPlanLink(planPath);
        setUpgrade(lj.reason === "plan_limit" ? lj.upgradeTo ?? null : undefined);
        return;
      }
      setLaunchedJob({ campaignId: lj.campaignId, url: lj.url ?? `/c/${lj.campaignId}` });
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPayBusy(false);
    }
  };

  const submit = async () => {
    if (describesWork()) return moveToPay();
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

  /** Under the card's button: why it waits, what the account still needs, a refusal, or the job, live. */
  const launchNote = (
    <>
      {payErr && (
        <p className="lxs-err" role="alert">
          {payErr}
          {planLink && (
            <>
              {" "}The plan is saved: <Link href={planLink}>launch it from its page</Link>.
            </>
          )}
        </p>
      )}
      {upgrade !== undefined && <UpgradeLink to={upgrade} className="lx-btn" />}
      {launchedJob ? (
        <div className="cmp-live" role="status">
          <p>
            <Sparkles size={15} /> <b>It&apos;s live.</b> Sage created the job&apos;s vault from your account, funded it and opened it. Every payout gets a receipt.
          </p>
          <div className="cmp-live-row">
            <Link className="lx-btn" href={`/campaign/${launchedJob.campaignId}`}>
              Open the job <ArrowUpRight size={14} />
            </Link>
            <a className="lxo-chip" href={launchedJob.url}>the board</a>
            <button type="button" className="lxo-chip" onClick={postAnother}>Post another</button>
          </div>
        </div>
      ) : (
        founder.authed &&
        !payBusy && (
          <p className="cmp-wait">
            {!payValid()
              ? missing()
              : isLocal
                ? "Priced in another currency: Sage converts it when the plan is created, then you launch it from the plan's page."
                : account.state === "none"
                  ? "Your account isn't open yet. Create the plan, then open your account and launch it from the plan's page."
                  : account.state === "open" && readiness && !readiness.ready
                    ? readiness.short
                      ? `Your account holds $${(account.read.balanceUsd ?? 0).toFixed(2)}. Add $${readiness.addUsd.toFixed(2)} to launch this, or create the plan now and launch it later.`
                      : readiness.overCap
                        ? `Your account puts at most $${(account.read.perCampaignCapUsd ?? 0).toFixed(2)} into one job. Raise that limit to launch this one.`
                        : `Launching needs about ${nativeAmount(account.read.launchFloorWei)} ${account.read.nativeSymbol ?? "METIS"} for network fees, paid from your account.`
                    : null}
            {account.state === "open" && readiness && !readiness.ready && payValid() && !isLocal && (
              <span className="cmp-wait-fix">
                {(readiness.short || readiness.needsFee) && (
                  <a className="lxo-chip" href="/workspace/account?do=add" target="_blank" rel="noopener noreferrer">Add money</a>
                )}
                {readiness.needsFee && account.read.canSwap && !!account.read.gasWei && BigInt(account.read.gasWei) > BigInt(0) && (
                  <a className="lxo-chip" href="/workspace/account?do=swap" target="_blank" rel="noopener noreferrer">Swap USDC to {account.read.nativeSymbol ?? "METIS"}</a>
                )}
                {readiness.overCap && (
                  <a className="lxo-chip" href="/workspace/account" target="_blank" rel="noopener noreferrer">Change the limit</a>
                )}
              </span>
            )}
          </p>
        )
      )}
    </>
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if ((e.target as HTMLElement).tagName === "TEXTAREA" && !e.metaKey) return;
    e.preventDefault();
    if (mode === "pay") {
      if (!hasJob) void handOver();
      return;
    }
    void submit();
  };


  return (
    <div className="lxo" onKeyDown={onKeyDown}>
      {/* key remounts the panel so the entrance animation replays on each step AND door switch */}
      <div className="lxo-step" key={mode}>
        <h2 className="lxo-q">What do you want done?</h2>

        {/* THE TWO DOORS (move 5). The paths are STRUCTURE, not prose: two tappable answers to the
            one question. Picking one reframes the card — the explainer paragraph this replaced was
            deleted, not moved. */}
        {(
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

        {mode === "test" && (
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
                That&rsquo;s work you want done, not a product to test. <button type="button" className="lx-edit-link" onClick={moveToPay}>Hand it to Sage under Pay for work</button>
              </p>
            )}
            {/* ONE TAP INSTEAD OF ONE PARAGRAPH. Each chip writes a proven goal shape — the same
                wording that produced good mission plans in real campaigns — so the founder who
                cannot be bothered to write still hands Sage a sharp goal, and the founder who can
                write gets a head start to edit. "Let Sage decide" is a first-class choice, not a
                fallback: it clears the goal, and the pipeline treats that as full delegation. */}
            {/* ONE DISCLOSURE, NOT THREE. The three optional inputs (steer, repo, test login) sat as
                three separate "+" links under the URL — a row of small decisions before the one
                that matters. They open together behind one line; anything already filled keeps
                them open. */}
            {showOptions || showGoal || showRepo || showAuth || form.goal || form.repoUrl || form.testEmail ? (
              <>
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
            ) : (
              <button type="button" className="lx-edit-link lxo-addrepo" onClick={() => setShowOptions(true)}>
                <Plus size={14} /> Options <span className="muted">— steer what gets tested, add a GitHub repo, add a test login</span>
              </button>
            )}
            {/* THE BUDGET, ON THE SAME STEP (28 Oct 2026): a second screen for one number was a step for nothing. */}
            <div className="ho-budget" role="group" aria-label="Testing budget">
              <span className="jc-k">Budget</span>
              <AmountChips values={[5, 10, 20, 50]} value={form.budgetUsd} symbol="$" onChange={(v) => set("budgetUsd", v)} label="Testing budget" />
            </div>
          </>
        )}

        {/* PAY FOR WORK — a sentence you finish, not a form (and never a paragraph to derive).
            The tokens compose the exact structured ask the agent needs; the examples fill the
            sentence in one tap. Continue hands the founder's finished sentence to Sage in chat. */}
        {/* PAY FOR WORK — sentences you finish, never a form to derive. One line is a gig; add a
            line and it is a milestone grant; type ONE total and watch Sage split it live. The rows
            compile DIRECTLY into the deterministic campaign compiler — no chat, no model. */}
        {mode === "pay" && (
          <div className="cmp">
            {/* HAND IT TO SAGE (28 Oct 2026). The founder: "pay for work looks so packed", and of chat
                boxes, "simple type to agent got too common that no one uses". The work is usually
                written down already, so the founder hands it over: a link Sage opens and reads
                itself, or the message they'd send someone. Sage writes the job, and what comes back
                is one card whose two decisions (what it pays, who can do it) are taps. The full form
                stays behind "Change the details" for the job that needs it. */}
            <div className="ho">
              <label className="ho-k" htmlFor="ho-in">Paste a link, or the message you&apos;d send someone</label>
              <textarea
                id="ho-in"
                className={`ho-in${linkOnly ? " mono" : ""}`}
                rows={2}
                placeholder="https://github.com/you/app/issues/42, or: Pay my designer $50 when the new landing page is live"
                value={draftText}
                onChange={(e) => {
                  setDraftText(e.target.value);
                  setProductChoice(false);
                }}
                disabled={draftBusy}
              />
              <div className="ho-foot">
                <span className="ho-hint">An issue, a doc, a page, or a few words</span>
                <button type="button" className="lx-btn" onClick={() => void handOver()} disabled={draftBusy || draftText.trim().length < 10}>
                  {draftBusy ? "Sage is on it…" : "Hand it to Sage"}
                </button>
              </div>
            </div>

            {productChoice && (
              <div className="ho-choice" role="group" aria-label="What this link is for">
                <span>That looks like a product. Do you want people to try it?</span>
                <span className="ho-choice-do">
                  <button type="button" className="lx-btn" onClick={tryProduct}>Have people try it</button>
                  <button type="button" className="lxo-chip" onClick={() => void handOver(true)}>No, it&apos;s work I want done</button>
                </span>
              </div>
            )}

            {(draftBusy || handed) && (
              <ul className="ho-steps" aria-live="polite">
                {draftBusy ? (
                  <li className="ho-step">
                    <Loader2 size={14} className="sage-spin2" aria-hidden />
                    <span>{busyUrl ? `Reading ${labelFor(busyUrl)} and writing the job` : "Writing the job and what it checks"}</span>
                    <span className="mono ho-time">· {elapsed}s</span>
                  </li>
                ) : (
                  handed && (
                    <>
                      {handed.source &&
                        (handed.source.read ? (
                          <li className="ho-step done">
                            <Check size={14} aria-hidden /> <span>Opened {handed.source.label}</span>
                          </li>
                        ) : (
                          <li className="ho-step miss">
                            <X size={14} aria-hidden /> <span>Couldn&apos;t open {handed.source.label}: {handed.source.reason}.</span>
                          </li>
                        ))}
                      {handed.seconds !== null && (
                        <li className="ho-step done">
                          <Check size={14} aria-hidden /> <span>Wrote the job and what it checks</span>
                          <span className="mono ho-time">· {handed.seconds}s</span>
                        </li>
                      )}
                    </>
                  )
                )}
              </ul>
            )}
            {draftErr && (
              <p className="cmp-err ho-err">
                {draftErr}
                {!draftBusy && draftText.trim().length >= 10 && (
                  <button type="button" className="lxo-chip" onClick={() => void handOver(true)}>
                    Try again
                  </button>
                )}
              </p>
            )}
            {draftNotes.map((n, i) => (
              <p className="muted cmp-draft-note" key={i}>{n}</p>
            ))}

            {hasJob ? (
              <JobCard
                title={cardTitle}
                from={handed?.source?.read ? handed.source.label : null}
                slots={pay.slots}
                tranches={tranches}
                splitTotal={splitTotal}
                shares={splitPreview()}
                currencySymbol={curSymbol}
                isLocal={isLocal}
                inviteOnly={inviteOnly}
                canInvite={canInvite}
                chainName={(id) => chainConfig(id ?? DEFAULT_EVM_LAUNCH_CHAIN).name}
                onChange={(patch) => {
                  if (patch.slots !== undefined) setP("slots", patch.slots);
                  if (patch.tranches) setTranches(patch.tranches);
                  if (patch.splitTotal !== undefined) setSplitTotal(patch.splitTotal);
                  if (patch.inviteOnly !== undefined) setInviteOnly(patch.inviteOnly);
                }}
                onDetails={() => setShowDetails((v) => !v)}
                detailsOpen={showDetails}
                action={launchedJob ? null : launchButton}
                note={launchNote}
              />
            ) : (
              !draftBusy &&
              !showDetails && (
                <button type="button" className="ho-manual" onClick={() => setShowDetails(true)}>
                  Or fill it in yourself
                </button>
              )
            )}

            {showDetails && (
              <div className="cmp-details">
                <div className="cmp-card">
                  <div className="cmp-card-h">
                    <span className="cmp-k mono">{tranches.length > 1 ? "Milestone grant" : Number(pay.slots) > 1 ? "Open bounty" : "Gig"}</span>
                    <div className="cmp-types" role="group" aria-label="Kind of work">
                      <button type="button" className={`cmp-type${tranches.length === 1 && Number(pay.slots) <= 1 ? " on" : ""}`} onClick={() => { setTranches((ts) => [ts[0] ?? blankTranche()]); setP("slots", "1"); setSplitTotal(""); }}>Gig</button>
                      <button type="button" className={`cmp-type${tranches.length === 1 && Number(pay.slots) > 1 ? " on" : ""}`} onClick={() => { setTranches((ts) => [ts[0] ?? blankTranche()]); setP("slots", "3"); setSplitTotal(""); }}>Bounty</button>
                      <button type="button" className={`cmp-type${tranches.length > 1 ? " on" : ""}`} onClick={() => { setTranches((ts) => (ts.length > 1 ? ts : [...ts, blankTranche(ts[0]?.verify)])); setP("slots", "1"); }}>Milestone grant</button>
                    </div>
                  </div>
                  <div className="cmp-row">
                    <label className="cmp-field cmp-grow">
                      <span className="cmp-label">Who is this for</span>
                      <input className="lx-input cmp-input" type="text" placeholder="my designer · a translator · anyone" value={pay.who} onChange={(e) => setP("who", e.target.value)} />
                    </label>
                    <label className="cmp-field">
                      <span className="cmp-label">Priced in</span>
                      <select className="lx-input cmp-input cmp-sel" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="The currency you are pricing in">
                        {CURRENCIES.filter((c) => c.code === "USD" || c.region === "caribbean").map((c) => (
                          <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
                        ))}
                        {CURRENCIES.filter((c) => c.region === "sender").map((c) => (
                          <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
                        ))}
                      </select>
                    </label>
                    {tranches.length === 1 && (
                      <label className="cmp-field">
                        <span className="cmp-label">How many can earn it</span>
                        <select className="lx-input cmp-input cmp-sel" value={pay.slots} onChange={(e) => setP("slots", e.target.value)}>
                          {slotChoices(pay.slots).map((c) => (
                            <option key={c} value={c}>{c === "1" ? "1 person" : `${c} people`}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <label className="cmp-invite">
                    <input type="checkbox" checked={inviteOnly} onChange={(e) => setInviteOnly(e.target.checked)} />
                    <span><b>Only people I invite.</b> <span className="muted">Off the public marketplace — you get a link to share with your team, contractors or grantees.</span></span>
                  </label>
                </div>

                {tranches.map((t, i) => (
                  <div className="cmp-card cmp-tranche" key={i}>
                    <div className="cmp-card-h">
                      <span className="cmp-k mono">{tranches.length > 1 ? `Milestone ${String(i + 1).padStart(2, "0")}` : "The work"}</span>
                      {tranches.length > 1 && (
                        <button type="button" className="cmp-x" aria-label={`Remove milestone ${i + 1}`} onClick={() => setTranches((ts) => ts.filter((_, j) => j !== i))}>
                          <X size={13} /> remove
                        </button>
                      )}
                    </div>
                    <div className="cmp-row">
                      <label className="cmp-field cmp-amt">
                        <span className="cmp-label">{splitting ? "Share (computed)" : "Pays"}</span>
                        {splitting ? (
                          <span className="cmp-computed mono">{curSymbol}{splitPreview()[i]}</span>
                        ) : (
                          <span className="cmp-amt-wrap">
                            <span className="cmp-cur mono">{curSymbol}</span>
                            <input className="lx-input cmp-input mono" type="number" min="0.5" step="0.5" placeholder={tranches.length > 1 ? "20" : "50"} value={t.amount} onChange={(e) => setT(i, "amount", e.target.value)} aria-label={`Amount for milestone ${i + 1}`} />
                          </span>
                        )}
                      </label>
                      <label className="cmp-field cmp-grow">
                        <span className="cmp-label">What must be true</span>
                        <input className="lx-input cmp-input" type="text" placeholder={i === 0 ? "the new logo page is live" : "the next milestone is true"} value={t.deliverable} onChange={(e) => setT(i, "deliverable", e.target.value)} aria-label={`What must be true for milestone ${i + 1}`} />
                      </label>
                    </div>
                    <div className="cmp-row">
                      <label className="cmp-field">
                        <span className="cmp-label">How Sage verifies</span>
                        <select className="lx-input cmp-input cmp-sel" value={t.verify} onChange={(e) => setT(i, "verify", e.target.value)} aria-label={`How Sage verifies milestone ${i + 1}`}>
                          {VERIFY_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="cmp-field cmp-grow">
                        <span className="cmp-label">Title on the card (optional)</span>
                        <input className="lx-input cmp-input" type="text" placeholder={t.deliverable.trim() ? missionTitleFrom(t.deliverable, i) : "derived from the sentence above"} value={t.title ?? ""} onChange={(e) => setT(i, "title", e.target.value)} maxLength={80} aria-label={`Card title for milestone ${i + 1}`} />
                      </label>
                      {t.verify === "page" && (
                        <label className="cmp-field cmp-grow">
                          <span className="cmp-label">Text that must appear</span>
                          <input className="lx-input cmp-input" type="text" placeholder="the exact text that must appear" value={t.expectedText} onChange={(e) => setT(i, "expectedText", e.target.value)} />
                        </label>
                      )}
                      {t.verify === "onchain" && (
                        <>
                          <label className="cmp-field cmp-grow">
                            <span className="cmp-label">Transaction must go to</span>
                            <input className="lx-input cmp-input mono" type="text" placeholder="0x… contract or recipient" value={t.toAddr} onChange={(e) => setT(i, "toAddr", e.target.value)} />
                          </label>
                          <label className="cmp-field">
                            <span className="cmp-label">On</span>
                            <select className="lx-input cmp-input" value={t.txChain ?? DEFAULT_EVM_LAUNCH_CHAIN} onChange={(e) => setTranches((prev) => prev.map((x, j) => (j === i ? { ...x, txChain: Number(e.target.value) } : x)))}>
                              {TX_CHAINS.map((id) => (
                                <option key={id} value={id}>{chainConfig(id).name}</option>
                              ))}
                            </select>
                          </label>
                        </>
                      )}
                      {t.verify === "link" && (
                        <span className="cmp-help">Sage fetches the link they publish and checks it shows the finished work and carries their wallet address. Durable pages only — a blog, dev.to, Medium, GitHub, Notion, their own site; paste services are refused.</span>
                      )}
                    </div>
                  </div>
                ))}

                <div className="cmp-actions">
                  <button type="button" className="lx-edit-link" onClick={() => setTranches((ts) => [...ts, blankTranche(ts[ts.length - 1]?.verify)])}>
                    <Plus size={14} /> Add a milestone
                    {tranches.length === 1 && <span className="muted"> — turns this into a grant, released tranche by tranche</span>}
                  </button>
                  {tranches.length > 1 && (
                    <label className="cmp-split">
                      <span className="cmp-label">Or one total, split exactly by Sage</span>
                      <span className="cmp-amt-wrap">
                        <span className="cmp-cur mono">{curSymbol}</span>
                        <input className="lx-input cmp-input mono" type="number" min="1" step="0.5" placeholder="40" value={splitTotal} onChange={(e) => setSplitTotal(e.target.value)} aria-label="One total, split equally by Sage" />
                      </span>
                    </label>
                  )}
                </div>

              </div>
            )}
          </div>
        )}

        <div className="lxo-hint">{MODE_HINT[mode]}</div>
        {!founder.authed && mode === "test" && !showSignIn && (
          <p className="lxo-hint" style={{ marginTop: 6, opacity: 0.85 }}>
            You&apos;ll sign in to start, with your email or MetaMask: no gas, no transaction, nothing spent.
            It just ties this inspection to you so your plan and any feedback stay yours.
          </p>
        )}
        {showSignIn && !founder.authed && (
          <div style={{ marginTop: 14 }}>
            <FounderSignIn
              explainer={
                <>
                  <b>MetaMask</b> or any Ethereum wallet. Signing in just ties the inspection to you;
                  nothing is funded here.
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

      {mode === "test" && (
        <div className="lxo-nav">
          <span className="lxo-step-count">One step. You see the plan before anything moves</span>
          <button type="button" className="lx-btn" onClick={submit} disabled={submitting || (!describesWork() && !stepValid()) || siwe.connecting || siwe.signingIn}>
            {submitting
              ? "Starting…"
              : describesWork()
                ? "Set it up as work"
                : siwe.connecting || siwe.signingIn
                  ? "Connecting…"
                  : founder.authed
                    ? "Let Sage look at it"
                    : "Sign in and let Sage look"}
            <span aria-hidden>→</span>
          </button>
        </div>
      )}
    </div>
  );
}
