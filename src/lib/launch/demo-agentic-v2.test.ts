import { describe, it, expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { deriveObservations, deriveActionOutcomes, decisiveFacts } from "./observed-facts";
import { buildProbes, runInspectionProbe } from "./inspection-replay";
import { validatePlanMissions, type ValidationScope } from "./validate-mission";
import { computeGroundingMetrics } from "./mission-metrics";
import { coverageReport } from "./mission-grounding";
import { judgeObservationV2 } from "@/lib/deputy/observation-judge-v2";
import { advance, newTaskRun, readMemory, type ToolOutcome } from "@/lib/telegram/task-run";
import type { CandidateMission, FieldTestState, FieldTestSummary, MissionGroundingV1 } from "./schemas";

/**
 * AGENTIC VERTICAL SLICE — a deterministic, self-contained integration scenario that ties every overnight
 * capability together on a FIXTURE product. Labeled a fixture run: no mainnet, no payment, no external
 * user, no production feed, and no faked payout. Run it with `npm run demo:agentic-v2` (DEMO_AGENTIC=1).
 *
 * It proves, end to end: safe inspection → captured action transition → typed SEEN facts → a real safe
 * browser REPLAY → grounded (vision) INFERRED facts → mission generation with source-fact mappings →
 * deterministic validation (grounded accepted, ungrounded rejected) → the Concierge run using tools,
 * persisting state, and resuming → an honest trace that labels every fact as seen / inferred / replay-
 * reproduced / used-by-a-mission / rejected-as-ungrounded.
 */
const RUN = process.env.DEMO_AGENTIC === "1";
const log = (s: string) => console.log(s);

/** The fixture product's inspected state log — as if Sage field-tested a small narrative game. */
const st = (over: Partial<FieldTestState>): FieldTestState => ({ trigger: "initial load", screenshot: null, visibleTextExcerpt: "", notableElements: [], pixelDeltaPct: 0, url: "https://yara.fixture/", networkMethods: ["GET"], ...over });
const FIELD_TEST: FieldTestSummary = {
  ran: true, startUrl: "https://yara.fixture/", mode: "interactive", pages: [], classification: "Interactive app · 3 states", limitation: null, durationMs: 4200,
  states: [
    st({ trigger: "initial load", visibleTextExcerpt: "Welcome. Press start.", notableElements: [{ tag: "button", text: "Start", role: "button" }] }),
    st({ trigger: "clicked 'Start'", url: "https://yara.fixture/play", visibleTextExcerpt: "You reach the garden world.", notableElements: [{ tag: "button", text: "Talk to Yara", role: "button" }], pixelDeltaPct: 40 }),
    st({ trigger: "clicked 'Talk to Yara'", url: "https://yara.fixture/play", visibleTextExcerpt: "Yara says: hello traveler.", notableElements: [], pixelDeltaPct: 22 }),
  ],
  visionObservations: [{ stateIndex: 1, trigger: "clicked 'Start'", sceneDescription: "A lush garden world with a character", visibleText: ["Talk to Yara"], uiElements: [{ label: "Talk to Yara", kind: "button" }], productTypeSignals: ["narrative game"], audienceSignals: ["casual players"], qualityIssues: [] }],
};

async function fixtureServer() {
  const server = http.createServer((_q, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(`<!doctype html><html><body><button id="s">Start</button><div id="o"></div><script>document.getElementById('s').onclick=()=>document.getElementById('o').textContent='You reach the garden world.';</script></body></html>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return { origin: `http://127.0.0.1:${port}`, port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe.runIf(RUN)("AGENTIC VERTICAL SLICE (fixture)", () => {
  it("inspection → facts → replay → missions → validation → concierge → trace", async () => {
    log("\n══════════ AGENTIC VERTICAL SLICE — [FIXTURE RUN: no mainnet, no payment, no external user, no production feed] ══════════");

    // 1–3. safe inspection → typed observation set (SEEN facts + transitions + INFERRED vision).
    const set = deriveObservations(FIELD_TEST, 7);
    const seen = decisiveFacts(set);
    const inferred = set.facts.filter((f) => f.grounding === "inferred");
    log(`\n[1] Inspected ${FIELD_TEST.states.length} states. Observation set ${set.digest}: ${seen.length} SEEN facts, ${inferred.length} INFERRED (vision), ${set.transitions.length} transitions.`);
    for (const f of seen) log(`    SEEN     ${f.id}  ${f.source.padEnd(16)} "${f.visibleTexts[0]?.slice(0, 40) ?? ""}"`);
    for (const f of inferred) log(`    INFERRED ${f.id}  vision(img ${f.sourceImageIndex})  conf ${f.confidence}`);
    expect(seen.length).toBeGreaterThan(0);
    expect(inferred.every((f) => !f.decisive)).toBe(true); // vision never decisive

    // 2. captured action transition + typed action→outcome.
    const outcomes = deriveActionOutcomes(set);
    for (const o of outcomes) log(`\n[2] TRANSITION ${o.transitionId}: ${o.safeAction} "${o.observedControl?.name}" → ${o.changedAfter.join(" / ").slice(0, 60)} (grounding ${o.grounding})`);
    expect(outcomes.length).toBe(2);

    // 4. a REAL safe browser replay of the first transition (through the guarded egress proxy).
    const probes = buildProbes(set);
    log(`\n[4] Built ${probes.length} safe replay probe(s) from observed transitions.`);
    const fx = await fixtureServer();
    let replayReproduced = false;
    try {
      const probe = { ...probes[0], startUrl: fx.origin + "/", expectedAddedTexts: ["You reach the garden world."], expectedAfterUrl: fx.origin + "/" };
      const r = await runInspectionProbe(probe, { allowLoopback: new Set([`127.0.0.1:${fx.port}`]), egressAllowedPorts: new Set([80, 443, fx.port]) });
      replayReproduced = r.classification === "reproduced";
      log(`    REPLAY ${probe.verb} "${probe.locator.accessibleName}" → ${r.classification}  (events: ${r.events.map((e) => e.event).join(" → ")})`);
      if (r.classification === "infrastructure_failure") log("    (browser engine unavailable — replay skipped; run `npx playwright install chromium`)");
    } finally {
      await fx.close();
    }

    // 5–6. mission generation with source-fact mappings (fixture "architect" output — the live architect is
    // quota-blocked; these are the missions Sage WOULD design, each grounded in real fact ids).
    const g = (c: MissionGroundingV1["criteria"]): MissionGroundingV1 => ({ version: "mission-grounding-v1", criteria: c });
    const startId = seen.find((f) => f.elementName === "Start")!.id;
    const yaraId = seen.find((f) => f.elementName === "Talk to Yara")!.id;
    const base = (over: Partial<CandidateMission>): CandidateMission => ({ missionKey: "k", title: "t", objective: "o", instructions: "i", targetSurface: "https://yara.fixture/play", criteria: ["c"], evidenceRequirements: ["e"], whyItMatters: "core journey observed in the field test", sources: [{ kind: "page", ref: "https://yara.fixture/play", observation: "reached the garden world" }], priority: "high", riskCategory: "critical_journey", effortMinutes: 3, conditions: [], rewardWeight: 5, maxCompletions: 3, verificationMethod: "the tester's account judged against Sage's observation corpus", confidence: 0.85, assumptions: [], disallowed: [], ...over });
    const grounded = base({
      missionKey: "reach-and-talk", title: "Reach the garden world and talk to Yara", objective: "Reach the world and open the Talk-to-Yara dialog",
      instructions: "1. Click Start to enter the garden world. 2. Click Talk to Yara and read her reply.",
      criteria: ["Reach the garden world after clicking Start", "Open the Talk to Yara dialog and observe her reply"],
      evidenceRequirements: ["Describe the world state you reached", "Describe what Yara said"],
      groundingV1: g([{ criterionIndex: 0, sourceFactIds: [startId], evidenceIndex: 0, verificationMode: "observation" }, { criterionIndex: 1, sourceFactIds: [yaraId], evidenceIndex: 1, verificationMode: "observation" }]),
    });
    const ungrounded = base({ missionKey: "ghost-zoom", title: "Use the Zoom Control", objective: "Zoom into the map with the Zoom Control", criteria: ["Use the Zoom Control"], evidenceRequirements: ["Describe zooming"], groundingV1: g([{ criterionIndex: 0, sourceFactIds: ["deadbeefdeadbeefdeadbeef"], evidenceIndex: 0, verificationMode: "observation" }]) });

    // 7. deterministic validation — grounded ACCEPTED, ungrounded REJECTED.
    const scope: ValidationScope = { knownUrls: new Set(["https://yara.fixture/", "https://yara.fixture/play"]), hosts: new Set(["yara.fixture"]), repoPaths: new Set() };
    const reports = validatePlanMissions([grounded, ungrounded], scope, undefined, set);
    log(`\n[6-7] Mission validation against the observation set:`);
    log(`    ACCEPTED  "${grounded.missionKey}"  criteria→facts: [${grounded.groundingV1!.criteria.map((c) => c.sourceFactIds[0].slice(0, 8)).join(", ")}]  ok=${reports[0].ok}`);
    log(`    REJECTED  "${ungrounded.missionKey}"  reason=${reports[1].issues.map((i) => i.code).join(",")}`);
    expect(reports[0].ok).toBe(true);
    expect(reports[1].ok).toBe(false);
    expect(reports[1].issues.some((i) => i.code === "ungrounded_fact_ref")).toBe(true);

    const accepted = [grounded];
    const metrics = computeGroundingMetrics([grounded, ungrounded], reports, set);
    const cov = coverageReport(set, accepted);
    log(`    Metrics: anchorIntegrity=${metrics.anchorIntegrity} factRefIntegrity=${metrics.factReferenceIntegrity} mapping=${metrics.criterionEvidenceMapping} scope=${metrics.targetScopeValidity} unsafe=${metrics.unsafeOrAuthMissions}`);
    log(`    Coverage: ${cov.coveredStates}/${cov.inspectedStates} states covered, modes=${JSON.stringify(cov.evidenceModeDistribution)}`);

    // 8. Concierge: begin a run, use tools, persist, resume, reach live.
    log(`\n[8] Concierge task run (fake tools):`);
    let run = newTaskRun({ runId: "demo", goal: "get testers to talk to Yara", productUrl: "https://yara.fixture/", budgetText: "$10", now: 1 });
    const step = (o: ToolOutcome | { founderMessage: string; approve?: boolean }, at: number) => {
      const ev = "founderMessage" in o ? ({ kind: "founder" as const, text: o.founderMessage, approve: o.approve }) : ({ kind: "tool" as const, outcome: o });
      const res = advance(run, ev, at); run = res.run;
      log(`    ${String(run.state).padEnd(22)} ← ${"founderMessage" in o ? `founder:"${o.founderMessage}"` : `${o.tool}:${o.ok ? "ok" : o.reason}`}`);
      return res.next;
    };
    step({ tool: "inspect", ok: true, data: { inspectionId: "insp_demo" } }, 2);
    step({ tool: "poll_inspection", ok: true, data: { ready: false } }, 3);
    step({ tool: "poll_inspection", ok: true, data: { ready: true, planId: "plan_demo" } }, 4);
    // RESTART: round-trip the run through per-chat storage, then resume.
    const stored = JSON.stringify({ version: 2, messages: [], summary: "awaiting approval on plan_demo", activeTask: run, recentTools: [] });
    run = readMemory(stored).activeTask!;
    log(`    ── restart ── resumed at "${run.state}" (inspectionId=${run.inspectionId}) from storage`);
    step({ founderMessage: "approve", approve: true }, 5);
    step({ tool: "fund_and_launch", ok: true, data: { campaignId: "camp_demo", campaignUrl: "https://x/c/camp_demo" } }, 6);
    step({ tool: "poll_campaign", ok: true, data: {} }, 7);
    expect(run.state).toBe("completed");
    expect(run.campaignId).toBe("camp_demo"); // authoritative id came from the tool, not a message

    // 9. Observation judge V2 shadow — a genuine account passes; a generic one fails.
    const genuine = judgeObservationV2("I clicked Start and reached the garden world, then clicked Talk to Yara and Yara says: hello traveler.", set);
    const generic = judgeObservationV2("I clicked start, nice game, everything loaded fine.", set);
    log(`\n[9] Observation Judge V2 (shadow): genuine pass=${genuine.pass} [${genuine.reasonCodes.join(",")}] | generic pass=${generic.pass} [${generic.reasonCodes.join(",")}]`);
    expect(genuine.pass).toBe(true);
    expect(generic.pass).toBe(false);

    // honest trace summary — every fact classified.
    const usedFactIds = new Set(grounded.groundingV1!.criteria.flatMap((c) => c.sourceFactIds));
    log(`\n[TRACE] facts: ${seen.length} seen · ${inferred.length} inferred(vision) · replay-reproduced=${replayReproduced} · used-by-mission=${usedFactIds.size} · rejected-as-ungrounded=1 (ghost-zoom)`);
    log("══════════ END SLICE — no payout occurred (this is a fixture run) ══════════\n");
    expect(usedFactIds.size).toBe(2);
  }, 60_000);
});
