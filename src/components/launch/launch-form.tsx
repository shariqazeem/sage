"use client";
import { chainConfig, DEFAULT_EVM_LAUNCH_CHAIN, isPausedNetwork, PRIMARY_NETWORKS, SECONDARY_NETWORKS } from "@/lib/deputy/networks";

/** Networks a worker's transaction can be checked on: real-money EVM networks, primary first. */
const TX_CHAINS: readonly number[] = [...PRIMARY_NETWORKS, ...SECONDARY_NETWORKS].filter((id) => chainConfig(id).evm && chainConfig(id).isMainnet);

import { prefillSlots } from "@/lib/launch/direct-fallback";
import { prefillMoneyFromWords } from "@/lib/launch/prefill-money";
import { missionTitleFrom } from "@/lib/launch/mission-title";
import { blankTranche, composeDirectBody, composerTotal, type Tranche } from "@/lib/launch/composer";
import { FIRST_IMPRESSIONS_GOAL, readyJobs, type ReadyJob, type ReadyProduct } from "@/lib/launch/ready-jobs";
import { launchReadiness, nativeAmount, type AccountRead } from "@/lib/treasury/launch-readiness";
import { UpgradeLink } from "@/components/plans/upgrade-link";
import type { PlanId } from "@/lib/plans/catalog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CURRENCIES } from "@/lib/money/currency";
import { X, HandCoins, Plus, ScanSearch, Sparkles, ArrowUpRight } from "lucide-react";
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
    goal: FIRST_IMPRESSIONS_GOAL,
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

/** Tap-to-fill examples — the blank-page killer. Each writes complete working sentences the
 *  founder edits, the same way the goal chips write proven goal shapes. */
const PAY_EXAMPLES: { label: string; who: string; slots: string; splitTotal?: string; currency?: string; tranches: Partial<Tranche>[] }[] = [
  { label: "Design gig", who: "my designer", slots: "1", tranches: [{ amount: "50", deliverable: "the new logo page is live", verify: "link" }] },
  { label: "Translation job", who: "a translator", slots: "1", tranches: [{ amount: "20", deliverable: "my menu is published in English as a public page", verify: "link" }] },
  { label: "Open bounty", who: "anyone", slots: "3", tranches: [{ amount: "5", deliverable: "they publish a working setup guide for my product", verify: "link" }] },
  // TRADE FINANCE IN THE BRIEF'S OWN WORDS: a supplier is paid when the delivery verifies — the
  // payment generates its own paperwork. Supplier credit shaped by delivery, on a real surface.
  { label: "Pay a supplier", who: "my supplier", slots: "1", tranches: [{ amount: "60", deliverable: "the delivery confirmation for invoice INV-1042 is published on a public page", verify: "page", expectedText: "INV-1042 delivered" }] },
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
  pay: "Pick a ready job or describe your own, and Sage drafts the brief. You set the money, and no model ever sets an amount. Launching funds it from your account, and work that fails Sage's checks is never paid.",
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

  // READY TO GO (28 Oct 2026): whole jobs written for this founder's product, and the product a test starts from.
  const [product, setProduct] = useState<ReadyProduct>({ name: null, url: null });
  const ready = useMemo(() => readyJobs(product), [product]);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (!founder.authed) return;
    let live = true;
    void (async () => {
      try {
        const r = await fetch("/api/launch/starters", { cache: "no-store" });
        const j = (await r.json()) as { product?: ReadyProduct | null };
        if (!live || !j.product) return;
        setProduct(j.product);
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

  /** After a launch: a clean composer, and the account read again (the job took its budget). */
  const postAnother = () => {
    setLaunchedJob(null);
    setPicked(null);
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

  const pickReady = (j: ReadyJob) => {
    setPayErr(null);
    setPlanLink(null);
    setUpgrade(undefined);
    if (j.kind === "test") {
      setMode("test");
      setStep(0);
      setForm((f) => ({ ...f, productUrl: f.productUrl.trim() || product.url || "", goal: j.goal }));
      return;
    }
    setPicked(j.key);
    setPay({ who: j.draft.who, slots: j.draft.slots });
    setTranches(j.draft.tranches.map((t) => ({ ...t, criteria: t.criteria ? [...t.criteria] : undefined })));
    setSplitTotal(j.draft.splitTotal);
    setCurrency("USD");
    setInviteOnly(j.draft.inviteOnly);
    setDraftText("");
    setDraftWhy("");
    setDraftNotes([]);
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
   * THE SENTENCES COMPILE DIRECTLY — no chat, no model. The rows the founder composed become the
   * exact `DirectCampaignInput` the deterministic compiler takes; multi-tranche is a grant, one
   * line is a gig, and a stated total rides `splitTotalUsd` so Sage does the division in base
   * units. Errors come back as the compiler's own words, under the form.
   */
  const draftWithSage = async () => {
    if (draftText.trim().length < 10 || draftBusy) return;
    setDraftErr(null);
    setDraftNotes([]);
    setDraftBusy(true);
    setPicked(null);
    try {
      const res = await fetch("/api/campaigns/direct/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: draftText.trim(), ...(isHttpUrl(form.productUrl) ? { productUrl: form.productUrl.trim() } : {}) }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; draft?: Draft; notes?: string[] };
      if (res.status === 401) {
        setShowSignIn(true);
        setDraftErr("Sign in (email or MetaMask) to let Sage draft this — then press Draft again.");
        return;
      }
      if (!res.ok || !data.ok || !data.draft) throw new Error(data.error ?? "Sage couldn't draft this.");
      const d = data.draft;
      setP("who", d.who);
      // the count is money: the founder's stated headcount, else one payment — never the model's guess
      setP("slots", clampSlots(prefillSlots(draftText, d.milestones.length)));
      // THE FOUNDER'S WORDS ARE THE MONEY: the currency, the total to split, or the price per person,
      // read from the sentence deterministically — never from the model — and left editable.
      const money = prefillMoneyFromWords(draftText, d.milestones.length);
      if (money.currency) setCurrency(money.currency);
      if (money.splitTotal != null) setSplitTotal(String(money.splitTotal));
      else if (money.perUnit != null) setT(0, "amount", String(money.perUnit));
      setDraftWhy(d.whyItMatters ?? "");
      setDraftNotes(data.notes ?? []);
      // Amounts the founder already typed survive the draft: money is theirs, words are Sage's.
      setTranches((prev) =>
        d.milestones.map((m, i) => ({
          amount: prev[i]?.amount ?? "",
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
    } catch (e) {
      setDraftErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDraftBusy(false);
    }
  };

  const submitPay = async () => {
    if (!payValid() || payBusy) return;
    setPayErr(null);
    setPlanLink(null);
    setUpgrade(undefined);
    setPayPhase("plan");
    setPayBusy(true);
    try {
      const body = composeDirectBody({ who: pay.who, slots: pay.slots, tranches, splitTotal, currency, inviteOnly, why: draftWhy });
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
          </>
        )}

        {/* PAY FOR WORK — a sentence you finish, not a form (and never a paragraph to derive).
            The tokens compose the exact structured ask the agent needs; the examples fill the
            sentence in one tap. Continue hands the founder's finished sentence to Sage in chat. */}
        {/* PAY FOR WORK — sentences you finish, never a form to derive. One line is a gig; add a
            line and it is a milestone grant; type ONE total and watch Sage split it live. The rows
            compile DIRECTLY into the deterministic campaign compiler — no chat, no model. */}
        {step === 0 && mode === "pay" && (
          <div className="cmp">
            {/* THE COMPOSER. The pay door used to be a fill-in-the-blanks sentence; founders,
                companies and teams will use this every day, so it is now a real instrument:
                the work on the left, and on the right the plan Sage will compile from it —
                the exact split, each verification contract in plain words, the rail and the
                door — updating as you type. The preview is the deterministic client mirror of
                the compiler; no model runs here and no amount is ever computed by one. Same
                POST body as before. */}
            <div className="cmp-grid">
              <div className="cmp-form">
                {/* READY TO GO. Whole jobs for this founder's product: one tap fills everything below. */}
                <div className="cmp-ready" role="group" aria-label="Ready to go">
                  <div className="cmp-card-h">
                    <span className="cmp-k mono">Ready to go</span>
                    <span className="muted cmp-draft-hint">Pick one, change anything, launch</span>
                  </div>
                  <div className="cmp-ready-grid">
                    {ready.map((j) => (
                      <button key={j.key} type="button" className={`cmp-ready-card${picked === j.key ? " on" : ""}`} aria-pressed={picked === j.key} onClick={() => pickReady(j)}>
                        <span className="cmp-ready-t">{j.title}</span>
                        <span className="cmp-ready-l">{j.line}</span>
                        <span className="cmp-ready-p mono">
                          {j.price}
                          {j.kind === "pay" && j.needs ? " · needs your contract" : ""}
                          {j.kind === "test" ? " · product test" : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                {/* THE GIG BRAIN. One sentence — what, for whom, how many, what good looks like — and
                    Sage drafts the steps, the acceptance criteria with an effort bar, and the evidence
                    rule, for any kind of work. The founder edits and approves; the money stays theirs. */}
                <div className="cmp-card cmp-draft">
                  <div className="cmp-card-h">
                    <span className="cmp-k mono">Describe the work</span>
                    <span className="muted cmp-draft-hint">Sage drafts the brief; you set the pay</span>
                  </div>
                  <textarea
                    className="lx-input cmp-input cmp-draft-ta"
                    rows={3}
                    placeholder="e.g. Pay 5 people to each publish a short guide to setting up my product, on their own blog, with a screenshot of it running…"
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    disabled={draftBusy}
                  />
                  <div className="cmp-draft-row">
                    <button type="button" className="lx-btn" onClick={() => void draftWithSage()} disabled={draftBusy || draftText.trim().length < 10}>
                      {draftBusy ? "Sage is drafting…" : "Draft with Sage"}
                    </button>
                    <span className="muted">Steps, acceptance criteria and the evidence rule — for software, writing, design, a catalogue, a delivery, anything.</span>
                  </div>
                  {draftErr && <p className="cmp-err">{draftErr}</p>}
                  {draftNotes.map((n, i) => (
                    <p className="muted cmp-draft-note" key={i}>{n}</p>
                  ))}
                </div>
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

                <div className="lxo-chips lxs-ex cmp-ex" role="group" aria-label="Start from an example">
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
              </div>

              {/* ── the plan, forming ── */}
              <aside className="cmp-preview" aria-label="What Sage will compile">
                <div className="cmp-preview-h">
                  <span className="cmp-k mono">What Sage will do</span>
                  <span className="cmp-live mono">forms as you type</span>
                </div>
                <div className="cmp-pv-total">
                  <span className="cmp-pv-amt mono">
                    {curSymbol}
                    {splitting
                      ? Number(splitTotal || 0).toFixed(2)
                      : (tranches.reduce((a, t) => a + (Number(t.amount) || 0), 0) * (tranches.length === 1 ? Number(pay.slots) || 1 : 1)).toFixed(2)}
                  </span>
                  <span className="cmp-pv-k">
                    {tranches.length > 1
                      ? `across ${tranches.length} milestones, released one by one`
                      : Number(pay.slots) > 1
                        ? `${pay.slots} people × ${curSymbol}${Number(tranches[0]?.amount || 0).toFixed(2)}`
                        : "one deliverable, one payout"}
                    {isLocal ? ` · converted once to USDC at a stamped rate` : ""}
                  </span>
                </div>
                <ol className="cmp-pv-list">
                  {tranches.map((t, i) => {
                    const opt = VERIFY_OPTIONS.find((o) => o.value === t.verify);
                    return (
                      <li key={i}>
                        <span className="cmp-pv-n mono">{String(i + 1).padStart(2, "0")}</span>
                        <span className="cmp-pv-body">
                          <b>{(t.title ?? "").trim().length >= 4 ? (t.title ?? "").trim() : t.deliverable.trim() ? missionTitleFrom(t.deliverable, i) : "…what must be true"}</b>
                          {t.deliverable.trim() && <span className="cmp-pv-crit">{t.deliverable.trim()}</span>}
                          {(t.criteria?.length ?? 0) > 0 && (
                            <ul className="cmp-pv-criteria">
                              {t.criteria!.map((c, k) => (
                                <li key={k}>{c}</li>
                              ))}
                              {t.minWords ? <li>At least {t.minWords} words of the worker&rsquo;s own writing (checked before any model reads it)</li> : null}
                            </ul>
                          )}
                          <span className="cmp-pv-verify">Sage verifies by {opt?.ask ?? "checking the evidence"}{t.verify === "page" && t.expectedText.trim() ? ` — it must show “${t.expectedText.trim()}”` : ""}.</span>
                          <span className="cmp-pv-pay mono">{splitting ? `${curSymbol}${splitPreview()[i]}` : `${curSymbol}${Number(t.amount || 0).toFixed(2)}`} released on verification</span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
                <ul className="cmp-pv-facts">
                  <li><span className="mono">door</span>{inviteOnly ? "invite-only — off the public board" : "listed on the marketplace"}</li>
                  <li><span className="mono">who</span>{pay.who.trim() || "anyone who can do it"}{tranches.length === 1 && Number(pay.slots) > 1 ? ` · up to ${pay.slots} people` : ""}</li>
                  <li><span className="mono">refuses if</span>the evidence does not show the deliverable, is not theirs, or repeats another submission</li>
                  <li><span className="mono">then</span>launching funds it from your account, and payouts run with receipts</li>
                </ul>
              </aside>
            </div>

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
        {/* ONBOARDING — the founder's whole lifecycle in one line, on the last thing they type.
            Two human moments (approve, fund); everything else Sage does and narrates after. */}
        {mode === "test" && step === 1 && (
          <ol className="lxo-next" aria-label="What happens next">
            <li><b>Sage inspects</b> your product in a real browser — a few minutes</li>
            <li><b>You approve</b> the missions it designed</li>
            <li><b>You fund once</b> — a vault Sage cannot exceed</li>
            <li><b>Payouts run themselves</b>, each with a public receipt</li>
          </ol>
        )}

        <div className="lxo-hint">{step === 0 ? MODE_HINT[mode] : s.hint}</div>
        {!founder.authed && last && !showSignIn && (
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

      <div className="lxo-nav">
        {step > 0 ? (
          <button type="button" className="lx-btn ghost" onClick={back}>
            Back
          </button>
        ) : (
          <span className="lxo-step-count">
            {mode === "test" ? `Step ${step + 1} of ${STEPS.length}` : launchesHere ? "The plan on the right is what launches" : "One step: the plan compiles when you continue"}
          </span>
        )}
        {mode === "pay" && step === 0 ? (
          launchedJob ? null : (
            <button
              type="button"
              className="lx-btn"
              onClick={() => (founder.authed ? void submitPay() : setShowSignIn(true))}
              disabled={payBusy || (founder.authed && !payValid())}
            >
              {payBusy
                ? payPhase === "launch"
                  ? "Sage is launching it from your account…"
                  : "Writing the plan…"
                : !founder.authed
                  ? "Sign in to launch"
                  : launchesHere
                    ? `Launch · $${total.toFixed(2)} from your account`
                    : tranches.length > 1
                      ? "Create the grant"
                      : "Create the gig"}
              <span aria-hidden>→</span>
            </button>
          )
        ) : last ? (
          <button type="button" className="lx-btn" onClick={submit} disabled={submitting || !stepValid() || siwe.connecting || siwe.signingIn}>
            {submitting
              ? "Starting…"
              : siwe.connecting || siwe.signingIn
                ? "Connecting…"
                : founder.authed
                  ? "Let Sage inspect"
                  : "Sign in & inspect"}
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
