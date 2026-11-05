import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { describe, it, vi } from "vitest";
import type { PageRead } from "@/lib/read/page-reader";

/**
 * SAGE BENCH · JUDGE — real submissions through production's own decision path, on any judge model.
 *
 * Per job:
 * - compile it with the deterministic compiler (compileDirectCampaign);
 * - attach it as a LIVE campaign with production's attach (attachV2Campaign), against a vault that agrees
 *   with the plan (no chain, no money);
 * - for each submission: create it, run production's `ensureDecision` (work-proof checks, the twin check,
 *   the judge on the PAYOUT lane, the hardener), then the autopay gate at the effective threshold.
 *
 * The network is the corpus: a page's HTML through the guarded read, a platform link's reading through the
 * page reader. Wallet signals are neutral, because they are measured elsewhere and need a chain.
 *
 *   BENCH=1 BENCH_JUDGES=anthropic:claude-sonnet-5-5 [BENCH_LIMIT=10] [BENCH_RUN=name] npx vitest run tests/bench/judge.live
 *
 * The number that matters most is wrongPay: work a careful founder would HOLD that Sage paid. It must be 0.
 */
const fx = vi.hoisted(() => ({ html: new Map<string, string>(), platform: new Map<string, PageRead>() }));
const norm = (u: string) => u.trim().replace(/^http:\/\//i, "https://").replace(/[)\].,;!?]+$/, "");

vi.mock("node:dns/promises", async (orig) => {
  const real = await orig<typeof import("node:dns/promises")>();
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  return { ...real, lookup, default: { ...(real as unknown as { default?: object }).default, lookup } };
});
vi.mock("@/lib/deputy/wallet-signals", () => ({ walletFreshnessSignal: async () => null }));
vi.mock("@/lib/deputy/funding-graph", () => ({ fundingClusterSignal: async () => null }));
vi.mock("@/lib/verify/author-age", () => ({ authorAgeSignal: async () => null }));
vi.mock("@/lib/read/page-reader", async (orig) => {
  const real = await orig<typeof import("@/lib/read/page-reader")>();
  return { ...real, readPage: async (url: string, deps?: never) => fx.platform.get(norm(url)) ?? real.readPage(url, deps) };
});

import { compileDirectCampaign, directCampaignSchema } from "@/lib/launch/direct-campaign";
import { attachV2Campaign, computeV2SetupPreview, type V2SetupInput } from "@/lib/campaigns/v2-setup";
import { createSubmission, getCampaign } from "@/lib/db/campaigns";
import { ensureDecision } from "@/lib/deputy/decisions";
import { gateFromBrief } from "@/lib/deputy/autopilot";
import { effectiveThreshold } from "@/lib/campaigns/validate";
import { CHAINS } from "@/lib/deputy/networks";
import { parseCandidates, pointLane, pool } from "./lib/models";

interface Sub {
  label: string;
  evidenceUrl: string;
  note: string | null;
  format: "html" | "platform";
  body: string;
  author: string | null;
  facts: Record<string, string | null>;
  expected: "pay" | "hold";
  why: string;
}
interface Job {
  id: string;
  title: string;
  who: string;
  milestone: { title: string; instructions: string; criteria: string[]; evidence: Record<string, unknown> };
  submissions: Sub[];
}

const CHAIN = 1088;
const OPERATOR = "0x86d7000000000000000000000000000000007abb";
const FOUNDER = "0x2222222222222222222222222222222222222222";
const realFetch = globalThis.fetch;

function evidenceFor(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: e.kind };
  if (e.kind === "public_url") {
    out.expectedText = ((e.expectedText as string[] | null) ?? ["Sage bench proof"]).filter((t) => t.length >= 3).slice(0, 5);
    return out;
  }
  out.allowedHosts = ((e.allowedHosts as string[]) ?? []).map((h) => h.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")).filter((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h)).slice(0, 5);
  out.markerKind = "wallet";
  for (const k of ["minWords", "minRows", "minDurationSeconds"] as const) if (typeof e[k] === "number") out[k] = e[k];
  if (typeof e.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(e.repo)) out.repo = e.repo;
  if (e.prMerged === true) out.prMerged = true;
  if (e.postedAfterStart === true) out.postedAfterStart = true;
  return out;
}

describe.skipIf(process.env.BENCH !== "1")("bench · judge", () => {
  it("judges every submission through production's decision path", async () => {
    const corpus = JSON.parse(readFileSync(process.env.BENCH_JUDGE_CORPUS || "tests/bench/corpus/judge-scenarios.json", "utf8")) as Job[];
    const limit = Number(process.env.BENCH_LIMIT) || corpus.length;
    const jobs = corpus.slice(0, limit);
    const run = process.env.BENCH_RUN || new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const dir = `tests/bench/results/${run}`;
    mkdirSync(dir, { recursive: true });
    process.env.LLM_MAX_CONCURRENCY = process.env.LLM_MAX_CONCURRENCY || "8";
    process.env.DEPUTY_AUTOPILOT_MAINNET = "true";
    // the fixture network: a submission's page, by URL; anything else (the model's endpoint) is real
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = norm(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const page = fx.html.get(url);
      if (page !== undefined) return new Response(page, { status: page === "__404__" ? 404 : 200, headers: { "content-type": "text/html; charset=utf-8" } });
      if (/^https:\/\/(api\.anthropic\.com|api\.commonstack\.ai)\//.test(url)) return realFetch(input, init);
      return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    }) as typeof fetch;

    for (const judge of parseCandidates(process.env.BENCH_JUDGES, "anthropic:claude-sonnet-5-5")) {
      pointLane("PAYOUT", judge);
      const started = Date.now();
      const rows: Record<string, unknown>[] = [];
      let n = 0;
      await pool(jobs, Number(process.env.BENCH_CONCURRENCY) || 3, async (job) => {
        n += 1;
        const publicId = `gig-bench${String(n).padStart(3, "0")}${Math.random().toString(36).slice(2, 6)}`;
        const body = {
          kind: "gig",
          title: job.title.slice(0, 80),
          milestones: [
            {
              title: job.milestone.title.slice(0, 120),
              instructions: job.milestone.instructions.slice(0, 2000),
              criteria: job.milestone.criteria.slice(0, 7).map((c) => c.slice(0, 300)).filter((c) => c.length >= 4),
              evidence: evidenceFor(job.milestone.evidence),
              slots: Math.max(job.submissions.length, 1),
              rewardUsd: 20,
            },
          ],
        };
        const parsed = directCampaignSchema.safeParse(body);
        if (!parsed.success) {
          rows.push({ job: job.id, stage: "schema", error: parsed.error.issues[0]?.message });
          return;
        }
        const compiled = compileDirectCampaign(parsed.data, publicId, null);
        if (!compiled.ok) {
          rows.push({ job: job.id, stage: "compile", error: compiled.error });
          return;
        }
        const cfg = CHAINS[CHAIN]!;
        const setup: V2SetupInput = {
          publicCampaignId: publicId,
          title: job.title.slice(0, 80),
          productUrl: compiled.plan.missions[0]!.targetSurface,
          chainId: CHAIN,
          expectedToken: cfg.usdcAddress as string,
          founderAddress: FOUNDER,
          operatorAddress: OPERATOR,
          guardian: "0x0000000000000000000000000000000000000000",
          factoryAddress: "0x1111111111111111111111111111111111111111",
          vaultAddress: `0x${publicId.replace(/[^0-9a-f]/gi, "").padEnd(40, "a").slice(0, 40)}`,
          campaignKind: "gig",
          missions: compiled.plan.missions.map((m) => ({
            missionKey: m.missionKey,
            title: m.title,
            objective: m.objective,
            instructions: m.instructions,
            targetSurface: m.targetSurface,
            criteria: m.criteria,
            evidenceRequirements: m.evidenceRequirements,
            verifiabilityClass: "url-verifiable" as const,
            verificationContract: m.verificationContract,
            rewardBase: BigInt(m.rewardBase),
            maxCompletions: BigInt(m.maxCompletions),
          })),
        };
        const preview = computeV2SetupPreview(setup);
        const attach = await attachV2Campaign(setup, {
          operatorAddress: () => OPERATOR,
          adapter: {
            readSnapshot: async () => ({
              factoryRecognizes: true,
              owner: FOUNDER,
              operator: OPERATOR,
              guardian: setup.guardian,
              token: setup.expectedToken,
              campaignIdHash: preview.campaignIdHash as string,
              missionPlanDigest: preview.missionPlanDigest as string,
              budgetCeiling: BigInt(preview.totalBudgetBase),
              chainId: CHAIN,
              state: "active",
              replaySupport: "supported",
              missions: Object.fromEntries(preview.missions.map((m) => [m.missionIdHash.toLowerCase(), { exists: true, rewardBase: BigInt(m.rewardBase), maxCompletions: BigInt(m.maxCompletions) }])),
            }),
          } as never,
        });
        if (!attach.ok) {
          rows.push({ job: job.id, stage: "attach", error: `${attach.stage}: ${attach.errors.join(",")}` });
          return;
        }
        const campaign = getCampaign(attach.campaignId)!;
        const mission = preview.missions[0]!;
        // submissions run one after another within a job: the twin and copy checks read what came before
        for (const [i, sub] of job.submissions.entries()) {
          const wallet = `0x${(n * 100 + i + 1).toString(16).padStart(40, "3")}`;
          const url = norm(sub.evidenceUrl);
          const body = sub.body.replaceAll("{{WALLET}}", wallet);
          if (sub.format === "platform") {
            const facts = Object.fromEntries(Object.entries(sub.facts ?? {}).filter(([, v]) => v != null)) as Record<string, string>;
            fx.platform.set(url, { url, label: url.replace(/^https:\/\//, ""), read: true, kind: url.includes("/pull/") ? "github_pull" : url.includes("spreadsheets") ? "google_sheet" : url.includes("docs.google") ? "google_doc" : /youtube|youtu\.be|loom|vimeo/.test(url) ? "video" : /x\.com|twitter/.test(url) ? "social_post" : "page", text: body, author: sub.author ?? undefined, facts, reason: null });
          } else {
            fx.html.set(url, body);
          }
          const created = createSubmission({ campaignId: campaign.id, wallet, evidenceUrl: url, note: sub.note, missionIdHash: mission.missionIdHash, missionSpecDigest: mission.specDigest });
          if (!created.ok) {
            rows.push({ job: job.id, label: sub.label, expected: sub.expected, stage: "submit", error: created.error });
            continue;
          }
          const t0 = Date.now();
          const brief = await ensureDecision(created.submission.id).catch((e) => {
            rows.push({ job: job.id, label: sub.label, expected: sub.expected, stage: "decide", error: String(e).slice(0, 200) });
            return null;
          });
          if (!brief) continue;
          const gate = gateFromBrief(brief, { ...campaign, autopilotThreshold: effectiveThreshold(campaign.autopilotThreshold) }, "pending", true);
          const decided = gate.pay ? "pay" : "hold";
          rows.push({
            job: job.id,
            label: sub.label,
            expected: sub.expected,
            decided,
            ok: decided === sub.expected,
            engine: brief.engine,
            model: brief.model,
            recommendation: brief.recommendation,
            confidence: brief.confidence,
            reasonCode: brief.reasonCode,
            reason: gate.reason,
            summary: brief.summary?.slice(0, 300),
            high: brief.fraudSignals.filter((f) => f.severity === "high").map((f) => f.signal),
            ms: Date.now() - t0,
            why: sub.why,
          });
        }
      });
      const judged = rows.filter((r) => r.decided);
      const wrongPay = judged.filter((r) => r.decided === "pay" && r.expected === "hold");
      const missedPay = judged.filter((r) => r.decided === "hold" && r.expected === "pay");
      const summary = {
        judge: judge.id,
        jobs: jobs.length,
        submissions: judged.length,
        errors: rows.length - judged.length,
        correct: `${judged.filter((r) => r.ok).length}/${judged.length}`,
        wrongPay: wrongPay.length,
        missedPay: missedPay.length,
        payRecall: `${judged.filter((r) => r.expected === "pay" && r.decided === "pay").length}/${judged.filter((r) => r.expected === "pay").length}`,
        heuristic: judged.filter((r) => r.engine !== "llm").length,
        p50ms: [...judged.map((r) => Number(r.ms))].sort((a, b) => a - b)[Math.floor(judged.length / 2)] ?? 0,
        wallSeconds: Math.round((Date.now() - started) / 1000),
      };
      console.log(JSON.stringify(summary));
      for (const w of wrongPay) console.log(`WRONG PAY ${w.job} ${w.label}: ${w.summary}`);
      const file = `${dir}/judge-${judge.id.replace(/[^a-z0-9.-]+/gi, "_")}.json`;
      writeFileSync(file, JSON.stringify({ summary, rows }, null, 2));
      if (existsSync(file)) console.log(`wrote ${file}`);
    }
    globalThis.fetch = realFetch;
  }, 6 * 60 * 60 * 1000);
});
