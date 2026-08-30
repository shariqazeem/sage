import { describe, expect, it } from "vitest";

import { scopeForJob } from "./job";
import { scopeFromObservations } from "./product-map";
import type { InspectionJob } from "@/lib/db/schema";

/**
 * THE TWO SCOPES MUST AGREE, OR SAGE DISOWNS ITS OWN EYES.
 *
 * A mission is validated against `scopeFromObservations` when it is GENERATED, and against
 * `scopeForJob` whenever anything re-validates it later — editing a plan, rebalancing a budget.
 * The first included the field test's pages and states; the second did not.
 *
 * REPORTED on starkscan.co: its contract pages exist only behind the header search, so they are
 * field-test states and never crawled routes. The plan shipped, and removing one mission answered
 * "cited source does not exist" for a page Sage had itself driven a browser to. It could not show
 * up on a product whose pages are all reachable by following links, which is why every earlier
 * campaign was fine.
 */

const CONTRACT =
  "https://starkscan.co/contract/0x10398fe631af9ab2311840432d507bf7ef4b959ae967f1507928f5afe888a99";

const fieldTest = {
  ran: true,
  startUrl: "https://starkscan.co/",
  pages: [{ url: "https://starkscan.co/" }],
  states: [{ url: CONTRACT }, { url: "https://starkscan.co/" }],
} as never;

const job = (over: Record<string, unknown> = {}) =>
  ({
    productUrl: "https://starkscan.co/",
    result: {
      map: {
        routes: [{ sources: [{ kind: "page", ref: "https://starkscan.co/" }] }],
        browserConfirmed: [],
        interactiveSurfaces: [],
        trustSurfaces: [],
        fieldTest,
        ...over,
      },
    },
  }) as unknown as InspectionJob;

describe("a page the field test reached is in scope both times", () => {
  it("the generation scope knows the contract page", () => {
    const scope = scopeFromObservations(
      [{ url: "https://starkscan.co/", links: [] } as never],
      [],
      fieldTest,
    );
    expect(scope.knownUrls.has(CONTRACT)).toBe(true);
  });

  it("and so does the re-validation scope — this is the half that was missing", () => {
    expect(scopeForJob(job()).knownUrls.has(CONTRACT)).toBe(true);
  });

  it("agrees on every field-test URL, not just the one that was reported", () => {
    const gen = scopeFromObservations([{ url: "https://starkscan.co/", links: [] } as never], [], fieldTest);
    const re = scopeForJob(job());
    for (const u of [CONTRACT, "https://starkscan.co/"]) {
      expect(gen.knownUrls.has(u), `generation: ${u}`).toBe(true);
      expect(re.knownUrls.has(u), `re-validation: ${u}`).toBe(true);
    }
  });

  it("adds the field test's host, so a mission targeting it is not out of scope either", () => {
    expect(scopeForJob(job()).hosts.has("starkscan.co")).toBe(true);
  });

  it("still knows nothing Sage never visited", () => {
    // Widening the scope must not become "anything on the host is fine" — the guard exists to stop
    // a mission sending a tester somewhere Sage never looked.
    expect(scopeForJob(job()).knownUrls.has("https://starkscan.co/never/visited")).toBe(false);
  });

  it("is unchanged when no field test ran", () => {
    const noFt = scopeForJob(job({ fieldTest: { ran: false, pages: [], states: [] } }));
    expect(noFt.knownUrls.has(CONTRACT)).toBe(false);
    expect(noFt.knownUrls.has("https://starkscan.co/")).toBe(true);
  });
});
