"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  Copy,
  Check,
  ExternalLink,
  ChevronDown,
  Zap,
  Hand,
} from "lucide-react";
import { reward, networkLabel, short } from "@/lib/format";
import { NetworkChip } from "@/components/app/network-chip";
import { ConnectWallet } from "@/components/app/connect-wallet";
import { SageMark } from "@/components/brand/sage-mark";
import { SageActivity, type ActivityData } from "@/components/campaigns/sage-activity";
import { useSiwe } from "@/lib/auth/use-siwe";

/** One tester submission, already reduced to display truth on the server. */
export interface WorkspaceSubmission {
  wallet: string;
  missionTitle: string;
  /** reviewing = no decision yet · verified = decided pay, settling/awaiting · held · paid */
  state: "reviewing" | "verified" | "held" | "paid";
  confidence: number | null;
  reason: string | null;
  proofTx: string | null;
  at: number;
}

export interface WorkspaceMission {
  title: string;
  rewardBase: number;
  maxCompletions: number;
  paid: number;
  remainingSlots: number;
  full: boolean;
}

export interface WorkspaceData {
  isOwner: boolean;
  id: string;
  title: string;
  description: string;
  status: string;
  chainId: number;
  isTestnet: boolean;
  autonomy: string;
  autopilotThreshold: number | null;
  fundedBase: number;
  paidBase: number;
  remainingBase: number;
  missionCount: number;
  paidCompletions: number;
  totalCompletions: number;
  missions: WorkspaceMission[];
  submissions: WorkspaceSubmission[];
  testerUrl: string;
  vaultAddress: string;
  vaultExplorerUrl: string;
  campaignIdHash: string | null;
  missionPlanDigest: string | null;
  proofBaseTx: string | null;
  activity: ActivityData;
}

const STATE_META: Record<
  WorkspaceSubmission["state"],
  { label: string; cls: string }
> = {
  reviewing: { label: "Reviewing", cls: "cw-st-rev" },
  verified: { label: "Verified · settling", cls: "cw-st-ver" },
  held: { label: "Held", cls: "cw-st-held" },
  paid: { label: "Paid", cls: "cw-st-paid" },
};

/**
 * The founder's campaign console. One workspace for a live CampaignVaultV2: real
 * funded/paid/remaining in the network-truthful token, mission slots, every tester
 * submission with the Deputy's decision truth (reviewing / verified / held / paid) +
 * a proof link, the autonomy mandate, and progressive-disclosure provenance. All values
 * are composed on the server from the canonical DB/chain — this view never settles.
 */
export function CampaignWorkspace({ data }: { data: WorkspaceData }) {
  if (!data.isOwner) return <OwnerGate data={data} />;
  return <Console data={data} />;
}

function OwnerGate({ data }: { data: WorkspaceData }) {
  const siwe = useSiwe();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <main className="sb-shell">
      <TopBar chainId={data.chainId} />
      <div className="sage-agent-card" style={{ maxWidth: 520, margin: "40px auto" }}>
        <div className="sage-eyebrow">
          <ShieldCheck size={13} /> Founder console
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: "6px 0 8px" }}>
          Connect the wallet that owns this campaign
        </h1>
        <p style={{ fontSize: 14.5, color: "var(--sec)", lineHeight: 1.55, margin: "0 0 18px" }}>
          Only the founder who deployed and funded the vault can manage it here. Sign in with
          that wallet, or view the public tester board instead.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <ConnectWallet chainId={data.chainId} />
          <button
            className="sage-btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await siwe.signIn().catch(() => false);
              setBusy(false);
              if (ok) router.refresh();
            }}
          >
            {busy ? "Signing in…" : "Sign in to manage"}
          </button>
        </div>
        <div style={{ marginTop: 16 }}>
          <Link href={`/c/${data.id}`} className="cw-link">
            View the public tester board <ExternalLink size={13} />
          </Link>
        </div>
      </div>
    </main>
  );
}

function Console({ data }: { data: WorkspaceData }) {
  const [copied, setCopied] = useState(false);
  const [showTech, setShowTech] = useState(false);
  const pct = data.fundedBase > 0 ? Math.round((data.paidBase / data.fundedBase) * 100) : 0;
  const live = data.status === "live";
  const autopilot = data.autonomy === "autopilot";

  return (
    <main className="sb-shell">
      <TopBar chainId={data.chainId} />

      {/* header */}
      <div className="sage-agent-card" style={{ marginBottom: 14 }}>
        <div className="sage-eyebrow">
          <ShieldCheck size={13} /> Founder console · you own this vault
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.025em", margin: "6px 0" }}>
            {data.title}
          </h1>
          <span className={`cw-status ${live ? "cw-status-live" : "cw-status-off"}`}>
            {live ? "Live" : data.status}
          </span>
        </div>
        {data.description && (
          <p style={{ fontSize: 14.5, color: "var(--sec)", lineHeight: 1.55, margin: "2px 0 0" }}>
            {data.description}
          </p>
        )}

        {/* economics */}
        <div className="v2-econ" style={{ marginTop: 14 }}>
          <div className="v2-econ-row">
            <div className="v2-econ-fig"><span className="k">Funded</span><span className="v mono">{reward(data.fundedBase, data.chainId)}</span></div>
            <div className="v2-econ-fig"><span className="k">Paid</span><span className="v mono">{reward(data.paidBase, data.chainId)}</span></div>
            <div className="v2-econ-fig"><span className="k">Remaining</span><span className="v mono">{reward(data.remainingBase, data.chainId)}</span></div>
          </div>
          <div className="v2-econ-bar"><span style={{ width: `${pct}%` }} /></div>
          <div className="v2-econ-meta">
            <span>{networkLabel(data.chainId)}</span>
            <span>·</span>
            <span>{data.missionCount} mission{data.missionCount === 1 ? "" : "s"}</span>
            <span>·</span>
            <span>{data.paidCompletions}/{data.totalCompletions} paid</span>
          </div>
          {data.isTestnet && (
            <p className="v2-testnote">
              Payouts here are real on-chain testnet transactions. Test mUSDC has no monetary value.
            </p>
          )}
        </div>

        {/* the mandate */}
        <div className={`cw-mandate ${autopilot ? "cw-mandate-auto" : ""}`}>
          {autopilot ? <Zap size={15} /> : <Hand size={15} />}
          <div>
            <div className="cw-mandate-t">
              {autopilot ? "Autopilot — Sage pays verified work on its own" : "Manual — you confirm each payout"}
            </div>
            <div className="cw-mandate-s">
              {autopilot
                ? `Sage settles a submission when its confidence clears the ${data.autopilotThreshold != null ? Math.round(data.autopilotThreshold * 100) : 85}% bar — inside your on-chain limits, which it can never exceed.`
                : "Sage verifies and recommends; you release each reward. Every spend still passes the vault's on-chain checks."}
            </div>
          </div>
        </div>
      </div>

      <SageActivity campaignId={data.id} chainId={data.chainId} initial={data.activity} />

      {/* share the tester link */}
      <div className="sage-agent-card" style={{ marginBottom: 14 }}>
        <div className="cw-sec-k">Invite testers</div>
        <div className="cw-share">
          <code className="cw-share-url mono">{data.testerUrl}</code>
          <button
            className="sage-btn"
            onClick={() => {
              navigator.clipboard?.writeText(data.testerUrl).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                },
                () => {},
              );
            }}
          >
            {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}
          </button>
          <Link href={`/c/${data.id}`} className="cw-link">
            Open board <ExternalLink size={13} />
          </Link>
        </div>
      </div>

      {/* missions */}
      <div className="cw-sec-label">Missions</div>
      <div className="cw-missions">
        {data.missions.map((m, i) => (
          <div key={i} className={`cw-mission ${m.full ? "cw-mission-full" : ""}`}>
            <div className="cw-mission-top">
              <span className="cw-mission-title">{m.title}</span>
              <span className="cw-mission-reward mono">{reward(m.rewardBase, data.chainId)}</span>
            </div>
            <div className="cw-mission-slots">
              <span>{m.paid}/{m.maxCompletions} paid</span>
              {m.full ? (
                <span className="cw-slot-full">Full</span>
              ) : (
                <span className="cw-slot-open">{m.remainingSlots} open</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* submissions */}
      <div className="cw-sec-label">Tester submissions</div>
      {data.submissions.length === 0 ? (
        <div className="sage-agent-card cw-empty">
          No submissions yet. Share the tester link above — Sage reviews and pays each valid
          submission automatically, inside your limits.
        </div>
      ) : (
        <div className="cw-subs">
          {data.submissions.map((s, i) => {
            const meta = STATE_META[s.state];
            return (
              <div key={i} className="cw-sub">
                <div className="cw-sub-main">
                  <span className="cw-sub-wallet mono">{short(s.wallet)}</span>
                  <span className="cw-sub-mission">{s.missionTitle}</span>
                </div>
                <div className="cw-sub-right">
                  {s.confidence != null && (
                    <span className="cw-sub-conf mono">{Math.round(s.confidence * 100)}%</span>
                  )}
                  <span className={`cw-sub-state ${meta.cls}`}>{meta.label}</span>
                  {s.proofTx ? (
                    <Link href={`/proof/${s.proofTx}`} className="cw-link">
                      Proof <ExternalLink size={12} />
                    </Link>
                  ) : (
                    <span className="cw-sub-reason">{s.reason ?? ""}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* provenance — progressive disclosure */}
      <button className="cw-tech-toggle" onClick={() => setShowTech((v) => !v)}>
        <ChevronDown size={14} style={{ transform: showTech ? "rotate(180deg)" : "none" }} />
        Vault & provenance
      </button>
      {showTech && (
        <div className="sage-agent-card cw-tech">
          <Row k="Vault">
            <a href={data.vaultExplorerUrl} target="_blank" rel="noopener noreferrer" className="cw-link mono">
              {short(data.vaultAddress)} <ExternalLink size={12} />
            </a>
          </Row>
          {data.campaignIdHash && <Row k="Campaign id hash"><span className="mono cw-hash">{data.campaignIdHash}</span></Row>}
          {data.missionPlanDigest && <Row k="Mission plan digest"><span className="mono cw-hash">{data.missionPlanDigest}</span></Row>}
          <Row k="Operator authority"><span>Bounded payout role — six on-chain checks + replay protection</span></Row>
          {data.proofBaseTx && (
            <Row k="Latest proof">
              <Link href={`/proof/${data.proofBaseTx}`} className="cw-link">Open receipt <ExternalLink size={12} /></Link>
            </Row>
          )}
        </div>
      )}

      <footer className="sage-hint" style={{ padding: "22px 2px 60px" }}>
        You own the campaign vault; Sage is the bounded operator. It reviews each submission and
        pays eligible work within your on-chain limits — it can never exceed the budget, the
        per-mission reward, or the completion caps.
      </footer>
    </main>
  );
}

function TopBar({ chainId }: { chainId: number }) {
  return (
    <header className="sb-top">
      <Link href="/" className="sb-brand" style={{ textDecoration: "none" }}>
        <SageMark size={20} /> Sage
      </Link>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        <Link href="/dashboard" className="cw-link" style={{ textDecoration: "none" }}>
          Dashboard
        </Link>
        <NetworkChip chainId={chainId} size="xs" />
        <span className="sb-net"><span className="dot" /> Founder console</span>
      </span>
    </header>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="cw-row">
      <span className="cw-row-k">{k}</span>
      <span className="cw-row-v">{children}</span>
    </div>
  );
}
