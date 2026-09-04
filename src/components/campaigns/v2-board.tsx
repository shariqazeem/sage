"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
  Target,
} from "lucide-react";
import { getAddress } from "viem";
import { MissionVerify } from "@/components/live/mission-verify";
import { reward as fmtReward } from "@/lib/format";
import { CountUp } from "@/components/app/count-up";
import { useSiwe } from "@/lib/auth/use-siwe";
import { useStarknetSiwe } from "@/lib/auth/use-starknet-siwe";
import { buildStarknetEvidenceTypedData } from "@/lib/campaigns/starknet-evidence-typed-data";
import { WalletConnect } from "@/components/wallet/wallet-connect";
import { useWallet } from "@/lib/wallet/use-wallet";
import { workerShouldPoll } from "@/lib/campaigns/live-poll";
import {
  composeAccount,
  evidencePrompts,
  hasAnyAnswer,
} from "@/lib/campaigns/evidence-answers";
import {
  buildEvidenceClaimTypedData,
  computeEvidenceDigest,
  EVIDENCE_CLAIM_SCHEMA_VERSION,
  EVIDENCE_CLAIM_TTL_SECONDS,
  type EvidenceClaim,
} from "@/lib/campaigns/evidence-claim";
import type { DecisionBrief } from "@/lib/deputy/brain-core";
import {
  DeputyAssessmentCard,
  ObservationVerdictCard,
  type ObservationVerdict,
} from "./deputy-assessment";

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
  /** "J$5,000 → $31.57 @ 158.37" when the founder priced in their currency; absent = USD. */
  denominated?: string | null;
  maxCompletions: number;
  paid: number;
  remainingSlots: number;
  full: boolean;
  status: string;
  /** P16 — "observation-based" missions are founder-approved after Sage's assessment (never auto-paid). */
  verifiabilityClass?: "url-verifiable" | "observation-based";
  /** the operator's verification contract kind — keys the evidence coaching below. */
  verificationKind?: "artifact_url" | "public_url" | "onchain_tx" | "onchain_state" | "observation";
}

interface MySubmission {
  id: string;
  status: string;
  payoutTx: string | null;
  /**
   * A private-rail payout, escrowed behind a commitment instead of sent to an address. The link IS
   * the money — the API returns it only to the worker whose submission it is.
   */
  claim: { url: string; commitment: string | null } | null;
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
  /** the founder's reason when they refused it — shown to the worker, verbatim. */
  rejectReason: string | null;
}

const clamp01 = (n: number) =>
  Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/** P26 — a small ring that fills to X-of-Y matched on mount: the retryable-hold state as MOMENTUM
 *  (progress toward the bar), never a warning. Presentational — the numbers are Sage's real match counts. */
function MatchRing({ matched, total }: { matched: number; total: number }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOn(true), 60);
    return () => clearTimeout(t);
  }, []);
  const frac = on && total > 0 ? clamp01(matched / total) : 0;
  const R = 20;
  const C = 2 * Math.PI * R;
  return (
    <div
      className="v2-ring"
      role="img"
      aria-label={`${matched} of ${total} matched`}
    >
      <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden>
        <circle cx="26" cy="26" r={R} className="v2-ring-track" />
        <circle
          cx="26"
          cy="26"
          r={R}
          className="v2-ring-prog"
          style={{ strokeDasharray: C, strokeDashoffset: C * (1 - frac) }}
        />
      </svg>
      <div className="v2-ring-mid">
        <b>
          <CountUp value={on ? matched : 0} />
        </b>
        <span>/{total}</span>
      </div>
    </div>
  );
}

function beat(m: MySubmission): {
  icon: ReactNode;
  text: string;
  color: string;
} {
  if (m.status === "paid")
    return {
      icon: <CheckCircle2 size={15} color="var(--pos)" />,
      text: "Paid · reward released to your wallet",
      color: "var(--pos)",
    };
  if (m.status === "rejected")
    return {
      icon: <XCircle size={15} color="var(--dan)" />,
      // The reason itself is rendered in full below (the retry block carries it); this line is the beat.
      text: m.retry?.retryable
        ? "Not accepted — here's why, and you can resubmit"
        : "Not accepted this time",
      color: "var(--dan)",
    };
  if (m.status === "blocked")
    return {
      icon: <XCircle size={15} color="var(--dan)" />,
      text: "The vault blocked this payout — no funds moved",
      color: "var(--dan)",
    };
  if (m.status === "approved")
    return {
      icon: <ShieldCheck size={15} color="var(--accent)" />,
      text: "Verified · approved — Sage pays after a short window it uses to check for copies and wallet clusters",
      color: "var(--accent)",
    };
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
  const held =
    !!m.brief &&
    (m.autopay?.state === "held" || m.brief.recommendation !== "pay");
  if (held) {
    // The judge approved and the autopilot still held it (a copy of another submission, a cap): say
    // so — "Verified · 95%" here read as "paying" to a worker whose money was not moving.
    if (m.brief?.recommendation === "pay" && m.autopay?.state === "held")
      return {
        icon: <Clock size={15} color="var(--warn)" />,
        text: "Verified, but held for the founder — see why below",
        color: "var(--warn)",
      };
    const unmet = (m.brief?.criteria ?? []).filter((c) => c.met === false).length;
    const total = (m.brief?.criteria ?? []).length;
    const why = highFraud
      ? "a fraud signal was flagged"
      : unmet > 0
        ? `Sage couldn't confirm ${unmet} of ${total} ${total === 1 ? "requirement" : "requirements"}`
        : m.brief?.recommendation === "hold"
          ? "Sage needs more evidence"
          : "needs a human look";
    return {
      icon: <Clock size={15} color="var(--warn)" />,
      text: m.retry?.retryable ? `Held — ${why} · you can revise` : `Held — ${why}`,
      color: "var(--warn)",
    };
  }
  if (m.brief)
    return {
      icon: <ShieldCheck size={15} color="var(--accent)" />,
      text: `Verified · ${Math.round(clamp01(m.brief.confidence) * 100)}% confidence`,
      color: "var(--accent)",
    };
  return {
    icon: <Loader2 size={15} className="sage-spin2" color="var(--accent)" />,
    text: "Sage is checking your evidence against what it saw for itself…",
    color: "var(--sec)",
  };
}

/**
 * A single mission: its brief, exact reward (network-truthful), remaining slots, and — for
 * a signed-in tester — a structured evidence form that produces an EIP-712 evidence
 * commitment before submit. After submitting, the tester WATCHES the real pipeline decide
 * and (on autopilot) pay, polling /me?mission=<hash>. A paid entry links to its proof.
 */
function MissionCard({
  campaignId,
  campaignIdHash,
  chainId,
  mission,
  live,
  isTarget,
  autopays,
  rail,
}: {
  campaignId: string;
  campaignIdHash: string;
  chainId: number;
  mission: MissionView;
  live: boolean;
  isTarget: boolean;
  /** whether THIS campaign auto-pays — server-decided, never inferred from the mission's class alone. */
  autopays: boolean;
  rail: "evm" | "starknet";
}) {
  const wallet = useWallet();
  const starknet = useStarknetSiwe();
  // Share ONE wallet instance with SIWE — otherwise the connect/sign-in runs on siwe's
  // internal useWallet while the evidence signature checks this one, which stays empty
  // ("Reconnect your wallet to sign" on an actually-connected wallet).
  const siwe = useSiwe(wallet);
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  // The mission designs its own evidence form: one answer per requirement it authored. A tester used
  // to face a single box and no idea what it had to contain, so honest people wrote two sentences and
  // the observation bar — which needs three details only a real user could know — held them.
  const [answers, setAnswers] = useState<string[]>([]);
  // The questions this mission puts to a tester, authored per product by the mission brain from what
  // Sage actually saw. Empty for a mission that carries none → one open box, an honest degradation.
  const prompts = evidencePrompts(mission.evidenceList);
  // The judged account: the tester's OWN words only. The prompts are public card text, and folding
  // them in would put language the tester merely read in front of the verifier.
  const composedNote =
    prompts.length > 0 ? composeAccount(answers) : note.trim();
  const answered =
    prompts.length === 0 ? note.trim().length > 0 : hasAnyAnswer(answers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doorDemanded, setDoorDemanded] = useState(false);
  const [mine, setMine] = useState<MySubmission | null>(null);
  const [materialized, setMaterialized] = useState(false);
  const hadBrief = useRef(false);

  /**
   * Signed in ON THE RAIL THAT PAYS — one expression, used by the sign-in gate, by this loader,
   * and by everything gated behind them, so they can never disagree about which wallet counts.
   */
  const signedIn = rail === "starknet" ? starknet.authed : siwe.authed;
  // the wallet that signed in is the wallet that gets paid — and the only one a proof may bind to
  const signedInWallet = (rail === "starknet" ? starknet.address : siwe.address) ?? "";

  const loadMine = useCallback(async () => {
    // Was `!siwe.authed`, so on the private rail a tester's OWN submission was never fetched: the
    // board stayed empty after they submitted, and the server route it calls is rail-aware.
    if (!signedIn) {
      setMine(null);
      return;
    }
    try {
      const res = await fetch(
        `/api/campaigns/${campaignId}/me?mission=${mission.missionIdHash}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as { submission: MySubmission | null };
      const next = json.submission;
      const hasVerdict = !!(next?.brief || next?.observation);
      if (hasVerdict && !hadBrief.current) setMaterialized(true);
      hadBrief.current = hasVerdict;
      setMine(next);
    } catch {
      /* retry next poll */
    }
  }, [campaignId, mission.missionIdHash, signedIn]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  const pollActive = !!mine && workerShouldPoll(mine.status);
  useEffect(() => {
    if (!pollActive) return;
    let t: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (!(typeof document !== "undefined" && document.hidden))
        void loadMine();
    };
    t = setInterval(tick, 2500);
    return () => {
      if (t) clearInterval(t);
    };
  }, [pollActive, loadMine]);

  const submit = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const onStarknet = rail === "starknet";
      // WHICHEVER RAIL, THE WALLET THAT SIGNS IS THE WALLET THAT GETS PAID. On Starknet that is the
      // signed-in Starknet account, never the EVM one a tester may also have connected.
      const account = onStarknet ? starknet.address : wallet.address;
      const walletClient = onStarknet ? null : wallet.getWalletClient();
      if (!account || (!onStarknet && !walletClient)) {
        setError("Reconnect your wallet to sign.");
        return;
      }
      // ONE string, used for both the signed digest and the request body — they must never diverge.
      const submittedNote = composedNote;
      const evidenceDigest = computeEvidenceDigest({
        evidenceUrl: evidence.trim(),
        note: submittedNote,
      });
      const now = Math.floor(Date.now() / 1000);
      const claim: EvidenceClaim = {
        schemaVersion: EVIDENCE_CLAIM_SCHEMA_VERSION,
        publicCampaignId: campaignId,
        campaignIdHash: campaignIdHash as `0x${string}`,
        missionKey: mission.missionKey,
        missionIdHash: mission.missionIdHash as `0x${string}`,
        missionSpecDigest: (mission.specDigest ??
          `0x${"0".repeat(64)}`) as `0x${string}`,
        evidenceDigest,
        // A Starknet account is a felt, not a checksummed EVM address — `getAddress` throws on one.
        tester: (onStarknet ? account : getAddress(account)) as `0x${string}`,
        chainId,
        nonce: `n_${Math.floor(now).toString(16)}_${mission.missionKey}`,
        issuedAt: now,
        expiry: now + EVIDENCE_CLAIM_TTL_SECONDS,
      };
      let signature: string | string[];
      if (onStarknet) {
        // An account CONTRACT signs, so the answer is an array of felts and there is no address to
        // recover: the server asks the account itself whether the signature is valid.
        const sig = await starknet.signTypedData(
          buildStarknetEvidenceTypedData(claim, account),
        );
        if (!sig) {
          setError("You declined the signature. Nothing was submitted.");
          return;
        }
        signature = sig;
      } else {
        const typed = buildEvidenceClaimTypedData(claim);
        try {
          signature = await walletClient!.signTypedData({
            account: getAddress(account),
            domain: typed.domain,
            types: typed.types,
            primaryType: typed.primaryType,
            message: typed.message,
          });
        } catch {
          setError("You declined the signature. Nothing was submitted.");
          return;
        }
      }
      const res = await fetch(`/api/campaigns/${campaignId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          missionKey: mission.missionKey,
          evidence: evidence.trim(),
          note: submittedNote,
          claim,
          signature,
        }),
      });
      const json = (await res.json()) as { error?: string; needsVerification?: boolean };
      if (!res.ok) {
        // The door answered: open the widget instead of printing a wall. The route stays the gate.
        if (json.needsVerification) setDoorDemanded(true);
        setError(json.error ?? "Could not submit.");
        return;
      }
      setOpen(false);
      await loadMine();
    } finally {
      setBusy(false);
    }
  }, [
    wallet,
    starknet,
    rail,
    evidence,
    composedNote,
    campaignId,
    campaignIdHash,
    chainId,
    mission,
    loadMine,
  ]);

  const rewardLabel = fmtReward(mission.rewardBase, chainId);
  const denomLabel = mission.denominated ?? null;
  const soldOut = mission.full && !mine;
  const canRetry = !!mine?.retry?.retryable;
  const isObservation = mission.verifiabilityClass === "observation-based";

  // The evidence form — reused for a FIRST submission and for a P20 revise-in-place (retry). The submit
  // handler is identical; the route decides create-vs-revise from the wallet's existing held submission.
  // P23: for an OBSERVATION mission the ACCOUNT is the evidence, so the form leads with it and demotes the
  // URL to optional; for a url-verifiable mission the public link leads, as before.
  // THE MISSION'S OWN FORM. Each requirement Sage authored for THIS product becomes a question, so a
  // tester is told exactly what to look for instead of guessing at an empty box. A mission carrying no
  // requirements still gets the single open field — never a blank form.
  const account =
    prompts.length > 0 ? (
      <div>
        {prompts.map((p, i) => (
          <div className="sage-field" key={i}>
            <label className="sage-label">{p}</label>
            <textarea
              className="sage-textarea"
              rows={2}
              placeholder="In your own words — what did you actually see?"
              value={answers[i] ?? ""}
              onChange={(e) => {
                const next = [...answers];
                next[i] = e.target.value;
                setAnswers(next);
              }}
              disabled={busy}
            />
          </div>
        ))}
        <p className="sage-hint" style={{ marginTop: -4 }}>
          Answer in your own words. Sage checks what you describe against what
          it saw itself, so the exact labels, headings and results you read are
          what count — not the wording you use.
        </p>
      </div>
    ) : (
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
        {isObservation ? (
          <>
            Public link <span className="muted">(optional)</span>
          </>
        ) : (
          "Public evidence link"
        )}
      </label>
      <input
        className="sage-input"
        placeholder={
          isObservation
            ? "https://… only if you have a public link to add"
            : "https://… a public link to your proof"
        }
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        disabled={busy}
      />
    </div>
  );
  const formBlock = (
    <div className="v2-form">
      <EvidenceCoaching
        evidenceList={mission.evidenceList}
        observation={isObservation}
        requirementsShown={prompts.length > 0}
        kind={mission.verificationKind}
      />
      {isObservation ? (
        <>
          {account}
          {link}
        </>
      ) : (
        <>
          {link}
          {account}
        </>
      )}
      <p className="tb-sig">
        You&apos;ll sign a message binding this exact evidence to your wallet —
        a free signature that authorizes no transaction and moves no funds.
      </p>
      <div className="sage-row">
        {/* An empty form costs the tester one of their limited attempts for nothing. */}
        <button
          className="sage-btn sage-btn-primary"
          disabled={busy || !answered}
          onClick={() => void submit()}
        >
          {busy ? (
            <>
              <Loader2 size={15} className="sage-spin2" /> Signing + submitting…
            </>
          ) : canRetry ? (
            "Sign + resubmit"
          ) : (
            "Sign + submit evidence"
          )}
        </button>
        <button
          className="sage-btn"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
      {error && (
        <div className="sage-toast dan">
          <XCircle size={15} /> {error}
        </div>
      )}
    </div>
  );

  return (
    <div
      id={mission.missionKey}
      className={`v2-mission${soldOut ? "is-sold" : ""}${isTarget ? "is-target" : ""}`}
    >
      <div className="v2-mission-head">
        <div className="v2-mission-title">
          <Target size={15} /> {mission.title}
        </div>
        <div className="v2-mission-reward mono">{rewardLabel}</div>
        {denomLabel && <div className="v2-mission-denom mono">{denomLabel}</div>}
      </div>

      {soldOut ? (
        <div className="v2-sold">
          <CheckCircle2 size={15} className="ok" /> Full — every reward has been
          paid.
        </div>
      ) : (
        <>
          {mission.objective && mission.objective !== `Deliverable: ${mission.title}` && mission.objective !== `Milestone: ${mission.title}` && (
            <p className="v2-mission-obj">{mission.objective}</p>
          )}
          {/* THE TASK, IN FULL, WITH ITS LINKS. The first public gig of launch week showed a worker the
              title, the title again as "Deliverable", and no steps — the founder's sentence and its
              URL lived only in the compiled instructions, which the card never rendered. */}
          {mission.instructions && mission.verifiabilityClass !== "observation-based" && (
            <div className="v2-mission-task">
              <span className="v2-mission-task-k">What to do</span>
              <p>{linkify(mission.instructions.replace(/^What must be true:\s*/i, ""))}</p>
            </div>
          )}
          <div className="v2-mission-meta">
            <span className="v2-slots">
              {mission.remainingSlots} of {mission.maxCompletions} paid slots
              left
            </span>
            {mission.targetSurface && (
              <a
                className="v2-chip link"
                href={mission.targetSurface}
                target="_blank"
                rel="noopener noreferrer"
              >
                {hostOf(mission.targetSurface)}
              </a>
            )}
          </div>
          {/* Say what THIS campaign actually does. This line used to be hardcoded to
              "observation-based", from the P16 era when such missions could never auto-pay — so with
              observation autopay armed it told testers they would be reviewed by hand when Sage was
              in fact about to pay them automatically. Under-promising is still misinformation, and on
              the money path it is the claim testers decide to take the work on. */}
          {mission.verifiabilityClass === "observation-based" && (
            <p
              style={{
                fontSize: 12.5,
                color: "var(--sec)",
                margin: "8px 0 0",
                lineHeight: 1.5,
              }}
            >
              {autopays
                ? "Sage assesses your account against what it saw itself and pays automatically when it clears."
                : "Payouts on this mission are founder-approved after Sage\u2019s assessment."}
            </p>
          )}

          {/* already submitted → watch the real pipeline decide + pay */}
          {mine ? (
            <div className="v2-status">
              <div
                className="mono"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 13,
                  color: beat(mine).color,
                }}
              >
                {beat(mine).icon} {beat(mine).text}
              </div>
              {mine.status === "paid" && mine.claim ? (
                <ClaimHandoff reward={rewardLabel} url={mine.claim.url} />
              ) : mine.status === "paid" && mine.payoutTx ? (
                <PaidShare reward={rewardLabel} tx={mine.payoutTx} wallet={rail === "starknet" ? starknet.address : wallet.address} />
              ) : null}
              {/* P23: a retryable hold reads as PROGRESS — the "Almost there" beat + the coaching block below
                  carry it; the verdict card (which shows a "HOLD" chip) is reserved for verified/final states. */}
              {mine.observation && !mine.retry?.retryable ? (
                <ObservationVerdictCard
                  v={mine.observation}
                  materialize={materialized}
                />
              ) : !mine.observation && mine.brief ? (
                <DeputyAssessmentCard
                  brief={mine.brief}
                  rewardUsd={null}
                  threshold={0.85}
                  materialize={materialized}
                />
              ) : null}
              {!mine.observation && mine.retry && !mine.retry.retryable && (
                <p className="v2-retry-coach" style={{ marginTop: 10 }}>
                  {mine.retry.coaching}
                </p>
              )}
              {/* P20 retry-while-held: a thin-but-genuine observation hold self-cures — coach + let the
                  tester revise in place (no new row, no dead end). Founder is NOT pinged until attempts run out. */}
              {canRetry &&
                (open ? (
                  formBlock
                ) : (
                  <div className="v2-retry">
                    {mine.observation ? (
                      <MatchRing
                        matched={mine.observation.distinctSources}
                        total={mine.observation.keyDistinctSources}
                      />
                    ) : (
                      <div className="v2-retry-icon" aria-hidden>
                        <RefreshCw size={18} />
                      </div>
                    )}
                    <div className="v2-retry-body">
                      <p className="v2-retry-coach">{mine.retry!.coaching}</p>
                      <button
                        className="sage-btn sage-btn-primary sage-btn-sm"
                        onClick={() => {
                          setError(null);
                          setOpen(true);
                        }}
                      >
                        <RefreshCw size={15} /> Revise &amp; resubmit
                        <span className="v2-retry-count mono">
                          {mine.retry!.attemptsLeft} left
                        </span>
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          ) : !live ? (
            <div className="v2-full">
              This mission isn&apos;t open for submissions right now.
            </div>
          ) : !signedIn ? (
            /**
             * SIGN IN ON THE RAIL THAT PAYS. The wallet that signs in is the wallet that gets
             * PAID, so on the private rail it has to be the Starknet one — offering an EVM
             * sign-in here left a tester holding a Ready wallet with no way to submit.
             *
             * ONLY the signed-out case branches by rail. It used to branch for BOTH, and the
             * signed-IN Starknet case rendered `null`: a tester who connected Ready and signed
             * successfully saw no submit control at all, because the button and the form live in
             * the tail below and only the EVM path ever reached them. Reported from the live
             * Starknet campaign. Both rails now converge here once the wallet has proved itself.
             */
            rail === "starknet" ? (
              <StarknetSubmitGate starknet={starknet} />
            ) : (
              <>
                <button
                  className="sage-btn sage-btn-primary"
                  disabled={siwe.signingIn}
                  onClick={() => void siwe.signIn()}
                >
                  {siwe.signingIn ? (
                    <>
                      <Loader2 size={15} className="sage-spin2" /> Signing…
                    </>
                  ) : siwe.address ? (
                    <>
                      <ShieldCheck size={15} /> Sign in to submit
                    </>
                  ) : (
                    "Connect wallet to submit"
                  )}
                </button>
                <p className="tb-sig">
                  A free signature — it just proves the wallet is yours. No gas,
                  no transaction.
                </p>
              </>
            )
          ) : !open ? (
            <>
              {/* Asked at the mission, before an account is written that could not be submitted. */}
              {signedInWallet ? <MissionVerify wallet={signedInWallet} campaignId={campaignId} rewardBase={mission.rewardBase} demanded={doorDemanded} onVerified={() => setDoorDemanded(false)} /> : null}
              <button
                className="sage-btn sage-btn-primary"
                onClick={() => setOpen(true)}
              >
                Submit evidence
              </button>
            </>
          ) : (
            <>
              {signedInWallet ? <MissionVerify wallet={signedInWallet} campaignId={campaignId} rewardBase={mission.rewardBase} demanded={doorDemanded} onVerified={() => setDoorDemanded(false)} /> : null}
              {formBlock}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Evidence coaching driven by the mission's requirements — mirrors mission-prompt.ts rule 6:
 *  Sage reads ONE public URL as text; screenshots/uploads/logged-in pages can't be verified. */
function EvidenceCoaching({
  evidenceList,
  observation = false,
  /** true when the requirements are already rendered as the form's own field labels — repeating the
   *  first one above them reads as a bug, not as coaching. */
  requirementsShown = false,
  kind,
}: {
  evidenceList: string[];
  observation?: boolean;
  requirementsShown?: boolean;
  kind?: "artifact_url" | "public_url" | "onchain_tx" | "onchain_state" | "observation";
}) {
  const list = requirementsShown ? [] : evidenceList;
  if (observation) {
    // P23 — for an observation mission Sage judges your firsthand ACCOUNT against what it saw itself.
    return (
      <div className="tb-coach">
        {list.length > 0 && (
          <div className="tb-coach-row">
            <span style={{ fontWeight: 650 }}>Do:</span>
            <span>{list[0]}</span>
          </div>
        )}
        <div className="tb-coach-row">
          <span className="ok">Clears</span>
          <span>
            a specific, firsthand account in your own words — the exact screens,
            labels, and text you saw, and what happened when you acted. Details
            only someone who actually used it would know.
          </span>
        </div>
        <div className="tb-coach-row">
          <span className="no">Won&apos;t clear</span>
          <span>
            a vague summary, or repeating the mission card. Sage compares your
            account to what it saw exploring the product itself.
          </span>
        </div>
        {/* MEASURED, not assumed. Accounts written in Spanish and in Urdu both verify — but only
            because the writer kept the product's own words for what was on screen. An account that
            translates everything, including the labels, matches nothing and is held, and a tester
            has no way to guess that. It is the one instruction that decides whether writing in your
            own language works, so it belongs here rather than in an FAQ nobody opens mid-task. */}
        <div className="tb-coach-row">
          <span style={{ fontWeight: 650 }}>Any language</span>
          <span>
            Write in whatever language you think in. Keep the product&apos;s own
            words for the things you saw on screen — names, buttons, headings —
            because those are what Sage matches against.
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="tb-coach">
      {list.length > 0 && (
        <div className="tb-coach-row">
          <span style={{ fontWeight: 650 }}>Submit:</span>
          <span>{list[0]}</span>
        </div>
      )}
      {/* The coaching follows the operator's contract. The first public gig of launch week was an
          artifact gig whose board still said "plus the exact text you saw" — the product-testing
          wording — and a stranger has no way to know which sentence applies to them. */}
      {kind === "artifact_url" ? (
        <>
          <div className="tb-coach-row">
            <span className="ok">Works</span>
            <span>
              a public page <b>you created</b> — a blog post, a dev.to or Medium article, a GitHub gist, a
              Notion page, your own site — that visibly shows your submitting wallet address. Any host.
            </span>
          </div>
          <div className="tb-coach-row">
            <span className="no">Won&apos;t work</span>
            <span>
              someone else&apos;s page, a copy of another submission with your address swapped in, a page
              without your wallet on it, screenshots, or anything behind a login. Sage fetches the link
              itself and checks the page carries your marker.
            </span>
          </div>
        </>
      ) : kind === "onchain_tx" || kind === "onchain_state" ? (
        <>
          <div className="tb-coach-row">
            <span className="ok">Works</span>
            <span>the transaction hash (or a block-explorer link to it), sent from your own submitting wallet.</span>
          </div>
          <div className="tb-coach-row">
            <span className="no">Won&apos;t work</span>
            <span>a transaction from another wallet, or a screenshot of one. Sage reads the chain directly.</span>
          </div>
        </>
      ) : (
        <>
          <div className="tb-coach-row">
            <span className="ok">Works</span>
            <span>
              a public URL anyone can open — e.g.{" "}
              <code>https://yourproduct.com/pricing</code> or a block-explorer tx
              page — plus the exact text you saw.
            </span>
          </div>
          <div className="tb-coach-row">
            <span className="no">Won&apos;t work</span>
            <span>
              screenshots, images, file uploads, or logged-in / private pages. Sage
              reads public web pages as text only.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** On paid: the amount, the proof receipt, and a ready-to-share line. */
/**
 * A PRIVATE PAYOUT IS HANDED OVER, NOT ANNOUNCED.
 *
 * On this rail the money is escrowed behind a commitment rather than sent to an address, so the
 * worker opens it themselves — publicly or into a shielded note, to any wallet. That is what keeps
 * their income off the identity they submitted with.
 *
 * The link is a bearer secret: whoever holds it collects. Binding it to their address would defeat
 * the whole point, so it is shown HERE, in their own signed-in panel, and nowhere else — not in a
 * notification, not in the founder's console, not in any channel Sage does not control. The copy
 * says so plainly, because someone who does not know that will paste it somewhere.
 */
function ClaimHandoff({ reward, url }: { reward: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="v2-claim">
      <p className="v2-claim-head">
        <ShieldCheck size={15} aria-hidden /> {reward} is yours to collect
      </p>
      <p className="v2-claim-body">
        It is held for you, not sent to your address — so collecting it
        privately keeps the amount off your public record.{" "}
        <b>This link is the money.</b> Anyone who has it can collect, so keep it
        to yourself.
      </p>
      <div className="v2-claim-row">
        <a
          className="sage-btn sage-btn-primary sage-btn-sm"
          href={url}
          target="_blank"
          rel="noreferrer noopener"
        >
          Collect {reward}
        </a>
        <button
          className="sage-btn sage-btn-sm"
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}

function PaidShare({ reward, tx, wallet }: { reward: string; tx: string; wallet?: string | null }) {
  const [copied, setCopied] = useState(false);
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://sagepays.xyz";
  const proofUrl = `${origin}/proof/${tx}`;
  const shareText = `I just got paid ${reward} by an AI agent for testing a product — verifiable proof: ${proofUrl}`;
  return (
    <div className="tb-paid">
      <div className="tb-paid-amt">{reward} released to your wallet</div>
      <div className="tb-share">
        <a className="sage-sub-link" href={`/proof/${tx}`}>
          <ExternalLink size={13} /> View your proof receipt
        </a>
        {/* THE ASSET THE PAYOUT LEFT BEHIND. Being paid is the moment; the record is what it
            builds — the verified history a lender can underwrite. Handing it here, at the delight
            moment, is what turns one payout into a reason to come back. */}
        {wallet && (
          <a className="sage-sub-link" href={`/record/${wallet.toLowerCase()}`}>
            <ExternalLink size={13} /> Your verified work record
          </a>
        )}
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
export function HowYouGetPaid({
  autopays = true,
}: { autopays?: boolean } = {}) {
  const steps: ReactNode[] = [
    <>Pick a mission below.</>,
    <>
      Connect your wallet + <b>one free signature</b>{" "}
      <span className="muted">
        — it just proves the wallet is yours. No gas, no transaction.
      </span>
    </>,
    <>
      Do the mission, then submit <b>what you did and saw</b>.
    </>,
    autopays ? (
      <>
        Sage verifies and pays <b>USDC to your wallet</b> automatically{" "}
        <span className="muted">
          — usually within ~2 minutes, with a public proof receipt.
        </span>
      </>
    ) : (
      <>
        Sage assesses your work against what it saw for itself; the founder
        confirms payouts{" "}
        <span className="muted">
          — you&apos;re paid in <b>USDC</b> with a public proof receipt.
        </span>
      </>
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
export function TesterFaq({
  perWalletCap = 1,
}: { perWalletCap?: number } = {}) {
  const faqs: [string, string][] = [
    [
      "Where does the money come from?",
      "A founder pre-funded an on-chain vault with hard caps. Sage can only pay from that vault, and never above each mission's reward or completion cap — it cannot overspend.",
    ],
    [
      "Who decides if I get paid?",
      "An AI agent reads your evidence against the mission's criteria and decides. Every decision is published as a public receipt you can inspect — the reasoning and the on-chain payout.",
    ],
    [
      "My submission isn't paid yet — what now?",
      "If Sage says “almost there,” you're close — add more of what you actually did and saw (specific screens, exact labels, what happened when you clicked) and resubmit; you get a few tries. Only if those are used up, or something looks off, does it go to a person to review.",
    ],
    [
      "How do you keep it fair?",
      `Each wallet can earn up to ${perWalletCap} payout${perWalletCap === 1 ? "" : "s"} here, one per mission. Copied or near-identical reports are detected and held for a person to review — honest work in your own words is fine. A brand-new wallet is only noted as a caution for review; that alone never blocks a payout.`,
    ],
    [
      "What exactly does the check verify?",
      "For a mission Sage judges against its own private exploration, it verifies your account describes specific things Sage saw for itself — details only someone who used the product would know. To be precise about its limits: it checks that knowledge, not authorship. It cannot tell whether you experienced it first-hand or learned the specifics from someone who did. Word-for-word copies of another tester are caught; a genuine retelling in your own words is trusted. With the per-wallet cap bounding the rewards, that's a deliberate, documented boundary — we'd rather state it plainly than overclaim.",
    ],
    [
      "Do I pay gas?",
      "No. Signing in and committing your evidence are free signatures — they authorize no transaction and move no funds. Only Sage's wallet pays gas, when it pays you.",
    ],
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
export function V2Board({
  campaignId,
  campaignIdHash,
  chainId,
  live,
  missions,
  autopays = false,
  rail = "evm",
}: {
  campaignId: string;
  campaignIdHash: string;
  chainId: number;
  live: boolean;
  missions: MissionView[];
  /** whether THIS campaign actually auto-pays — decided server-side by `campaignAutopays`. */
  autopays?: boolean;
  /**
   * Which chain pays, so a tester is asked for the wallet that can actually RECEIVE.
   *
   * Defaulted, so every EVM caller is unchanged. Without it a Starknet campaign offered an EVM
   * sign-in on the board — the one control a tester needs — and no Starknet worker could submit
   * at all.
   */
  rail?: "evm" | "starknet";
}) {
  const [target, setTarget] = useState<string | null>(null);
  // Deep link: /c/<slug>#<missionKey> scrolls that mission into view + highlights it briefly, so a
  // single mission can be shared from Telegram.
  useEffect(() => {
    const key =
      typeof window !== "undefined"
        ? decodeURIComponent(window.location.hash.replace(/^#/, ""))
        : "";
    if (!key || !missions.some((m) => m.missionKey === key)) return;
    setTarget(key);
    const el = document.getElementById(key);
    if (el)
      window.setTimeout(
        () => el.scrollIntoView({ behavior: "smooth", block: "start" }),
        60,
      );
    const t = window.setTimeout(() => setTarget(null), 2600);
    return () => window.clearTimeout(t);
  }, [missions]);
  return (
    <div className="v2-board sage-stagger">
      {missions.map((m) => (
        <MissionCard
          key={m.missionKey}
          campaignId={campaignId}
          campaignIdHash={campaignIdHash}
          chainId={chainId}
          mission={m}
          live={live}
          isTarget={target === m.missionKey}
          autopays={autopays}
          rail={rail}
        />
      ))}
    </div>
  );
}

function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

/** The private rail's sign-in, in the same language every other wallet moment uses. */
function StarknetSubmitGate({
  starknet,
}: {
  starknet: ReturnType<typeof useStarknetSiwe>;
}) {
  if (starknet.loading) {
    return <p className="tb-sig">Checking your wallet…</p>;
  }
  return (
    <WalletConnect
      options={starknet.wallets.map((w) => ({
        id: w.id,
        name: w.name,
        icon: w.icon,
        onSelect: () => void starknet.signIn(w),
      }))}
      explainer={
        <>
          This campaign pays on Starknet, so sign in with a Starknet wallet —{" "}
          <b>that is the address you&rsquo;ll be paid at.</b>
        </>
      }
      busy={starknet.signingIn}
      busyLabel="Waiting for your wallet…"
      error={starknet.error}
      emptyMessage="No Starknet wallet found in this browser."
      installHints={[
        { name: "Ready", url: "https://www.ready.co" },
        { name: "Braavos", url: "https://braavos.app" },
      ]}
    />
  );
}

/** Turn bare URLs and sagepays.xyz paths in a sentence into links a worker can click. Pure. */
export function linkify(text: string): ReactNode[] {
  const re = /(https?:\/\/[^\s"')<>]+|(?:^|(?<=[\s(]))sagepays\.xyz(?:\/[^\s"')<>]*)?)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const raw = m[0].replace(/[.,;:]+$/, "");
    const href = raw.startsWith("http") ? raw : `https://${raw}`;
    out.push(
      <a key={`l${k++}`} href={href} target="_blank" rel="noopener noreferrer">
        {raw}
      </a>,
    );
    last = m.index + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
