import { describe, it, expect } from "vitest";

/**
 * SCREEN CHURN — the rule that stops a marketing page absorbing the whole exploration budget.
 *
 * Job Y2RRcUc9OB_Q spent 11 of its 26 states on `/`, clicking the landing page's own demo widget
 * ("Start", "action · Start", "payout may continue", "SAGE REPLAYED") and reached the actual app with
 * nothing left to spend. On a page that repaints, every click satisfies "the words changed", so each
 * one bought another unit of the state budget and the run never left.
 *
 * The rule is reproduced here exactly as the loop applies it, because the loop itself only runs
 * inside a real browser against a real product: a screen that keeps changing WITHOUT getting anywhere
 * accrues churn, and at the cap every control on it retires at once. Anything that is actually
 * getting somewhere — a new url, an accepted field, a founder checkpoint met — resets it.
 */

const SCREEN_CHURN_CAP = 4;

/** The accounting the goal loop performs on each state, extracted verbatim in shape. */
function runChurn(
  steps: Array<{ url: string; filled?: boolean; journeyAdvanced?: boolean }>,
) {
  const churnAtUrl = new Map<string, number>();
  const retired: string[] = [];
  let prevUrl = steps[0]?.url ?? "/";
  for (const s of steps.slice(1)) {
    const sameUrl = s.url === prevUrl;
    if (!sameUrl || s.filled || s.journeyAdvanced) {
      churnAtUrl.set(s.url, 0);
    } else {
      const seen = (churnAtUrl.get(prevUrl) ?? 0) + 1;
      churnAtUrl.set(prevUrl, seen);
      if (seen >= SCREEN_CHURN_CAP && !retired.includes(prevUrl)) {
        retired.push(prevUrl);
      }
    }
    prevUrl = s.url;
  }
  return { retired, churnAtUrl };
}

const at = (url: string, n: number) => Array.from({ length: n }, () => ({ url }));

describe("a repainting landing page is retired", () => {
  it("retires the screen once it churns past the cap", () => {
    const { retired } = runChurn(at("/", 8));
    expect(retired).toEqual(["/"]);
  });

  it("does not retire it before the cap", () => {
    expect(runChurn(at("/", SCREEN_CHURN_CAP)).retired).toEqual([]);
  });

  it("reproduces the real failure: 11 states on / would have retired it", () => {
    const { retired, churnAtUrl } = runChurn(at("/", 11));
    expect(retired).toEqual(["/"]);
    // and the churn is counted where it happened, not spread across the run
    expect(churnAtUrl.get("/")).toBeGreaterThanOrEqual(SCREEN_CHURN_CAP);
  });
});

describe("a screen that is getting somewhere is never retired", () => {
  it("a filled field resets the count", () => {
    const steps = [
      { url: "/launch" },
      { url: "/launch" },
      { url: "/launch" },
      { url: "/launch", filled: true },
      { url: "/launch" },
      { url: "/launch" },
      { url: "/launch", filled: true },
      { url: "/launch" },
    ];
    expect(runChurn(steps).retired).toEqual([]);
  });

  it("a founder checkpoint being met resets the count", () => {
    const steps = [
      { url: "/app" },
      { url: "/app" },
      { url: "/app" },
      { url: "/app", journeyAdvanced: true },
      { url: "/app" },
      { url: "/app" },
    ];
    expect(runChurn(steps).retired).toEqual([]);
  });

  it("a multi-step form alternating fill and continue survives indefinitely", () => {
    const steps: Array<{ url: string; filled?: boolean }> = [{ url: "/launch" }];
    for (let i = 0; i < 12; i++) {
      steps.push({ url: "/launch" }, { url: "/launch", filled: true });
    }
    expect(runChurn(steps).retired).toEqual([]);
  });

  it("navigating away gives the new screen a clean slate", () => {
    const steps = [...at("/", 3), { url: "/dashboard" }, ...at("/dashboard", 3)];
    expect(runChurn(steps).retired).toEqual([]);
  });
});

describe("churn is per screen, not global", () => {
  it("retires only the screen that churned", () => {
    const steps = [...at("/", 8), { url: "/launch" }, ...at("/launch", 2)];
    expect(runChurn(steps).retired).toEqual(["/"]);
  });

  it("counts two bad screens independently", () => {
    const steps = [...at("/", 8), { url: "/pricing" }, ...at("/pricing", 8)];
    expect(runChurn(steps).retired).toEqual(["/", "/pricing"]);
  });

  it("a screen revisited after real progress starts clean", () => {
    // / churns 3, Sage leaves, comes back — the return resets rather than resuming at 3.
    const steps = [...at("/", 3), { url: "/app" }, { url: "/" }, ...at("/", 3)];
    expect(runChurn(steps).retired).toEqual([]);
  });
});

/**
 * FORCED DEPARTURE — the rule that finally moved the number. Label-level retirement cannot work on a
 * page whose demo widget RENAMES its controls on every repaint ("Start" → "action · Start" → "payout
 * may continue" → "SAGE REPLAYED"); retiring one only hides a label the page has already replaced.
 * Two attempts at it moved 11 states to 10. So the entry screen, once it has churned past the cap,
 * is left by NAVIGATION rather than by declining the same buttons again.
 */
const MAX_NAVIGATIONS = 3;

function forcedExit(opts: {
  here: string;
  entry: string;
  churn: number;
  candidates: string[];
  visited?: string[];
  navigations?: number;
}): string | null {
  const visited = new Set(opts.visited ?? []);
  if (opts.here !== opts.entry) return null;
  if (opts.churn < SCREEN_CHURN_CAP) return null;
  if ((opts.navigations ?? 0) >= MAX_NAVIGATIONS) return null;
  return opts.candidates.find((p) => !visited.has(p)) ?? null;
}

describe("an exhausted entry screen is left by navigating", () => {
  const base = { here: "/", entry: "/", candidates: ["/launch", "/dashboard"] };

  it("opens the first unvisited route once the entry page is exhausted", () => {
    expect(forcedExit({ ...base, churn: SCREEN_CHURN_CAP })).toBe("/launch");
  });

  it("stays put while the entry page is still paying", () => {
    expect(forcedExit({ ...base, churn: SCREEN_CHURN_CAP - 1 })).toBeNull();
  });

  it("never loops back onto a route it already opened", () => {
    expect(
      forcedExit({ ...base, churn: 9, visited: ["/launch"] }),
    ).toBe("/dashboard");
    expect(
      forcedExit({ ...base, churn: 9, visited: ["/launch", "/dashboard"] }),
    ).toBeNull();
  });

  it("leaves a genuine single-page product alone — no routes, no forced exit", () => {
    expect(forcedExit({ ...base, churn: 9, candidates: [] })).toBeNull();
  });

  it("does not fire on a screen Sage navigated TO, only on the entry screen", () => {
    expect(forcedExit({ ...base, here: "/launch", churn: 9 })).toBeNull();
  });

  it("respects the navigation ceiling", () => {
    expect(
      forcedExit({ ...base, churn: 9, navigations: MAX_NAVIGATIONS }),
    ).toBeNull();
  });
});

/**
 * THE TRIGGER THAT HELD. Every cleverer signal was defeated by the page itself — label retirement by
 * a widget that renames its controls each repaint, churn-with-journey-reset by landing copy that
 * DESCRIBES the flow so checkpoints read as observed from marketing text. Three deploys moved 11
 * states to 10 to 11.
 *
 * A marketing page can fake progress signals. It cannot fake having been looked at N times.
 */
const ENTRY_STATE_CAP = 6;

function entryExit(steps: string[], candidates: string[]): number | null {
  let entryStates = 0;
  const entry = steps[0];
  const visited = new Set<string>();
  let navigations = 0;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] === entry) entryStates++;
    if (
      steps[i] === entry &&
      entryStates > ENTRY_STATE_CAP &&
      navigations < MAX_NAVIGATIONS
    ) {
      const next = candidates.find((p) => !visited.has(p));
      if (next) {
        visited.add(next);
        navigations++;
        return i; // the state index at which Sage leaves
      }
    }
  }
  return null;
}

describe("the entry screen is left after a fixed number of looks", () => {
  it("leaves on the state after the cap, whatever the page claims", () => {
    expect(entryExit(Array(12).fill("/"), ["/launch"])).toBe(ENTRY_STATE_CAP);
  });

  it("caps the real failure at 7 states instead of 11", () => {
    const leaveAt = entryExit(Array(11).fill("/"), ["/launch", "/dashboard"]);
    expect(leaveAt).not.toBeNull();
    expect((leaveAt as number) + 1).toBeLessThan(11);
  });

  it("does not fire while the entry screen is within its allowance", () => {
    expect(entryExit(Array(ENTRY_STATE_CAP).fill("/"), ["/launch"])).toBeNull();
  });

  it("leaves a single-page product alone — no routes, no exit", () => {
    expect(entryExit(Array(12).fill("/"), [])).toBeNull();
  });

  it("does not count states spent on other screens against the entry allowance", () => {
    const steps = ["/", "/", "/launch", "/launch", "/launch", "/launch", "/launch"];
    expect(entryExit(steps, ["/launch"])).toBeNull();
  });
});
