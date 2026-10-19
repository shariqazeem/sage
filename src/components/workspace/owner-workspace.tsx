import { DEFAULT_EVM_LAUNCH_CHAIN, METIS_MAINNET_CHAIN_ID } from "@/lib/deputy/networks";
import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Inbox, Rocket, Sparkles } from "lucide-react";
import { hasFeature, PLANS, planInForce } from "@/lib/plans/catalog";
import { reward as fmtReward, networkLabel, usd } from "@/lib/format";
import type { FounderDesk } from "@/lib/campaigns/founder-activity";
import type { SettlementRail, WorkspacePlan, WorkspaceRole } from "@/lib/db/schema";
import { SageAtWork } from "./sage-at-work";
import { SettlingLane } from "@/components/live/settling-lane";
import { NextMove } from "@/components/live/next-move";

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
  /** which rail the owner signed in from — the fund-once account exists on EVM only, and step three says so */
  chain?: "evm" | "starknet";
  /** the server has Arc (testnet) configured, so the orientation line may promote it */
  /** Arc mainnet is configured, so the same account can be opened there. */
  /** Metis mainnet is configured: its account door can be offered */
  metis?: boolean;
}

const chainFor = (rail: SettlementRail, chainId?: number | null) => (rail === "starknet" ? 900001 : (chainId ?? DEFAULT_EVM_LAUNCH_CHAIN));
const KIND = { testing: "Testing run", grant: "Milestone grant", gig: "Gig" } as const;

/**
 * THE OWNER'S HOME. Four numbers (the fourth is the plan, one click from changing it), then, while
 * the workspace is new, the three moves to the first verified payout: fund, post, watch it pay.
 * Then the work that is open and the agent's own timeline. Every number is a row.
 */
export function OwnerWorkspace({ view }: { view: OwnerView }) {
  const ws = view.workspace;
  const live = view.campaigns.filter((c) => c.status === "live");
  const paidCount = view.campaigns.reduce((n, c) => n + c.paid, 0);
  const paidUsd = view.campaigns.reduce((n, c) => n + c.paidBase, 0) / 1e6;
  const inReview = view.campaigns.reduce((n, c) => n + c.pending, 0);
  const posted = view.campaigns.length > 0;
  const paid = paidCount > 0;
  const fresh = !(posted && paid);
  const plan = planInForce(ws);

  return (
    <main className="ws-shell ws-stagger">
      <header className="ws-head">
        <div>
          <Link className="ws-eyebrow ws-plan-link" href="/workspace/settings#plan">{PLANS[plan].name} plan</Link>
          <h1 className="ws-title">{ws.name}</h1>
          <p className="ws-sub">Sage checks the work and pays your people from the budget you fund. Every payout has a receipt; every refusal, a reason.</p>
        </div>
        <div className="ws-nav">
          <Link className="sage-btn sage-btn-primary sage-btn-sm" href="/launch?do=pay"><Rocket size={14} /> Post work</Link>
        </div>
      </header>

      <section className="ws-stats" aria-label="At a glance">
        <div className="ws-stat"><span className="ws-stat-v">{live.length}</span><span className="ws-stat-k">Open work</span></div>
        <div className="ws-stat"><span className="ws-stat-v">{inReview}</span><span className="ws-stat-k">In review</span></div>
        <div className={`ws-stat${paidUsd > 0 ? " pos" : ""}`}><span className="ws-stat-v">{usd(paidUsd)}</span><span className="ws-stat-k">Paid · {paidCount} payout{paidCount === 1 ? "" : "s"}</span></div>
        <Link className="ws-stat ws-stat-link" href="/workspace/settings#plan"><span className="ws-stat-v">{PLANS[plan].name}</span><span className="ws-stat-k">{PLANS[plan].liveJobs === 1 ? "One live job at a time" : "Unlimited live jobs"}</span></Link>
      </section>

      {/* Autopilot's next move, on the plans that include it; the settling window once there is work to settle. */}
      {hasFeature(plan, "autopilot") && <NextMove />}
      {!fresh && <SettlingLane title="Settling — the finalization window" />}

      {fresh && (
        <section className="ws-card">
          <div className="ws-card-h"><h2><Sparkles size={15} /> Your first verified payout</h2></div>
          {/* ORIENTATION, ONE LINE: which networks this founder's money moves on, and what that means. */}
          <p className="ws-rail">
            {view.chain === "starknet" ? (
              <><b>Your money moves on Starknet.</b> Real USDC, private when you ask. Each job is funded from your wallet when you post it.</>
            ) : (
              <><b>Your money moves on Metis or GOAT Network.</b> Real USDC, and a public receipt for every payout.{view.metis ? <> <Link href={`/workspace/account?chain=${METIS_MAINNET_CHAIN_ID}`} className="ws-rail-new"><span className="ws-new">new</span>Your account on Metis</Link>.</> : null}</>
            )}
          </p>
          <ol className="ws-check">
            <li className={posted ? "done" : ""}>
              <span className="ws-check-n">{posted ? <CheckCircle2 size={13} /> : "1"}</span>
              {view.chain === "starknet" ? (
                <>
                  <span className="ws-check-t">Fund it as you launch</span>
                  <span className="ws-check-s">Each job&rsquo;s vault is funded from your Starknet wallet in one signed transaction. Sage can never spend more than you put in.</span>
                </>
              ) : (
                <>
                  <span className="ws-check-t">Fund your account</span>
                  <span className="ws-check-s">Send USDC to your account once. Sage launches every job from it, and can never spend more than you put in.</span>
                </>
              )}
              <Link href="/workspace/account">Your account →</Link>
            </li>
            <li className={posted ? "done" : ""}>
              <span className="ws-check-n">{posted ? <CheckCircle2 size={13} /> : "2"}</span>
              <span className="ws-check-t">Post the work</span>
              <span className="ws-check-s">One sentence: a product test, a gig or a milestone grant. Sage designs it, prices it, and shows you the plan before anything moves.</span>
              <Link href="/launch?do=pay">Post →</Link>
            </li>
            <li className={paid ? "done" : ""}>
              <span className="ws-check-n">{paid ? <CheckCircle2 size={13} /> : "3"}</span>
              <span className="ws-check-t">Watch it pay</span>
              <span className="ws-check-s">Sage checks every submission. Real work is paid in USDC at once; anything else is refused, with the reason written down.</span>
              <Link href="/workspace/jobs">Your jobs →</Link>
            </li>
          </ol>
        </section>
      )}

      <section className="ws-card">
        <div className="ws-card-h"><h2><Rocket size={15} /> Open work</h2><Link className="ws-chip" href="/workspace/jobs">all jobs <ArrowUpRight size={11} /></Link></div>
        {live.length === 0 ? (
          <p className="ws-empty"><Inbox size={18} /><span>Nothing is open right now. <Link href="/launch?do=pay">Post work</Link> and your members hear about it the moment it is live.</span></p>
        ) : (
          <ul className="ws-list">
            {live.map((c) => (
              <li key={c.id} className="ws-row">
                <div className="ws-row-main">
                  <p className="ws-row-title"><span className="ws-livedot" aria-hidden /><Link href={`/campaign/${c.id}`}>{c.title}</Link></p>
                  <p className="ws-row-meta">{KIND[c.kind]} · {fmtReward(c.rewardBase, chainFor(c.rail, c.chainId))} each · {c.paid}/{c.slots} paid{c.pending ? ` · ${c.pending} in review` : ""} · {networkLabel(chainFor(c.rail, c.chainId))}</p>
                </div>
                <div className="ws-row-side">
                  <span className={`ws-chip${c.visibility === "unlisted" ? "" : " accent"}`}>{c.visibility === "unlisted" ? "members only" : "public"}</span>
                  <Link className="ws-chip" href={`/c/${c.id}`}>board <ArrowUpRight size={11} /></Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {view.desk.events.length > 0 && (
        <section className="ws-card">
          <div className="ws-card-h"><h2><Sparkles size={15} /> Sage at work</h2><Link className="ws-chip" href="/workspace/jobs">everything <ArrowUpRight size={11} /></Link></div>
          <SageAtWork desk={view.desk} limit={6} />
        </section>
      )}
    </main>
  );
}
