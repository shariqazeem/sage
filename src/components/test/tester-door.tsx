"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { getAddress } from "viem";
import { ArrowUpRight, Loader2 } from "lucide-react";

import { EmbeddedWalletBridge, type EmbeddedWallet } from "@/components/campaigns/embedded-wallet-bridge";
import { MissionVerify } from "@/components/live/mission-verify";
import { Button, ButtonLink } from "@/components/sage/button";
import { SignInSheet } from "@/components/sage/sign-in-sheet";
import { Ticket, type TicketState } from "@/components/sage/ticket";
import { useSiwe } from "@/lib/auth/use-siwe";
import { refreshFounderSession, useFounderSession } from "@/lib/auth/use-founder-session";
import { composeAccount, evidencePrompts, hasAnyAnswer } from "@/lib/campaigns/evidence-answers";
import { workerShouldPoll } from "@/lib/campaigns/live-poll";
import { buildEvidenceClaim, postEvidence, signEvmEvidenceClaim, type EvidenceInput } from "@/lib/campaigns/submit-evidence";
import { chainConfig } from "@/lib/deputy/networks";
import { short } from "@/lib/format";
import type { LiveMission, LiveView } from "@/lib/test-page/live";
import { useWallet } from "@/lib/wallet/use-wallet";

const emailDoor = (): boolean => !!process.env.NEXT_PUBLIC_PRIVY_LOGIN_APP_ID?.trim();
const usd = (base: number): string => `$${(base / 1_000_000).toFixed(2)}`;

/** What the server says about the signed-in person's own answer (GET /api/campaigns/<id>/me). */
interface Mine {
  id: string;
  status: string;
  payoutTx: string | null;
  rejectReason: string | null;
  brief: { summary?: string | null } | null;
  observation: unknown;
  retry: { attempt: number; maxAttempts: number; attemptsLeft: number; retryable: boolean; coaching: string } | null;
  autopay: { state: "settled" | "held"; reason: string | null } | null;
}

function ticketState(m: Mine): TicketState {
  if (m.status === "paid") return "paid";
  if (m.status === "rejected" || m.status === "blocked") return "not-paid";
  if (m.status === "pending" && !m.brief && !m.observation) return "answered";
  return "checking";
}

/**
 * THE TESTER'S DOOR: what to do, what counts, what it pays, and the way in.
 *
 * Take a place → sign in → the steps → the answer → Sage checks it → Paid, or Not paid with the reason
 * and what is left to try. The answer travels the product's one submit path (`submit-evidence.ts`: the
 * claim is signed by the wallet that will be paid, then POST /api/campaigns/<id>/submit), and the
 * person's own state is read from GET /api/campaigns/<id>/me, exactly as the mission board does.
 *
 * WHICH WALLET SIGNS: the one that is signed in, never whichever happens to be connected. An email
 * sign-in signs with its own Privy wallet; a MetaMask sign-in with that MetaMask account.
 */
export function TesterDoor({ view, onChanged }: { view: LiveView; onChanged: () => void }) {
  const open = view.missions.filter((m) => !m.full);
  const [key, setKey] = useState<string>((open[0] ?? view.missions[0]).missionKey);
  const mission = view.missions.find((m) => m.missionKey === key) ?? view.missions[0];

  return (
    <div className="sg-stack sg-gap-3">
      {view.missions.length > 1 ? (
        <div className="sg-t-seg sg-t-tabs" role="group" aria-label="Missions">
          {view.missions.map((m, i) => (
            <button key={m.missionKey} type="button" data-words aria-pressed={m.missionKey === mission.missionKey} onClick={() => setKey(m.missionKey)}>
              Mission {i + 1}
            </button>
          ))}
        </div>
      ) : null}
      <MissionDoor key={mission.missionKey} view={view} mission={mission} onChanged={onChanged} />
    </div>
  );
}

function MissionDoor({ view, mission, onChanged }: { view: LiveView; mission: LiveMission; onChanged: () => void }) {
  const session = useFounderSession();
  const wallet = useWallet();
  const siwe = useSiwe(wallet);
  const [embedded, setEmbedded] = useState<EmbeddedWallet | null>(null);
  const address = session.address && session.chain === "evm" ? session.address : (siwe.authedAddress ?? null);
  const signedIn = !!address;
  const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const signerIsEmbedded = same(address, embedded?.address);
  const signerIsInjected = same(address, wallet.address);

  const [ask, setAsk] = useState(false);
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doorDemanded, setDoorDemanded] = useState(false);
  const [mine, setMine] = useState<Mine | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [revising, setRevising] = useState(false);
  // The tester door (one place per person): a public test asks for a Google or X sign-in behind the
  // wallet. Asked BEFORE the work, from the same answer the submit route refuses with.
  const [needsSocial, setNeedsSocial] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  // the stamp lands once, on the render where this person's answer BECOMES paid
  const wasPaid = useRef<boolean | null>(null);
  const [land, setLand] = useState(false);

  const prompts = evidencePrompts(mission.evidenceList);
  const account = prompts.length > 0 ? composeAccount(answers) : note.trim();
  const answered = prompts.length > 0 ? hasAnyAnswer(answers) : note.trim().length > 0;
  const needsLink = mission.verifiabilityClass === "url-verifiable";
  const canSend = needsLink ? link.trim().length > 0 : answered;

  const loadMine = useCallback(async () => {
    if (!signedIn) {
      setMine(null);
      setLoaded(true);
      return;
    }
    try {
      const res = await fetch(`/api/campaigns/${view.id}/me?mission=${mission.missionIdHash}`, { cache: "no-store" });
      const json = (await res.json()) as { submission: Mine | null };
      const next = json.submission;
      const paid = next?.status === "paid";
      if (wasPaid.current === false && paid) {
        setLand(true);
        onChanged();
      }
      wasPaid.current = paid;
      setMine(next);
    } catch {
      /* ask again on the next poll */
    } finally {
      setLoaded(true);
    }
  }, [signedIn, view.id, mission.missionIdHash, onChanged]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  const readDoor = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/identity?wallet=${address}&campaign=${encodeURIComponent(view.id)}&reward=${mission.rewardBase}`, { cache: "no-store" });
      const d = (await res.json()) as { requiresSocialSignIn?: boolean };
      setNeedsSocial(!!d.requiresSocialSignIn);
    } catch {
      /* the submit route is still the gate */
    }
  }, [address, view.id, mission.rewardBase]);
  useEffect(() => {
    void readDoor();
  }, [readDoor]);

  const polling = !!mine && workerShouldPoll(mine.status);
  useEffect(() => {
    if (!polling) return;
    const t = setInterval(() => {
      if (!document.hidden) void loadMine();
    }, 2500);
    return () => clearInterval(t);
  }, [polling, loadMine]);

  const send = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (!address) {
        setAsk(true);
        return;
      }
      const walletClient = signerIsEmbedded && embedded ? await embedded.getWalletClient(view.chainId) : signerIsInjected ? wallet.getWalletClient(view.chainId) : null;
      if (!walletClient) {
        setError(
          emailDoor() && !embedded && !signerIsInjected
            ? "Your account's wallet is still opening. Try again in a moment; if this stays, sign out and sign in again."
            : `Sign in again with ${short(address)}. That is the wallet this test would pay, and it has to be the one that signs.`,
        );
        return;
      }
      // a wallet refuses to sign a claim stamped with a chain it is not on
      if (signerIsInjected && !wallet.onChain(view.chainId)) {
        try {
          await wallet.switchToChain(view.chainId);
        } catch {
          setError(`Switch your wallet to ${chainConfig(view.chainId).name} to sign this, then send again.`);
          return;
        }
      }
      const input: EvidenceInput = {
        campaignId: view.id,
        campaignIdHash: view.campaignIdHash,
        chainId: view.chainId,
        mission,
        evidenceUrl: link.trim(),
        note: account,
        tester: getAddress(address),
      };
      const claim = buildEvidenceClaim(input);
      const signed = await signEvmEvidenceClaim(walletClient, getAddress(address), claim);
      if (!signed.ok) {
        setError(signed.error);
        return;
      }
      const sent = await postEvidence(input, claim, signed.signature);
      if (!sent.ok) {
        if (sent.needsVerification) setDoorDemanded(true);
        if (sent.needsSocialSignIn) {
          // the door asked for a Google or X sign-in: open it right here, with the answer kept
          setNeedsSocial(true);
          setWhy(sent.error);
          setAsk(true);
          return;
        }
        setError(sent.error);
        return;
      }
      setRevising(false);
      wasPaid.current = false;
      await loadMine();
      onChanged();
    } finally {
      setBusy(false);
    }
  }, [address, signerIsEmbedded, signerIsInjected, embedded, wallet, view.id, view.campaignIdHash, view.chainId, mission, link, account, loadMine, onChanged]);

  const each = usd(mission.rewardBase);
  const left = mission.remainingSlots;
  const bridge = emailDoor() ? <EmbeddedWalletBridge onChange={setEmbedded} /> : null;
  const state = mine ? ticketState(mine) : null;
  const canRevise = !!mine?.retry?.retryable;
  const showForm = signedIn && loaded && ((!mine && started) || (canRevise && revising));
  const closed = view.phase === "done" || (mission.full && !mine);

  const head = (
    <div className="sg-t-door-head">
      <div className="sg-stack sg-gap-2">
        <h3 className="sg-t-door-title">{mission.title}</h3>
        {mission.objective ? <p className="sg-small">{mission.objective}</p> : null}
      </div>
      <div className="sg-t-door-each">
        {each}
        <small>{closed && !mine ? "no places left" : `${left} of ${mission.maxCompletions} left`}</small>
      </div>
    </div>
  );

  // a campaign on a rail this door does not sign for keeps its own board
  if (view.rail !== "evm") {
    return (
      <div className="sg-t-door">
        {head}
        <div className="sg-t-door-part">
          <ButtonLink href={`/c/${view.id}`}>Open this test&apos;s board</ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="sg-t-door">
      {bridge}
      {head}

      {mine && state ? (
        <div className="sg-t-door-part">
          <div className="sg-t-mine">
            <Ticket
              handle="Your answer"
              words
              state={state}
              amount={each}
              land={land}
              href={state === "paid" && mine.payoutTx ? `/proof/${mine.payoutTx}` : undefined}
              reason={state === "not-paid" ? (mine.rejectReason ?? mine.retry?.coaching ?? mine.brief?.summary ?? null) : null}
              meta={state === "paid" ? `Paid to ${address ? short(address) : "your wallet"} on ${view.network}` : state === "checking" && mine.autopay?.state === "held" ? "Held for a second look" : undefined}
            />
          </div>
          {state === "answered" || (state === "checking" && mine.autopay?.state !== "held") ? (
            <p role="status">Sage is checking your answer against what it saw when it tried the product itself. This page updates by itself; you can leave and come back.</p>
          ) : null}
          {state === "checking" && mine.autopay?.state === "held" && mine.retry ? <p>{mine.retry.coaching}</p> : null}
          {state === "not-paid" && mine.retry && !canRevise ? <p>{mine.retry.attemptsLeft > 0 ? mine.retry.coaching : "There are no tries left on this mission."}</p> : null}
          {canRevise && !revising ? (
            <div className="sg-t-notice-actions">
              <Button variant="quiet" onClick={() => setRevising(true)}>
                Improve my answer ({mine.retry!.attemptsLeft} {mine.retry!.attemptsLeft === 1 ? "try" : "tries"} left)
              </Button>
            </div>
          ) : null}
          {state === "paid" && mine.payoutTx ? (
            <ButtonLink href={`/proof/${mine.payoutTx}`} variant="quiet" size="sm">
              Open your receipt <ArrowUpRight size={14} aria-hidden />
            </ButtonLink>
          ) : null}
        </div>
      ) : null}

      {mine && !revising ? <KeepPosted submissionId={mine.id} /> : null}

      {!mine && !closed && !showForm ? (
        <div className="sg-t-door-part">
          <Button
            wide
            disabled={signedIn && !loaded}
            onClick={() => {
              if (signedIn && !needsSocial) setStarted(true);
              else {
                setWhy(needsSocial ? "Sign in with Google or X to take a place in this test. It keeps one person to one place." : null);
                setAsk(true);
              }
            }}
          >
            Take a place
          </Button>
          <p className="sg-small">
            {signedIn && needsSocial
              ? "This test gives one place per person, so it asks for a Google or X sign-in first."
              : signedIn
              ? `You'll be paid to ${short(address!)} on ${view.network} once Sage has checked your answer.`
              : "You sign in first, so Sage knows where to pay you. Then you try the product and answer here."}
          </p>
        </div>
      ) : null}

      {closed && !mine ? (
        <div className="sg-t-door-part">
          <p>{view.phase === "done" ? "This test has ended, so no more places can be taken." : "Every place on this mission is taken."}</p>
          <ButtonLink href="/earn" variant="quiet" size="sm">
            See open tests
          </ButtonLink>
        </div>
      ) : null}

      {showForm ? (
        <>
          <div className="sg-t-door-part">
            <span className="sg-label">What to do</span>
            <p>{mission.instructions}</p>
            {view.productUrl ? (
              <ButtonLink href={mission.targetSurface?.startsWith("http") ? mission.targetSurface : view.productUrl} variant="quiet" size="sm">
                Open {view.host ?? "the product"} <ArrowUpRight size={14} aria-hidden />
              </ButtonLink>
            ) : null}
          </div>
          {mission.criteria.length > 0 ? (
            <div className="sg-t-door-part">
              <span className="sg-label">What counts</span>
              <ul className="sg-t-list">
                {mission.criteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <form
            className="sg-t-door-part"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <span className="sg-label">Your answer</span>
            {address ? <MissionVerify wallet={address} campaignId={view.id} rewardBase={mission.rewardBase} demanded={doorDemanded} onVerified={() => setDoorDemanded(false)} /> : null}
            {prompts.length > 0 ? (
              prompts.map((p, i) => (
                <div className="sg-t-q" key={i}>
                  <label htmlFor={`q-${mission.missionKey}-${i}`}>{p}</label>
                  <textarea
                    id={`q-${mission.missionKey}-${i}`}
                    className="sg-t-area"
                    placeholder="In your own words: what did you actually see?"
                    value={answers[i] ?? ""}
                    disabled={busy}
                    onChange={(e) => {
                      const next = [...answers];
                      next[i] = e.target.value;
                      setAnswers(next);
                    }}
                  />
                </div>
              ))
            ) : (
              <div className="sg-t-q">
                <label htmlFor={`q-${mission.missionKey}`}>What happened when you tried it, and where did you get stuck?</label>
                <textarea id={`q-${mission.missionKey}`} className="sg-t-area" placeholder="In your own words: what did you actually see?" value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
              </div>
            )}
            <div className="sg-t-q">
              <label htmlFor={`l-${mission.missionKey}`}>{needsLink ? "The link that shows it" : "A link, if you have one"}</label>
              <input id={`l-${mission.missionKey}`} className="sg-field" inputMode="url" placeholder="https://" value={link} disabled={busy} onChange={(e) => setLink(e.target.value)} />
            </div>
            <Button type="submit" wide disabled={busy || !canSend}>
              {busy ? <Loader2 size={16} className="sg-spin" aria-hidden /> : null}
              {busy ? "Sending" : mine ? "Send my improved answer" : "Send my answer"}
            </Button>
            {error ? (
              <p className="sg-small sg-note-problem" role="alert">
                {error}
              </p>
            ) : (
              <p className="sg-small">You sign once with your wallet to send it. It costs nothing, and nothing moves.</p>
            )}
          </form>
        </>
      ) : null}

      <SignInSheet
        open={ask}
        why={why ?? "Sign in so Sage knows where to pay you. The wallet you sign in with is the one that gets paid."}
        onClose={() => setAsk(false)}
        onSignedIn={() => {
          setAsk(false);
          setStarted(true);
          setNeedsSocial(false);
          void refreshFounderSession().then(() => readDoor());
        }}
      />
    </div>
  );
}

/** Privy's sign-in token, for sharing a handle or an email the sign-in itself carries. */
function PrivyToken({ onReady }: { onReady: (get: () => Promise<string | null>) => void }) {
  const { getAccessToken } = usePrivy();
  useEffect(() => {
    onReady(() => getAccessToken().catch(() => null));
  }, [getAccessToken, onReady]);
  return null;
}

type Kept = { kind: string; contact: string } | null;

/**
 * KEEP ME POSTED: a tester who liked it tells the builder "you may reach me here". Their choice,
 * recorded as their choice (WS4's endpoint): the contact is never typed in, it is the wallet they are
 * signed in with, or the X handle or email their own sign-in carries.
 */
function KeepPosted({ submissionId }: { submissionId: string }) {
  const [kept, setKept] = useState<Kept>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef<(() => Promise<string | null>) | null>(null);
  const takeToken = useCallback((get: () => Promise<string | null>) => {
    token.current = get;
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(`/api/submissions/${submissionId}/keep-posted`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { keepPosted?: Kept } | null) => {
        if (!alive) return;
        setKept(d?.keepPosted ?? null);
        setLoaded(true);
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [submissionId]);

  const share = async (how: "x" | "email" | "wallet" | "none") => {
    setBusy(true);
    setError(null);
    try {
      const privyToken = (how === "x" || how === "email") && token.current ? await token.current() : null;
      const res = await fetch(`/api/submissions/${submissionId}/keep-posted`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ share: how, ...(privyToken ? { privyToken } : {}) }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; keepPosted?: Kept; error?: string };
      if (res.ok && data.ok) setKept(data.keepPosted ?? null);
      else setError(data.error ?? "That wasn't saved. Try again.");
    } catch {
      setError("Sage couldn't be reached. Try again.");
    }
    setBusy(false);
  };

  if (!loaded) return null;
  return (
    <div className="sg-t-door-part">
      {emailDoor() ? <PrivyToken onReady={takeToken} /> : null}
      <span className="sg-label">Keep me posted</span>
      {kept ? (
        <>
          <p>
            The builder can reach you at <span className="sg-mono sg-ink">{kept.kind === "wallet" ? short(kept.contact) : kept.contact}</span>. Nobody else sees it.
          </p>
          <div className="sg-t-notice-actions">
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => void share("none")}>
              Take it back
            </Button>
          </div>
        </>
      ) : (
        <>
          <p>Liked it? Let the builder reach you when it changes. Only they see this, and only if you say so.</p>
          <div className="sg-t-notice-actions">
            {emailDoor() ? (
              <>
                <Button variant="quiet" size="sm" disabled={busy} onClick={() => void share("x")}>
                  Share my X handle
                </Button>
                <Button variant="quiet" size="sm" disabled={busy} onClick={() => void share("email")}>
                  Share my email
                </Button>
              </>
            ) : null}
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => void share("wallet")}>
              Share my wallet address
            </Button>
          </div>
        </>
      )}
      {error ? (
        <p className="sg-small sg-note-problem" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
