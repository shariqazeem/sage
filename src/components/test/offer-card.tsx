"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, CircleAlert, Loader2 } from "lucide-react";

import { LOGIN_WITH_X } from "@/components/auth/privy-provider";
import { EmbeddedWalletBridge, type EmbeddedWallet } from "@/components/campaigns/embedded-wallet-bridge";
import { embeddedPayEnabled, usePayFromWallet } from "@/components/launch/pay-from-wallet/use-pay-from-wallet";
import type { JobView } from "@/components/launch/types";
import { Button, ButtonLink } from "@/components/sage/button";
import { SignInSheet } from "@/components/sage/sign-in-sheet";
import { refreshFounderSession } from "@/lib/auth/use-founder-session";
import type { StepView } from "@/lib/own-wallet/run";
import { SwapToUsdc } from "./swap-to-usdc";
import type { Whose } from "@/lib/test-page/before";
import {
  EACH_PRESETS_USD,
  PEOPLE_PRESETS,
  WORLD_ID_ABOVE_BASE,
  baseToUsd,
  offerOf,
  offerProblem,
  usdToBase,
} from "@/lib/test-page/offer-shape";

const emailDoor = (): boolean => !!process.env.NEXT_PUBLIC_PRIVY_LOGIN_APP_ID?.trim();

/**
 * THE OFFER CARD: the builder's decisions about a test, and nothing else.
 *
 * People, what each earns, the total (their product, to the cent), two switches that start on, one
 * option, one button. Choosing people or a reward asks the server to recompile the plan (no model:
 * the budget compiler), and the card then shows what the SERVER saved, never its own arithmetic.
 *
 * Signing in happens here, at the money moment. A test nobody owns yet becomes the signed-in
 * person's; one a tag on X started can be taken only by that X account (the server compares X's own
 * user id, read from the sign-in, never anything this page sends about who is asking).
 */
export function OfferCard({
  job,
  whose,
  inviteOnly,
  xDraft,
  locked,
  onJob,
  onMine,
  onLive,
}: {
  job: JobView;
  whose: Whose;
  inviteOnly: boolean;
  xDraft: { username: string | null } | null;
  /** why the people and reward cannot change, or null */
  locked: string | null;
  onJob: (job: JobView) => void;
  /** the test became the visitor's own */
  onMine: () => void;
  onLive: (campaignId: string) => void;
}) {
  const plan = job.plan!;
  const shape = offerOf(plan.missions);
  // a test handed over from Telegram is priced by its owner once it is theirs
  const mayChange = (whose === "yours" || whose === "nobody") && !locked;
  const builder = whose === "yours" || whose === "nobody" || whose === "handover";

  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [customPeople, setCustomPeople] = useState(!PEOPLE_PRESETS.includes(shape.people as (typeof PEOPLE_PRESETS)[number]));
  const [customEach, setCustomEach] = useState(shape.eachBase !== null && !EACH_PRESETS_USD.some((u) => u * 1_000_000 === shape.eachBase));
  const [peopleText, setPeopleText] = useState(String(shape.people));
  const [eachText, setEachText] = useState(shape.eachBase !== null ? (shape.eachBase / 1_000_000).toFixed(2) : "");
  // The two switches start on and live on this page until the test is paid for: sharing belongs to
  // the live test, which exists only once its vault is recorded. They are saved the moment it is.
  const [share, setShare] = useState(() => remembered(job.id)?.share ?? true);
  const [findingsPublic, setFindingsPublic] = useState(() => remembered(job.id)?.findingsPublic ?? true);
  const [invite, setInvite] = useState(inviteOnly);
  const sent = useRef(0);

  /** Ask the server to recompile for these numbers. What it saves is what the card then shows. */
  const offer = useCallback(
    async (people: number, eachBase: number, inviteNow: boolean = invite) => {
      const why = offerProblem(people, eachBase, shape.missions);
      if (why) {
        setProblem(why);
        return;
      }
      const mine = ++sent.current;
      setSaving(true);
      setProblem(null);
      try {
        const res = await fetch(`/api/launch/${job.id}/offer`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ people, eachUsd: (eachBase / 1_000_000).toFixed(2), inviteOnly: inviteNow, expectedRevision: job.revision }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; job?: JobView };
        if (mine !== sent.current) return; // a later choice is already on its way
        if (data.job) onJob(data.job);
        if (!res.ok || !data.ok) setProblem(data.error ?? "That change wasn't saved. Try again.");
      } catch {
        if (mine === sent.current) setProblem("Sage couldn't be reached, so that change wasn't saved. Try again.");
      } finally {
        if (mine === sent.current) setSaving(false);
      }
    },
    [invite, shape.missions, job.id, job.revision, onJob],
  );

  const eachNow = shape.eachBase ?? shape.maxEachBase;
  useEffect(() => remember(job.id, { share, findingsPublic }), [job.id, share, findingsPublic]);

  /** The launch made here is live: record the builder's two answers on the test itself, then open it. */
  const live = useCallback(
    async (campaignId: string) => {
      await fetch(`/api/campaigns/${campaignId}/sharing`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postMission: share && !invite, findingsPublic }),
      }).catch(() => null);
      onLive(campaignId);
    },
    [share, invite, findingsPublic, onLive],
  );

  const total = baseToUsd(shape.totalBase);
  const needsWorldId = shape.maxEachBase > WORLD_ID_ABOVE_BASE;

  return (
    <div className="sg-t-offer" aria-label="The offer">
      <div className="sg-t-offer-row">
        <span className="sg-t-offer-k" id="offer-people">
          People
        </span>
        {mayChange ? (
          <div>
            <div className="sg-t-seg" role="group" aria-labelledby="offer-people">
              {PEOPLE_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={!customPeople && shape.people === n}
                  disabled={n < shape.missions}
                  onClick={() => {
                    setCustomPeople(false);
                    setPeopleText(String(n));
                    void offer(n, eachNow);
                  }}
                >
                  {n}
                </button>
              ))}
              <button type="button" data-words aria-pressed={customPeople} onClick={() => setCustomPeople(true)}>
                Custom
              </button>
            </div>
            {customPeople ? (
              <form
                className="sg-t-custom"
                onSubmit={(e) => {
                  e.preventDefault();
                  void offer(Number(peopleText), eachNow);
                }}
              >
                <input className="sg-field" inputMode="numeric" aria-label="How many people" value={peopleText} onChange={(e) => setPeopleText(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} />
                <Button type="submit" variant="quiet" size="sm" disabled={saving || Number(peopleText) === shape.people}>
                  Set
                </Button>
              </form>
            ) : null}
          </div>
        ) : (
          <span className="sg-t-offer-fixed">{shape.people}</span>
        )}
      </div>

      <div className="sg-t-offer-row">
        <span className="sg-t-offer-k" id="offer-each">
          Each earns
        </span>
        {mayChange ? (
          <div>
            <div className="sg-t-seg" role="group" aria-labelledby="offer-each">
              {EACH_PRESETS_USD.map((u) => (
                <button
                  key={u}
                  type="button"
                  aria-pressed={!customEach && shape.eachBase === u * 1_000_000}
                  onClick={() => {
                    setCustomEach(false);
                    setEachText(u.toFixed(2));
                    void offer(shape.people, u * 1_000_000);
                  }}
                >
                  ${u}
                </button>
              ))}
              <button type="button" data-words aria-pressed={customEach} onClick={() => setCustomEach(true)}>
                Custom
              </button>
            </div>
            {customEach ? (
              <form
                className="sg-t-custom"
                onSubmit={(e) => {
                  e.preventDefault();
                  const base = usdToBase(eachText);
                  if (base === null) setProblem("Use dollars and whole cents, like 2.50.");
                  else void offer(shape.people, base);
                }}
              >
                <span className="sg-mono" aria-hidden>
                  $
                </span>
                <input className="sg-field" inputMode="decimal" aria-label="What each person earns, in dollars" value={eachText} onChange={(e) => setEachText(e.target.value.replace(/[^\d.]/g, "").slice(0, 7))} />
                <Button type="submit" variant="quiet" size="sm" disabled={saving || usdToBase(eachText) === shape.eachBase}>
                  Set
                </Button>
              </form>
            ) : null}
          </div>
        ) : (
          <span className="sg-t-offer-fixed">{shape.eachBase !== null ? baseToUsd(shape.eachBase) : `${baseToUsd(shape.minEachBase)} to ${baseToUsd(shape.maxEachBase)}`}</span>
        )}
        {shape.eachBase === null && mayChange ? <p className="sg-t-offer-note">Sage priced each mission by its effort: {baseToUsd(shape.minEachBase)} to {baseToUsd(shape.maxEachBase)}. Pick one reward to pay everyone the same.</p> : null}
        {needsWorldId ? <p className="sg-t-offer-note">Above $5.00, each tester is asked for a one-time World ID check before they can take a place. It keeps one person from taking several, and it slows a test down.</p> : null}
        {locked && (whose === "yours" || whose === "nobody") ? <p className="sg-t-offer-note">{locked}</p> : null}
      </div>

      <div className="sg-t-offer-total">
        <span className="sg-t-offer-sum">
          {shape.eachBase !== null ? (
            <>
              <span className="sg-n">{shape.people}</span> × <span className="sg-n">{baseToUsd(shape.eachBase)}</span>, all of it to the testers
            </>
          ) : (
            <>
              <span className="sg-n">{shape.people}</span> people, all of it to the testers
            </>
          )}
        </span>
        <span className="sg-t-offer-amount" aria-label={`Total ${total}`} aria-live="polite">
          {saving ? <Loader2 size={20} className="sg-spin" aria-hidden /> : total}
        </span>
      </div>

      {builder ? (
        <div className="sg-t-offer-switches">
          <Switch
            title="Sage shares it"
            sub={invite ? "Not shared while only people you invite can take a place." : "Sage posts the test on its X account and its Telegram channel, so testers find it."}
            checked={share && !invite}
            disabled={invite}
            onChange={setShare}
          />
          <Switch
            title="Findings are public"
            sub="Anyone with this link can read what people found. Off: only you."
            checked={findingsPublic}
            onChange={setFindingsPublic}
          />
          <Switch
            title="Only people I invite"
            sub="You get one link to send. The test stays off every public list."
            checked={invite}
            disabled={!mayChange}
            onChange={(v) => {
              setInvite(v);
              void offer(shape.people, eachNow, v);
            }}
          />
        </div>
      ) : null}

      <div className="sg-t-offer-pay">
        {problem ? (
          <p className="sg-small sg-note-problem" role="alert">
            {problem}
          </p>
        ) : null}
        {whose === "yours" ? (
          <PayArea
            job={job}
            total={total}
            hold={saving}
            onLive={live}
            onAlreadyLive={onLive}
          />
        ) : (
          <ClaimArea jobId={job.id} whose={whose} total={total} xDraft={xDraft} onMine={onMine} />
        )}
      </div>
    </div>
  );
}

function Switch({ title, sub, checked, disabled, onChange }: { title: string; sub: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="sg-t-switch">
      <span className="sg-t-switch-words">
        <b>{title}</b>
        <span>{sub}</span>
      </span>
      <span className="sg-t-switch-ctl">
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="sg-t-switch-track" aria-hidden />
      </span>
    </label>
  );
}

/** The two switches, kept for this browser tab so a reload before paying doesn't forget them. */
type Kept = { share: boolean; findingsPublic: boolean };
const keptKey = (jobId: string) => `sage:offer:${jobId}`;
function remembered(jobId: string): Kept | null {
  try {
    const raw = typeof window === "undefined" ? null : window.sessionStorage.getItem(keptKey(jobId));
    const v = raw ? (JSON.parse(raw) as Partial<Kept>) : null;
    return v && typeof v.share === "boolean" && typeof v.findingsPublic === "boolean" ? { share: v.share, findingsPublic: v.findingsPublic } : null;
  } catch {
    return null;
  }
}
function remember(jobId: string, kept: Kept): void {
  try {
    window.sessionStorage.setItem(keptKey(jobId), JSON.stringify(kept));
  } catch {
    /* a browser that keeps nothing still pays: the switches are sent from state */
  }
}

/**
 * THE BUTTON, BEFORE THE TEST IS YOURS. One tap: sign in if you haven't, then the test becomes yours
 * (the server decides whether it may), and the card turns into the pay button with your wallet read.
 *
 * A test nobody owns goes through POST /api/t/<id>/claim. One a tag on X started goes through
 * /api/launch/<id>/claim-x, where the server compares the X account IT verified at sign-in with the
 * one that tagged Sage; this page sends no id and no handle, only the session.
 */
function ClaimArea({ jobId, whose, total, xDraft, onMine }: { jobId: string; whose: Whose; total: string; xDraft: { username: string | null } | null; onMine: () => void }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isX = whose === "x";

  const claim = useCallback(async (): Promise<"mine" | "signin" | "no"> => {
    setBusy(true);
    setError(null);
    try {
      // a Telegram handover's link carries its code (`?claim=`): it is sent here, at the money moment
      const code = new URLSearchParams(window.location.search).get("claim");
      const res = isX
        ? await fetch(`/api/launch/${jobId}/claim-x`, { method: "POST" })
        : await fetch(`/api/t/${jobId}/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(code ? { claim: code } : {}) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) return "mine";
      // not signed in, or (for an X draft) signed in without that X account: signing in is the next step
      if (res.status === 401 || (isX && res.status === 403)) {
        if (res.status === 403) setError(data.error ?? null);
        return "signin";
      }
      setError(data.error ?? "This test couldn't be made yours. Try again.");
      return "no";
    } catch {
      setError("Sage couldn't be reached. Nothing changed; try again.");
      return "no";
    } finally {
      setBusy(false);
    }
  }, [jobId, isX]);

  // someone already signed in with the X account that tagged Sage: the test is theirs without a tap
  const tried = useRef(false);
  useEffect(() => {
    if (!isX || tried.current) return;
    tried.current = true;
    void fetch(`/api/launch/${jobId}/claim-x`, { cache: "no-store" })
      .then((r) => r.json())
      .then(async (d: { yours?: boolean; unclaimed?: boolean }) => {
        if (d.yours && d.unclaimed && (await claim()) === "mine") onMine();
      })
      .catch(() => null);
  }, [isX, jobId, claim, onMine]);

  if (whose === "other") {
    return <p className="sg-small">This test belongs to the person who started it. When they pay for it, the places open here.</p>;
  }

  const who = xDraft?.username ? `@${xDraft.username}` : "the account that tagged Sage";
  const xOff = isX && !LOGIN_WITH_X;
  return (
    <>
      {isX ? (
        <p className="sg-small">
          Drafted for {who}. Sign in with X to claim it.{xOff ? " Signing in with X isn't switched on here yet." : ""}
        </p>
      ) : null}
      <Button
        wide
        disabled={busy || xOff}
        onClick={async () => {
          const r = await claim();
          if (r === "mine") onMine();
          else if (r === "signin") setAsk(true);
        }}
      >
        {busy ? <Loader2 size={16} className="sg-spin" aria-hidden /> : null}
        {isX ? (
          "Sign in with X to claim it"
        ) : (
          <>
            Pay <span className="sg-n">{total}</span> from your wallet
          </>
        )}
      </Button>
      {error ? (
        <p className="sg-small sg-note-problem" role="alert">
          {error}
        </p>
      ) : null}
      {!isX ? <p className="sg-small">You sign in first. Nothing is paid until you confirm it in your own wallet.</p> : null}
      <SignInSheet
        open={ask}
        why={isX ? `Sign in with X as ${who} to claim this test.` : "Sign in to pay for this test from your own wallet on Metis."}
        onClose={() => setAsk(false)}
        onSignedIn={() => {
          setAsk(false);
          void refreshFounderSession().then(async () => {
            if ((await claim()) === "mine") onMine();
          });
        }}
      />
    </>
  );
}

const STEP_WORDS: Record<StepView["status"], string> = {
  waiting: "",
  sign: "Confirm in your wallet",
  confirming: "Confirming on Metis",
  done: "Done",
  failed: "Not sent",
};

/**
 * PAYING, FROM YOUR OWN WALLET. The hook is WS3's (`usePayFromWallet`): it reads the wallet before
 * anything is signed, walks create → approve → fund → activate, and has the server record the test
 * only once the chain shows it. This draws its state: the wallet, what it is short of (with the
 * amount and where to get it), each step as a line with its transaction, and one button.
 */
function PayArea({ job, total, hold, onLive, onAlreadyLive }: { job: JobView; total: string; hold: boolean; onLive: (campaignId: string) => void; onAlreadyLive: (campaignId: string) => void }) {
  const [embedded, setEmbedded] = useState<EmbeddedWallet | null>(null);
  const [ask, setAsk] = useState(false);
  const pay = usePayFromWallet({ jobId: job.id, revision: job.revision, embedded, onLive });
  const { refresh, phase, campaignId } = pay;
  const started = pay.steps.some((s) => s.status !== "waiting");

  // the plan on screen changed (people, reward): read the wallet against the new total
  const seen = useRef(job.revision);
  useEffect(() => {
    if (seen.current === job.revision) return;
    seen.current = job.revision;
    void refresh();
  }, [job.revision, refresh]);

  // A test that was already paid for (in another tab, or before a reload) opens as itself. The launch
  // made in THIS visit is told through the hook's own `onLive`, which also records the sharing answers.
  const paidHere = useRef(false);
  useEffect(() => {
    if (phase === "live" && campaignId && !paidHere.current) onAlreadyLive(campaignId);
  }, [phase, campaignId, onAlreadyLive]);

  const bridge = emailDoor() ? <EmbeddedWalletBridge onChange={setEmbedded} /> : null;
  const emailWalletOff = pay.walletKind === "embedded" && !embeddedPayEnabled();

  if (phase === "signed-out") {
    return (
      <>
        {bridge}
        <Button wide onClick={() => setAsk(true)}>
          Pay <span className="sg-n">{total}</span> from your wallet
        </Button>
        <p className="sg-small">Your sign-in ended. Sign in again to pay; the test is saved.</p>
        <SignInSheet
          open={ask}
          why="Sign in to pay for this test from your own wallet on Metis."
          onClose={() => setAsk(false)}
          onSignedIn={() => {
            setAsk(false);
            void refreshFounderSession().then(() => refresh());
          }}
        />
      </>
    );
  }

  if (phase === "refused") {
    return (
      <>
        {bridge}
        <div className="sg-t-notice" data-tone="problem">
          <p>{pay.error ?? "This test can't be paid for from your wallet as it stands."}</p>
          <div className="sg-t-notice-actions">
            <Button variant="quiet" size="sm" onClick={() => void refresh()}>
              Check again
            </Button>
            {pay.upgradeTo !== undefined ? (
              <ButtonLink href={pay.upgradeTo ? `/pricing?plan=${pay.upgradeTo}` : "/pricing"} variant="quiet" size="sm">
                See plans
              </ButtonLink>
            ) : null}
          </div>
        </div>
        <p className="sg-small">Nothing was sent, and the test is saved.</p>
      </>
    );
  }

  const running = phase === "running" || phase === "recording" || pay.busy;
  return (
    <>
      {bridge}
      {pay.owner ? (
        <div className="sg-t-wallet">
          <span>
            Your wallet on Metis <b>{pay.owner.slice(0, 6)}…{pay.owner.slice(-4)}</b>
          </span>
          {pay.balances ? (
            <span>
              <b>${pay.balances.usdc.toFixed(2)}</b> m.USDC · <b>{pay.balances.metis}</b> METIS
            </span>
          ) : null}
        </div>
      ) : null}

      {started || running ? (
        <ol className="sg-t-steps" aria-label="Paying for this test">
          {pay.steps.map((s) => (
            <li className="sg-t-step" data-s={s.status} key={s.step}>
              <span className="sg-t-step-mark" aria-hidden>
                {s.status === "done" ? <Check size={15} strokeWidth={2.25} /> : s.status === "sign" || s.status === "confirming" ? <Loader2 size={15} className="sg-spin" /> : s.status === "failed" ? <CircleAlert size={15} /> : null}
              </span>
              <span>{s.label}</span>
              {s.explorerUrl ? (
                <a className="sg-t-step-state" href={s.explorerUrl} target="_blank" rel="noreferrer noopener" aria-label={`${s.label}: ${STEP_WORDS[s.status] || "sent"}. Open the transaction.`}>
                  {s.txHash ? `${s.txHash.slice(0, 6)}…${s.txHash.slice(-4)}` : STEP_WORDS[s.status]} <ArrowUpRight size={13} aria-hidden />
                </a>
              ) : (
                <span className="sg-t-step-state">{STEP_WORDS[s.status]}</span>
              )}
            </li>
          ))}
        </ol>
      ) : null}

      {phase === "recording" ? (
        <p className="sg-small" role="status">
          Sage is reading the vault on Metis before it opens the places.
        </p>
      ) : null}

      {pay.shortfalls.length > 0 ? (
        <div className="sg-t-notice" data-tone="problem">
          {pay.shortfalls.map((s) => (
            <p key={s.what}>{s.message}</p>
          ))}
          {pay.owner && pay.shortfalls.some((s) => s.what === "usdc") ? <SwapToUsdc owner={pay.owner} embedded={pay.walletKind === "embedded"} onDone={() => void refresh()} /> : null}
          <div className="sg-t-notice-actions">
            <Button variant="quiet" size="sm" onClick={() => void refresh()} disabled={pay.busy}>
              Check my wallet again
            </Button>
          </div>
        </div>
      ) : null}

      {emailWalletOff ? (
        <div className="sg-t-notice">
          <p>Paying from the wallet your email sign-in holds isn&apos;t switched on yet. Pay from your Sage account instead, or sign in with MetaMask.</p>
          <div className="sg-t-notice-actions">
            <ButtonLink href={`/launch/${job.id}`} variant="quiet" size="sm">
              Pay from your Sage account
            </ButtonLink>
          </div>
        </div>
      ) : (
        <Button
          wide
          disabled={running || hold || phase === "loading" || phase === "short"}
          onClick={() => {
            paidHere.current = true;
            void pay.pay();
          }}
        >
          {running ? <Loader2 size={16} className="sg-spin" aria-hidden /> : null}
          {phase === "loading" ? (
            "Reading your wallet"
          ) : running ? (
            "Paying"
          ) : started ? (
            "Continue paying"
          ) : (
            <>
              Pay <span className="sg-n">{total}</span> from your wallet
            </>
          )}
        </Button>
      )}

      {pay.error && phase !== "short" ? (
        <p className="sg-small sg-note-problem" role="alert">
          {pay.error}
        </p>
      ) : null}
      {!started && !running && pay.shortfalls.length === 0 && !emailWalletOff ? (
        <p className="sg-small">The money goes into this test&apos;s own vault on Metis. What isn&apos;t paid to testers comes back to your wallet.</p>
      ) : null}
    </>
  );
}
