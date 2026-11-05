/**
 * SAGE BENCH · PAYABILITY — could an honest worker who does this job actually get paid by Sage's checks?
 *
 *   npx tsx tests/bench/audit-payability.mts <run> [--resume <batch_id>]
 *
 * The grader asks whether a founder would launch a card. This asks the question that decides whether
 * Sage failed as an agent: once launched, does the proof Sage chose let an honest worker through, on
 * whatever site the work lives, and does it keep a cheater out? Measured after the founder's own test
 * (5 Nov 2026) drafted a job nobody could ever be paid for: a link proof on a page that cannot carry
 * the worker's wallet.
 *
 * Claude Opus 5.5 reads each launched card as the worker who will do it and as the check that will
 * judge it, with an exact account of what Sage checks (Batch API, half price). Writes
 * tests/bench/results/<run>/payability.json and prints the blockers by class.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { evalClient, costUsd } from "./lib/anthropic.mts";
import { whatSageSeesText } from "../../src/lib/verify/what-sage-sees.ts";

const MODEL = "claude-opus-5-5";
const run = process.argv[2];
if (!run) throw new Error("usage: audit-payability.mts <run>");
const dir = `tests/bench/results/${run}`;
const corpus = new Map(
  (JSON.parse(readFileSync("tests/bench/corpus/draft-scenarios.json", "utf8")) as { id: string }[]).map((s) => [s.id, s as Record<string, unknown>]),
);

export const BLOCKERS = [
  "none",
  "marker_cannot_be_placed", // the worker cannot put their wallet address where the proof lives
  "sage_cannot_read", // the proof lives behind a login, in an app, on a platform Sage cannot open, or is not a link at all
  "criteria_not_in_proof", // a criterion the judge holds them to cannot be seen in anything they can submit
  "proof_does_not_show_the_work", // the proof can pass without the work being done (or the work can be done without the proof passing)
  "worker_cannot_do_it", // a stranger cannot do this as written: missing access, an impossible step, a contradiction
  "check_contradicts_steps", // the steps tell the worker to do or submit something the check will refuse
  "founder_judgment_unflagged", // only the founder can tell, and the card lets Sage pay without them
  "onchain_check_wrong", // wrong network, wrong target, a transaction the worker cannot send from their own wallet
  "fakeable", // someone who did not do the work can pass the checks (another person's page, a public page anyone can submit)
  "other",
] as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["payable", "blocker", "where", "why", "fix"],
  properties: {
    payable: { type: "string", enum: ["yes", "risky", "no"], description: "yes: an honest worker who does the work gets paid and a cheater does not. risky: usually, but a common honest submission fails or a cheater gets through. no: an honest worker cannot get paid as written." },
    blocker: { type: "string", enum: BLOCKERS as unknown as string[] },
    where: { type: "string", description: "the milestone and the exact check or step where it breaks; empty when payable is yes" },
    why: { type: "string", description: "one or two sentences, concrete: what the honest worker submits and why Sage refuses it, or how a cheater passes" },
    fix: { type: "string", description: "the GENERAL fix: the proof or check that would make this kind of job payable on any site, not a patch for this one; empty when payable is yes" },
  },
} as const;

const SYSTEM = `You audit jobs posted on Sage, an AI agent that pays people in USDC for verified work. A founder hands Sage a request; Sage drafts a job card (steps, criteria, and ONE proof per milestone); a stranger does the work and submits ONE link or transaction hash plus a short note from their wallet; Sage checks it and pays. Your one question: could an honest worker who does exactly what the card says actually get paid by these checks, and are cheaters kept out? A job nobody can be paid for is Sage failing as an agent, whatever the site or the kind of work.

EXACTLY WHAT SAGE CHECKS, per proof kind (nothing else exists; workers cannot upload files or screenshots):
- artifact_url (a link to something the worker made): Sage opens the submitted link itself, without logging in. It must be public; on one of allowedHosts when any are named (empty = any public host); never a paste site (pastebin, rentry, telegra.ph and the like). The page must VISIBLY contain the worker's full wallet address (0x… 40 hex): that is the only authorship check, so the worker must be able to put text where the proof lives. Optional extras, each checked deterministically: minWords (words of content), mustContain (verbatim phrases), repo + prMerged (a GitHub pull request into that repository that is merged; the wallet goes in the PR description), minRows (a Google Sheet's filled rows), minDurationSeconds (a video's length), postedAfterStart (a post or video published after the job went live), txProof (every transaction hash listed in the work is read on its network: sent from the worker's wallet, succeeded, after the job went live, to the named contracts; at least minTxs per network).
  linkProof {minLinks, hosts}: the work lists links to other pages (posts, listings, PRs); Sage opens each (up to 12), on the named hosts, and each must be readable and carry the worker's wallet (posted after the job went live when it shows a time); at least minLinks must pass, and what those pages say goes to the judge.
  WHAT SAGE SEES of a link (exactly this, nothing more):
${whatSageSeesText()}
- public_url (text on a page): Sage opens the submitted page and requires each expectedText verbatim. There is NO wallet binding: anyone can submit the same page.
- onchain_tx (a transaction): the submitted hash is read on chainId: sent FROM the submitting wallet, after the job went live, and matching what is named (to: the contract it must call; deploysContract: it deployed a contract). A transaction sent by someone else's wallet, by a contract, or by the worker's exchange account fails.
- sage_record (work done on Sage itself): Sage looks the record up in its own database: launched_job (they launched a funded job on Sage from the account they submit with, after this job went live) or was_paid (Sage paid them for verified work after this job went live); first = only their first.
- founderConfirms on any proof: every submission waits for the founder to confirm before it pays.
Then an AI judge reads what Sage fetched against the CRITERIA, quoting it verbatim; a criterion that the submitted proof cannot show is a criterion the worker fails. Public jobs also need a one-time World ID check per person; ignore that here.

Judge the card as launched (the founder already set the pay, the people and anything Sage asked them for). Be concrete and fair: do not fail a card for a hypothetical edge case; fail it when the normal honest path breaks or the normal cheat works. Your fix must be GENERAL: what proof or check would make this KIND of job payable on any site.`;

function prompt(s: Record<string, unknown>, row: Record<string, unknown>): string {
  return [
    `WHAT THE FOUNDER HANDED SAGE (${s.inputMode}):`,
    String(s.input),
    s.sourceText ? `\nTHE PAGE AT ${s.sourceUrl}, AS SAGE READ IT:\n${String(s.sourceText).slice(0, 4000)}` : "",
    `\nTHE JOB AS LAUNCHED:\n${JSON.stringify(row.launched, null, 1)}`,
    row.needs && (row.needs as string[]).length ? `\nTHE FOUNDER FILLED IN (these become "From the founder" lines at the top of the steps): ${JSON.stringify(row.needs)}` : "",
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
      if (row.status !== "launchable") continue;
      items.push({ key: `${cand}__${row.id}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64), cand, id: String(row.id), row });
    }
  }
  if (!batchId) {
    const batch = await client.messages.batches.create({
      requests: items.map((it) => ({
        custom_id: it.key,
        params: {
          model: MODEL,
          max_tokens: 3000,
          system: SYSTEM,
          output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
          messages: [{ role: "user", content: prompt(corpus.get(it.id) ?? {}, it.row) }],
        },
      })),
    });
    batchId = batch.id;
    writeFileSync(`${dir}/payability.batch`, batchId);
    console.log(`submitted ${items.length} audits as batch ${batchId}`);
  }
  for (;;) {
    const b = await client.messages.batches.retrieve(batchId);
    console.log(`${new Date().toISOString()} ${b.processing_status} ${JSON.stringify(b.request_counts)}`);
    if (b.processing_status === "ended") break;
    await new Promise((r) => setTimeout(r, 30_000));
  }
  const byKey = new Map(items.map((it) => [it.key, it]));
  const out: Record<string, unknown>[] = [];
  let usd = 0;
  for await (const r of await client.messages.batches.results(batchId)) {
    const it = byKey.get(r.custom_id);
    if (!it || r.result.type !== "succeeded") continue;
    usd += costUsd(MODEL, r.result.message.usage, true);
    const text = r.result.message.content.find((c) => c.type === "text");
    if (!text || text.type !== "text") continue;
    try {
      const a = JSON.parse(text.text) as Record<string, unknown>;
      const s = corpus.get(it.id) ?? {};
      const kinds = ((it.row.launched as { milestones?: { evidence?: { kind?: string } }[] })?.milestones ?? []).map((m) => m.evidence?.kind ?? "?");
      out.push({ cand: it.cand, id: it.id, category: s.category, kinds, ...a });
    } catch {
      /* a refusal or a cut answer: skipped */
    }
  }
  writeFileSync(`${dir}/payability.json`, JSON.stringify(out, null, 2));
  const count = (k: string, v: string) => out.filter((a) => a[k] === v).length;
  console.log(JSON.stringify({ audited: out.length, yes: count("payable", "yes"), risky: count("payable", "risky"), no: count("payable", "no") }));
  const blockers = Object.fromEntries(BLOCKERS.filter((b) => b !== "none").map((b) => [b, out.filter((a) => a.payable !== "yes" && a.blocker === b).length]).filter(([, n]) => (n as number) > 0));
  console.log("blockers (risky + no):", JSON.stringify(blockers));
  const cats = [...new Set(out.map((a) => String(a.category)))].sort();
  for (const c of cats) {
    const g = out.filter((a) => a.category === c);
    console.log(`${c.padEnd(26)} yes ${g.filter((a) => a.payable === "yes").length} · risky ${g.filter((a) => a.payable === "risky").length} · no ${g.filter((a) => a.payable === "no").length}`);
  }
  console.log(`audit cost $${usd.toFixed(2)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
