import { DEFAULT_EVM_LAUNCH_CHAIN } from "@/lib/deputy/networks";
import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, CircleDot, Compass, Inbox, Plus, Rocket, Sparkles } from "lucide-react";
import { PLANS } from "@/lib/plans/catalog";
import { reward as fmtReward, usd } from "@/lib/format";
import { formatNative } from "@/lib/treasury/gas-policy";
import type { FounderDesk } from "@/lib/campaigns/founder-activity";
import type { SettlementRail, WorkspacePlan, WorkspaceRole } from "@/lib/db/schema";
import type { PlanId } from "@/lib/plans/catalog";
import { SageAtWork } from "./sage-at-work";
import { SettlingLane } from "@/components/live/settling-lane";
import { NextMove } from "@/components/live/next-move";
import { RefreshSoon } from "./refresh-soon";

/** The account, as Home sees it: open with balances, being opened, not open yet, or not available. */
export type HomeAccount =
  | { state: "open"; network: string; nativeSymbol: string; usdc: number; gasWei: string | null; gasUsd: number | null; launchFloorWei: string; usdcIsGas: boolean; canSwap: boolean }
  | { state: "opening" | "none"; network: string }
  | { state: "closed"; network: string; reason: string }
  | { state: "starknet" | "unconfigured"; network: string };

export interface OwnerView {
  workspace: { id: string; name: string; slug: string; plan: WorkspacePlan; planUntil: number | null; memberCap: number; proPriceUsd: number };
  members: { key: string; address: string | null; role: WorkspaceRole; displayName: string | null; joinedAt: number; viaTelegram: boolean }[];
  memberCount: number;
  campaigns: {
    id: string;
    title: string;
    kind: "testing" | "grant" | "gig";
    status: string;
    visibility: "listed" | "unlisted";
    rail: SettlementRail;
    /** the campaign's own chain — GOAT and Arc are both EVM, so the rail alone cannot name it */
    chainId: number | null;
    rewardBase: number;
    paid: number;
    pending: number;
    slots: number;
    paidBase: number;
  }[];
  desk: FounderDesk;
  me: string;
  /** which rail the owner signed in from — the account exists on EVM only */
  chain?: "evm" | "starknet";
  /** the plan in force now, and what it allows against what has been used */
  usage?: { plan: PlanId; liveJobs: number; launchedUsd: number };
  account?: HomeAccount;
  /** Autopilot is switched on for this founder: its next move belongs on Home */
  autopilotArmed?: boolean;
  /** what to say about the plan's next renewal (or a failed one), from the billing view; null = nothing. */
  billingNotice?: { tone: "info" | "warn"; text: string } | null;
}

const chainFor = (rail: SettlementRail, chainId?: number | null) => (rail === "starknet" ? 900001 : (chainId ?? DEFAULT_EVM_LAUNCH_CHAIN));
const KIND = { testing: "Testing run", grant: "Milestone grant", gig: "Gig" } as const;

type Step = { key: string; title: string; body: string; href: string; cta: string };

/**
 * THE ONE NEXT STEP. Home asks for at most one thing, the first that is true, so a new founder is
 * never handed three competing doors: open the account, add money, add the fee token, post the first
 * job, decide on work that is waiting. When none is true, Home asks for nothing.
 */
export function nextStep(view: OwnerView): Step | null {
  const a = view.account;
  const posted = view.campaigns.length > 0;
  const inReview = view.campaigns.reduce((n, c) => n + c.pending, 0);
  if (a?.state === "none") return { key: "open", title: `Open your account on ${a.network}`, body: "It takes a few seconds. Sage funds every job from it, inside a limit you set.", href: "/workspace/account", cta: "Open your account" };
  if (a?.state === "open" && a.usdc <= 0 && !posted) {
    return { key: "add", title: "Add money to your account", body: a.usdcIsGas ? `Send USDC on ${a.network} from any wallet or exchange.` : `Send USDC or ${a.nativeSymbol} on ${a.network}, from an exchange or a wallet. ${a.canSwap ? `You can swap ${a.nativeSymbol} to USDC inside Sage.` : ""}`.trim(), href: "/workspace/account?do=add", cta: "Add money" };
  }
  if (a?.state === "open" && !a.usdcIsGas && a.usdc > 0 && a.gasWei !== null && BigInt(a.gasWei) < BigInt(a.launchFloorWei)) {
    return {
      key: "fee",
      title: `Add a little ${a.nativeSymbol} for network fees`,
      body: `Launching a job takes about ${formatNative(BigInt(a.launchFloorWei))} ${a.nativeSymbol} of fees, paid from your account. Withdraw ${a.nativeSymbol} from an exchange on the ${a.network} network${a.canSwap && BigInt(a.gasWei) > BigInt(0) ? `, or swap a little USDC to ${a.nativeSymbol}` : ""}.`,
      href: a.canSwap && BigInt(a.gasWei) > BigInt(0) ? "/workspace/account?do=swap" : "/workspace/account?do=add",
      cta: a.canSwap && BigInt(a.gasWei) > BigInt(0) ? "Swap" : "Add METIS",
    };
  }
  if (!posted) return { key: "post", title: "Post your first job", body: "Say what you need done in a sentence and set a budget. Sage designs it, prices it and shows you the plan before anything moves.", href: "/launch?do=pay", cta: "Post a job" };
  if (inReview > 0) return { key: "review", title: `${inReview} submission${inReview === 1 ? " is" : "s are"} in review`, body: "Sage is checking the work. Anything it holds for you to decide is waiting on the job's page.", href: "/workspace/jobs", cta: "Open jobs" };
  return null;
}

/**
 * THE OWNER'S HOME (redrawn 24 Oct 2026). Four things, in the order a founder needs them: the money
 * (the account's balance, with its moves one click away), the one next step, the work that is live,
 * and what Sage did. Every number is a row or a chain read; nothing here is decoration.
 */
export function OwnerWorkspace({ view }: { view: OwnerView }) {
  const ws = view.workspace;
  const live = view.campaigns.filter((c) => c.status === "live");
  const paidCount = view.campaigns.reduce((n, c) => n + c.paid, 0);
  const paidUsd = view.campaigns.reduce((n, c) => n + c.paidBase, 0) / 1e6;
  const step = nextStep(view);
  const plan = view.usage?.plan ?? "free";
  const spec = PLANS[plan];

  return (
    <main className="ws-shell ws-stagger">
      <header className="ws-head">
        <div>
          <Link className="ws-eyebrow ws-plan-link" href="/workspace/settings#plan">{spec.name} plan</Link>
          <h1 className="ws-title">{ws.name}</h1>
          <p className="ws-sub">Post work, and Sage checks it and pays your people from your account.</p>
        </div>
        <div className="ws-nav">
          <Link className="sage-btn sage-btn-primary sage-btn-sm" href="/launch?do=pay"><Plus size={14} /> Post a job</Link>
        </div>
      </header>

      {view.billingNotice && (
        <Link href="/workspace/settings#plan" className={`ws-billing-notice ${view.billingNotice.tone}`}>
          <span>{view.billingNotice.text}</span>
          <span className="ws-billing-go">Manage billing →</span>
        </Link>
      )}

      <div className="home-top">
        <AccountStrip account={view.account} />
        <section className="home-tile home-plan" aria-label="Your plan">
          <span className="home-k">{spec.name} plan</span>
          <span className="home-usage">
            <b className="mono">{view.usage?.liveJobs ?? live.length}</b>
            {Number.isFinite(spec.liveJobs) ? ` of ${spec.liveJobs}` : ""} live job{(Number.isFinite(spec.liveJobs) ? spec.liveJobs : 2) === 1 ? "" : "s"}
          </span>
          <span className="home-usage">
            <b className="mono">{usd(view.usage?.launchedUsd ?? 0)}</b>
            {Number.isFinite(spec.monthlyUsd) ? ` of ${usd(spec.monthlyUsd)}` : ""} launched in 30 days
          </span>
          <span className="home-usage faint">{usd(paidUsd)} paid to people · {paidCount} payout{paidCount === 1 ? "" : "s"}</span>
          {plan === "free" ? <Link className="home-link" href="/checkout?plan=pro">Upgrade to Pro <ArrowRight size={13} /></Link> : <Link className="home-link" href="/workspace/settings#plan">Plan and billing <ArrowRight size={13} /></Link>}
        </section>
        {/* the one next step spans the row on a wide screen, and comes straight after the money on a phone */}
        {step && (
          <section className={`home-step step-${step.key}`}>
            <span className="home-step-ic" aria-hidden><CircleDot size={16} /></span>
            <div className="home-step-main">
              <h2>{step.title}</h2>
              <p>{step.body}</p>
            </div>
            <Link className="sage-btn sage-btn-primary sage-btn-sm" href={step.href}>{step.cta}</Link>
          </section>
        )}
      </div>

      {view.autopilotArmed && <NextMove />}

      <section className="ws-card">
        <div className="ws-card-h"><h2><Rocket size={15} /> Live jobs</h2><Link className="ws-chip" href="/workspace/jobs">all jobs <ArrowUpRight size={11} /></Link></div>
        {live.length === 0 ? (
          <p className="ws-empty"><Inbox size={18} /><span>No live jobs. <Link href="/launch?do=pay">Post one</Link> in a sentence: a product test, a gig or a milestone grant.</span></p>
        ) : (
          <ul className="ws-list">
            {live.map((c) => {
              const pct = c.slots > 0 ? Math.min(100, Math.round((c.paid / c.slots) * 100)) : 0;
              return (
                <li key={c.id} className="ws-row home-job">
                  <div className="ws-row-main">
                    <p className="ws-row-title"><span className="ws-livedot" aria-hidden /><Link href={`/campaign/${c.id}`}>{c.title}</Link></p>
                    <p className="ws-row-meta">{KIND[c.kind]} · {fmtReward(c.rewardBase, chainFor(c.rail, c.chainId))} each · {c.paid} of {c.slots} paid{c.pending ? ` · ${c.pending} in review` : ""}</p>
                    <progress className="home-bar" max={Math.max(1, c.slots)} value={Math.min(c.paid, Math.max(1, c.slots))} aria-label={`${pct}% paid`} />
                  </div>
                  <div className="ws-row-side">
                    <span className={`ws-chip${c.visibility === "unlisted" ? "" : " accent"}`}>{c.visibility === "unlisted" ? "members only" : "public"}</span>
                    <Link className="ws-chip" href={`/c/${c.id}`}>board <ArrowUpRight size={11} /></Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {paidCount > 0 && <SettlingLane title="Settling" />}

      <section className="ws-card">
        <div className="ws-card-h"><h2><Sparkles size={15} /> What Sage did</h2>{view.desk.events.length > 0 && <Link className="ws-chip" href="/workspace/jobs">everything <ArrowUpRight size={11} /></Link>}</div>
        {view.desk.events.length > 0 ? (
          <SageAtWork desk={view.desk} limit={8} />
        ) : (
          <p className="ws-empty"><Compass size={18} /><span>Nothing yet. When people submit work, every check, payout and refusal shows up here, each with its receipt or its reason.</span></p>
        )}
      </section>
    </main>
  );
}

/** The money, one line: the balance, the fee token beside it, and the moves. Each state says what it is. */
function AccountStrip({ account }: { account?: HomeAccount }) {
  if (!account) return null;
  if (account.state === "open") {
    return (
      <section className="home-tile home-money" aria-label="Your account">
        <span className="home-k">Account · {account.network}</span>
        <span className="home-bal">
          ${account.usdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          <span className="home-bal-u">USDC</span>
        </span>
        {!account.usdcIsGas && (
          <span className="home-fee">
            {account.gasWei === null ? "—" : formatNative(BigInt(account.gasWei))} {account.nativeSymbol} for network fees
            {account.gasUsd !== null ? <span className="faint"> ≈ ${account.gasUsd.toFixed(2)}</span> : null}
          </span>
        )}
        <span className="home-moves">
          <Link className="home-move" href="/workspace/account?do=add"><ArrowDownLeft size={14} /> Add money</Link>
          {account.canSwap && <Link className="home-move" href="/workspace/account?do=swap"><ArrowLeftRight size={14} /> Swap</Link>}
          <Link className="home-move" href="/workspace/account?do=send"><ArrowUpRight size={14} /> Send</Link>
        </span>
      </section>
    );
  }
  const text =
    account.state === "opening"
      ? { k: `Account · ${account.network}`, t: "Opening your account…", s: "This takes a few seconds." }
      : account.state === "none"
        ? { k: `Account · ${account.network}`, t: "No account yet", s: "Open it once; every job is funded from it." }
        : account.state === "closed"
          ? { k: `Account · ${account.network}`, t: "Opening soon", s: account.reason }
          : account.state === "starknet"
            ? { k: "Account · Starknet", t: "Your wallet is your account", s: "Each job is funded from your Starknet wallet when you post it." }
            : { k: "Account", t: "Not configured here", s: "Post work from your own wallet." };
  return (
    <section className="home-tile home-money" aria-label="Your account">
      {account.state === "opening" && <RefreshSoon />}
      <span className="home-k">{text.k}</span>
      <span className="home-bal small">{text.t}</span>
      <span className="home-fee">{text.s}</span>
      <span className="home-moves">
        <Link className="home-move" href="/workspace/account">Your account <ArrowRight size={13} /></Link>
      </span>
    </section>
  );
}
