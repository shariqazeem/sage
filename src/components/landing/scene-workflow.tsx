"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Compass, Eye, Lock, MousePointer2, ShieldCheck, Wand2, X } from "lucide-react";
import { usd } from "@/lib/format";
import type { Showcase, ShowcaseMove } from "@/lib/landing/showcase";

/**
 * THE FILM. One dark frame pinned beside four chapters. Scrolling scrubs a continuous progress
 * p ∈ [0, 4): floor(p) is the take on screen and the fraction is how far its scene has played —
 * the artifact draws itself as the reader approaches the heading (a beam scans the observed
 * facts, criteria stamp in, the confidence counts up, the veto ring closes) and hands over to
 * the next take in the last stretch before the next heading. Nothing here is timed: every frame
 * is a function of scroll position, so it plays forward and backward, never stalls, and reads as
 * one take rather than four cards. Every artifact is the real run, loaded from the ledger.
 * Reduced-motion and phones get each take fully drawn, inline under its chapter.
 */
const CHAPTERS = [
  {
    n: "01",
    tag: "Explore",
    Icon: Eye,
    title: "Sage enters the product itself.",
    body: "No brief, no guesswork. Sage opens the real product in its own browser, moves through it, and records the states and controls it actually sees.",
  },
  {
    n: "02",
    tag: "Design",
    Icon: Wand2,
    title: "Every mission begins with something Sage actually saw.",
    body: "Observed facts condense into paid missions. Each criterion is linked to the source it came from, the budget is allocated deterministically, and anything Sage can’t ground is dropped.",
  },
  {
    n: "03",
    tag: "Verify",
    Icon: ShieldCheck,
    title: "A tester can claim the work. Sage still checks for itself.",
    body: "When someone submits, Sage opens a fresh, isolated browser and replays the same safe action. Only when the expected outcome appears does a verification permit exist.",
  },
  {
    n: "04",
    tag: "Decide",
    Icon: Compass,
    title: "Then it decides what to buy next.",
    body: "Work that gets claimed earns a larger budget next time; work nobody comes to is stopped and the money returns. Sage proposes each move with its reason and its price before anything is spent, and waits — you can stop it, or tell it to go now. It can never spend past your ceilings, price its own work, or buy against a product you did not name.",
  },
];

const TAKES = CHAPTERS.length;
/** the chapter's scene starts playing when its heading is this far below the activation line */
const LEAD = 0.28;
const RING_LEN = 2 * Math.PI * 18;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => { const x = clamp01(v); return x * x * (3 - 2 * x); };

/**
 * Drive one film frame to progress p. Pure DOM writes, no React re-render: the takes' opacity
 * and depth, each take's reveals (`data-r` = the local progress at which the element appears),
 * the beam, the ring, the counter and the filmstrip.
 */
function drive(root: HTMLElement, p: number, reduce: boolean) {
  const active = Math.min(TAKES - 1, Math.floor(p));
  const takes = root.querySelectorAll<HTMLElement>(".film-take");
  takes.forEach((take, i) => {
    const d = p - i;
    const t = reduce ? (i === active ? 1 : i < active ? 1 : 0) : clamp01(d);
    let opacity = 0, ty = 0, scale = 1, blur = 0;
    if (reduce) {
      opacity = i === active ? 1 : 0;
    } else if (d < -0.18) {
      opacity = 0; ty = 26;
    } else if (d < 0) {
      const k = smooth((d + 0.18) / 0.18);
      opacity = k; ty = 26 * (1 - k);
    } else if (d <= 0.84) {
      opacity = 1;
    } else if (d <= 1) {
      const k = smooth((d - 0.84) / 0.16);
      opacity = 1 - k * 0.85; ty = -16 * k; scale = 1 - 0.05 * k; blur = 1.5 * k;
    } else if (d < 1.7) {
      const k = (d - 1) / 0.7;
      opacity = 0.15 * (1 - k); ty = -18; scale = 0.94; blur = 2;
    }
    take.style.opacity = opacity.toFixed(3);
    take.style.transform = `translate3d(0, ${ty.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
    take.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none";
    take.style.visibility = opacity < 0.01 ? "hidden" : "visible";
    take.style.zIndex = i === active ? "2" : "1";
    take.querySelectorAll<HTMLElement>("[data-r]").forEach((el) => {
      const th = Number(el.dataset.r ?? 0);
      const r = reduce ? 1 : smooth((t - th) / 0.14);
      el.style.opacity = r.toFixed(3);
      el.style.transform = r < 0.999 ? `translate3d(0, ${(10 * (1 - r)).toFixed(1)}px, 0)` : "none";
    });
    take.querySelectorAll<HTMLElement>("[data-kind='beam']").forEach((el) => {
      const k = clamp01(t / 0.62);
      el.style.top = `${(6 + 88 * k).toFixed(1)}%`;
      el.style.opacity = reduce || t > 0.66 ? "0" : "1";
    });
    take.querySelectorAll<SVGCircleElement>("[data-kind='ring']").forEach((el) => {
      el.style.strokeDashoffset = (RING_LEN * (1 - clamp01(t / 0.7))).toFixed(2);
    });
    take.querySelectorAll<HTMLElement>("[data-kind='count']").forEach((el) => {
      const target = Number(el.dataset.count ?? 0);
      el.textContent = String(Math.round(target * smooth(clamp01((t - 0.1) / 0.6))));
    });
  });
  root.querySelectorAll<HTMLElement>(".film-seg").forEach((seg, i) => {
    seg.style.setProperty("--f", (reduce ? (i <= active ? 1 : 0) : clamp01(p - i)).toFixed(3));
    seg.dataset.on = i === active ? "1" : "0";
  });
}

export function SceneWorkflow({ showcase, move = null }: { showcase: Showcase | null; move?: ShowcaseMove | null }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const filmRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    let lastActive = -1;
    const recompute = () => {
      raf = 0;
      const film = filmRef.current;
      const line = window.innerHeight * 0.42;
      const ys = refs.current.map((el) => {
        const h = el?.querySelector("h3") ?? el;
        if (!h) return Number.POSITIVE_INFINITY;
        const r = h.getBoundingClientRect();
        return r.top + r.height / 2;
      });
      const lead = window.innerHeight * LEAD;
      // p = i + (line − (y_i − lead)) / (y_{i+1} − y_i): the scene plays as its heading approaches
      let p = 0;
      const last = TAKES - 1;
      const span = (i: number) => (i < last ? ys[i + 1]! - ys[i]! : ys[last]! - ys[last - 1]!);
      for (let i = 0; i < TAKES; i++) {
        const start = ys[i]! - lead;
        const s = span(i);
        if (!Number.isFinite(start) || !Number.isFinite(s) || s <= 0) continue;
        if (line >= start) p = i + (line - start) / s;
      }
      p = Math.max(0, Math.min(TAKES - 0.001, p));
      if (film) drive(film, p, reduce);
      const a = Math.min(last, Math.floor(p));
      if (a !== lastActive) { lastActive = a; setActive(a); }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(recompute); };
    const io = new IntersectionObserver(schedule, { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] });
    refs.current.forEach((r) => r && io.observe(r));
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    recompute();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <section id="how" className="wf scene" aria-label="How Sage works">
      <div className="wrap">
        <div className="wf-head">
          <span className="eyebrow">Fund once, then stop deciding</span>
          <h2 className="h2">You watch the agent work.</h2>
          <p className="lede wf-lede">It sees the product, designs the work, verifies every deliverable, then decides what to buy next. Every take below is a real run, read from the ledger.</p>
        </div>

        <div className="wf-grid">
          <div className="wf-stage-col">
            <div className="wf-stage" ref={filmRef}>
              <Film sc={showcase} move={move} active={active} mode="scrub" />
            </div>
          </div>

          <div className="wf-chapters">
            {CHAPTERS.map((c, i) => (
              <div
                key={c.n}
                ref={(el) => { refs.current[i] = el; }}
                className="wf-chapter"
                data-active={active === i ? "1" : "0"}
              >
                <div className="wf-chapter-k mono">
                  <span className="wf-n">{c.n}</span>
                  <span className="wf-tag">
                    <c.Icon size={14} strokeWidth={2} /> {c.tag}
                  </span>
                </div>
                <h3 className="h3">{c.title}</h3>
                <p className="wf-body">{c.body}</p>
                {/* phones and reduced motion: the take, fully drawn, under its chapter */}
                <div className="wf-stage wf-stage-inline">
                  <Film sc={showcase} move={move} active={i} mode="static" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** the caption under the screen — the fact a judge would check for this take */
function caption(i: number, sc: Showcase | null, move: ShowcaseMove | null): [string, string] {
  if (!sc) return [["app.yourproduct.com · Sage's own browser", "grounded mission · reward from the budget", "fresh session · replay", "next move · proposed first"][i] ?? "", "sketch"];
  if (i === 0) return [`${sc.targetHost} · recorded in Sage's own browser`, "before any mission existed"];
  if (i === 1) return [`${sc.railLabel} · reward ${usd(sc.mission.rewardBase / 1_000_000)}`, "allocated deterministically"];
  if (i === 2) return [`tx ${sc.txHash.slice(0, 10)}…${sc.txHash.slice(-4)} · ${sc.railLabel}`, "the vault released it"];
  if (move) return [`${move.surface} · ${move.source === "real" ? "recorded before the money moved" : "rehearsal, nothing recorded"}`, move.decidedBy === "llm" ? "chosen by the model" : "chosen by the rules"];
  return ["next move · proposed first", "never above your ceilings"];
}

/**
 * The frame: a filmstrip of four takes, the screen, the caption. In `scrub` mode the takes are
 * stacked and `drive()` sets their state from scroll; in `static` mode only `active` renders,
 * fully drawn.
 */
function Film({ sc, move, active, mode }: { sc: Showcase | null; move: ShowcaseMove | null; active: number; mode: "scrub" | "static" }) {
  const [cap, sub] = caption(active, sc, move);
  const takes = mode === "scrub" ? [0, 1, 2, 3] : [active];
  return (
    <div className="film" data-mode={mode}>
      <div className="film-bar">
        <ol className="film-strip" aria-hidden>
          {CHAPTERS.map((c, i) => (
            <li key={c.n} className="film-seg" data-on={i === active ? "1" : "0"} style={mode === "static" ? ({ "--f": i <= active ? 1 : 0 } as React.CSSProperties) : undefined}>
              <i />
              <span className="mono">{c.n} · {c.tag}</span>
            </li>
          ))}
        </ol>
        <span className="film-real mono"><i className="film-dot" />{sc ? "real run" : "sketch"}</span>
      </div>
      <div className="film-screen">
        {takes.map((i) => (
          <div key={i} className="film-take" data-i={i} style={mode === "static" ? { position: "static", opacity: 1 } : undefined}>
            {sc ? <RealTake i={i} sc={sc} move={move} /> : <SketchTake i={i} />}
          </div>
        ))}
      </div>
      <div className="film-cap mono">
        <span>{cap}</span>
        <span>{sub}</span>
      </div>
    </div>
  );
}

/** the reveal attribute: in static mode everything is drawn */
const r = (th: number) => ({ "data-r": th });

function RealTake({ i, sc, move }: { i: number; sc: Showcase; move: ShowcaseMove | null }) {
  if (i === 0) {
    return (
      <div className="art">
        <i className="film-beam" data-kind="beam" aria-hidden />
        <div className="art-h">
          <span>What Sage saw · {sc.targetHost}</span>
          <span className="real">real run</span>
        </div>
        <p className="art-t" {...r(0.04)}>{sc.campaignTitle}</p>
        <ul className="art-list">
          {sc.mission.criteria.slice(0, 3).map((c, k) => (
            <li key={k} {...r(0.16 + k * 0.16)}><span className="k">observed</span><span>{c}</span></li>
          ))}
        </ul>
        <div className="art-f" {...r(0.68)}>
          <span>Recorded in Sage&rsquo;s own browser, before any mission existed.</span>
        </div>
      </div>
    );
  }
  if (i === 1) {
    return (
      <div className="art">
        <div className="art-h">
          <span>Mission · {sc.mission.verifiabilityClass === "url-verifiable" ? "url-verifiable" : "observation-based"}</span>
          <span className="real">real run</span>
        </div>
        <p className="art-t" {...r(0.06)}>{sc.mission.title}</p>
        <ul className="art-list">
          {sc.mission.criteria.slice(0, 3).map((c, k) => (
            <li key={k} {...r(0.2 + k * 0.15)}><span className="k">criterion</span><span>{c}</span></li>
          ))}
        </ul>
        <div className="art-f" {...r(0.7)}>
          <span>reward <b className="mono">{usd(sc.mission.rewardBase / 1_000_000)}</b> · allocated deterministically</span>
          <span>{sc.railLabel}</span>
        </div>
      </div>
    );
  }
  if (i === 2) {
    const quoted = sc.decision.criteria.find((c) => c.quote) ?? sc.decision.criteria[0];
    const pct = Math.round(sc.decision.confidence * 100);
    return (
      <div className="art">
        <div className="art-h">
          <span>Verdict · <b className="art-pct"><span data-kind="count" data-count={pct}>{pct}</span>%</b> confidence</span>
          <span className="real">real run</span>
        </div>
        <ul className="art-list">
          {sc.decision.criteria.slice(0, 3).map((c, k) => (
            <li key={k} {...r(0.14 + k * 0.14)}>
              <span className={`art-stamp ${c.met ? "art-ok" : "art-no"}`}>{c.met ? <Check size={13} strokeWidth={3} /> : <X size={13} strokeWidth={2.8} />}</span>
              <span>{c.criterion.length > 110 ? `${c.criterion.slice(0, 108)}…` : c.criterion}</span>
            </li>
          ))}
        </ul>
        {quoted?.quote && <p className="art-quote" {...r(0.58)}>&ldquo;{quoted.quote.length > 160 ? `${quoted.quote.slice(0, 158)}…` : quoted.quote}&rdquo;</p>}
        <div className="art-f" {...r(0.74)}>
          <span>Recommendation: <b className={sc.decision.recommendation === "pay" ? "art-ok" : "art-no"}>{sc.decision.recommendation}</b> · the vault released it</span>
          <Link href={`/proof/${sc.txHash}`}>receipt →</Link>
        </div>
      </div>
    );
  }
  if (!move) return <SketchTake i={3} />;
  const real = move.source === "real";
  const KIND: Record<ShowcaseMove["kind"], string> = { testing: "testing run", gig: "gig", grant: "grant" };
  return (
    <div className="art art-move">
      <div className="art-h">
        <span>Next move · {move.surface}</span>
        <span className="real">{real ? "real run" : "rehearsal"}</span>
      </div>
      <div className="art-move-row">
        <svg className="film-ring" viewBox="0 0 44 44" aria-hidden>
          <circle className="track" cx="22" cy="22" r="18" fill="none" strokeWidth="3" />
          <circle className="arc" data-kind="ring" cx="22" cy="22" r="18" fill="none" strokeWidth="3" strokeDasharray={RING_LEN} strokeDashoffset={0} />
        </svg>
        <p className="art-t" {...r(0.05)}>
          <b className="mono">{usd(move.budgetUsd)}</b> {KIND[move.kind]} on <span className="mono">{move.surface}</span>
        </p>
      </div>
      <ul className="art-list">
        <li {...r(0.24)}><span className="k">goal</span><span>{move.goal.length > 140 ? `${move.goal.slice(0, 138)}…` : move.goal}</span></li>
        <li {...r(0.42)}><span className="k">why</span><span>{move.reason.length > 160 ? `${move.reason.slice(0, 158)}…` : move.reason}</span></li>
      </ul>
      <div className="art-f" {...r(0.68)}>
        {real ? (
          <span>{move.state === "vetoed" ? "Stopped by the founder inside the window" : move.state === "launched" ? "Launched after the veto window passed" : "Proposed — waiting out the veto window"}</span>
        ) : (
          <span>Sized as if the treasury held <b className="mono">{usd(move.assumesFundingUsd ?? 0)}</b> · nothing recorded</span>
        )}
        <Link href="/workspace/autopilot">let it run →</Link>
      </div>
    </div>
  );
}

/** the sketch — only ever shown to an empty ledger */
function SketchTake({ i }: { i: number }) {
  return (
    <div className="wfv">
      <div className="wfv-browser">
        <div className="wfv-chrome">
          <span className="wfv-dots"><i /><i /><i /></span>
          <span className="wfv-url mono"><Lock size={11} strokeWidth={2.4} />{i === 2 ? "fresh session · replay" : "app.yourproduct.com"}</span>
        </div>
        <div className="wfv-body">
          {i === 0 && (
            <>
              <div className="wfv-line w-60" {...r(0.05)} />
              <div className="wfv-line w-80" {...r(0.12)} />
              <div className="wfv-line w-45" {...r(0.2)} />
              <span className="wfv-chip c1" {...r(0.3)}>observed · heading</span>
              <span className="wfv-chip c2" {...r(0.42)}>observed · input</span>
              <span className="wfv-chip c3" {...r(0.54)}>action · Start</span>
              <MousePointer2 className="wfv-cursor" size={18} strokeWidth={2.2} fill="currentColor" />
            </>
          )}
          {i === 1 && (
            <div className="wfv-mission">
              <div className="wfv-mission-h mono"><Wand2 size={13} strokeWidth={2} /> Mission · grounded</div>
              <div className="wfv-mission-t" {...r(0.1)}>Click “Start” and reach the garden</div>
              <div className="wfv-crit" {...r(0.3)}><span className="mono">criterion</span><span className="wfv-link" /><span className="mono">observed · Start</span></div>
              <div className="wfv-mission-f" {...r(0.55)}>
                <span className="wfv-reward mono">reward $0.40</span>
                <span className="wfv-ghost mono"><X size={11} strokeWidth={2.6} /> ungrounded mission dropped</span>
              </div>
            </div>
          )}
          {i === 2 && (
            <>
              <div className="wfv-line w-45" {...r(0.05)} />
              <div className="wfv-replay-row" {...r(0.25)}>
                <span className="wfv-replay-act mono"><MousePointer2 size={12} strokeWidth={2.4} fill="currentColor" /> click “Start”</span>
                <span className="wfv-replay-ok mono"><Check size={12} strokeWidth={3} /> garden observed</span>
              </div>
              <div className="wfv-permit" {...r(0.55)}>
                <span className="wfv-permit-ic"><ShieldCheck size={13} strokeWidth={2} /></span>
                <span className="mono">verification permit minted</span>
              </div>
            </>
          )}
          {i === 3 && (
            <div className="wfv-mission">
              <div className="wfv-mission-h mono"><Compass size={13} strokeWidth={2} /> Next move · proposed</div>
              <div className="wfv-mission-t" {...r(0.1)}>$5.00 testing run on app.yourproduct.com</div>
              <div className="wfv-crit" {...r(0.3)}><span className="mono">why</span><span className="wfv-link" /><span className="mono">the last run filled · scale ×2</span></div>
              <div className="wfv-mission-f" {...r(0.55)}>
                <span className="wfv-reward mono">veto window 20m</span>
                <span className="wfv-ghost mono">never above your ceilings</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
