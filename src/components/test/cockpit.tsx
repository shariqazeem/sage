"use client";

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";

import { Button, ButtonLink } from "@/components/sage/button";
import { Sheet } from "@/components/sage/sheet";
import { count, howLong, whenAgo } from "@/lib/site/when";
import type { ActivityItem } from "@/lib/test-page/activity";
import type { SourceKey, SourceRow, TestFunnel } from "@/lib/test-page/funnel";
import type { LiveTicket, LiveView } from "@/lib/test-page/live";

/**
 * THE BUILDER'S VIEW OF A LIVE TEST (27 Nov 2026): everything that happened, and nothing that didn't.
 *
 * How far people got (the funnel, drawn as The Stop: an ink line runs as far as people got, and Sage's
 * seal marks the stage where most of them stopped), where they came from, what Sage did for this test,
 * and each person's whole try with their answer. Every number and line is read from a recorded row on
 * the server (live.ts): nothing here is a timer, an estimate or a filler.
 *
 * The owner's alone. A tester never sees another person's answer, Sage's notes, or this test's funnel.
 */

/** The page's sections, for a builder who wants to jump: the page still reads top to bottom. */
export function SectionJumps({
  findings,
  sage,
}: {
  findings: boolean;
  sage: boolean;
}) {
  return (
    <nav className="sg-t-jumps" aria-label="On this page">
      <a href="#reach">How far they got</a>
      <a href="#people">People</a>
      {findings ? <a href="#findings">What they found</a> : null}
      {sage ? <a href="#sage">What Sage did</a> : null}
      <a href="#users">First users and sharing</a>
      <a href="#money">Money</a>
    </nav>
  );
}

/**
 * HOW FAR PEOPLE GOT. One row per stage, "reached at least this far" (the server counts each person once,
 * at their furthest stage, so the rows never grow downwards). The row where the line got cut shortest ends
 * in Sage's seal.
 */
export function Funnel({
  funnel,
  sources,
}: {
  funnel: TestFunnel;
  sources: SourceRow[];
}) {
  const max = Math.max(1, ...funnel.stages.map((s) => s.people));
  const stopAt = funnel.stop
    ? funnel.stages.findIndex((s) => s.stage === funnel.stop!.after) + 1
    : -1;
  const nobody = funnel.stages.every((s) => s.people === 0);

  return (
    <div className="sg-stack sg-gap-5">
      <div className="sg-t-funnel" role="list" aria-label="How far people got">
        {funnel.stages.map((s, i) => {
          const stop = i === stopAt;
          // a stop on a stage nobody reached still shows its seal, at the very start of the line
          const value = stop ? Math.max(s.people, max * 0.012) : s.people;
          return (
            <div
              className="sg-t-funnel-row"
              role="listitem"
              key={s.stage}
              data-stop={stop || undefined}
            >
              <span className="sg-t-funnel-label">{s.label}</span>
              <progress
                className="sg-t-funnel-bar"
                value={value}
                max={max}
                aria-hidden
                data-stop={stop || undefined}
              />
              <span className="sg-t-funnel-n">
                {s.people.toLocaleString("en-US")}
              </span>
            </div>
          );
        })}
      </div>

      {nobody ? (
        <p className="sg-small">
          Nobody has opened this test yet. Each person is counted here the
          moment they do.
        </p>
      ) : funnel.stop ? (
        <p className="sg-t-funnel-stop">
          <span className="sg-t-funnel-seal" aria-hidden />
          {funnel.stop.line}
        </p>
      ) : null}

      {!funnel.tracked && !nobody ? (
        <p className="sg-small">
          Visits to this page were not counted before 27 Nov, so the first rows
          start with the people who answered.
        </p>
      ) : null}

      {funnel.held > 0 || funnel.notPaid > 0 ? (
        <p className="sg-small">
          {[
            funnel.held > 0
              ? `${count(funnel.held, "answer waits", "answers wait")} for you`
              : null,
            funnel.notPaid > 0
              ? `${count(funnel.notPaid, "answer was", "answers were")} not paid`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          .
        </p>
      ) : null}

      {sources.length > 0 ? <Sources rows={sources} /> : null}
    </div>
  );
}

function Sources({ rows }: { rows: SourceRow[] }) {
  return (
    <div className="sg-t-sources-wrap">
      <table className="sg-t-sources">
        <caption className="sg-label">Where they came from</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sg-visually-hidden">Where</span>
            </th>
            <th scope="col">Saw it</th>
            <th scope="col">Answered</th>
            <th scope="col">Paid</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.source}>
              <th scope="row">{r.label}</th>
              <td>{r.saw}</td>
              <td>{r.answered}</td>
              <td>{r.paid}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const isExternal = (href: string): boolean => /^https?:\/\//.test(href);

/** WHAT SAGE DID: the agent's own work on this test, newest first, each line backed by its record. */
export function Activity({ items }: { items: ActivityItem[] }) {
  const [all, setAll] = useState(false);
  if (items.length === 0)
    return (
      <p className="sg-small">
        Sage&apos;s work on this test shows here as it happens.
      </p>
    );
  const shown = all ? items : items.slice(0, 8);
  return (
    <div className="sg-stack sg-gap-3">
      <ol className="sg-t-activity">
        {shown.map((a, i) => (
          <li key={`${a.at}-${a.kind}-${i}`} data-kind={a.kind}>
            <time
              className="sg-t-activity-when"
              dateTime={new Date(a.at * 1000).toISOString()}
              suppressHydrationWarning
            >
              {whenAgo(a.at)}
            </time>
            <span className="sg-t-activity-text">
              {a.text}
              {a.href ? (
                <>
                  {" "}
                  <a
                    className="sg-link sg-t-activity-link"
                    href={a.href}
                    {...(isExternal(a.href)
                      ? { target: "_blank", rel: "noreferrer noopener" }
                      : {})}
                  >
                    {a.kind === "paid" ? "Receipt" : "Open"}
                    <ArrowUpRight size={14} aria-hidden />
                  </a>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      {items.length > shown.length ? (
        <Button variant="plain" size="sm" onClick={() => setAll(true)}>
          Show all {items.length}
        </Button>
      ) : null}
    </div>
  );
}

const CAME_FROM: Record<SourceKey, string> = {
  x: "from Sage's post on X",
  telegram: "from Sage's Telegram channel",
  earn: "from Earn, Sage's list of open tests",
  alert: "from Sage's message to people who asked",
  link: "from your own link",
  sage: "from Sage's home page",
  direct: "directly",
  other: "from another site",
};

/** "27 Nov, 14:02" in the reader's own time; the sheet only ever renders in the browser. */
function at(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Journey = NonNullable<LiveTicket["journey"]>;

function journeySteps(
  t: LiveTicket,
  j: Journey,
): {
  key: string;
  words: string;
  when: number | null;
  done: boolean;
  tone?: "stop";
}[] {
  const steps: {
    key: string;
    words: string;
    when: number | null;
    done: boolean;
    tone?: "stop";
  }[] = [];
  if (j.sawAt)
    steps.push({
      key: "saw",
      words: `Saw the test ${j.source ? CAME_FROM[j.source] : ""}`.trim(),
      when: j.sawAt,
      done: true,
    });
  if (j.signedInAt)
    steps.push({
      key: "in",
      words: "Signed in to take part",
      when: j.signedInAt,
      done: true,
    });
  if (j.openedAt)
    steps.push({
      key: "open",
      words: "Opened your product",
      when: j.openedAt,
      done: true,
    });
  steps.push({
    key: "answer",
    words: j.answeredAt ? "Answered" : "Has not answered yet",
    when: j.answeredAt,
    done: !!j.answeredAt,
  });
  if (j.decidedAt && t.state !== "answered")
    steps.push({
      key: "check",
      words: "Sage checked the answer",
      when: j.decidedAt,
      done: true,
    });
  if (t.state === "paid")
    steps.push({
      key: "paid",
      words: `Paid ${t.amount}`,
      when: j.paidAt,
      done: true,
    });
  else if (t.held)
    steps.push({
      key: "held",
      words: "Waiting for you: Sage was not sure",
      when: null,
      done: false,
    });
  else if (t.state === "not-paid")
    steps.push({
      key: "no",
      words: t.reason ? `Not paid: ${t.reason}` : "Not paid",
      when: j.decidedAt,
      done: true,
      tone: "stop",
    });
  return steps;
}

/**
 * ONE PERSON'S TRY, for the builder: where they came from, each step with its time, where they say they
 * stopped, their answer exactly as written, and the decision when Sage held it for the builder.
 */
export function PersonSheet({
  testId,
  ticket,
  onClose,
  onChanged,
}: {
  testId: string;
  ticket: LiveTicket;
  onClose: () => void;
  onChanged: () => void;
}) {
  const j = ticket.journey ?? null;
  const steps = j ? journeySteps(ticket, j) : [];
  const spent =
    j?.openedAt && j.answeredAt && j.answeredAt > j.openedAt &&
    j.answeredAt - j.openedAt <= 3 * 3600
      ? j.answeredAt - j.openedAt
      : null;

  return (
    <Sheet open onClose={onClose} title={ticket.handle}>
      <div className="sg-stack sg-gap-5 sg-t-person">
        {steps.length > 0 ? (
          <ol className="sg-t-journey" aria-label="Their try, step by step">
            {steps.map((s) => (
              <li
                key={s.key}
                data-done={s.done || undefined}
                data-tone={s.tone}
              >
                <span className="sg-t-journey-words">{s.words}</span>
                {s.when ? (
                  <span className="sg-t-journey-when">{at(s.when)}</span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}

        {spent ? (
          <p className="sg-small">
            About {howLong(spent)} between opening your product and answering.
          </p>
        ) : null}

        {j?.stoppedAt || j?.wouldReturn ? (
          <dl className="sg-t-facts">
            {j.stoppedAt ? (
              <div className="sg-t-fact">
                <dt>How far they say they got</dt>
                <dd>{j.stoppedAt}</dd>
              </div>
            ) : null}
            {j.wouldReturn ? (
              <div className="sg-t-fact">
                <dt>Would they come back</dt>
                <dd>{j.wouldReturn}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {ticket.answer ? (
          <figure className="sg-t-answer">
            <figcaption className="sg-label">
              Their answer, as they wrote it
            </figcaption>
            <blockquote>{ticket.answer}</blockquote>
          </figure>
        ) : null}

        {ticket.held ? (
          <HeldDecision
            testId={testId}
            held={ticket.held}
            amount={ticket.amount}
            onDone={() => {
              onChanged();
              onClose();
            }}
          />
        ) : null}

        {ticket.receipt ? (
          <div>
            <ButtonLink href={ticket.receipt} variant="quiet" size="sm">
              Open the receipt <ArrowUpRight size={14} aria-hidden />
            </ButtonLink>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * AN ANSWER SAGE HELD FOR THE BUILDER: pay it, or say why not. The reason is shown to the tester exactly as
 * written. The server checks ownership, the vault's limits and the replay rules; the page only asks.
 */
function HeldDecision({
  testId,
  held,
  amount,
  onDone,
}: {
  testId: string;
  held: { submissionId: string; why: string };
  amount: string;
  onDone: () => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (decision: "pay" | "decline") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/t/${encodeURIComponent(testId)}/answers/${encodeURIComponent(held.submissionId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            decision === "pay"
              ? { decision }
              : { decision, reason: reason.trim() },
          ),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && data.ok) onDone();
      else
        setError(
          data.error ?? "That wasn't saved. Nothing changed; try again.",
        );
    } catch {
      setError("Sage couldn't be reached. Nothing changed; try again.");
    }
    setBusy(false);
  };

  return (
    <div className="sg-t-notice">
      <p>
        <b className="sg-ink">Sage held this answer for you.</b> {held.why}
      </p>
      {declining ? (
        <form
          className="sg-stack sg-gap-3 sg-t-decline"
          onSubmit={(e) => {
            e.preventDefault();
            void send("decline");
          }}
        >
          <label className="sg-label" htmlFor={`decline-${held.submissionId}`}>
            Why it isn&apos;t paid (they read this exactly as you write it)
          </label>
          <input
            id={`decline-${held.submissionId}`}
            className="sg-field"
            maxLength={200}
            placeholder="For example: this describes a different product"
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="sg-t-notice-actions">
            <Button type="submit" disabled={busy || reason.trim().length < 4}>
              Don&apos;t pay this answer
            </Button>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => setDeclining(false)}
            >
              Back
            </Button>
          </div>
        </form>
      ) : (
        <div className="sg-t-notice-actions">
          <Button disabled={busy} onClick={() => void send("pay")}>
            Pay {amount}
          </Button>
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => setDeclining(true)}
          >
            Don&apos;t pay
          </Button>
        </div>
      )}
      {error ? (
        <p className="sg-small sg-note-problem" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * TELEGRAM UPDATES for a builder who closes the tab: a first answer, an answer waiting for them, what
 * people found, and the end. One link, opened in Telegram, binds this account; the bot says what it will send.
 */
export function UpdatesLine({
  state,
  compact,
  email,
}: {
  state: "connected" | "muted" | "off";
  compact?: boolean;
  /** email updates for this builder; nothing is shown about email when the server has none set up */
  email?: { state: "on" | "off" | "unavailable"; to: string | null };
}) {
  const [now, setNow] = useState(state);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    // the window is opened inside the click so a browser does not block it, then pointed at the link
    const win = window.open("about:blank", "_blank");
    try {
      const res = await fetch("/api/updates", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (res.ok && data.url) {
        if (win) win.location.href = data.url;
        else window.location.href = data.url;
        setWaiting(true);
      } else {
        win?.close();
        setError(data.error ?? "Sage couldn't make the link. Try again.");
      }
    } catch {
      win?.close();
      setError("Sage couldn't be reached. Try again.");
    }
    setBusy(false);
  };

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/updates", { method: "DELETE" });
      if (res.ok) setNow("muted");
      else setError("That wasn't saved. Try again.");
    } catch {
      setError("Sage couldn't be reached. Try again.");
    }
    setBusy(false);
  };

  if (now === "connected") {
    return (
      <div className="sg-t-updates" data-compact={compact || undefined}>
        <p className="sg-small">
          Sage messages you on Telegram when someone answers, when an answer
          waits for you, and when what people found is ready.
        </p>
        <Button
          variant="plain"
          size="sm"
          disabled={busy}
          onClick={() => void stop()}
        >
          Turn off
        </Button>
        {error ? <p className="sg-small sg-note-problem">{error}</p> : null}
        {email ? <EmailUpdates email={email} telegram /> : null}
      </div>
    );
  }

  return (
    <div className="sg-t-notice sg-t-updates">
      <p>
        {waiting ? (
          <>Press Start in Telegram to finish. The link works for 15 minutes.</>
        ) : (
          <>
            <b className="sg-ink">Get told when it matters.</b> Sage can message
            you on Telegram when someone answers, when an answer waits for you,
            and when what people found is ready.
          </>
        )}
      </p>
      <div className="sg-t-notice-actions">
        <Button size="sm" disabled={busy} onClick={() => void connect()}>
          {waiting
            ? "Open the link again"
            : now === "muted"
              ? "Turn updates back on"
              : "Get updates in Telegram"}
        </Button>
      </div>
      {error ? (
        <p className="sg-small sg-note-problem" role="alert">
          {error}
        </p>
      ) : null}
      {email ? <EmailUpdates email={email} telegram={false} /> : null}
    </div>
  );
}

/**
 * EMAIL UPDATES, beside Telegram's: the same news at the address the builder signed in with. Shown only
 * when the server has email set up. The address is read on the server and comes back masked; this
 * component never sends one.
 */
function EmailUpdates({
  email,
  telegram,
}: {
  email: { state: "on" | "off" | "unavailable"; to: string | null };
  /** Telegram updates are already on, so email is "too" and not "instead" */
  telegram: boolean;
}) {
  const [now, setNow] = useState(email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (now.state === "unavailable") return null;

  const set = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/updates/email", { method: on ? "POST" : "DELETE" });
      const data = (await res.json().catch(() => ({}))) as {
        email?: "on" | "off" | "unavailable";
        emailTo?: string | null;
        error?: string;
      };
      if (res.ok && data.email) setNow({ state: data.email, to: data.emailTo ?? null });
      else setError(data.error ?? "That wasn't saved. Try again.");
    } catch {
      setError("Sage couldn't be reached. Try again.");
    }
    setBusy(false);
  };

  return (
    <div className="sg-t-notice-actions">
      {now.state === "on" ? (
        <>
          <p className="sg-small">
            Sage {telegram ? "also emails" : "emails"} {now.to ?? "you"} about
            your tests.
          </p>
          <Button variant="plain" size="sm" disabled={busy} onClick={() => void set(false)}>
            Stop emails
          </Button>
        </>
      ) : (
        <Button variant="plain" size="sm" disabled={busy} onClick={() => void set(true)}>
          {telegram ? "Email me too" : "Email me instead"}
        </Button>
      )}
      {error ? (
        <p className="sg-small sg-note-problem" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The funnel in one line for the page's head: "38 saw it · 9 answered · 7 paid". */
export function funnelLine(view: LiveView): string | null {
  const f = view.owner?.funnel;
  if (!f) return null;
  const n = (stage: string) =>
    f.stages.find((s) => s.stage === stage)?.people ?? 0;
  if (n("saw") === 0) return null;
  return `${n("saw")} saw it · ${n("answered")} answered · ${n("paid")} paid`;
}
