"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles,
  ShieldCheck,
  Copy,
  Check,
  ExternalLink,
  ChevronDown,
  Zap,
  Hand,
} from "lucide-react";
import { reward, networkLabel, short, since } from "@/lib/format";
import { ConnectWallet } from "@/components/app/connect-wallet";
import {
  SageActivity,
  type ActivityData,
} from "@/components/campaigns/sage-activity";
import { StopWithdrawCard } from "@/components/campaign/stop-withdraw-card";
import { StarknetStopWithdrawCard } from "@/components/campaign/starknet-stop-withdraw-card";
import { chainConfig } from "@/lib/deputy/networks";
import { FounderSignIn } from "@/components/wallet/founder-sign-in";
import "@/styles/wallet-connect.css";

/** One tester submission, already reduced to display truth on the server. */
export interface WorkspaceSubmission {
  /** the submission's own id — needed to release or refuse it from here. */
  id: string;
  wallet: string;
  missionTitle: string;
  /** reviewing = no decision yet · verified = decided pay, settling/awaiting · held · paid */
  state: "reviewing" | "verified" | "held" | "refused" | "paid";
  confidence: number | null;
  reason: string | null;
  proofTx: string | null;
  at: number;
  /** what the tester actually WROTE — the deliverable. Owner-only; never rendered publicly. */
  account: string | null;
  /** the evidence link they submitted — what Sage fetched and judged. */
  evidenceUrl?: string | null;
  /** the mission's reward, so a paid report can state its own value. */
  rewardBase: number | null;
}

export interface WorkspaceMission {
  title: string;
  rewardBase: number;
  maxCompletions: number;
  paid: number;
  remainingSlots: number;
  full: boolean;
}

export interface WorkspaceIntegrity {
  decided: number;
  twins: number;
  nearDups: number;
  freshWallets: number;
  clusters: number;
  otherFlags: number;
}

export interface WorkspaceData {
  isOwner: boolean;
  /** the judge's cross-submission work, counted from real signal names — see the console loader. */
  integrity: WorkspaceIntegrity;
  id: string;
  title: string;
  description: string;
  status: string;
  chainId: number;
  /** Sage for teams: `unlisted` campaigns are reachable only through their own door. */
  visibility: "listed" | "unlisted";
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

/**
 * RELEASING WORK SAGE HELD.
 *
 * A hold is not a refusal — it is Sage saying it could not verify enough to pay on its own and
 * asking the person whose money it is. Until now there was nowhere to answer: the review queue
 * lived in Telegram and in an operator script, so a founder who signed in with a wallet could read
 * "held for human review" in their own console and had no way to do the reviewing. On the Starknet
 * rail that is every founder, because the walletless Telegram path launches on GOAT.
 *
 * It is the founder's vault and the vault still bounds the payout: releasing here asks the same
 * settlement path autopay uses, and the vault can still refuse. This adds a decision, not an
 * exemption — Sage's assessment stays on screen next to it, including the reasons it held.
 */
function HeldDecision({
  campaignId,
  submissionId,
}: {
  campaignId: string;
  submissionId: string;
}) {
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [askReason, setAskReason] = useState(false);
  const [reason, setReason] = useState("");
  const decide = async (decision: "approve" | "reject", reasonText?: string) => {
    setError(null);
    setBusy(decision);
    try {
      const res = await fetch(
        `/api/campaigns/${campaignId}/submissions/${submissionId}/decide`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(reasonText ? { decision, reason: reasonText } : { decision }),
        },
      );
      const json = (await res.json()) as {
        error?: string;
        settled?: boolean;
        reason?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "That did not go through.");
        return;
      }
      // A release does not always PAY on the spot — the vault can hold it for the next sweep, and
      // saying "paid" here when it did not would be the one claim this product never makes.
      setDone(
        decision === "reject"
          ? "Refused."
          : json.settled
            ? "Released — paying now."
            : `Approved. ${json.reason ?? "Sage will settle it on the next pass."}`,
      );
    } catch {
      setError("Network error — nothing was decided.");
    } finally {
      setBusy(null);
    }
  };

  if (done) return <span className="cw-card-note">{done}</span>;
  return (
    <span className="cw-decide">
      <button
        className="sage-btn sage-btn-primary sage-btn-sm"
        disabled={busy !== null}
        onClick={() => void decide("approve")}
      >
        {busy === "approve" ? "Releasing…" : "Release payment"}
      </button>
      {!askReason ? (
        <button className="sage-btn sage-btn-sm" disabled={busy !== null} onClick={() => setAskReason(true)}>
          Refuse
        </button>
      ) : (
        <span className="cw-decide-reason">
          <input
            className="lx-input"
            type="text"
            maxLength={300}
            placeholder="Why — one line the submitter will see (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button className="sage-btn sage-btn-sm" disabled={busy !== null} onClick={() => void decide("reject", reason.trim() || undefined)}>
            {busy === "reject" ? "Refusing…" : "Confirm refusal"}
          </button>
          <button className="sage-btn sage-btn-sm" disabled={busy !== null} onClick={() => setAskReason(false)}>
            Cancel
          </button>
        </span>
      )}
      {error && <span className="cw-card-note cw-decide-err">{error}</span>}
    </span>
  );
}

const STATE_META: Record<
  WorkspaceSubmission["state"],
  { label: string; cls: string }
> = {
  reviewing: { label: "Reviewing", cls: "cw-st-rev" },
  verified: { label: "Verified · paying", cls: "cw-st-ver" },
  held: { label: "Held", cls: "cw-st-held" },
  refused: { label: "Refused", cls: "cw-st-held" },
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
  const router = useRouter();
  return (
    <main className="sb-shell">
      <div
        className="sage-agent-card"
        style={{ maxWidth: 520, margin: "40px auto" }}
      >
        <div className="sage-eyebrow">
          <ShieldCheck size={13} /> Founder console
        </div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: "6px 0 8px",
          }}
        >
          Connect the wallet that owns this campaign
        </h1>
        <p
          style={{
            fontSize: 14.5,
            color: "var(--sec)",
            lineHeight: 1.55,
            margin: "0 0 18px",
          }}
        >
          Only the founder who deployed and funded the vault can manage it here.
          Sign in with that wallet, or view the public tester board instead.
        </p>
        {/* Any wallet family: a campaign console is a question of WHO you are, and a founder who
            funded on Starknet must be able to open the console for what they funded. The EVM chip
            stays alongside because managing an EVM vault still needs an EVM wallet connected. */}
        <div style={{ marginTop: 4 }}>
          <FounderSignIn
            explainer={
              <>
                Sign in to manage this campaign — <b>Ethereum or Starknet.</b>
              </>
            }
            onSignedIn={() => router.refresh()}
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <ConnectWallet chainId={data.chainId} />
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
  const [inviteCopied, setInviteCopied] = useState(false);
  const [showTech, setShowTech] = useState(false);
  const pct =
    data.fundedBase > 0
      ? Math.round((data.paidBase / data.fundedBase) * 100)
      : 0;
  const status = data.status.toLowerCase();
  const isStopped = status === "cancelled" || status === "stopped";
  // Economically complete: every mission slot paid → all rewards released, budget spent.
  const allPaid =
    data.totalCompletions > 0 && data.paidCompletions >= data.totalCompletions;
  const isDone =
    !isStopped && (status === "completed" || status === "closed" || allPaid);
  const statusLabel = isStopped
    ? "Stopped"
    : isDone
      ? "Completed"
      : status === "paused"
        ? "Paused"
        : "Live";
  const statusClass = isStopped
    ? "cw-status-stopped"
    : isDone
      ? "cw-status-done"
      : "cw-status-live";
  const autopilot = data.autonomy === "autopilot";

  const wrote = data.submissions.filter(
    (s) => s.account && s.account.trim().length > 0,
  );
  const paidCount = data.submissions.filter((s) => s.state === "paid").length;

  return (
    <main className="sb-board cw-board">
      {/*
        THE PAGE HEADER follows the same shape as /dashboard and /marketplace — eyebrow, Geist
        display title, lede, headline numbers BESIDE the title, one rule underneath. It used to be
        a bordered card with a small heading, which is why this screen read as older and heavier
        than every other surface in the app while showing more important information.
      */}
      <header className="cw-hero">
        <div className="cw-hero-main">
          <div className="sage-eyebrow">
            <ShieldCheck size={13} /> Founder console · you own this vault
          </div>
          <h1 className="dash-display cw-title">{data.title}</h1>
          <p className="cw-lede">
            <span className={`cw-status ${statusClass}`}>{statusLabel}</span>
            {isStopped
              ? "Stopped — the remaining funds were returned to your wallet."
              : isDone
                ? "All missions completed — every reward has been paid."
                : `${data.paidCompletions} of ${data.totalCompletions} slots paid. Sage keeps working until they are full.`}
          </p>
          {data.description && (
            <p className="cw-lede cw-lede-desc">{data.description}</p>
          )}
          {/* SAGE FOR TEAMS — an invite-only campaign's door is the thing the founder shares.
              Shown here, on the console, because the marketplace will never show it anywhere. */}
          {data.visibility === "unlisted" && (
            <div className="cw-invite" role="group" aria-label="Invite link">
              <b>Invite only</b>
              <span>Off the public board — share this door with your people:</span>
              <code>{data.testerUrl}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(data.testerUrl).then(
                    () => setInviteCopied(true),
                    () => setInviteCopied(false),
                  );
                }}
              >
                {inviteCopied ? "Copied" : "Copy link"}
              </button>
            </div>
          )}
        </div>

        <dl className="cw-hero-stats">
          <div>
            <dd className="mono">{reward(data.fundedBase, data.chainId)}</dd>
            <dt>Funded</dt>
          </div>
          <div>
            <dd className="mono cw-hstat-paid">
              {reward(data.paidBase, data.chainId)}
            </dd>
            <dt>Released</dt>
          </div>
          <div>
            <dd className="mono">{reward(data.remainingBase, data.chainId)}</dd>
            <dt>Remaining</dt>
          </div>
        </dl>
      </header>

      <div className="cw-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="cw-meta">
        <span>{networkLabel(data.chainId)}</span>
        <span>
          {data.missionCount} mission{data.missionCount === 1 ? "" : "s"}
        </span>
        <span>
          {data.paidCompletions}/{data.totalCompletions} paid
        </span>
        <span className="cw-meta-mandate">
          {autopilot ? <Zap size={12} /> : <Hand size={12} />}
          {autopilot
            ? "Autopilot — Sage settles verified work inside your on-chain limits"
            : "Manual — Sage recommends, you release each reward"}
        </span>
      </p>
      {data.isTestnet && (
        <p className="cw-testnote">
          Payouts here are real on-chain testnet transactions. Test mUSDC has no
          monetary value.
        </p>
      )}

      <div className="cw-grid">
        <div className="cw-main">
          {/*
        THE FEEDBACK LOG — the reason a founder opens this page.
        This used to be a compressed status list (wallet · state · confidence) with the tester's
        words tucked underneath as a footnote, which is exactly backwards: the founder paid for
        the words. Here each submission reads as an entry in a log — who, which mission, when,
        what they wrote in full, and what Sage decided. Held and refused work is included on
        purpose: a founder who only sees the paid ones is reading a filtered version of their
        own campaign.
      */}
          <section className="cw-log-wrap">
            <header className="cw-log-head">
              <h2 className="cw-log-h">What your testers told you</h2>
              <p className="cw-log-sub">
                Every word, newest first — including the reports Sage held or
                refused. You paid for the verified ones. You get to read all of
                them.
              </p>
              {data.submissions.length > 0 && (
                <dl className="cw-log-stats">
                  <div>
                    <dt>Reports</dt>
                    <dd className="mono">{wrote.length}</dd>
                  </div>
                  <div>
                    <dt>Paid</dt>
                    <dd className="mono">{paidCount}</dd>
                  </div>
                  <div>
                    <dt>Released</dt>
                    <dd className="mono">
                      {reward(data.paidBase, data.chainId)}
                    </dd>
                  </div>
                </dl>
              )}
            </header>

            {data.submissions.length === 0 ? (
              <div className="cw-empty">
                <p>No reports yet.</p>
                <p>
                  Share the tester link — Sage reviews and pays each verified
                  submission automatically, inside the limits you set.
                </p>
              </div>
            ) : (
              <ol className="cw-log">
                {data.submissions.map((s, i) => {
                  const meta = STATE_META[s.state];
                  const prev = data.submissions[i - 1];
                  // The mission title repeats on nearly every row when a campaign has one mission.
                  // Printing it 14 times is noise, so it appears only when the mission CHANGES.
                  const showMission =
                    !prev || prev.missionTitle !== s.missionTitle;
                  return (
                    <li key={i} className={`cw-entry cw-entry-${s.state}`}>
                      {showMission && (
                        <p className="cw-entry-mission">{s.missionTitle}</p>
                      )}
                      <article className="cw-card">
                        <header className="cw-card-top">
                          <span
                            className="cw-mono-badge"
                            style={monogramStyle(s.wallet)}
                            aria-hidden
                          >
                            {s.wallet.slice(2, 4).toUpperCase()}
                          </span>
                          <span className="cw-card-who mono">
                            {short(s.wallet)}
                          </span>
                          <span className={`cw-chip ${meta.cls}`}>
                            {meta.label}
                          </span>
                          <time className="cw-card-when">{since(s.at)}</time>
                        </header>

                        {s.account ? (
                          <blockquote className="cw-card-body">
                            {s.account}
                          </blockquote>
                        ) : (
                          <p className="cw-card-empty">
                            No written account was submitted.
                          </p>
                        )}

                        {s.evidenceUrl && (
                          <p className="cw-card-note">
                            Evidence:{" "}
                            <a href={s.evidenceUrl} target="_blank" rel="noopener noreferrer" className="cw-link">
                              {s.evidenceUrl.length > 72 ? `${s.evidenceUrl.slice(0, 72)}…` : s.evidenceUrl}
                            </a>
                          </p>
                        )}
                        <footer className="cw-card-foot">
                          {s.state === "paid" && s.rewardBase != null && (
                            <span className="cw-card-amt mono">
                              {reward(s.rewardBase, data.chainId)}
                            </span>
                          )}
                          {s.confidence != null && (
                            <span className="cw-card-note mono">
                              {Math.round(s.confidence * 100)}% confidence
                            </span>
                          )}
                          {s.reason && (
                            <span className="cw-card-note">{s.reason}</span>
                          )}
                          {s.state === "held" && (
                            <HeldDecision
                              campaignId={data.id}
                              submissionId={s.id}
                            />
                          )}
                          {s.proofTx && (
                            <Link
                              href={`/proof/${s.proofTx}`}
                              className="cw-card-proof"
                            >
                              Receipt <ExternalLink size={12} />
                            </Link>
                          )}
                        </footer>
                      </article>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <SageActivity
            campaignId={data.id}
            chainId={data.chainId}
            initial={data.activity}
          />
        </div>

        <aside className="cw-side">
          {/* share the tester link */}
          <div className="sage-agent-card cw-side-card">
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
                {copied ? (
                  <>
                    <Check size={14} /> Copied
                  </>
                ) : (
                  <>
                    <Copy size={14} /> Copy link
                  </>
                )}
              </button>
              <Link href={`/c/${data.id}`} className="cw-link">
                Open board <ExternalLink size={13} />
              </Link>
            </div>
            {/* THE ECOSYSTEM TISSUE: from any campaign, the agent one click away and already
                briefed. Reuses the /agent?ask= prefill — composer, never auto-sent, so the
                founder always sees the words before Sage acts on them. */}
            <Link
              href={`/agent?ask=${encodeURIComponent(`How is my campaign "${data.title}" (${data.id}) doing — anything that needs my attention?`)}`}
              className="cw-link cw-ask-sage"
            >
              <Sparkles size={13} /> Ask Sage about this campaign
            </Link>
          </div>

          {/* THE JUDGE'S CROSS-CHECKS — the intelligence the founder paid for, visible in its own
              words. Counts come from the decisions' real signal names; nothing here is estimated.
              Rendered only once work has been decided — a promise box would be marketing. */}
          {data.isOwner && data.integrity.decided > 0 && (
            <div className="cw-integrity">
              <div className="cw-sec-k">Integrity checks</div>
              <p className="cw-int-lede">
                Every submission is judged against Sage&rsquo;s own evidence <em>and against every
                other submission</em> on this campaign — content twins, near-duplicates, wallet
                patterns.
              </p>
              <ul className="cw-int-list">
                <li>
                  <span className="mono">{data.integrity.decided}</span> cross-checked
                </li>
                <li className={data.integrity.twins > 0 ? "is-hit" : ""}>
                  <span className="mono">{data.integrity.twins}</span> duplicate artifacts caught
                </li>
                <li className={data.integrity.nearDups > 0 ? "is-hit" : ""}>
                  <span className="mono">{data.integrity.nearDups}</span> near-duplicates caught
                </li>
                <li className={data.integrity.clusters > 0 ? "is-hit" : ""}>
                  <span className="mono">{data.integrity.clusters}</span> funding-cluster flags
                </li>
                <li>
                  <span className="mono">{data.integrity.freshWallets}</span> fresh-wallet cautions
                </li>
              </ul>
            </div>
          )}

          {/* missions */}
          <div className="cw-sec-label">Missions</div>
          <div className="cw-missions">
            {data.missions.map((m, i) => (
              <div
                key={i}
                className={`cw-mission ${m.full ? "cw-mission-full" : ""}`}
              >
                <div className="cw-mission-top">
                  <span className="cw-mission-title">{m.title}</span>
                  <span className="cw-mission-reward mono">
                    {reward(m.rewardBase, data.chainId)}
                  </span>
                </div>
                <div className="cw-mission-slots">
                  <span>
                    {m.paid}/{m.maxCompletions} paid
                  </span>
                  {m.full ? (
                    <span className="cw-slot-full">Full</span>
                  ) : (
                    <span className="cw-slot-open">
                      {m.remainingSlots} open
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* provenance — progressive disclosure */}
          <button
            className="cw-tech-toggle"
            onClick={() => setShowTech((v) => !v)}
          >
            <ChevronDown
              size={14}
              style={{ transform: showTech ? "rotate(180deg)" : "none" }}
            />
            Vault & provenance
          </button>
          {showTech && (
            <div className="sage-agent-card cw-tech">
              <Row k="Vault">
                <a
                  href={data.vaultExplorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cw-link mono"
                >
                  {short(data.vaultAddress)} <ExternalLink size={12} />
                </a>
              </Row>
              {data.campaignIdHash && (
                <Row k="Campaign id hash">
                  <span className="mono cw-hash">{data.campaignIdHash}</span>
                </Row>
              )}
              {data.missionPlanDigest && (
                <Row k="Mission plan digest">
                  <span className="mono cw-hash">{data.missionPlanDigest}</span>
                </Row>
              )}
              <Row k="Operator authority">
                <span>
                  Bounded payout role — six on-chain checks + replay protection
                </span>
              </Row>
              {data.proofBaseTx && (
                <Row k="Latest proof">
                  <Link href={`/proof/${data.proofBaseTx}`} className="cw-link">
                    Open receipt <ExternalLink size={12} />
                  </Link>
                </Row>
              )}
            </div>
          )}

          {chainConfig(data.chainId).evm ? (
            <StopWithdrawCard
              campaignId={data.id}
              vaultAddress={data.vaultAddress}
              chainId={data.chainId}
              explorerUrl={chainConfig(data.chainId).explorerUrl}
            />
          ) : (
            /* The EVM card is viem all the way down and cannot read a felt — it sat on "reading
             vault balance…" while telling a founder to connect a wallet they already had. */
            <StarknetStopWithdrawCard
              campaignId={data.id}
              vaultAddress={data.vaultAddress}
              explorerUrl={chainConfig(data.chainId).explorerUrl}
            />
          )}
        </aside>
      </div>

      <footer className="sage-hint cw-foot">
        You own the campaign vault; Sage is the bounded operator. It reviews
        each submission and pays eligible work within your on-chain limits — it
        can never exceed the budget, the per-mission reward, or the completion
        caps. You can stop the campaign and withdraw the remaining funds at any
        time.
      </footer>
    </main>
  );
}

/**
 * A stable colour per wallet. Fourteen identical grey rows read as a database dump; a founder is
 * reading FOURTEEN PEOPLE. The hue is derived from the address so the same tester looks the same
 * every time, and the tint is faint enough to identify without decorating.
 */
function monogramStyle(wallet: string): React.CSSProperties {
  let h = 0;
  for (let i = 2; i < wallet.length; i++)
    h = (h * 31 + wallet.charCodeAt(i)) % 360;
  return {
    color: `hsl(${h} 42% 38%)`,
    background: `hsl(${h} 46% 94%)`,
    borderColor: `hsl(${h} 34% 84%)`,
  };
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="cw-row">
      <span className="cw-row-k">{k}</span>
      <span className="cw-row-v">{children}</span>
    </div>
  );
}
