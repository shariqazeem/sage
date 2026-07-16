"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CheckCircle2, Clock, ExternalLink, Loader2, ShieldCheck, XCircle, Target,
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
import { DeputyAssessmentCard } from "./deputy-assessment";

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
}

interface MySubmission {
  id: string;
  status: string;
  payoutTx: string | null;
  brief: DecisionBrief | null;
  autopay: { state: "settled" | "held"; reason: string | null } | null;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

function beat(m: MySubmission): { icon: ReactNode; text: string; color: string } {
  if (m.status === "paid") return { icon: <CheckCircle2 size={15} color="var(--pos)" />, text: "Paid · reward released to your wallet", color: "var(--pos)" };
  if (m.status === "rejected") return { icon: <XCircle size={15} color="var(--dan)" />, text: "This submission did not meet the mission criteria", color: "var(--dan)" };
  if (m.status === "blocked") return { icon: <XCircle size={15} color="var(--dan)" />, text: "The vault blocked this payout — no funds moved", color: "var(--dan)" };
  const highFraud = m.brief?.fraudSignals?.some((f) => f.severity === "high");
  const held = m.autopay?.state === "held" || (!!m.brief && m.brief.recommendation !== "pay");
  if (held) {
    const why = highFraud ? "a fraud signal was flagged" : m.brief?.recommendation === "hold" ? "Sage needs more evidence" : "needs a human look";
    return { icon: <Clock size={15} color="var(--warn)" />, text: `Held — ${why}`, color: "var(--warn)" };
  }
  if (m.brief) return { icon: <ShieldCheck size={15} color="var(--accent)" />, text: `Verified · ${Math.round(clamp01(m.brief.confidence) * 100)}% confidence`, color: "var(--accent)" };
  return { icon: <Loader2 size={15} className="sage-spin2" color="var(--accent)" />, text: "Sage is reviewing your evidence…", color: "var(--sec)" };
}

/**
 * A single mission: its brief, exact reward (network-truthful), remaining slots, and — for
 * a signed-in tester — a structured evidence form that produces an EIP-712 evidence
 * commitment before submit. After submitting, the tester WATCHES the real pipeline decide
 * and (on autopilot) pay, polling /me?mission=<hash>. A paid entry links to its proof.
 */
function MissionCard({ campaignId, campaignIdHash, chainId, mission, live }: {
  campaignId: string; campaignIdHash: string; chainId: number; mission: MissionView; live: boolean;
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
      if (next?.brief && !hadBrief.current) setMaterialized(true);
      hadBrief.current = !!next?.brief;
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

  return (
    <div className="v2-mission">
      <div className="v2-mission-head">
        <div className="v2-mission-title"><Target size={15} /> {mission.title}</div>
        <div className="v2-mission-reward mono">{rewardLabel}</div>
      </div>
      {mission.objective && <p className="v2-mission-obj">{mission.objective}</p>}
      <div className="v2-mission-meta">
        <span className="v2-chip">{mission.remainingSlots}/{mission.maxCompletions} slots left</span>
        {mission.targetSurface && <a className="v2-chip link" href={mission.targetSurface} target="_blank" rel="noopener noreferrer">{hostOf(mission.targetSurface)}</a>}
      </div>

      {/* already submitted → watch the real pipeline decide + pay */}
      {mine ? (
        <div className="v2-status">
          <div className="mono" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: beat(mine).color }}>
            {beat(mine).icon} {beat(mine).text}
          </div>
          {mine.status === "paid" && mine.payoutTx && (
            <a className="sage-sub-link" href={`/proof/${mine.payoutTx}`}><ExternalLink size={13} /> View payout proof</a>
          )}
          {mine.brief && <DeputyAssessmentCard brief={mine.brief} rewardUsd={null} threshold={0.85} materialize={materialized} />}
        </div>
      ) : mission.full ? (
        <div className="v2-full">This mission is full — every reward has been paid.</div>
      ) : !live ? (
        <div className="v2-full">This mission isn&apos;t open for submissions right now.</div>
      ) : !siwe.authed ? (
        <button className="sage-btn sage-btn-primary" disabled={siwe.signingIn} onClick={() => void siwe.signIn()}>
          {siwe.signingIn ? <><Loader2 size={15} className="sage-spin2" /> Signing…</> : siwe.address ? <><ShieldCheck size={15} /> Sign in to submit</> : "Connect wallet to submit"}
        </button>
      ) : !open ? (
        <button className="sage-btn sage-btn-primary" onClick={() => setOpen(true)}>Submit evidence</button>
      ) : (
        <div className="v2-form">
          {mission.evidenceList.length > 0 && (
            <ul className="v2-evreq">{mission.evidenceList.map((e, i) => <li key={i}>{e}</li>)}</ul>
          )}
          <div className="sage-field">
            <label className="sage-label">Public evidence link</label>
            <input className="sage-input" placeholder="https://… a public link to your proof" value={evidence} onChange={(e) => setEvidence(e.target.value)} disabled={busy} />
          </div>
          <div className="sage-field">
            <label className="sage-label">What you observed</label>
            <textarea className="sage-textarea" rows={3} placeholder="Quote the exact text or describe what you saw." value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
          <p className="sage-hint" style={{ margin: "2px 0 10px" }}>You&apos;ll sign a message binding this exact evidence to your wallet — it authorizes no transaction and moves no funds.</p>
          <div className="sage-row">
            <button className="sage-btn sage-btn-primary" disabled={busy} onClick={() => void submit()}>
              {busy ? <><Loader2 size={15} className="sage-spin2" /> Signing + submitting…</> : "Sign + submit evidence"}
            </button>
            <button className="sage-btn" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {error && <div className="sage-toast dan"><XCircle size={15} /> {error}</div>}
        </div>
      )}
    </div>
  );
}

/** The V2 tester mission board: real per-mission economics + signed, mission-scoped submit. */
export function V2Board({ campaignId, campaignIdHash, chainId, live, missions }: {
  campaignId: string; campaignIdHash: string; chainId: number; live: boolean; missions: MissionView[];
}) {
  return (
    <div className="v2-board">
      {missions.map((m) => (
        <MissionCard key={m.missionKey} campaignId={campaignId} campaignIdHash={campaignIdHash} chainId={chainId} mission={m} live={live} />
      ))}
    </div>
  );
}

function hostOf(u: string): string { try { return new URL(u).host; } catch { return u; } }
