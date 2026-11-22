"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy } from "lucide-react";

import { StopWithdrawCard } from "@/components/campaign/stop-withdraw-card";
import { Button, ButtonLink } from "@/components/sage/button";
import { Frame } from "@/components/sage/frame";
import type { PillTone } from "@/components/sage/pill";
import { Sheet } from "@/components/sage/sheet";
import { PlacesRail } from "@/components/sage/test-card";
import { Ticket } from "@/components/sage/ticket";
import { count, howLong } from "@/lib/site/when";
import type { LiveView } from "@/lib/test-page/live";
import { FirstLook, lookMeta } from "./first-look";
import { FirstUsers } from "./first-users";
import { MissionItem, Stage, TestHead } from "./parts";
import { Report } from "./report";
import { TesterDoor } from "./tester-door";

const usd = (base: number): string => `$${(base / 1_000_000).toFixed(2)}`;

/**
 * A TEST ONCE IT IS PAID FOR: people arriving, each one checked and paid, and what they found.
 *
 * Seeded on the server and then read again every 4 s while the test is live (GET /api/t/<id>), so a
 * ticket moves when its row does. Two things are noticed between one read and the next, and only
 * then: a person who was not there before (their ticket arrives), and a ticket that BECAME paid
 * (the stamp lands, once). A page opened on a paid ticket shows it stamped and still.
 *
 * The owner gets the controls; everyone else gets the tester's door.
 */
export function TestLive({ initial }: { initial: LiveView }) {
  const [view, setView] = useState<LiveView>(initial);
  const known = useRef<Map<string, string>>(new Map(initial.tickets.map((t) => [t.key, t.state])));
  const [landed, setLanded] = useState<Set<string>>(new Set());
  const [arrived, setArrived] = useState<Set<string>>(new Set());

  const read = useCallback(async () => {
    try {
      const res = await fetch(`/api/t/${initial.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as LiveView;
      const land = new Set<string>();
      const fresh = new Set<string>();
      for (const t of next.tickets) {
        const was = known.current.get(t.key);
        if (was === undefined) fresh.add(t.key);
        else if (was !== "paid" && t.state === "paid") land.add(t.key);
        known.current.set(t.key, t.state);
      }
      setLanded(land);
      setArrived(fresh);
      setView(next);
    } catch {
      /* ask again */
    }
  }, [initial.id]);

  const live = view.phase === "live" || view.places.checking > 0;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      if (!document.hidden) void read();
    }, 4000);
    return () => clearInterval(t);
  }, [live, read]);

  const owner = view.viewer === "owner";
  const done = view.phase === "done";
  const { places } = view;
  const host = view.host ?? view.title;
  const paidPeople = view.findings?.paid.people ?? places.paid;

  let pill: { label: string; tone: PillTone } = { label: "Live", tone: "ink" };
  if (done) pill = { label: view.status === "cancelled" ? "Stopped" : "Done", tone: "neutral" };

  return (
    <div className="sg-col sg-t">
      <TestHead
        host={host}
        href={view.productUrl}
        state={pill.label}
        tone={pill.tone}
        sub={
          done
            ? paidPeople > 0
              ? `Each answer was checked against what Sage saw itself, and paid on ${view.network} with a receipt.`
              : "Nobody was paid on this test."
            : owner
              ? "People take a place, try it and answer. Sage checks each answer against what it saw itself and pays from this test's vault. This page updates by itself."
              : `Try it, answer honestly, and Sage checks your answer and pays you in USDC on ${view.network}.`
        }
      >
        {done ? (
          paidPeople > 0 ? (
            <>
              What {count(paidPeople, "person", "people")} found on <span className="sg-mono">{host}</span>.
            </>
          ) : (
            <>
              The test of <span className="sg-mono">{host}</span> has ended.
            </>
          )
        ) : owner ? (
          places.paid + places.checking === 0 ? (
            <>
              <span className="sg-mono">{host}</span> is open for {count(places.total, "person", "people")}.
            </>
          ) : (
            <>
              {places.paid} of {places.total} people paid for trying <span className="sg-mono">{host}</span>.
            </>
          )
        ) : (
          <>
            Try <span className="sg-mono">{host}</span> and get paid {usd(view.missions[0]?.rewardBase ?? 0)}.
          </>
        )}
      </TestHead>

      <div className="sg-t-stages">
        {/* the tester's door comes first for everyone who is not the owner */}
        {!owner && !done ? (
          <Stage state="now" title="Take a place" meta={`${places.left} of ${places.total} left`} id="place">
            {/* what every tester reads before a place: short and calm (product-kind.ts testerCautions) */}
            {view.cautions.length > 0 ? (
              <div className="sg-stack sg-gap-2">
                <span className="sg-label">Before you start</span>
                {view.cautions.map((line) => (
                  <p className="sg-small" key={line}>
                    {line}
                  </p>
                ))}
              </div>
            ) : null}
            <TesterDoor view={view} onChanged={read} />
          </Stage>
        ) : null}

        {/* a test Sage never ran in its browser (a job written by hand) has no frames: no empty heading */}
        {view.frames.length > 0 || owner || done ? (
        <Stage
          state="done"
          title={view.frames.length > 0 ? (view.sageReads ? `Sage read ${view.sageReads} first` : "Sage tried it first") : "The missions"}
          meta={view.frames.length > 0 && view.run ? [count(view.run.steps, "step", "steps"), view.run.seconds ? howLong(view.run.seconds) : ""].filter(Boolean).join(" · ") : null}
        >
          {view.frames.length > 0 ? (
            <div className="sg-shots">
              {view.frames.map((f, i) => (
                <Frame key={f.n} n={f.n} url={f.url} src={f.src} note={f.note} saw={f.saw} priority={i === 0 && owner} />
              ))}
            </div>
          ) : null}
          {owner || done ? (
            <div className="sg-t-missions">
              {view.missions.map((m, i) => (
                <MissionItem
                  key={m.missionKey}
                  n={i + 1}
                  mission={{ missionKey: m.missionKey, title: m.title, objective: m.objective, instructions: m.instructions, criteria: m.criteria, each: usd(m.rewardBase), places: done ? `${m.paid} of ${m.maxCompletions} paid` : `${m.remainingSlots} of ${m.maxCompletions} left` }}
                />
              ))}
            </div>
          ) : null}
        </Stage>
        ) : null}

        {/* Sage's own notes are the builder's: a tester must not read what Sage saw before answering */}
        {view.firstLook ? (
          <Stage state="done" title="What Sage noticed" meta={lookMeta(view.firstLook)}>
            <FirstLook look={view.firstLook} />
          </Stage>
        ) : null}

        <Stage state={done || !owner ? "done" : "now"} title="People" meta={done ? `${places.paid} paid` : null} id="people">
          <div className="sg-t-places">
            <div className="sg-t-places-row">
              <span className="sg-t-places-left" aria-live="polite">
                {done ? places.paid : places.left}
                <small>{done ? `of ${places.total} places paid` : `of ${places.total} places left`}</small>
              </span>
              {!done ? (
                <span className="sg-t-places-counts">
                  {places.paid} paid
                  {places.checking > 0 ? ` · ${places.checking} being checked` : ""}
                </span>
              ) : null}
            </div>
            <PlacesRail total={places.total} paid={places.paid} taken={places.checking} />
          </div>
          {view.tickets.length > 0 ? (
            <div className="sg-t-tickets">
              {view.tickets.map((t) => (
                <div key={t.key} data-new={arrived.has(t.key) || undefined} className={t.mine ? "sg-t-mine" : undefined}>
                  <Ticket handle={t.handle} state={t.state} amount={t.amount} reason={t.reason} href={t.receipt ?? undefined} land={landed.has(t.key)} meta={t.flag ? "Approved. Paid when the 30 minutes are up" : undefined} />
                  {t.flag ? <FlagAnswer flag={t.flag} handle={t.handle} onDone={read} /> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="sg-small">{done ? "Nobody took a place." : owner ? "Nobody has taken a place yet. Each person appears here the moment they do." : "Nobody has taken a place yet. You could be the first."}</p>
          )}
          {owner && view.owner && view.owner.held > 0 ? (
            <div className="sg-t-notice">
              <p>
                {count(view.owner.held, "answer is", "answers are")} not decided yet. Sage pays what it is sure of by itself; anything it holds is yours to read and decide.
              </p>
              <div className="sg-t-notice-actions">
                <ButtonLink href={`/campaign/${view.id}`} size="sm">
                  Read {view.owner.held === 1 ? "it" : "them"}
                </ButtonLink>
              </div>
            </div>
          ) : null}
          {owner && view.owner?.review ? (
            <div className="sg-t-notice">
              <p>{view.owner.review}</p>
            </div>
          ) : null}
          {owner && view.owner?.seatLink ? <SeatLink link={view.owner.seatLink} /> : null}
        </Stage>

        <Stage
          state={view.findings && view.findings.findings.length > 0 ? (done ? "done" : "now") : "next"}
          title={view.findings && view.findings.paid.people > 0 ? `What ${count(view.findings.paid.people, "person", "people")} found` : "What they found"}
          id="findings"
        >
          {view.findings ? (
            view.findings.findings.length > 0 ? (
              <>
                {view.findings.sageTried ? <p className="sg-small">{view.findings.sageTried}</p> : null}
                <Report view={view.findings} />
                {view.findings.notPaid.total > 0 ? (
                  <p className="sg-small">
                    {count(view.findings.notPaid.total, "answer was", "answers were")} not paid: {view.findings.notPaid.byReason.map((r) => (view.findings!.notPaid.byReason.length > 1 ? `${r.reason.toLowerCase().replace(/\.$/, "")} (${r.count})` : r.reason.toLowerCase().replace(/\.$/, ""))).join(", ")}.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="sg-small">{done ? "No answer was paid, so there are no findings." : "Findings appear here as answers are checked and paid."}</p>
            )
          ) : (
            <p className="sg-small">The builder keeps this test&apos;s findings private.</p>
          )}
        </Stage>

        {owner && view.owner && view.findings ? <OwnerEnd view={view} onChanged={read} /> : null}

        {!owner && done ? (
          <Stage state="next" title="Earn on another test">
            <ButtonLink href="/earn" variant="quiet">
              See open tests
            </ButtonLink>
          </Stage>
        ) : null}
      </div>
    </div>
  );
}

const minutesLeft = (until: number): number => Math.max(0, Math.ceil((until - Date.now() / 1000) / 60));

/**
 * "NOT A REAL TRY?" The builder knows their product best, so for the 30 minutes between Sage approving
 * an answer and paying it, they may say it wasn't a real try (POST /api/submissions/<id>/flag). The
 * payout is revoked, the tester reads the reason exactly as written, and the place reopens. The server
 * holds the rules: only inside the window, at most one in five places per test, nothing refunded.
 */
function FlagAnswer({ flag, handle, onDone }: { flag: { submissionId: string; until: number }; handle: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = minutesLeft(flag.until);
  const text = reason.trim();

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/submissions/${flag.submissionId}/flag`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: text }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setOpen(false);
        onDone();
      } else setError(data.error ?? "That wasn't saved. Try again.");
    } catch {
      setError("Sage couldn't be reached. Nothing changed; try again.");
    }
    setBusy(false);
  };

  return (
    <>
      <button type="button" className="sg-t-flag" onClick={() => setOpen(true)}>
        Not a real try? <span className="sg-mono">{left} min left</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Not a real try?" side="center">
        <form
          className="sg-stack sg-gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <p className="sg-small">
            Sage approved <span className="sg-mono sg-ink">{handle}</span>&apos;s answer and pays it in <span className="sg-n">{left} min</span>. If it isn&apos;t a real try of your product, say why in one line. They won&apos;t be paid, they will read your reason exactly as you write it, and the place opens for someone else.
          </p>
          <div className="sg-t-q">
            <label htmlFor={`flag-${flag.submissionId}`}>Why it isn&apos;t a real try</label>
            <input id={`flag-${flag.submissionId}`} className="sg-field sg-t-flag-reason" maxLength={200} placeholder="For example: this describes a different product" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="sg-t-notice-actions">
            <Button type="submit" disabled={busy || text.length < 4 || left === 0}>
              Don&apos;t pay this answer
            </Button>
            <Button variant="quiet" onClick={() => setOpen(false)}>
              Leave it
            </Button>
          </div>
          {error ? (
            <p className="sg-small sg-note-problem" role="alert">
              {error}
            </p>
          ) : (
            <p className="sg-small">You can do this for at most one in five places on a test. Sage&apos;s own checks still run on every answer.</p>
          )}
        </form>
      </Sheet>
    </>
  );
}

function CopyRow({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="sg-t-copy">
      <input className="sg-field" readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <Button
        variant="quiet"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          });
        }}
      >
        {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function SeatLink({ link }: { link: { url: string; seats: number; taken: number } }) {
  return (
    <div className="sg-stack sg-gap-2">
      <span className="sg-label">
        Your link for the people you invite · {link.taken} of {link.seats} joined
      </span>
      <CopyRow value={link.url} label="The link to send your people" />
      <p className="sg-small">Each person who opens it and signs in takes one place. Nobody else can.</p>
    </div>
  );
}

function Switch({ title, sub, checked, onChange }: { title: string; sub: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="sg-t-switch">
      <span className="sg-t-switch-words">
        <b>{title}</b>
        <span>{sub}</span>
      </span>
      <span className="sg-t-switch-ctl">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="sg-t-switch-track" aria-hidden />
      </span>
    </label>
  );
}

/**
 * THE OWNER'S END OF THE PAGE: getting their first users (posts in their own voice, the testers who
 * asked to hear back, where to post, and what Sage shares itself with its exact words before any yes),
 * then the money (paid, with receipts on the tickets above, and what was not spent) and stopping the test.
 */
function OwnerEnd({ view, onChanged }: { view: LiveView; onChanged: () => void }) {
  const o = view.owner!;
  const f = view.findings!;
  const done = view.phase === "done";
  const [sharing, setSharing] = useState(o.sharing);
  const [stop, setStop] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async (patch: Partial<typeof sharing>) => {
    const was = sharing;
    setSharing({ ...sharing, ...patch });
    setProblem(null);
    try {
      const res = await fetch(`/api/campaigns/${view.id}/sharing`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; sharing?: typeof sharing; error?: string };
      if (res.ok && data.ok && data.sharing) setSharing(data.sharing);
      else {
        setSharing(was);
        setProblem(data.error ?? "That wasn't saved. Try again.");
      }
    } catch {
      setSharing(was);
      setProblem("Sage couldn't be reached, so that wasn't saved.");
    }
  };

  const contacts = f.keepPosted.contacts ?? [];
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(o.resultPost ?? `Real people are trying ${view.host ?? "my product"} on Sage.`)}${o.resultPost ? "" : `&url=${encodeURIComponent(view.shareUrl)}`}`;

  return (
    <>
      <FirstUsers campaignId={view.id} users={o.users} contacts={contacts} wanted={f.keepPosted.count}>
        <div className="sg-t-offer">
          <div className="sg-t-offer-switches">
            {!view.inviteOnly && !done ? (
              <Switch title="Sage shares it" sub="Sage posts the test on its X account and its Telegram channel while places are open." checked={sharing.postMission} onChange={(v) => void save({ postMission: v })} />
            ) : null}
            <Switch title="Findings are public" sub="Anyone with this link can read what people found. Off: only you." checked={sharing.findingsPublic} onChange={(v) => void save({ findingsPublic: v })} />
            <Switch
              title="Let Sage post the result"
              sub={o.resultPost ? "When the test ends, Sage's X account posts the words below. Nothing is posted without this." : "When the test ends, Sage's X account posts what people found. You'll see the exact words here once someone is paid."}
              checked={sharing.postResult}
              onChange={(v) => void save({ postResult: v })}
            />
          </div>
        </div>
        {o.resultPost ? (
          <div className="sg-stack sg-gap-2">
            <span className="sg-label">{sharing.postResult ? "Sage will post this" : "What Sage would post"}</span>
            <p className="sg-t-post">{o.resultPost}</p>
            {!done ? <p className="sg-small">These are today&apos;s words. They follow the answers until the test ends, and a quote is always exactly what a paid person wrote.</p> : null}
          </div>
        ) : null}
        {problem ? (
          <p className="sg-small sg-note-problem" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="sg-stack sg-gap-2">
          <span className="sg-label">The test itself</span>
          <CopyRow value={view.shareUrl} label="This test's link" />
          <div className="sg-t-share">
            <ButtonLink href={intent} variant="quiet" size="sm">
              Post the test on X <ArrowUpRight size={14} aria-hidden />
            </ButtonLink>
          </div>
        </div>
      </FirstUsers>

      <Stage state="done" title="The money">
        <div className="sg-sum">
          <div className="sg-sum-row">
            <span>You paid in</span>
            <b>{usd(view.money.fundedBase)}</b>
          </div>
          <div className="sg-sum-row">
            <span>Paid to {count(f.paid.people, "person", "people")}, each with a receipt above</span>
            <b>{usd(view.money.paidBase)}</b>
          </div>
          <div className="sg-sum-row" data-total>
            <span>{done ? "Not spent" : "Still in the test's vault"}</span>
            <b>{usd(view.money.unspentBase)}</b>
          </div>
        </div>
        <p className="sg-small">
          {view.money.unspentBase === 0
            ? "Every dollar went to a tester."
            : view.status === "cancelled"
              ? "You stopped this test. What wasn't spent went back to the wallet that paid, when it was stopped."
              : "What isn't paid to testers comes back to the wallet that paid, whenever you stop the test."}{" "}
          <a className="sg-link" href={`${o.explorerUrl}/address/${o.vaultAddress}`} target="_blank" rel="noreferrer noopener">
            The vault on {view.network} <ArrowUpRight size={14} aria-hidden />
          </a>
        </p>
        {view.status === "live" || (view.status !== "cancelled" && view.money.unspentBase > 0) ? (
          <div className="sg-t-notice-actions">
            <Button variant="quiet" size="sm" onClick={() => setStop(true)}>
              {done ? "Take back what wasn't spent" : "Stop the test and take back what's left"}
            </Button>
          </div>
        ) : null}
      </Stage>

      <Sheet open={stop} onClose={() => setStop(false)} title="Stop this test">
        <div className="sg-stack sg-gap-4 sg-t-stop">
          <p className="sg-small">Stopping ends the test for good. Answers still being checked won&apos;t be paid, and what is left in the vault goes back to the wallet that paid.</p>
          <StopWithdrawCard campaignId={view.id} vaultAddress={o.vaultAddress} chainId={view.chainId} explorerUrl={o.explorerUrl} viaAccount={!o.ownVault} />
          <Button
            variant="quiet"
            onClick={() => {
              setStop(false);
              onChanged();
            }}
          >
            Close
          </Button>
        </div>
      </Sheet>
    </>
  );
}
