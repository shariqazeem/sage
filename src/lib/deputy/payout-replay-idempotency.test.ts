import { describe, it, expect, afterEach } from "vitest";
import { runPayoutActionReplay, type PayoutReplayDeps } from "./payout-replay";
import type { ReplayJournalHandle, ReplayJournalLookup } from "@/lib/db/payout-replay-journal";
import { compileVerificationPolicy } from "@/lib/launch/mission-probe";
import type { ObservationSetV1, ObservedFactV1, ActionTransitionV1 } from "@/lib/launch/observed-facts";
import type { CandidateMission } from "@/lib/launch/schemas";
import type { ValidationScope } from "@/lib/launch/validate-mission";
import type { Campaign } from "@/lib/db/schema";
import type { ProbeClassification } from "@/lib/launch/inspection-replay";

/** Phase 5 — idempotency: a COMPLETED result for the exact (submissionId, policyDigest, probeDigest) is reused;
 *  a changed probe re-runs; an in-flight crash reconciles by re-running; replay never double-executes a cached
 *  completed probe (and never settles, so it can never dup a payout). */

const MODE = "PAYOUT_ACTION_REPLAY_MODE";
afterEach(() => { delete process.env[MODE]; });

const AFTER = "state-after";
const scope: ValidationScope = { hosts: new Set(["app.test"]) } as ValidationScope;
const fact: ObservedFactV1 = { version: "obs-fact-v1", id: "f-after", source: "field_transition", grounding: "seen", decisive: true, pageUrl: "https://app.test/report", stateId: AFTER, visibleTexts: ["Report ready"], provenanceDigest: "pd" };
const trans: ActionTransitionV1 = { version: "action-transition-v1", id: "t-load", startUrl: "https://app.test/", beforeStateDigest: "b", verb: "click", locator: { role: "button", accessibleName: "Load report" }, afterUrl: "https://app.test/report", afterStateDigest: AFTER, addedTexts: ["Report ready"], removedTexts: [], observableChange: true, networkMethodSummary: "get_observed", safeClassification: "safe", provenance: { fromStateIndex: 0, toStateIndex: 1 } };
const set: ObservationSetV1 = { version: "obs-set-v1" as ObservationSetV1["version"], facts: [fact], transitions: [trans], captureVersion: 1, digest: "setdig" };
const mission: CandidateMission = { missionKey: "m-load", criteria: ["c"], evidenceRequirements: ["e"], groundingV1: { version: "mission-grounding-v1", observationSetDigest: "setdig", criteria: [{ criterionIndex: 0, criterionKind: "action_outcome", sourceFactIds: ["f-after"], sourceTransitionIds: ["t-load"], evidenceIndex: 0, verificationMode: "observation" }] } } as unknown as CandidateMission;
const campaign = (): Campaign => { const p = compileVerificationPolicy({ missionPlanDigest: "0xplan", productMapDigest: "0xmap", set, missions: [mission], replayReproduced: new Set(["t-load"]), scope }).policy; return { verificationPolicy: p, verificationPolicyDigest: p.policyDigest, missionPlanDigest: "0xplan" } as Campaign; };

// in-memory journal + a run counter to prove no double-execution.
function memJournal() {
  const rows = new Map<string, ReplayJournalLookup>();
  const k = (a: string, b: string, c: string) => `${a}|${b}|${c}`;
  const handle: ReplayJournalHandle = {
    lookup: (s, p, pr) => rows.get(k(s, p, pr)) ?? null,
    begin: (s, p, pr) => { const cur = rows.get(k(s, p, pr)); rows.set(k(s, p, pr), { decision: "hold", code: "internal_error", completed: false, attempt: (cur?.attempt ?? 0) + 1 }); },
    complete: (s, p, pr, o) => { const cur = rows.get(k(s, p, pr)); rows.set(k(s, p, pr), { decision: o.decision, code: o.code, completed: true, attempt: cur?.attempt ?? 1 }); },
  };
  return { handle, rows, k };
}

describe("payout replay idempotency", () => {
  it("a completed reproduced result is REUSED on retry (no second browser run)", async () => {
    process.env[MODE] = "canary";
    const j = memJournal();
    let runs = 0;
    const deps: PayoutReplayDeps = { submissionId: "sub-1", journal: j.handle, runProbe: async (p) => { runs++; return { classification: "reproduced" as ProbeClassification, reason: "", probeId: p.id }; } };
    const first = await runPayoutActionReplay(campaign(), "m-load", deps);
    const second = await runPayoutActionReplay(campaign(), "m-load", deps);
    expect(first.decision).toBe("allow");
    expect(second.decision).toBe("allow");
    expect(runs).toBe(1); // reused — the browser ran exactly ONCE
  });

  it("a completed VETO is reused on retry (still holds, no re-run)", async () => {
    process.env[MODE] = "canary";
    const j = memJournal();
    let runs = 0;
    const deps: PayoutReplayDeps = { submissionId: "sub-2", journal: j.handle, runProbe: async (p) => { runs++; return { classification: "no_observable_change" as ProbeClassification, reason: "", probeId: p.id }; } };
    expect((await runPayoutActionReplay(campaign(), "m-load", deps)).decision).toBe("hold");
    expect((await runPayoutActionReplay(campaign(), "m-load", deps)).decision).toBe("hold");
    expect(runs).toBe(1);
  });

  it("a DIFFERENT submission is a different key → a fresh run", async () => {
    process.env[MODE] = "canary";
    const j = memJournal();
    let runs = 0;
    const mk = (sid: string): PayoutReplayDeps => ({ submissionId: sid, journal: j.handle, runProbe: async (p) => { runs++; return { classification: "reproduced" as ProbeClassification, reason: "", probeId: p.id }; } });
    await runPayoutActionReplay(campaign(), "m-load", mk("sub-a"));
    await runPayoutActionReplay(campaign(), "m-load", mk("sub-b"));
    expect(runs).toBe(2);
  });

  it("an IN-FLIGHT crash (begun, never completed) reconciles by re-running", async () => {
    process.env[MODE] = "canary";
    const j = memJournal();
    // simulate a crash: begin without complete.
    j.handle.begin("sub-3", campaign().verificationPolicyDigest!, (campaign().verificationPolicy as { probes: { probeDigest: string }[] }).probes[0].probeDigest);
    let runs = 0;
    const deps: PayoutReplayDeps = { submissionId: "sub-3", journal: j.handle, runProbe: async (p) => { runs++; return { classification: "reproduced" as ProbeClassification, reason: "", probeId: p.id }; } };
    const r = await runPayoutActionReplay(campaign(), "m-load", deps);
    expect(r.decision).toBe("allow");
    expect(runs).toBe(1); // re-ran (reconciled) rather than trusting the in-flight row
  });

  it("without a journal / submissionId, every call runs fresh (no caching)", async () => {
    process.env[MODE] = "canary";
    let runs = 0;
    const deps: PayoutReplayDeps = { runProbe: async (p) => { runs++; return { classification: "reproduced" as ProbeClassification, reason: "", probeId: p.id }; } };
    await runPayoutActionReplay(campaign(), "m-load", deps);
    await runPayoutActionReplay(campaign(), "m-load", deps);
    expect(runs).toBe(2);
  });
});
