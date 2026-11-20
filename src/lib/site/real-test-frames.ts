/**
 * THE FRAMES OF A RUN, chosen from a stored field test. Pure: the same stored run always gives the
 * same frames, and every word in a note comes from the run (what Sage did is the step's own
 * `trigger`; what it saw is its eyes' own description of that step, when there is one).
 *
 * A run can hold dozens of steps, many of them the same screen a moment later. The front door shows
 * a few: the first, then the steps where the screen changed the most, in the order they happened.
 */
export interface RealFrame {
  /** the step's number in the run, from 1 */
  n: number;
  /** the screenshot's file number, as the run saved it */
  file: number;
  src: string;
  url: string;
  note: string;
  saw: string | null;
}

export interface RunFrames {
  frames: RealFrame[];
  steps: number;
  seconds: number | null;
}

/** A screen counts as changed when this much of it is different from the step before. */
const CHANGED_PCT = 10;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const fileOf = (screenshot: unknown): number | null => {
  const m = /\/(\d{1,3})$/.exec(str(screenshot));
  return m ? Number(m[1]) : null;
};

/** The step in plain words: "initial load" → "Opened yara.garden"; `clicked "ENTER"` → `Clicked “ENTER”`. */
export function noteOf(trigger: string, host: string): string {
  const t = trigger.trim();
  if (!t || /^initial load$/i.test(t)) return `Opened ${host}`;
  if (/^clicked at \d/i.test(t)) return "Clicked on the page";
  // an icon button has no words on it: say what happened, never `Clicked “”`
  if (/^clicked\s*""\s*$/i.test(t)) return "Clicked a button with no label";
  const quoted = t.replace(/"([^"]*)"/g, "“$1”").replace(/\s*→\s*”/g, "”");
  return quoted[0].toUpperCase() + quoted.slice(1);
}

export function framesOf(fieldTest: unknown, host: string, max: number): RunFrames | null {
  const ft = fieldTest as { ran?: unknown; durationMs?: unknown; states?: unknown; pages?: unknown; visionObservations?: unknown } | null;
  if (!ft || ft.ran !== true) return null;
  const seconds = typeof ft.durationMs === "number" && ft.durationMs > 0 ? Math.round(ft.durationMs / 1000) : null;
  const states = Array.isArray(ft.states) ? (ft.states as Record<string, unknown>[]) : [];
  const pages = Array.isArray(ft.pages) ? (ft.pages as Record<string, unknown>[]) : [];

  if (states.length > 0) {
    const saw = new Map<number, string>();
    if (Array.isArray(ft.visionObservations)) {
      for (const o of ft.visionObservations as Record<string, unknown>[]) {
        if (typeof o.stateIndex === "number" && str(o.sceneDescription)) saw.set(o.stateIndex, str(o.sceneDescription));
      }
    }
    const all = states
      .map((s, i) => ({ i, file: fileOf(s.screenshot), url: str(s.url), trigger: str(s.trigger), delta: typeof s.pixelDeltaPct === "number" ? s.pixelDeltaPct : 0 }))
      .filter((s): s is typeof s & { file: number } => s.file !== null);
    if (all.length === 0) return null;
    // the first step, then the biggest changes of screen: the moments the run actually moved
    const changed = all.slice(1).filter((s) => s.delta >= CHANGED_PCT).sort((a, b) => b.delta - a.delta || a.i - b.i);
    const picked = [all[0], ...changed].slice(0, max);
    // a quiet run still shows what there is, in order
    for (const s of all) {
      if (picked.length >= Math.min(max, all.length)) break;
      if (!picked.includes(s)) picked.push(s);
    }
    picked.sort((a, b) => a.i - b.i);
    return {
      steps: states.length,
      seconds,
      frames: picked.map((s) => ({ n: s.i + 1, file: s.file, src: "", url: s.url, note: noteOf(s.trigger, host), saw: saw.get(s.i) ?? null })),
    };
  }

  // a site Sage read page by page: each page it opened is a step
  const opened = pages
    .map((p, i) => ({ i, file: fileOf(p.screenshot), url: str(p.url), title: str(p.h1) || str(p.title) }))
    .filter((p): p is typeof p & { file: number } => p.file !== null);
  if (opened.length === 0) return null;
  return {
    steps: pages.length,
    seconds,
    frames: opened.slice(0, max).map((p) => {
      let where = host;
      try {
        const u = new URL(p.url);
        where = u.pathname === "/" ? host : u.pathname;
      } catch {
        /* the host stands */
      }
      return { n: p.i + 1, file: p.file, src: "", url: p.url, note: `Opened ${where}`, saw: p.title || null };
    }),
  };
}
