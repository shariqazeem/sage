/**
 * EVERY PLAN SAGE EVER MADE, RE-READ WITH TODAY'S CODE (22 Nov 2026).
 *
 * Runs only when `PLANS_CORPUS` names the private export (one stored inspection job per line, .jsonl or
 * .jsonl.gz). The export is production data: it is never in the repo, and nothing this file prints or writes
 * goes into the repo either. The full per-job report is written beside the export (`PLANS_REPORT`, default the
 * export's own folder); the console gets counts only.
 *
 *   PLANS_CORPUS=/path/to/sage-plans.jsonl.gz npx vitest run tests/plans-corpus/measure.live
 *
 * No model, no network, no database write. Four measures:
 *   1. builders who were asked a question: what today's code decides (kind, sufficiency, the first try alone);
 *   2. failed jobs: each failure against what today's code does with that failure;
 *   3. every mission of every ready plan through today's gate, the kind's proof rule, the real-try readiness
 *      and the product safety screen (with the list fixture);
 *   4. the first-try mission today's code would write for every ready plan, and where its main action came from.
 *
 * What a stored job cannot say is in `reconstruct.ts`: the static read is not stored, so the anchor and scope
 * checks are approximate here and are reported apart from the exact ones.
 */
import path from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addCoreMission, buildCoreMission, coreAnchors, GENERIC_ACTION, type FirstScreen } from "@/lib/launch/core-mission";
import { computeCorpusReadiness } from "@/lib/launch/job";
import { gatherRichness } from "@/lib/launch/mission-brain";
import { NO_MODEL_REASONS, UNREADABLE_REASONS } from "@/lib/launch/no-model";
import { hasUsableInspection } from "@/lib/launch/product-map";
import { kindFromUrl, kindProofIssue, playbookOf } from "@/lib/launch/product-kind";
import type { MissionPlanV1 } from "@/lib/launch/schemas";
import { SUFFICIENCY_THRESHOLD, classifyVerifiability, observationScore, validatePlanMissions } from "@/lib/launch/validate-mission";
import { compilePhishingList, screenProduct, type PhishingConfig } from "@/lib/safety/product-screen";
import { CORE_MISSION_KEY } from "@/lib/core-test/shape";
import { asCandidate, hostOfJob, readJobs, rebuild, sliceOf, type Rebuilt, type StoredJob, type StoredMission } from "./reconstruct";

const CORPUS = process.env.PLANS_CORPUS ?? "";
const OUT = process.env.PLANS_REPORT ?? (CORPUS ? path.join(path.dirname(CORPUS), "report") : "");

/** Gate codes that read only the mission's own words: exact on stored data. */
const EXACT = new Set([
  "empty_field", "criteria_unordered_or_dup", "evidence_unordered_or_dup", "spec_incompatible", "invalid_reward_or_cap",
  "destructive_instruction", "secret_request", "wallet_signing_request", "fund_transfer_request", "security_exploitation",
  "prompt_injection_content", "evidence_cannot_prove_criteria", "unsupported_evidence_type", "worthless_presence_check",
  "volatile_criterion", "duplicate_mission_key", "duplicate_objective",
  "unnamed_target", "asks_personal_detail", "needs_developer_tools", "answer_on_the_card",
]);
/** The four rules this measure added to the gate (mission-quality.ts): counted apart, so their cost is plain. */
const ADDED = new Set(["unnamed_target", "asks_personal_detail", "needs_developer_tools", "answer_on_the_card"]);

const tally = <T,>(xs: readonly T[], key: (x: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
};

const firstScreenOf = (r: Rebuilt): FirstScreen => {
  const o = r.observations[0];
  return o ? { title: o.title, headings: o.headings, ctas: o.ctas } : {};
};

/** The first-try mission today's code writes for this product, with no model and nothing accepted beside it. */
function firstTry(job: StoredJob, r: Rebuilt, opts: { accepted?: StoredMission[]; noModel?: boolean } = {}) {
  try {
    return addCoreMission({
      map: r.map,
      productUrl: job.product_url,
      scope: r.scope,
      corpus: r.corpus,
      accepted: (opts.accepted ?? []).filter((m) => m.missionKey !== CORE_MISSION_KEY).map(asCandidate),
      modelHint: null,
      ...(opts.noModel ? { firstScreen: firstScreenOf(r) } : {}),
    });
  } catch {
    return null;
  }
}

describe.skipIf(!CORPUS)("every stored plan, re-read with today's code", () => {
  const jobs = CORPUS ? readJobs(CORPUS) : [];
  const LIST = compilePhishingList(JSON.parse(readFileSync(path.join(process.cwd(), "src", "lib", "safety", "__fixtures__", "phishing-config.json"), "utf8")) as PhishingConfig, 1);
  const write = (name: string, value: unknown) => {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 1));
  };

  it("1. builders who were asked a question: what today's code decides", () => {
    const asked = jobs.filter((j) => j.status === "needs_input");
    const rows = asked.map((job) => {
      const r = rebuild(job);
      const reason = job.result?.reason ?? "(none)";
      const base = { id: job.id, host: hostOfJob(job), slice: sliceOf(job), reason, questions: job.result?.questions ?? [], goal: job.goal };
      const urlKind = kindFromUrl(job.product_url)?.kind ?? null;
      if (!r || !hasUsableInspection(r.map)) {
        // nothing was read. Today a platform address is read as its own page; that cannot be replayed offline.
        return { ...base, kind: urlKind ?? "website", score: 0, today: urlKind && playbookOf(urlKind).peopleDoTheTry ? "kind:first-try-if-the-listing-is-read" : "question:nothing-was-read" };
      }
      const kind = r.kind.kind;
      const people = playbookOf(kind).peopleDoTheTry;
      const score = observationScore(gatherRichness(r.map, r.corpus));
      const core = firstTry(job, r);
      const out = (today: string) => ({ ...base, kind, score: Math.round(score * 10) / 10, today, mainAction: core?.hint.mainAction ?? null, from: core?.hint.from ?? null });
      // THE GOAL GAP. Then: a question and nothing else. Today (pipeline.ts, "plan what Sage could see"): when Sage
      // saw part of the journey and has missions for it, that plan is the test and the gap is named beside it.
      const accepted = job.result?.brain?.accepted?.length ?? 0;
      if (reason === "founder_goal_incomplete") {
        const seenPart = (r.map.goalJourney?.checkpoints ?? []).some((c) => c.status === "observed");
        if (accepted > 0 && seenPart) return out("test:the-part-sage-saw-is-planned-and-the-gap-named");
        return out(accepted > 0 ? "question:goal-gap-with-a-plan-attached" : "question:goal-gap");
      }
      // THE BUDGET. "Larger than the plan can spend" is no longer a question: the rest stays with the builder.
      if (reason === "sample_budget_insufficient")
        return out((job.result?.questions ?? []).some((q) => /larger than the plan can spend/i.test(q)) && accepted > 0 ? "test:the-unspent-budget-stays-with-the-builder" : "question:which-of-two-things-did-you-mean");
      if (reason.startsWith("canary_blocked")) return out(accepted > 0 ? "test:legacy-plan-offered-today" : "question:other");
      if (people) return out(core ? "test:first-try-alone(kind)" : "question:first-try-refused-by-gate");
      if (reason === "insufficient_observation") return out(score >= SUFFICIENCY_THRESHOLD ? "architect-asked-today(score-now-sufficient)" : "question:thin-and-right");
      if (reason === "no_missions_passed_validation") {
        // the model answered and the gate refused every mission. Does today's gate accept one it refused then?
        const cands = (job.result?.brain?.candidates ?? []).map(asCandidate);
        const critic = new Map((job.result?.brain?.critiques ?? []).map((c) => [c.missionKey, c.decision]));
        const reports = cands.length ? validatePlanMissions(cands, r.scope, r.corpus) : [];
        const passing = cands.filter((c, i) => reports[i]!.ok && kindProofIssue(c, kind, classifyVerifiability(c)) === null && !["reject", "needs_input"].includes(critic.get(c.missionKey) ?? "accept"));
        if (passing.length > 0) return { ...out("test:a-stored-candidate-passes-today"), passing: passing.length, candidates: cands.length };
        // A model answered and nothing survived, so the builder is asked (that is the rule, and it stays). Counted
        // beside it, for the founder to weigh: would the first-try mission alone have been an honest test here?
        // "Yes" only when Sage itself got behind the first screen in three places (`missionTryReadiness`).
        let firstTryReady = false;
        if (core) {
          const readiness = computeCorpusReadiness(r.map, { missions: [{ ...core.mission, verifiabilityClass: "observation-based" }] } as unknown as MissionPlanV1);
          firstTryReady = !!readiness?.autonomous && !!readiness.missions?.[0]?.autonomous;
        }
        const criticOnly = reports.every((x) => x.ok);
        return { ...out(criticOnly ? "question:the-critic-refused-every-mission" : "question:the-gate-refused-every-mission"), candidates: cands.length, firstTryReady, refusedFor: tally(reports.flatMap((x) => x.issues), (i) => i.code) };
      }
      return out("question:other");
    });
    write("1-asked.json", rows);
    const got = rows.filter((x) => x.today.startsWith("test:")).length;
    console.log(`\n1. ASKED A QUESTION: ${asked.length} jobs, ${new Set(rows.map((x) => x.host)).size} products`);
    console.log("   today:", tally(rows, (x) => x.today));
    console.log("   by reason then:", tally(rows, (x) => `${x.reason} → ${x.today}`));
    console.log("   by slice:", tally(rows, (x) => `${x.slice} → ${x.today.split(":")[0]}`));
    console.log("   kinds today:", tally(rows, (x) => x.kind));
    console.log(`   would now get a test: ${got} of ${asked.length}`);
    const refusedAll = rows.filter((x) => x.today.includes("refused-every-mission"));
    const ready = refusedAll.filter((x) => (x as { firstTryReady?: boolean }).firstTryReady);
    console.log(`   still asked because every mission was refused: ${refusedAll.length}; of those, a first try alone would have been an honest test (three places behind the first screen): ${ready.length}`, tally(ready, (x) => x.slice));
    expect(rows.length).toBe(asked.length);
  });

  it("2. failed jobs: each failure against today's code", () => {
    const failed = jobs.filter((j) => j.status === "failed");
    const rows = failed.map((job) => {
      const r = rebuild(job);
      const stored = job.result?.brain?.reason ?? job.result?.reason ?? job.failure_reason ?? "(none)";
      const detail = job.result?.brain?.reasonDetail ?? "";
      const base = { id: job.id, host: hostOfJob(job), slice: sliceOf(job), failure: job.failure_reason, brainReason: stored, detail };
      if (!r || !hasUsableInspection(r.map)) return { ...base, today: "no-map:the-run-died-before-a-map" };
      // a job read with no browser kept nothing of what it read, so its first try has no words to anchor on here
      const replayable = (r.fieldTest?.pages?.length ?? 0) + (r.fieldTest?.states?.length ?? 0) > 0;
      const kind = r.kind.kind;
      const people = playbookOf(kind).peopleDoTheTry;
      // what `firstTryAlone` does today when the architect ends with this reason
      const noModel = NO_MODEL_REASONS.has(stored);
      const core = firstTry(job, r, { noModel: noModel && !people });
      const unreadableCore = UNREADABLE_REASONS.has(stored) ? firstTry(job, r, { noModel: !people }) : null;
      let today: string;
      if (String(job.failure_reason).startsWith("canary_blocked")) today = "test:legacy-plan-offered-today";
      else if (people) today = core ? "test:first-try-alone(kind)" : "fails:first-try-refused-by-gate";
      else if (noModel) today = core ? "test:first-try-alone(no-model)" : "fails:first-try-refused-by-gate";
      // every answer unreadable: the job runs once more, and if that run ends the same way the first try is the test
      else if (UNREADABLE_REASONS.has(stored)) today = unreadableCore ? "test:first-try-alone(unreadable-on-the-retry-too)" : replayable ? "fails:first-try-refused-by-gate" : "unknown:the-static-read-is-not-stored";
      else today = "fails:other";
      const used = core ?? unreadableCore;
      return { ...base, kind, noModelReason: noModel, today, mainAction: used?.hint.mainAction ?? null, from: used?.hint.from ?? null, startsAt: used?.hint.startsAt ?? null };
    });
    write("2-failed.json", rows);
    console.log(`\n2. FAILED: ${failed.length} jobs`);
    console.log("   failure → today:", tally(rows, (x) => `${x.failure} [${x.brainReason}${x.detail ? ` · ${x.detail.slice(0, 40)}` : ""}] → ${x.today}`));
    console.log("   today:", tally(rows, (x) => x.today));
    console.log("   by slice:", tally(rows, (x) => `${x.slice} → ${x.today.split(":")[0]}`));
    console.log("   first-try main action from:", tally(rows.filter((x) => "from" in x && x.from), (x) => String((x as { from?: string }).from)));
    expect(rows.length).toBe(failed.length);
  });

  it("3. every mission of every ready plan through today's gate", () => {
    const ready = jobs.filter((j) => j.status === "ready" && (j.result?.plan?.missions?.length ?? 0) > 0);
    const rows: Record<string, unknown>[] = [];
    const products = new Map<string, string>();
    for (const job of ready) {
      const r = rebuild(job);
      const missions = job.result!.plan!.missions!;
      const slice = sliceOf(job);
      const host = hostOfJob(job);
      if (!r) {
        for (const m of missions) rows.push({ id: job.id, host, slice, key: m.missionKey, noMap: true, exact: [], approx: [], kindIssue: null });
        continue;
      }
      const cands = missions.map(asCandidate);
      const reports = validatePlanMissions(cands, r.scope, r.corpus);
      const safety = screenProduct({ url: job.product_url, observations: r.observations, fieldTest: r.fieldTest, kind: r.kind.kind, phishing: LIST, now: 1 });
      products.set(host, safety.outcome === "clear" ? (products.get(host) ?? "clear") : safety.outcome);
      const readiness = computeCorpusReadiness(r.map, job.result!.plan as unknown as MissionPlanV1);
      cands.forEach((c, i) => {
        const codes = [...new Set(reports[i]!.issues.map((x) => x.code as string))];
        const cls = classifyVerifiability(c);
        const mr = readiness?.missions?.find((x) => x.missionKey === c.missionKey) ?? null;
        rows.push({
          id: job.id, host, slice, key: c.missionKey, core: c.missionKey === CORE_MISSION_KEY, kind: r.kind.kind,
          storedClass: missions[i]!.verifiabilityClass ?? null, cls,
          exact: codes.filter((x) => EXACT.has(x)), approx: codes.filter((x) => !EXACT.has(x)),
          details: reports[i]!.issues.map((x) => `${x.code}: ${x.detail}`),
          kindIssue: kindProofIssue(c, r.kind.kind, cls),
          keyRichEnough: readiness?.autonomous ?? null,
          tryReady: cls === "observation-based" ? (mr ? mr.autonomous : null) : true,
          cardClears: mr?.cardClears ?? null,
          safety: safety.outcome,
          mission: { title: c.title, objective: c.objective, instructions: c.instructions, criteria: c.criteria, evidenceRequirements: c.evidenceRequirements, anchors: c.anchors, effortMinutes: c.effortMinutes },
        });
      });
    }
    write("3-missions.json", rows);
    type Row = { slice: string; host: string; exact: string[]; approx: string[]; kindIssue: string | null; tryReady: boolean | null; keyRichEnough: boolean | null; cls?: string; safety?: string; noMap?: boolean };
    const all = rows as unknown as Row[];
    const pct = (n: number) => `${n} (${((100 * n) / all.length).toFixed(1)}%)`;
    const refusedExact = all.filter((x) => x.exact.length > 0 || x.kindIssue);
    const before = all.filter((x) => x.exact.some((c) => !ADDED.has(c)) || x.kindIssue);
    const held = all.filter((x) => x.cls === "observation-based" && (x.tryReady === false || x.keyRichEnough === false));
    console.log(`\n3. MISSIONS: ${all.length} in ${ready.length} ready plans, ${new Set(all.map((x) => x.host)).size} products`);
    console.log("   by slice:", tally(all, (x) => x.slice));
    console.log(`   refused today on the mission's own words (exact): ${pct(refusedExact.length)}; before the four added rules: ${pct(before.length)}`);
    console.log("     by code:", tally(all.flatMap((x) => [...x.exact, ...(x.kindIssue ? ["kind_proof"] : [])]), (c) => c));
    console.log("     by slice:", tally(refusedExact, (x) => x.slice));
    console.log("     the four added rules, by product count:", Object.fromEntries([...ADDED].map((c) => [c, `${all.filter((x) => x.exact.includes(c)).length} missions on ${new Set(all.filter((x) => x.exact.includes(c)).map((x) => x.host)).size} products`])));
    console.log(`   anchor or scope not found in the REBUILT corpus (approximate, an upper bound): ${all.filter((x) => x.approx.length > 0).length}`);
    console.log("     by code:", tally(all.flatMap((x) => x.approx), (c) => c));
    console.log("     by slice:", tally(all.filter((x) => x.approx.length > 0), (x) => x.slice));
    console.log(`   observation missions: ${all.filter((x) => x.cls === "observation-based").length}; held for the builder's release today: ${held.length}`);
    console.log("     why:", tally(held, (x) => (x.keyRichEnough === false ? "key under five sources" : "the card clears the bar, or under three try-only places")));
    console.log("     by slice:", tally(held, (x) => x.slice));
    console.log("   class today:", tally(all, (x) => String(x.cls)));
    console.log("   products by safety screen:", tally([...products.values()], (x) => x), "missions:", tally(all, (x) => String(x.safety)));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("4. the first-try mission today's code writes for every ready plan", () => {
    const ready = jobs.filter((j) => j.status === "ready" && (j.result?.plan?.missions?.length ?? 0) > 0 && sliceOf(j) !== "direct");
    const rows = ready.map((job) => {
      const r = rebuild(job);
      const base = { id: job.id, host: hostOfJob(job), slice: sliceOf(job) };
      if (!r) return { ...base, today: "no-map" };
      const beside = firstTry(job, r, { accepted: job.result!.plan!.missions! });
      const alone = firstTry(job, r, { noModel: true });
      // when no version passes, say why: the generic mission through the same gate
      let refusedFor: string[] = [];
      if (!beside) {
        const generic = buildCoreMission({ mainAction: GENERIC_ACTION, startsAt: null, from: "generic" }, { productName: r.map.productName, targetSurface: job.product_url, anchors: coreAnchors(r.map, r.corpus, null), sources: [{ kind: "founder", ref: "goal", observation: "stored" }] });
        const reps = validatePlanMissions([...job.result!.plan!.missions!.filter((m) => m.missionKey !== CORE_MISSION_KEY).map(asCandidate), generic], r.scope, r.corpus);
        refusedFor = reps[reps.length - 1]!.issues.map((x) => `${x.code}: ${x.detail}`);
      }
      return {
        ...base, kind: r.kind.kind, productName: r.map.productName, refusedFor,
        today: beside ? "added" : "refused",
        from: beside?.hint.from ?? null, mainAction: beside?.hint.mainAction ?? null, startsAt: beside?.hint.startsAt ?? null, title: beside?.mission.title ?? null,
        aloneFrom: alone?.hint.from ?? null, aloneAction: alone?.hint.mainAction ?? null, aloneStartsAt: alone?.hint.startsAt ?? null,
        acceptedTitles: job.result!.plan!.missions!.map((m) => m.title),
        ctas: [...(r.fieldTest?.pages?.[0]?.ctas ?? []), ...((r.fieldTest?.states?.[0]?.notableElements ?? []).map((e) => e.text))].slice(0, 14),
        h1: r.fieldTest?.pages?.[0]?.h1 ?? null,
      };
    });
    write("4-first-try.json", rows);
    console.log(`\n4. FIRST TRY: ${ready.length} ready plans (direct gigs and grants left out)`);
    console.log("   beside the stored plan, with no model hint:", tally(rows, (x) => `${x.today}${"from" in x && x.from ? ` · ${x.from}` : ""}`));
    console.log("   alone, with no model at all:", tally(rows, (x) => String("aloneFrom" in x ? x.aloneFrom : "no-map")));
    console.log("   kinds today:", tally(rows, (x) => String("kind" in x ? x.kind : "no-map")));
    console.log("   refused for:", tally(rows.flatMap((x) => ("refusedFor" in x ? x.refusedFor : [])), (c) => c.split(":")[0]!));
    expect(rows.length).toBe(ready.length);
  });
});
