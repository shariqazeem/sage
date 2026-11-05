/**
 * SAGE BENCH · GRADE — would a founder launch this job as it is, and would a worker know what to do?
 *
 *   npx tsx tests/bench/grade-drafts.mts <run> [--resume <batch_id>]
 *
 * Claude Opus 5.5 reads each draft beside what the founder handed over and the scenario's expectations,
 * and scores it against one fixed rubric (Batch API, half price). Deterministic checks (does it compile?
 * is the money untouched?) are the runner's job; this grades what only a careful reader can.
 *
 * Writes tests/bench/results/<run>/grades.json: one grade per (candidate, scenario).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { evalClient, costUsd } from "./lib/anthropic.mts";

const MODEL = "claude-opus-5-5";
const run = process.argv[2];
if (!run) throw new Error("usage: grade-drafts.mts <run>");
const dir = `tests/bench/results/${run}`;
const corpus = new Map(
  (JSON.parse(readFileSync("tests/bench/corpus/draft-scenarios.json", "utf8")) as { id: string }[]).map((s) => [s.id, s as Record<string, unknown>]),
);

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["faithful", "complete", "verifiable", "clear", "proofFit", "launchAsIs", "declineCorrect", "missingFacts", "problems", "verdict"],
  properties: {
    faithful: { type: "integer", description: "1-5: the job is what the founder asked for, no more and no less; nothing invented, nothing dropped" },
    complete: { type: "integer", description: "1-5: every fact the work needs is on the card (repo, issue, language, length, chain, audience, deadline)" },
    verifiable: { type: "integer", description: "1-5: every criterion can be checked by reading the submitted evidence; none is vague or unobservable" },
    clear: { type: "integer", description: "1-5: a capable stranger could do the work from this card without asking a question" },
    proofFit: { type: "integer", description: "1-5: the proof asked for is the right proof for this work (a merged PR for code, a live page for writing, a tx for on-chain)" },
    launchAsIs: { type: "boolean", description: "would a careful founder launch this without editing anything" },
    declineCorrect: { type: ["boolean", "null"], description: "when Sage declined or failed to draft: was declining right? null when Sage drafted a job" },
    missingFacts: { type: "array", items: { type: "string" } },
    problems: { type: "array", items: { type: "string" }, description: "the 1-3 most important concrete problems, most severe first" },
    verdict: { type: "string", description: "one sentence" },
  },
} as const;

const SYSTEM = `You are the most demanding reviewer of Sage, an AI agent that turns what a team hands it into a paid job: Sage drafts the job card (title, steps, criteria, proof), the founder sets the pay and launches, people do the work, and Sage verifies each submission against the card before paying in USDC. A bad card means the founder fixes it by hand (Sage failed) or a worker does the wrong thing (Sage failed). Grade strictly and concretely; a 5 means you would not change a word. Money is never on the card: never penalize its absence.

What Sage checks by itself, so you can judge verifiability fairly:
- the worker's wallet address must appear in the work (page, doc, sheet, post, video description, PR description): authorship;
- the link must live on the named hosts; temporary paste sites are refused;
- a word floor counted on the content;
- a copy check against the page the work is about (a near-paste is refused, overlap is reported to the judge);
- for platform proofs it reads the platform itself: a PR's merge state and repository, a sheet's rows, a video's length, a post's time;
- for on-chain proofs it reads the transaction on its chain (sender, target, success, after the job went live);
- an AI judge then reads the work against the criteria, quoting the evidence, and a person holds anything doubtful.
"People", the deadline and what the founder adds (needs) are set on the card by the founder.`;

function prompt(s: Record<string, unknown>, row: Record<string, unknown>): string {
  const expect = s.expect as Record<string, unknown>;
  return [
    `WHAT THE FOUNDER HANDED SAGE (${s.inputMode}):`,
    String(s.input),
    s.sourceText ? `\nTHE PAGE AT ${s.sourceUrl} READ AS:\n${String(s.sourceText).slice(0, 6000)}` : "",
    `\nTHE FOUNDER WILL TAP: ${JSON.stringify(s.founderTaps)}`,
    `\nEXPECTED (from the scenario author): ${JSON.stringify({ shouldRefuse: expect.shouldRefuse, refuseWhy: expect.refuseWhy, kind: expect.kind, milestones: expect.milestones, idealProof: expect.proofKind, mustCarry: expect.mustCarry, pitfalls: expect.pitfalls })}`,
    row.draft
      ? `\nTHE JOB AS LAUNCHED (the card after the founder's taps: pay and people are theirs):\n${JSON.stringify(row.launched ?? row.draft, null, 1)}${row.needs && (row.needs as string[]).length ? `\nSAGE ASKED THE FOUNDER FOR (the card will not launch until they fill these in; each becomes a "From the founder" line at the top of the steps, so do not count them as missing): ${JSON.stringify(row.needs)}` : ""}`
      : `\nSAGE DID NOT DRAFT A JOB. It answered: ${JSON.stringify(row.error ?? null)}`,
    row.notes && (row.notes as string[]).length ? `\nNotes Sage showed the founder: ${JSON.stringify(row.notes)}` : "",
  ].join("\n");
}

async function main() {
  const client = evalClient();
  const resumeIdx = process.argv.indexOf("--resume");
  let batchId = resumeIdx > -1 ? process.argv[resumeIdx + 1] : null;
  const files = readdirSync(dir).filter((f) => f.startsWith("draft-") && f.endsWith(".json"));
  const items: { key: string; cand: string; id: string; row: Record<string, unknown> }[] = [];
  for (const f of files) {
    const cand = f.replace(/^draft-|\.json$/g, "");
    for (const row of (JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as { rows: Record<string, unknown>[] }).rows) {
      if (row.status === "too_long") continue;
      items.push({ key: `${cand}__${row.id}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64), cand, id: String(row.id), row });
    }
  }
  if (!batchId) {
    const batch = await client.messages.batches.create({
      requests: items.map((it) => ({
        custom_id: it.key,
        params: {
          model: MODEL,
          max_tokens: 4000,
          system: SYSTEM,
          output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
          messages: [{ role: "user", content: prompt(corpus.get(it.id) ?? {}, it.row) }],
        },
      })),
    });
    batchId = batch.id;
    writeFileSync(`${dir}/grade.batch`, batchId);
    console.log(`submitted ${items.length} grades as batch ${batchId}`);
  }
  for (;;) {
    const b = await client.messages.batches.retrieve(batchId);
    console.log(`${new Date().toISOString()} ${b.processing_status} ${JSON.stringify(b.request_counts)}`);
    if (b.processing_status === "ended") break;
    await new Promise((r) => setTimeout(r, 30_000));
  }
  const byKey = new Map(items.map((it) => [it.key, it]));
  const out: Record<string, unknown>[] = existsSync(`${dir}/grades.json`) ? JSON.parse(readFileSync(`${dir}/grades.json`, "utf8")) : [];
  let usd = 0;
  for await (const r of await client.messages.batches.results(batchId)) {
    const it = byKey.get(r.custom_id);
    if (!it || r.result.type !== "succeeded") continue;
    usd += costUsd(MODEL, r.result.message.usage, true);
    const text = r.result.message.content.find((c) => c.type === "text");
    if (!text || text.type !== "text") continue;
    try {
      out.push({ cand: it.cand, id: it.id, status: it.row.status, ...(JSON.parse(text.text) as object) });
    } catch {
      /* a refusal or a cut answer: skipped */
    }
  }
  writeFileSync(`${dir}/grades.json`, JSON.stringify(out, null, 2));
  // per-candidate summary
  const cands = [...new Set(out.map((g) => g.cand as string))];
  for (const c of cands) {
    const gs = out.filter((g) => g.cand === c);
    const drafted = gs.filter((g) => g.declineCorrect === null);
    const avg = (k: string) => (drafted.reduce((a, g) => a + Number(g[k] ?? 0), 0) / Math.max(1, drafted.length)).toFixed(2);
    console.log(JSON.stringify({
      candidate: c,
      graded: gs.length,
      drafted: drafted.length,
      launchAsIs: `${drafted.filter((g) => g.launchAsIs).length}/${drafted.length}`,
      faithful: avg("faithful"), complete: avg("complete"), verifiable: avg("verifiable"), clear: avg("clear"), proofFit: avg("proofFit"),
      declinesRight: `${gs.filter((g) => g.declineCorrect === true).length}/${gs.filter((g) => g.declineCorrect !== null).length}`,
    }));
  }
  console.log(`grading cost $${usd.toFixed(2)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
