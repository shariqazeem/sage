import { describe, expect, it } from "vitest";
import { validatePlanMissions } from "@/lib/launch/validate-mission";
import { asCandidate, hostOfJob, pseudoObservations, rebuild, sliceOf, type StoredJob } from "./reconstruct";

/**
 * The reader for a stored inspection job, on one INVENTED job. The full measure
 * (`measure.live.test.ts`) needs the private export and never runs in this suite; this keeps the
 * part it stands on honest: a stored job is read back into a scope, a corpus and a kind that
 * today's gate accepts a faithful mission against.
 */
const page = "https://lanternlog.example/";
const job = (over: Partial<StoredJob> = {}): StoredJob => ({
  id: "job-1", status: "ready", public_campaign_id: "c-1", product_url: page, goal: "see if strangers get it", target_users: "", total_budget_base: "5000000",
  token_decimals: 6, pages_inspected: 1, model: "fixture", provider: "fixture", prompt_version: "mb-v4.5-qa", failure_reason: null, created_at: 1,
  result: {
    stage: "ready",
    reason: null,
    map: {
      productName: "Lanternlog", category: "saas app", valueProp: "Keep a log by lantern light.", targetUserHypotheses: [], founderTargetUsers: "",
      primaryJourney: [{ value: "1. Arrive on / — Light a lantern", confidence: 0.7, sources: [{ kind: "page", ref: page, observation: "Light a lantern / Read the log" }], browserConfirmed: true }],
      routes: [{ value: "/", confidence: 0.9, sources: [{ kind: "page", ref: page, observation: "Lanternlog" }], browserConfirmed: true }],
      interactiveSurfaces: [], trustSurfaces: [], claimRisks: [], observedStates: [], repoOnlyCapabilities: [], browserConfirmed: [], limitations: [], openQuestions: [],
      pagesInspected: 1, repoFilesInspected: 0, digest: "0x00",
      fieldTest: {
        ran: true, startUrl: page, mode: "interactive", pages: [], classification: null, limitation: null, durationMs: 1,
        states: [{ trigger: "initial load", screenshot: null, visibleTextExcerpt: "Lanternlog\nLight a lantern", notableElements: [{ tag: "button", text: "Light a lantern", role: "button" }], pixelDeltaPct: 100, url: page }],
      },
    } as never,
    plan: {
      missions: [
        {
          missionKey: "light-a-lantern", title: "Light a lantern and say what the log shows", objective: "Find out whether a newcomer can light a lantern and read the first entry.",
          instructions: `1. Open ${page}\n2. Press Light a lantern.\n3. Say what the log shows next.`, targetSurface: page,
          criteria: ["The answer names what the log showed after the lantern was lit."], evidenceRequirements: ["What did the log show after you lit the lantern?"],
          whyItMatters: "Lighting a lantern is the product.", sources: [{ kind: "page", ref: page, observation: "the Light a lantern button" }],
          riskCategory: "critical_journey", priority: "high", effortMinutes: 5, maxCompletions: "5", verificationMethod: "Sage checks the answer against what it saw.", anchors: ["Light a lantern"],
        },
      ],
    },
  },
  ...over,
});

describe("a stored job, read back for today's gate", () => {
  it("rebuilds the scope, the corpus and the kind, and a faithful mission passes", () => {
    const r = rebuild(job())!;
    expect(r.kind.kind).toBe("website");
    expect(r.scope.hosts.has("lanternlog.example")).toBe(true);
    expect(r.corpus).toContain("light a lantern");
    const reports = validatePlanMissions(job().result!.plan!.missions!.map(asCandidate), r.scope, r.corpus);
    expect(reports.map((x) => x.issues)).toEqual([[]]);
  });

  it("keeps what the map remembers of the static read: the page, its title and its calls to action", () => {
    const [o] = pseudoObservations(job().result!.map);
    expect(o).toMatchObject({ url: page, title: "Lanternlog", ctas: ["Light a lantern", "Read the log"] });
  });

  it("a job with no map is not rebuilt, and an unreadable address is not a crash", () => {
    expect(rebuild(job({ result: { map: null } }))).toBeNull();
    expect(hostOfJob({ product_url: "not an address" })).toBe("(unreadable)");
    expect(hostOfJob({ product_url: "https://www.Lanternlog.example/a/b" })).toBe("lanternlog.example");
  });

  it("names the era a job comes from by its prompt version", () => {
    expect(["mb-v1", "mb-v2", "mb-v3-artifact", "mb-v4.5-qa", "direct-v1", null].map((v) => sliceOf({ prompt_version: v }))).toEqual(["mb-v1", "mb-v2", "mb-v3", "mb-v4.x", "direct", "none"]);
  });
});
