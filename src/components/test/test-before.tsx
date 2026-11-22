"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import type { JobView } from "@/components/launch/types";
import { Button, ButtonLink } from "@/components/sage/button";
import { Frame } from "@/components/sage/frame";
import type { PillTone } from "@/components/sage/pill";
import { friendlyFailure } from "@/lib/launch/failure-copy";
import { rememberInspection } from "@/lib/launch/recent-inspections";
import { noteOf } from "@/lib/site/real-test-frames";
import { testPath } from "@/lib/site/test-path";
import { count, howLong } from "@/lib/site/when";
import type { BeforeView, Whose } from "@/lib/test-page/before";
import { baseToUsd, offerOf } from "@/lib/test-page/offer-shape";
import { FirstLook, lookMeta } from "./first-look";
import { OfferCard } from "./offer-card";
import { PurposeLine } from "./purpose-line";
import { Facts, MissionItem, Stage, TestHead } from "./parts";

/**
 * A TEST BEFORE IT IS PAID FOR: Sage trying the product, writing the missions, and the offer.
 *
 * The page is seeded on the server with the stored job, so a reload, a shared link and the back
 * button all open on the real state. While Sage works, it asks for the job every 2 s and for the
 * browser's trail every 1.5 s, and draws only what comes back: a frame appears when Sage captured
 * one, a line when it did something. Nothing here runs on a timer of its own, and a stage that has
 * not happened shows its name and nothing else.
 */

type Status = JobView["status"];
const TRYING = new Set<Status>(["queued", "fetching", "field_test", "analyzing", "mapping"]);
const WRITING = new Set<Status>(["generating_missions", "reviewing"]);
const RUNNING = new Set<Status>([...TRYING, ...WRITING]);

interface TrailStep {
  n: number;
  at?: number;
  label: string;
  screenshot: string | null;
  url: string;
}

/** What Sage is doing in its browser, as it happens: every entry is a step it really took. */
function useTrail(inspectionId: string, active: boolean): TrailStep[] {
  const [steps, setSteps] = useState<TrailStep[]>([]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch(`/api/field-tests/${inspectionId}/progress`, { cache: "no-store" });
        const data = (await res.json()) as { ok?: boolean; steps?: TrailStep[] };
        if (alive && data.ok && Array.isArray(data.steps)) setSteps((was) => (data.steps!.length >= was.length ? data.steps! : was));
      } catch {
        /* a missing trail is not an error: ask again */
      }
    };
    void tick();
    const t = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [inspectionId, active]);
  return steps;
}

/** Sage's own line for a step, to its first clause: the rest is its working detail. */
const lineOf = (label: string, host: string): string => noteOf(label.split(" — ")[0], host);

const clock = (step: TrailStep, first: TrailStep): string => {
  if (!step.at || !first.at) return "";
  const s = Math.max(0, Math.round((step.at - first.at) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function TestBefore({ initial }: { initial: BeforeView }) {
  const router = useRouter();
  const [job, setJob] = useState<JobView>(initial.job);
  const [whose, setWhose] = useState<Whose>(initial.whose);
  const status = job.status;
  const running = RUNNING.has(status);
  const host = initial.host;
  const trail = useTrail(job.id, running);
  const shots = useRef<HTMLDivElement>(null);
  const wasRunning = useRef(running);

  // the server drew the page again (the run finished, the default offer was set): take its plan
  useEffect(() => {
    setJob((was) => (initial.job.revision >= was.revision && initial.job.updatedAt >= was.updatedAt ? initial.job : was));
  }, [initial.job]);

  useEffect(() => {
    rememberInspection(job.id, job.productUrl);
  }, [job.id, job.productUrl]);

  const read = useCallback(async () => {
    try {
      const res = await fetch(`/api/launch/${job.id}`, { cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; job?: JobView; ownership?: "yours" | "anonymous" | "other" };
      if (!data.ok || !data.job) return;
      setJob(data.job);
      if (data.ownership === "yours") setWhose("yours");
      else if (data.ownership === "anonymous") setWhose("nobody");
    } catch {
      /* keep asking */
    }
  }, [job.id]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      if (!document.hidden) void read();
    }, 2000);
    return () => clearInterval(t);
  }, [running, read]);

  // The run just finished: the frames Sage chose, the facts and the plan are the server's to give.
  useEffect(() => {
    if (wasRunning.current && !running) router.refresh();
    wasRunning.current = running;
  }, [running, router]);

  // Sage's browser just closed: its first look is stored before the missions are written, so ask
  // the server for it now, and once more after a model has had time to choose its words.
  const writing = WRITING.has(status);
  useEffect(() => {
    if (!writing) return;
    router.refresh();
    const t = setTimeout(() => router.refresh(), 25_000);
    return () => clearTimeout(t);
  }, [writing, router]);

  // a new frame arrived: bring it into view, the way a filmstrip advances
  const framed = trail.filter((s) => s.screenshot);
  useEffect(() => {
    const el = shots.current;
    const last = el?.lastElementChild as HTMLElement | null;
    if (el && last && framed.length > 1) el.scrollTo({ left: last.offsetLeft - el.offsetLeft, behavior: "smooth" });
  }, [framed.length]);

  const onLive = useCallback((campaignId: string) => router.replace(testPath(campaignId)), [router]);
  const onMine = useCallback(() => {
    setWhose("yours");
    router.refresh();
  }, [router]);

  if (job.launched?.campaignId) {
    // paid for since this page was drawn: the test's own page is the place to be
    return (
      <div className="sg-col sg-t">
        <TestHead host={host} href={job.productUrl} state="Live" tone="ink">
          This test is live.
        </TestHead>
        <div className="sg-t-stages">
          <ButtonLink href={testPath(job.launched.campaignId)}>Open the test</ButtonLink>
        </div>
      </div>
    );
  }

  const plan = job.plan;
  const shape = plan ? offerOf(plan.missions) : null;
  const latest = trail[trail.length - 1];
  const isTrying = TRYING.has(status);
  // a phone app, a bot, a repository: Sage read its page and people do the try (product-kind.ts)
  const reads = initial.sageReads;
  const isWriting = WRITING.has(status);
  const ready = status === "ready" && !!plan && plan.missions.length > 0;
  const mine = whose === "yours" || whose === "nobody" || whose === "handover";
  const look = isTrying ? null : initial.firstLook;
  const who = initial.xDraft?.username ? `@${initial.xDraft.username}` : null;

  let pill: { label: string; tone: PillTone } = { label: "Trying", tone: "neutral" };
  if (isWriting) pill = { label: "Writing", tone: "neutral" };
  if (ready) pill = { label: "Ready", tone: "accent" };
  if (status === "needs_input") pill = { label: "Needs you", tone: "accent" };
  if (status === "failed" || status === "superseded") pill = { label: "Stopped", tone: "neutral" };

  const pages = new Set(trail.map((s) => s.url).filter(Boolean)).size;
  const runMeta = running ? (trail.length > 0 ? count(trail.length, "step", "steps") : null) : initial.run ? [count(initial.run.steps, "step", "steps"), initial.run.seconds ? howLong(initial.run.seconds) : ""].filter(Boolean).join(" · ") : framed.length > 0 ? count(trail.length, "step", "steps") : null;

  return (
    <div className="sg-col sg-t">
      <TestHead
        host={host}
        href={job.productUrl}
        state={pill.label}
        tone={pill.tone}
        sub={
          isTrying ? (
            reads
              ? `Sage can't use this kind of product itself, so it is reading ${reads}. People do the trying. You can close this page: Sage keeps going, and this link is the test.`
              : "It opens the product in a real browser and uses it the way a stranger would. You can close this page: Sage keeps going, and this link is the test."
          ) : isWriting ? (
            "From what it saw, it is working out what to ask people to try, and checking each mission can be judged fairly. This part usually takes two to five minutes."
          ) : ready && mine ? (
            reads
              ? `Sage read ${reads}, wrote the missions below, and will check every answer against what it read. It could not use the product itself: people do. You pay only what testers earn.`
              : "Sage tried it, wrote the missions below, and will check every answer against what it saw itself. You pay only what testers earn."
          ) : ready && whose === "x" ? (
            `A tag on X started this test. Only ${who ?? "the account that tagged Sage"} can pay for it.`
          ) : ready ? (
            "The places open when the person who started this test pays for it."
          ) : status === "needs_input" ? (
            "Your answer goes straight into the plan. The test is saved either way."
          ) : (
            "Nothing was paid and nothing is lost. The test is saved at this link."
          )
        }
      >
        {isTrying ? (
          <>Sage is {reads ? "reading" : "trying"} <span className="sg-mono">{host}</span>.</>
        ) : isWriting ? (
          <>Sage is writing the missions.</>
        ) : ready && shape && mine ? (
          <>
            {shape.people} people can try <span className="sg-mono">{host}</span> for {baseToUsd(shape.totalBase)}.
          </>
        ) : ready ? (
          <>Sage {reads ? "read" : "tried"} <span className="sg-mono">{host}</span>{who && whose === "x" ? ` for ${who}` : ""}. The test is ready.</>
        ) : status === "needs_input" ? (
          <>Sage has a question before it writes the missions.</>
        ) : status === "superseded" ? (
          <>A newer run replaced this one.</>
        ) : (
          <>Sage couldn&apos;t finish trying <span className="sg-mono">{host}</span>.</>
        )}
      </TestHead>

      <div className="sg-t-stages">
        {/* 1 ── Sage tries it ──────────────────────────────────────────────── */}
        <Stage state={isTrying ? "now" : "done"} title={reads ? (isTrying ? `Sage is reading ${reads}` : `Sage read ${reads}`) : isTrying ? "Sage is trying it" : "Sage tried it"} meta={runMeta}>
          {running ? (
            <>
              {framed.length > 0 ? (
                <div className="sg-shots" ref={shots}>
                  {framed.map((s, i) => (
                    <Frame key={s.n} n={s.n + 1} url={s.url} src={s.screenshot!} note={noteOf(s.label, host)} priority={i === 0} />
                  ))}
                </div>
              ) : null}
              {latest ? (
                <p className="sg-t-now" role="status" aria-live="polite">
                  <span className="sg-t-now-n">{String(latest.n + 1).padStart(2, "0")}</span>
                  <span>{lineOf(latest.label, host)}</span>
                </p>
              ) : (
                <p className="sg-t-now" role="status">
                  <Loader2 size={14} className="sg-spin" aria-hidden />
                  <span>{status === "queued" ? "About to open it." : "Opening it."}</span>
                </p>
              )}
              {trail.length > 1 ? (
                <ol className="sg-t-log" aria-label="What Sage has done so far">
                  {trail
                    .slice(-6, -1)
                    .reverse()
                    .map((s) => (
                      <li key={s.n}>
                        <span>{String(s.n + 1).padStart(2, "0")}</span>
                        <span>{lineOf(s.label, host)}</span>
                        <span>{clock(s, trail[0])}</span>
                      </li>
                    ))}
                </ol>
              ) : null}
            </>
          ) : initial.run && initial.run.frames.length > 0 ? (
            <div className="sg-shots">
              {initial.run.frames.map((f, i) => (
                <Frame key={f.n} n={f.n} url={f.url} src={f.src} note={f.note} saw={f.saw} priority={i === 0} />
              ))}
            </div>
          ) : !RUNNING.has(status) && job.pagesInspected > 0 ? (
            whose === "yours" ? (
              <p className="sg-small">Sage read {count(job.pagesInspected, "page", "pages")} of it. It kept no pictures from this run.</p>
            ) : (
              // the frames exist; they are the owner's until the test is done (NO CORPUS ORACLE, before.ts)
              <p className="sg-small">Sage read {count(job.pagesInspected, "page", "pages")} of it. What it saw stays with the person who started this test until the test is done.</p>
            )
          ) : null}
          {!running ? <Facts facts={initial.facts} /> : null}
          {!running && initial.couldNotSee.length > 0 ? (
            <p className="sg-small">
              <b className="sg-ink">What Sage could not see.</b> {initial.couldNotSee.join(" ")}
            </p>
          ) : null}
        </Stage>

        {/* 1b ── what Sage itself noticed: free, and before anyone is paid ──── */}
        {look ? (
          <Stage state="done" title="What Sage noticed" meta={lookMeta(look)}>
            <FirstLook look={look} />
          </Stage>
        ) : isTrying ? (
          <Stage state="next" title="What Sage noticed" />
        ) : null}

        {/* 2 ── the missions ───────────────────────────────────────────────── */}
        {status === "needs_input" ? (
          <Stage state="now" title="Sage has a question">
            <Question job={job} mine={mine} onJob={setJob} />
          </Stage>
        ) : status === "failed" || status === "superseded" ? (
          <Stage state="now" title="What happened">
            <Failed job={job} mine={mine} onJob={setJob} />
          </Stage>
        ) : (
          <Stage
            state={isWriting ? "now" : ready ? "done" : "next"}
            title={isWriting ? "Sage is writing the missions" : ready ? `Sage wrote ${count(plan!.missions.length, "mission", "missions")}` : "The missions"}
            meta={ready && shape ? `${shape.people} places` : null}
          >
            {isWriting ? (
              <dl className="sg-t-facts">
                <div className="sg-t-fact">
                  <dt>What Sage did</dt>
                  <dd>
                    {trail.length > 0 ? `${count(framed.length, "screen", "screens")} captured${pages > 0 ? ` across ${count(pages, "page", "pages")}` : ""}` : job.pagesInspected > 0 ? `Read ${count(job.pagesInspected, "page", "pages")}` : "Tried the product"}
                  </dd>
                </div>
                <div className="sg-t-fact">
                  <dt>Doing now</dt>
                  <dd>{status === "reviewing" ? "Checking each mission is fair and can be judged" : "Turning what it saw into things a person can try"}</dd>
                </div>
              </dl>
            ) : ready ? (
              <div className="sg-stack sg-gap-4">
                {job.safety?.outcome === "hold" ? (
                  <div className="sg-t-notice">
                    <p>{job.safety.line}</p>
                  </div>
                ) : null}
                {job.purpose ? <PurposeLine purpose={job.purpose} /> : null}
                <div className="sg-t-missions">
                  {plan!.missions.map((m, i) => (
                    <MissionItem
                      key={m.missionKey}
                      n={i + 1}
                      open={plan!.missions.length === 1}
                      mission={{
                        missionKey: m.missionKey,
                        title: m.title,
                        objective: m.objective,
                        instructions: m.instructions,
                        criteria: m.criteria,
                        each: baseToUsd(Number(m.rewardBase)),
                        places: count(Number(m.maxCompletions), "person", "people"),
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </Stage>
        )}

        {/* 3 ── the offer ──────────────────────────────────────────────────── */}
        <Stage state={ready ? "now" : "next"} title={ready ? (mine ? "Choose the people and pay" : "The offer") : "The offer"} id="offer">
          {ready ? (
            <OfferCard
              job={job}
              whose={whose}
              inviteOnly={initial.inviteOnly}
              xDraft={initial.xDraft}
              locked={initial.offerLocked}
              onJob={setJob}
              onMine={onMine}
              onLive={onLive}
            />
          ) : null}
        </Stage>

        {/* 4, 5 ── what comes after the money ──────────────────────────────── */}
        <Stage state="next" title="People try it, and each one is checked and paid" />
        <Stage state="next" title="What they found" />
      </div>
    </div>
  );
}

/** Sage asked something. The answer goes into the plan and Sage carries on; or it can simply try again. */
function Question({ job, mine, onJob }: { job: JobView; mine: boolean; onJob: (j: JobView) => void }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState<"answer" | "retry" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const questions = job.result?.questions?.length ? job.result.questions : ["Could Sage reach your product over HTTPS?"];

  const send = async (kind: "answer" | "retry") => {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/launch/${job.id}/${kind === "answer" ? "clarify" : "retry"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: kind === "answer" ? JSON.stringify({ answer }) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; job?: JobView; error?: string };
      if (data.ok && data.job) onJob(data.job);
      else setError(data.error ?? "That didn't go through. Try again.");
    } catch {
      setError("Sage couldn't be reached. Your test is saved; try again.");
    }
    setBusy(null);
  };

  return (
    <>
      <ul className="sg-t-list">
        {questions.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ul>
      {mine ? (
        <>
          <textarea className="sg-t-area" aria-label="Your answer" placeholder="For example: what a person should manage to do, or where they should start." value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <div className="sg-t-notice-actions">
            <Button disabled={busy !== null || !answer.trim()} onClick={() => void send("answer")}>
              {busy === "answer" ? <Loader2 size={16} className="sg-spin" aria-hidden /> : null}
              Answer and carry on
            </Button>
            <Button variant="quiet" disabled={busy !== null} onClick={() => void send("retry")}>
              Try again without answering
            </Button>
          </div>
          {error ? (
            <p className="sg-small sg-note-problem" role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <p className="sg-small">The person who started this test can answer here.</p>
      )}
    </>
  );
}

/** Sage could not finish. What happened in one sentence, and the one next step. */
function Failed({ job, mine, onJob }: { job: JobView; mine: boolean; onJob: (j: JobView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/launch/${job.id}/retry`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; job?: JobView; error?: string };
      if (data.ok && data.job) onJob(data.job);
      else setError(data.error ?? "That didn't start. Try again in a moment.");
    } catch {
      setError("Sage couldn't be reached. Your test is saved; try again.");
    }
    setBusy(false);
  };
  return (
    <div className="sg-t-notice" data-tone="problem">
      <p>{job.status === "superseded" ? "This run was replaced by a newer one of the same product." : friendlyFailure(job.failureReason ?? job.result?.reason)}</p>
      <div className="sg-t-notice-actions">
        {mine && job.status === "failed" ? (
          <Button size="sm" disabled={busy} onClick={() => void retry()}>
            {busy ? <Loader2 size={15} className="sg-spin" aria-hidden /> : null}
            Try again
          </Button>
        ) : null}
        <ButtonLink href="/" variant="quiet" size="sm">
          Start with another link
        </ButtonLink>
      </div>
      {error ? (
        <p className="sg-small sg-note-problem" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
