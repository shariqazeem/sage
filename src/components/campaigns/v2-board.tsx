"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CheckCircle2, Clock, ExternalLink, Loader2, RefreshCw, ShieldCheck, XCircle, Target,
} from "lucide-react";
import { getAddress } from "viem";
import { reward as fmtReward } from "@/lib/format";
import { useSiwe } from "@/lib/auth/use-siwe";
import { useWallet } from "@/lib/wallet/use-wallet";
import { workerShouldPoll } from "@/lib/campaigns/live-poll";
import {
  buildEvidenceClaimTypedData, computeEvidenceDigest,
  EVIDENCE_CLAIM_SCHEMA_VERSION, EVIDENCE_CLAIM_TTL_SECONDS, type EvidenceClaim,
} from "@/lib/campaigns/evidence-claim";
import type { DecisionBrief } from "@/lib/deputy/brain-core";
import { DeputyAssessmentCard, ObservationVerdictCard, type ObservationVerdict } from "./deputy-assessment";

/** One mission's public view (serialized from V2Economics). */
export interface MissionView {
  missionKey: string;
  missionIdHash: string;
  specDigest: string | null;
  title: string;
  objective: string;
  instructions: string;
  targetSurface: string;
  criteria: string[];
  evidenceList: string[];
  rewardBase: number;
  maxCompletions: number;
  paid: number;
  remainingSlots: number;
  full: boolean;
  status: string;
  /** P16 — "observation-based" missions are founder-approved after Sage's assessment (never auto-paid). */
  verifiabilityClass?: "url-verifiable" | "observation-based";
}

interface MySubmission {
  id: string;
  status: string;
  payoutTx: string | null;
  brief: DecisionBrief | null;
  /** present ONLY for observation missions — judged against Sage's private eyes, never the url lane. */
  observation: ObservationVerdict | null;
  /** P20 — present when an observation submission is held; drives the revise-in-place affordance + coaching. */
  retry: {
    attempt: number;
    maxAttempts: number;
    attemptsLeft: number;
    retryable: boolean;
    coaching: string;
  } | null;
  autopay: { state: "settled" | "held"; reason: string | null } | null;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

function beat(m: MySubmission): { icon: ReactNode; text: string; color: string } {
  if (m.status === "paid") return { icon: <CheckCircle2 size={15} color="var(--pos)" />, text: "Paid · reward released to your wallet", color: "var(--pos)" };
  if (m.status === "rejected") return { icon: <XCircle size={15} color="var(--dan)" />, text: "This submission did not meet the mission criteria", color: "var(--dan)" };
  if (m.status === "blocked") return { icon: <XCircle size={15} color="var(--dan)" />, text: "The vault blocked this payout — no funds moved", color: "var(--dan)" };
  // OBSERVATION mission — judged against what Sage saw itself, NEVER the url-verifiable brain. P23: a
  // RETRYABLE hold reads as PROGRESS (a coaching state, accent — never "held"/review), a bar PASS reads
  // as verified-success, and only a FINAL hold (attempts exhausted / flagged) is "held for review".
  if (m.observation) {
    const o = m.observation;
    if (m.retry?.retryable) {
      return {
        icon: <RefreshCw size={15} color="var(--accent)" />,
        text: `Almost there — add a little more of what you did and saw, then resubmit.`,
        color: "var(--accent)",
      };
    }
    if (o.barPass) {
      return {
        icon: <ShieldCheck size={15} color="var(--accent)" />,
        text: `Sage verified your work — the founder releases your reward shortly.`,
        color: "var(--accent)",
      };
    }
    return {
      icon: <Clock size={15} color="var(--warn)" />,
      text: `Held for review — a person will take a look. You described ${o.distinctSources} of the ${o.keyDistinctSources} things Sage saw for itself.`,
      color: "var(--warn)",
    };
  }
  const highFraud = m.brief?.fraudSignals?.some((f) => f.severity === "high");
  // Require a brief before showing "Held" — a pending row with no decision (e.g. mid re-judge after a
  // P20 revise, when the old decision was cleared) is being REVIEWED, not held; fall through to the spinner.
  const held = !!m.brief && (m.autopay?.state === "held" || m.brief.recommendation !== "pay");
  if (held) {
    const why = highFraud ? "a fraud signal was flagged" : m.brief?.recommendation === "hold" ? "Sage needs more evidence" : "needs a human look";
    return { icon: <Clock size={15} color="var(--warn)" />, text: `Held — ${why}`, color: "var(--warn)" };
  }
  if (m.brief) return { icon: <ShieldCheck size={15} color="var(--accent)" />, text: `Verified · ${Math.round(clamp01(m.brief.confidence) * 100)}% confidence`, color: "var(--accent)" };
  return { icon: <Loader2 size={15} className="sage-spin2" color="var(--accent)" />, text: "Sage is checking your evidence against what it saw for itself…", color: "var(--sec)" };
}

/**
 * A single mission: its brief, exact reward (network-truthful), remaining slots, and — for
 * a signed-in tester — a structured evidence form that produces an EIP-712 evidence
 * commitment before submit. After submitting, the tester WATCHES the real pipeline decide
 * and (on autopilot) pay, polling /me?mission=<hash>. A paid entry links to its proof.
 */
function MissionCard({ campaignId, campaignIdHash, chainId, mission, live, isTarget }: {
  campaignId: string; campaignIdHash: string; chainId: number; mission: MissionView; live: boolean; isTarget: boolean;
}) {
  const wallet = useWallet();
  // Share ONE wallet instance with SIWE — otherwise the connect/sign-in runs on siwe's
  // internal useWallet while the evidence signature checks this one, which stays empty
  // ("Reconnect your wallet to sign" on an actually-connected wallet).
  const siwe = useSiwe(wallet);
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<MySubmission | null>(null);
  const [materialized, setMaterialized] = useState(false);
  const hadBrief = useRef(false);

  const loadMine = useCallback(async () => {
    if (!siwe.authed) { setMine(null); return; }
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/me?mission=${mission.missionIdHash}`, { cache: "no-store" });
      const json = (await res.json()) as { submission: MySubmission | null };
      const next = json.submission;
      const hasVerdict = !!(next?.brief || next?.observation);
      if (hasVerdict && !hadBrief.current) setMaterialized(true);
      hadBrief.current = hasVerdict;
      setMine(next);
    } catch { /* retry next poll */ }
  }, [campaignId, mission.missionIdHash, siwe.authed]);

  useEffect(() => { void loadMine(); }, [loadMine]);

  const pollActive = !!mine && workerShouldPoll(mine.status);
  useEffect(() => {
    if (!pollActive) return;
    let t: ReturnType<typeof setInterval> | null = null;
    const tick = () => { if (!(typeof document !== "undefined" && document.hidden)) void loadMine(); };
    t = setInterval(tick, 2500);
    return () => { if (t) clearInterval(t); };
  }, [pollActive, loadMine]);

  const submit = useCallback(async () => {
    setError(null); setBusy(true);
    try {
      const account = wallet.address;
      const walletClient = wallet.getWalletClient();
      if (!account || !walletClient) { setError("Reconnect your wallet to sign."); return; }
      const evidenceDigest = computeEvidenceDigest({ evidenceUrl: evidence.trim(), note: note.trim() });
      const now = Math.floor(Date.now() / 1000);
      const claim: EvidenceClaim = {
        schemaVersion: EVIDENCE_CLAIM_SCHEMA_VERSION,
        publicCampaignId: campaignId,
        campaignIdHash: campaignIdHash as `0x${string}`,
        missionKey: mission.missionKey,
        missionIdHash: mission.missionIdHash as `0x${string}`,
        missionSpecDigest: (mission.specDigest ?? `0x${"0".repeat(64)}`) as `0x${string}`,
        evidenceDigest,
        tester: getAddress(account),
        chainId,
        nonce: `n_${Math.floor(now).toString(16)}_${mission.missionKey}`,
        issuedAt: now,
        expiry: now + EVIDENCE_CLAIM_TTL_SECONDS,
      };
      const typed = buildEvidenceClaimTypedData(claim);
      let signature: string;
      try {
        signature = await walletClient.signTypedData({
          account: getAddress(account), domain: typed.domain, types: typed.types, primaryType: typed.primaryType, message: typed.message,
        });
      } catch { setError("You declined the signature. Nothing was submitted."); return; }
      const res = await fetch(`/api/campaigns/${campaignId}/submit`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ missionKey: mission.missionKey, evidence: evidence.trim(), note: note.trim(), claim, signature }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) { setError(json.error ?? "Could not submit."); return; }
      setOpen(false);
      await loadMine();
    } finally { setBusy(false); }
  }, [wallet, evidence, note, campaignId, campaignIdHash, chainId, mission, loadMine]);

  const rewardLabel = fmtReward(mission.rewardBase, chainId);
  const soldOut = mission.full && !mine;
  const canRetry = !!mine?.retry?.retryable;
  const isObservation = mission.verifiabilityClass === "observation-based";

  // The evidence form — reused for a FIRST submission and for a P20 revise-in-place (retry). The submit
  // handler is identical; the route decides create-vs-revise from the wallet's existing held submission.
  // P23: for an OBSERVATION mission the ACCOUNT is the evidence, so the form leads with it and demotes the
  // URL to optional; for a url-verifiable mission the public link leads, as before.
  const account = (
    <div className="sage-field">
      <label className="sage-label">What you did and saw</label>
      <textarea
        className="sage-textarea"
        rows={isObservation ? 5 : 3}
        placeholder={
          isObservation
            ? "Describe the specific screens you opened, the exact labels and text you read, and what happened when you clicked — the details only someone who actually used it would know."
            : "Quote the exact text or describe what you saw."
        }
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={busy}
      />
    </div>
  );
  const link = (
    <div className="sage-field">
      <label className="sage-label">
        {isObservation ? <>Public link <span className="muted">(optional)</span></> : "Public evidence link"}
      </label>
      <input
        className="sage-input"
        placeholder={isObservation ? "https://… only if you have a public link to add" : "https://… a public link to your proof"}
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        disabled={busy}
      />
    </div>
  );
  const formBlock = (
    <div className="v2-form">
      <EvidenceCoaching evidenceList={mission.evidenceList} observation={isObservation} />
      {isObservation ? <>{account}{link}</> : <>{link}{account}</>}
      <p className="tb-sig">You&apos;ll sign a message binding this exact evidence to your wallet — a free signature that authorizes no transaction and moves no funds.</p>
      <div className="sage-row">
        <button className="sage-btn sage-btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? <><Loader2 size={15} className="sage-spin2" /> Signing + submitting…</> : canRetry ? "Sign + resubmit" : "Sign + submit evidence"}
        </button>
        <button className="sage-btn" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error && <div className="sage-toast dan"><XCircle size={15} /> {error}</div>}
    </div>
  );

  return (
    <div id={mission.missionKey} className={`v2-mission${soldOut ? " is-sold" : ""}${isTarget ? " is-target" : ""}`}>
      <div className="v2-mission-head">
        <div className="v2-mission-title"><Target size={15} /> {mission.title}</div>
        <div className="v2-mission-reward mono">{rewardLabel}</div>
      </div>

      {soldOut ? (
        <div className="v2-sold"><CheckCircle2 size={15} className="ok" /> Full — every reward has been paid.</div>
      ) : (
        <>
          {mission.objective && <p className="v2-mission-obj">{mission.objective}</p>}
          <div className="v2-mission-meta">
            <span className="v2-slots">{mission.remainingSlots} of {mission.maxCompletions} paid slots left</span>
            {mission.targetSurface && <a className="v2-chip link" href={mission.targetSurface} target="_blank" rel="noopener noreferrer">{hostOf(mission.targetSurface)}</a>}
          </div>
          {mission.verifiabilityClass === "observation-based" && (
            <p style={{ fontSize: 12.5, color: "var(--sec)", margin: "8px 0 0", lineHeight: 1.5 }}>
              Payouts on this mission are founder-approved after Sage&apos;s assessment.
            </p>
          )}

          {/* already submitted → watch the real pipeline decide + pay */}
          {mine ? (
            <div className="v2-status">
              <div className="mono" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: beat(mine).color }}>
                {beat(mine).icon} {beat(mine).text}
              </div>
              {mine.status === "paid" && mine.payoutTx && <PaidShare reward={rewardLabel} tx={mine.payoutTx} />}
              {/* P23: a retryable hold reads as PROGRESS — the "Almost there" beat + the coaching block below
                  carry it; the verdict card (which shows a "HOLD" chip) is reserved for verified/final states. */}
              {mine.observation && !mine.retry?.retryable ? (
                <ObservationVerdictCard v={mine.observation} materialize={materialized} />
              ) : !mine.observation && mine.brief ? (
                <DeputyAssessmentCard brief={mine.brief} rewardUsd={null} threshold={0.85} materialize={materialized} />
              ) : null}
              {/* P20 retry-while-held: a thin-but-genuine observation hold self-cures — coach + let the
                  tester revise in place (no new row, no dead end). Founder is NOT pinged until attempts run out. */}
              {canRetry && (
                open ? (
                  formBlock
                ) : (
                  <div className="v2-retry">
                    <p className="v2-retry-coach">{mine.retry!.coaching}</p>
                    <button className="sage-btn sage-btn-primary" onClick={() => { setError(null); setOpen(true); }}>
                      <RefreshCw size={15} /> Revise &amp; resubmit
                      <span className="v2-retry-count mono">{mine.retry!.attemptsLeft} left</span>
                    </button>
                  </div>
                )
              )}
            </div>
          ) : !live ? (
            <div className="v2-full">This mission isn&apos;t open for submissions right now.</div>
          ) : !siwe.authed ? (
            <>
              <button className="sage-btn sage-btn-primary" disabled={siwe.signingIn} onClick={() => void siwe.signIn()}>
                {siwe.signingIn ? <><Loader2 size={15} className="sage-spin2" /> Signing…</> : siwe.address ? <><ShieldCheck size={15} /> Sign in to submit</> : "Connect wallet to submit"}
              </button>
              <p className="tb-sig">A free signature — it just proves the wallet is yours. No gas, no transaction.</p>
            </>
          ) : !open ? (
            <button className="sage-btn sage-btn-primary" onClick={() => setOpen(true)}>Submit evidence</button>
          ) : (
            formBlock
          )}
        </>
      )}
    </div>
  );
}

/** Evidence coaching driven by the mission's requirements — mirrors mission-prompt.ts rule 6:
 *  Sage reads ONE public URL as text; screenshots/uploads/logged-in pages can't be verified. */
function EvidenceCoaching({ evidenceList, observation = false }: { evidenceList: string[]; observation?: boolean }) {
  if (observation) {
    // P23 — for an observation mission Sage judges your firsthand ACCOUNT against what it saw itself.
    return (
      <div className="tb-coach">
        {evidenceList.length > 0 && (
          <div className="tb-coach-row"><span style={{ fontWeight: 650 }}>Do:</span><span>{evidenceList[0]}</span></div>
        )}
        <div className="tb-coach-row"><span className="ok">Clears</span><span>a specific, firsthand account in your own words — the exact screens, labels, and text you saw, and what happened when you acted. Details only someone who actually used it would know.</span></div>
        <div className="tb-coach-row"><span className="no">Won&apos;t clear</span><span>a vague summary, or repeating the mission card. Sage compares your account to what it saw exploring the product itself.</span></div>
      </div>
    );
  }
  return (
    <div className="tb-coach">
      {evidenceList.length > 0 && (
        <div className="tb-coach-row"><span style={{ fontWeight: 650 }}>Submit:</span><span>{evidenceList[0]}</span></div>
      )}
      <div className="tb-coach-row"><span className="ok">Works</span><span>a public URL anyone can open — e.g. <code>https://yourproduct.com/pricing</code> or a block-explorer tx page — plus the exact text you saw.</span></div>
      <div className="tb-coach-row"><span className="no">Won&apos;t work</span><span>screenshots, images, file uploads, or logged-in / private pages. Sage reads public web pages as text only.</span></div>
    </div>
  );
}

/** On paid: the amount, the proof receipt, and a ready-to-share line. */
function PaidShare({ reward, tx }: { reward: string; tx: string }) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "https://sagepays.xyz";
  const proofUrl = `${origin}/proof/${tx}`;
  const shareText = `I just got paid ${reward} by an AI agent for testing a product — verifiable proof: ${proofUrl}`;
  return (
    <div className="tb-paid">
      <div className="tb-paid-amt">{reward} released to your wallet</div>
      <div className="tb-share">
        <a className="sage-sub-link" href={`/proof/${tx}`}><ExternalLink size={13} /> View your proof receipt</a>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(shareText).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            });
          }}
        >
          {copied ? "Copied!" : "Copy share message"}
        </button>
      </div>
    </div>
  );
}

/** The top strip: how a first-time tester gets paid, in four honest steps. The final step is TRUTH-STATED
 *  to the campaign's real autopay state (P23) — it never promises automatic payout when the flag is off. */
export function HowYouGetPaid({ autopays = true }: { autopays?: boolean } = {}) {
  const steps: ReactNode[] = [
    <>Pick a mission below.</>,
    <>Connect your wallet + <b>one free signature</b> <span className="muted">— it just proves the wallet is yours. No gas, no transaction.</span></>,
    <>Do the mission, then submit <b>what you did and saw</b>.</>,
    autopays ? (
      <>Sage verifies and pays <b>USDC to your wallet</b> automatically <span className="muted">— usually within ~2 minutes, with a public proof receipt.</span></>
    ) : (
      <>Sage assesses your work against what it saw for itself; the founder confirms payouts <span className="muted">— you&apos;re paid in <b>USDC</b> with a public proof receipt.</span></>
    ),
  ];
  return (
    <div className="tb-pay">
      <div className="tb-pay-h">How you get paid</div>
      <div className="tb-steps">
        {steps.map((s, i) => (
          <div className="tb-step" key={i}>
            <div className="tb-step-n">{i + 1}</div>
            <div className="tb-step-t">{s}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A short, honest FAQ for the crypto-curious tester. */
export function TesterFaq({ perWalletCap = 1 }: { perWalletCap?: number } = {}) {
  const faqs: [string, string][] = [
    ["Where does the money come from?", "A founder pre-funded an on-chain vault with hard caps. Sage can only pay from that vault, and never above each mission's reward or completion cap — it cannot overspend."],
    ["Who decides if I get paid?", "An AI agent reads your evidence against the mission's criteria and decides. Every decision is published as a public receipt you can inspect — the reasoning and the on-chain payout."],
    ["My submission isn't paid yet — what now?", "If Sage says “almost there,” you're close — add more of what you actually did and saw (specific screens, exact labels, what happened when you clicked) and resubmit; you get a few tries. Only if those are used up, or something looks off, does it go to a person to review."],
    ["How do you keep it fair?", `Each wallet can earn up to ${perWalletCap} payout${perWalletCap === 1 ? "" : "s"} here, one per mission. Copied or near-identical reports are detected and held for a person to review — honest work in your own words is fine. A brand-new wallet is only noted as a caution for review; that alone never blocks a payout.`],
    ["What exactly does the check verify?", "For a mission Sage judges against its own private exploration, it verifies your account describes specific things Sage saw for itself — details only someone who used the product would know. To be precise about its limits: it checks that knowledge, not authorship. It cannot tell whether you experienced it first-hand or learned the specifics from someone who did. Word-for-word copies of another tester are caught; a genuine retelling in your own words is trusted. With the per-wallet cap bounding the rewards, that's a deliberate, documented boundary — we'd rather state it plainly than overclaim."],
    ["Do I pay gas?", "No. Signing in and committing your evidence are free signatures — they authorize no transaction and move no funds. Only Sage's wallet pays gas, when it pays you."],
  ];
  return (
    <div className="tb-faq">
      <div className="tb-faq-h">Good to know</div>
      {faqs.map(([q, a], i) => (
        <details key={i}>
          <summary>{q}</summary>
          <p>{a}</p>
        </details>
      ))}
    </div>
  );
}

/** The V2 tester mission board: real per-mission economics + signed, mission-scoped submit. */
export function V2Board({ campaignId, campaignIdHash, chainId, live, missions }: {
  campaignId: string; campaignIdHash: string; chainId: number; live: boolean; missions: MissionView[];
}) {
  const [target, setTarget] = useState<string | null>(null);
  // Deep link: /c/<slug>#<missionKey> scrolls that mission into view + highlights it briefly, so a
  // single mission can be shared from Telegram.
  useEffect(() => {
    const key = typeof window !== "undefined" ? decodeURIComponent(window.location.hash.replace(/^#/, "")) : "";
    if (!key || !missions.some((m) => m.missionKey === key)) return;
    setTarget(key);
    const el = document.getElementById(key);
    if (el) window.setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    const t = window.setTimeout(() => setTarget(null), 2600);
    return () => window.clearTimeout(t);
  }, [missions]);
  return (
    <div className="v2-board">
      {missions.map((m) => (
        <MissionCard key={m.missionKey} campaignId={campaignId} campaignIdHash={campaignIdHash} chainId={chainId} mission={m} live={live} isTarget={target === m.missionKey} />
      ))}
    </div>
  );
}

function hostOf(u: string): string { try { return new URL(u).host; } catch { return u; } }
