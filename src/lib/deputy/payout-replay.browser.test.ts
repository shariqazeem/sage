import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { runPayoutActionReplay } from "./payout-replay";
import { compileVerificationPolicyV2 } from "@/lib/launch/mission-probe-v2";
import type { ObservationSetV1, ObservedFactV1, ActionTransitionV1 } from "@/lib/launch/observed-facts";
import type { CandidateMission } from "@/lib/launch/schemas";
import type { ValidationScope } from "@/lib/launch/validate-mission";
import type { Campaign } from "@/lib/db/schema";
import type { ReplayJournalHandle } from "@/lib/db/payout-replay-journal";

/**
 * Phase 6B — REAL guarded-browser payout replay against a controlled product, through the FULL runPayoutActionReplay
 * path (MissionProbeV1 → InspectionProbeV1 → runInspectionProbe → classifyReplay → decision). Gated behind
 * PAYOUT_REPLAY_BROWSER_TEST=1 (needs chromium). The guarded browser itself is also covered by test:inspection-replay.
 */

const LIVE = process.env.PAYOUT_REPLAY_BROWSER_TEST === "1";
const noopJournal: ReplayJournalHandle = { lookup: () => null, begin: () => {}, complete: () => {} };

// A page with a "Load report" button that reveals "Report ready" on click (reproduce), and a "?drift=1" variant
// whose button does nothing (a change that isn't the expected one → veto).
const PAGE = (drift: boolean) => `<!doctype html><title>Reportly</title><main><button id="b">Load report</button><div id="o"></div></main>
<script>document.getElementById('b').addEventListener('click',function(){document.getElementById('o').textContent=${drift ? "'Something else happened'" : "'Report ready'"};});</script>`;

let fx: { port: number; close: () => Promise<void> };
beforeAll(async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE(/drift/.test(req.url ?? ""))); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  fx = { port, close: () => new Promise((r) => server.close(() => r())) };
});
afterAll(async () => { await fx?.close(); });

function policyFor(path: string) {
  const url = `http://127.0.0.1:${fx.port}${path}`;
  const AFTER = "s-after";
  const scope: ValidationScope = { hosts: new Set([`127.0.0.1:${fx.port}`]) } as ValidationScope;
  const fact: ObservedFactV1 = { version: "obs-fact-v1", id: "f-after", source: "field_transition", grounding: "seen", decisive: true, pageUrl: url, stateId: AFTER, visibleTexts: ["Report ready"], provenanceDigest: "pd" };
  const trans: ActionTransitionV1 = { version: "action-transition-v1", id: "t-load", startUrl: url, beforeStateDigest: "b", verb: "click", locator: { role: "button", accessibleName: "Load report" }, afterUrl: url, afterStateDigest: AFTER, addedTexts: ["Report ready"], removedTexts: [], observableChange: true, networkMethodSummary: "get_observed", safeClassification: "safe", provenance: { fromStateIndex: 0, toStateIndex: 1 } };
  const set: ObservationSetV1 = { version: "obs-set-v1" as ObservationSetV1["version"], facts: [fact], transitions: [trans], captureVersion: 1, digest: "setdig" };
  const mission: CandidateMission = { missionKey: "m-load", criteria: ["c"], evidenceRequirements: ["e"], groundingV1: { version: "mission-grounding-v1", observationSetDigest: "setdig", criteria: [{ criterionIndex: 0, criterionKind: "action_outcome", sourceFactIds: ["f-after"], sourceTransitionIds: ["t-load"], evidenceIndex: 0, verificationMode: "observation" }] } } as unknown as CandidateMission;
  const policy = compileVerificationPolicyV2({ missionPlanDigest: "0xplan", productMapDigest: "0xmap", set, missions: [mission], replayReproduced: new Set(["t-load"]), scope }).policy;
  return { verificationPolicy: policy, verificationPolicyDigest: policy.policyDigest, verificationPolicyRequired: true, missionPlanDigest: "0xplan" } as Campaign;
}
const hooks = () => ({ allowLoopback: new Set([`127.0.0.1:${fx.port}`]), egressAllowedPorts: new Set([80, 443, fx.port]), journal: noopJournal, submissionId: "sub-browser" });

describe.runIf(LIVE)("payout action replay — real browser", () => {
  it("canary + the exact action reproduces the expected state → ALLOW", async () => {
    process.env.PAYOUT_ACTION_REPLAY_MODE = "canary";
    const r = await runPayoutActionReplay(policyFor("/"), "m-load", hooks());
    expect(r.decision).toBe("allow");
    expect(r.code).toBe("reproduced");
  });
  it("canary + the action produces a DIFFERENT state → HOLD (wrong_after_state)", async () => {
    process.env.PAYOUT_ACTION_REPLAY_MODE = "canary";
    const r = await runPayoutActionReplay(policyFor("/?drift=1"), "m-load", hooks());
    expect(r.decision).toBe("hold");
    expect(["wrong_after_state", "product_drift", "no_observable_change"]).toContain(r.code);
  });
});
