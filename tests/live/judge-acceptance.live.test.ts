import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { distillPrivateKey, deriveCriterionEvidence, type PrivateKey } from "@/lib/deputy/observation-verify";
import { runObservationDecision } from "@/lib/deputy/observation-judge";
import { judgeRealTry } from "@/lib/deputy/real-try";
import { JUNK, LEGIT } from "./judge-acceptance-accounts";

/**
 * LIVE JUDGE-ACCEPTANCE EVAL — the founder's exact fear, measured: "will it reject legit evidence?"
 *
 * Runs the REAL observation-judging modules (no copies, no mocks) against the pinned key a READY
 * plan would deploy with, feeding it honest tester accounts in varied voices plus known-junk
 * controls. Reports accept/hold per account with the bar's own reasons. Gated: it costs real LLM
 * calls and reads the prod DB, so it runs ONLY with LIVE_JUDGE_EVAL=1 (on the VM, env sourced):
 *
 *   set -a; . ./.env; set +a; LIVE_JUDGE_EVAL=1 JUDGE_EVAL_JOB=<jobId> \
 *     npx vitest run tests/live/judge-acceptance.live.test.ts
 *
 * Hard assertions only on the controls (junk must never pass). Legit-account results are the
 * MEASUREMENT — printed, then judged by a human reading the table. A legit account held for review
 * is the SAFE failure (founder sees it); a junk account paid would be the disqualifying one.
 */
const live = process.env.LIVE_JUDGE_EVAL === "1";
const JOB_ID = process.env.JUDGE_EVAL_JOB || "zSPskFkD-Mdi";
const DB_PATH = process.env.JUDGE_EVAL_DB || "var/sage.db";

interface PlanMission {
  missionKey: string;
  title: string;
  objective: string;
  instructions: string;
  targetSurface: string;
  criteria: string[];
  evidenceRequirements?: string[];
  whyItMatters?: string;
  verifiabilityClass?: string;
  criterionEvidence?: unknown;
}

describe.skipIf(!live)("LIVE judge acceptance — legit evidence vs the real bar", () => {
  it(
    "measures accept/hold on the ready plan's pinned key",
    { timeout: 600_000 },
    async () => {
      const db = new Database(DB_PATH, { readonly: true });
      const row = db.prepare("select result from inspection_jobs where id = ?").get(JOB_ID) as
        | { result: string }
        | undefined;
      expect(row, `job ${JOB_ID} not found in ${DB_PATH}`).toBeTruthy();
      const result = JSON.parse(row!.result) as {
        plan: { missions: PlanMission[] };
        map?: { fieldTest?: unknown };
      };
      const missions = result.plan.missions.filter(
        (m) => (m.verifiabilityClass ?? "observation-based") === "observation-based",
      );
      expect(missions.length).toBeGreaterThan(0);
      const mission = missions[0]!;

      // EXACTLY the deploy-time pinning: field-test observations minus every public plan string.
      const publicPlanStrings = result.plan.missions.flatMap((m) => [
        m.title,
        m.objective,
        m.instructions,
        m.targetSurface,
        ...(m.criteria ?? []),
        ...(m.evidenceRequirements ?? []),
        ...(m.whyItMatters ? [m.whyItMatters] : []),
      ]);
      const pk = distillPrivateKey(
        (result.map?.fieldTest ?? null) as Parameters<typeof distillPrivateKey>[0],
        publicPlanStrings,
      );
      const key: PrivateKey = {
        observations: pk.observations,
        distinctSources: pk.distinctSources,
        digest: pk.digest,
      };
      console.log(`\nKEY: ${key.observations.length} observations · ${key.distinctSources} distinct sources · job ${JOB_ID}`);
      console.log(`MISSION: ${mission.title}\n`);

      // EXACTLY the judge-time public surface + contract derivation from deputy/pipeline.ts.
      const publicStrings = [
        mission.title,
        mission.objective,
        mission.instructions,
        mission.targetSurface,
        ...(mission.criteria ?? []),
        ...(mission.evidenceRequirements ?? []),
      ].filter((s): s is string => typeof s === "string" && s.length > 0);
      const derived = deriveCriterionEvidence(key, mission.criteria ?? [], mission.evidenceRequirements ?? []);
      const contract = derived.some((c) => c.keySources.length > 0) ? derived : null;

      const judge = (note: string) =>
        runObservationDecision({
          account: note,
          key,
          priors: [],
          missionObjective: mission.objective,
          criteria: mission.criteria,
          publicStrings,
          hasHighFraud: false,
          ...(contract ? { criterionEvidence: contract, criterionEvidenceDerived: true } : {}),
          model: process.env.OBS_JUDGE_MODEL || undefined,
        });

      // THE REAL-TRY GATE (22 Nov 2026), exactly as deputy/pipeline.ts applies it after the bar: a passing
      // answer is PAID only when nothing there holds it for the builder.
      const card = { publicStrings, criteria: mission.criteria ?? [], evidenceRequirements: mission.evidenceRequirements ?? [] };
      const rows: { group: string; name: string; pass: boolean; paid: boolean; hold: string; sources: number; trySources: number; share: string; reasons: string }[] = [];
      for (const [group, list] of [["LEGIT", LEGIT], ["JUNK", JUNK]] as const) {
        for (const a of list) {
          const d = await judge(a.note);
          const rt = judgeRealTry({
            account: a.note,
            key,
            card,
            pass: { barPass: d.bar.pass, deterministicSources: d.corpusMatch.distinctSources, criteriaCompletePass: d.criteriaCompletePass },
          });
          rows.push({
            group,
            name: a.name,
            pass: d.bar.pass,
            paid: d.bar.pass && rt.hold === null,
            hold: d.bar.pass ? (rt.hold ?? "") : "bar",
            sources: d.publicView.distinctSources,
            trySources: rt.evidence.trySources,
            share: rt.evidence.publicShare.toFixed(2),
            reasons: d.bar.reasons.join(","),
          });
          if (group === "LEGIT" && a === list[0]) {
            console.log(`MISSION READINESS: the card, submitted as the answer, matches ${rt.readiness.cardSources} sources · clears the bar: ${rt.readiness.cardClears} · sources only a try reveals: ${rt.readiness.tryOnlySources} · autonomous: ${rt.readiness.autonomous}\n`);
          }
        }
      }

      console.log("group  name              bar    paid   hold              sources  try  share  reasons");
      for (const r of rows)
        console.log(
          `${r.group.padEnd(6)} ${r.name.padEnd(17)} ${String(r.pass).padEnd(6)} ${String(r.paid).padEnd(6)} ${r.hold.padEnd(17)} ${String(r.sources).padEnd(8)} ${String(r.trySources).padEnd(4)} ${r.share.padEnd(6)} ${r.reasons.slice(0, 60)}`,
        );
      const legitPass = rows.filter((r) => r.group === "LEGIT" && r.pass).length;
      const legitPaid = rows.filter((r) => r.group === "LEGIT" && r.paid).length;
      const junkPass = rows.filter((r) => r.group === "JUNK" && r.pass).length;
      const junkPaid = rows.filter((r) => r.group === "JUNK" && r.paid).length;
      console.log(
        `\nLEGIT cleared the bar: ${legitPass}/${LEGIT.length} · paid by Sage alone: ${legitPaid}/${LEGIT.length} (the rest wait for the builder, none refused)` +
          `\nJUNK cleared the bar: ${junkPass}/${JUNK.length} · PAID: ${junkPaid}/${JUNK.length}\n`,
      );

      // The disqualifying failure is junk being PAID: a hard assertion. On 12 Aug 2026 the bar alone let
      // 2 of 4 through; what is asserted now is the bar AND the real-try gate, which is what pays. Legit
      // holding is safe-but-bad; it is the measurement this eval exists to print, judged by the reader.
      expect(junkPaid).toBe(0);
      db.close();
    },
  );
});
