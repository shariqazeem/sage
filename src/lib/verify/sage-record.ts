/**
 * SAGE'S OWN RECORDS AS PROOF (5 Nov 2026). See SageRecordContract in contract.ts for why it exists.
 *
 * Pure: every lookup is injected (work-proof.ts passes the database), so the rules here are tested without
 * one. The check answers from Sage's records and never from a page, because a Sage page never shows who
 * posted a job, and a page is what a worker controls.
 */
import type { SageRecordAction, SageRecordContract, VerificationResult } from "./contract";

/** Sage's own site. A page here is Sage's, never the worker's: it cannot carry their marker. */
export function isSageHost(host: string): boolean {
  return host.trim().toLowerCase().replace(/^www\./, "") === "sagepays.xyz";
}

const URLS = /https?:\/\/[^\s<>"'()\]]+/gi;
const JOB_PATH = /^\/(?:c|campaign|workspace\/jobs|jobs)\/([A-Za-z0-9_-]{4,64})\/?$/;
const RECEIPT_PATH = /^\/proof\/(0x[0-9a-fA-F]{64})\/?$/;
const TX = /\b0x[0-9a-fA-F]{64}\b/;

function sageUrls(text: string | null | undefined): URL[] {
  const out: URL[] = [];
  for (const m of (text ?? "").match(URLS) ?? []) {
    try {
      const u = new URL(m.replace(/[.,;:!?]+$/, ""));
      if (isSageHost(u.host)) out.push(u);
    } catch {
      /* not a URL */
    }
  }
  return out;
}

/** The job a link points at: sagepays.xyz/c/<id> (the public page), /campaign/<id>, /workspace/jobs/<id>. */
export function sageJobIdFrom(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) for (const u of sageUrls(t)) {
    const m = JOB_PATH.exec(u.pathname);
    if (m) return m[1]!;
  }
  return null;
}

/** The payout a receipt points at: sagepays.xyz/proof/<tx>, or the transaction hash itself. */
export function sageReceiptTxFrom(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) for (const u of sageUrls(t)) {
    const m = RECEIPT_PATH.exec(u.pathname);
    if (m) return m[1]!.toLowerCase();
  }
  for (const t of texts) {
    const m = TX.exec(t ?? "");
    if (m) return m[0].toLowerCase();
  }
  return null;
}

/** A job as Sage's records hold it. `title` and `missions` are what its poster wrote. */
export interface SageJobRecord {
  id: string;
  title: string;
  posterWallet: string;
  status: string;
  chainId: number;
  createdAt: number;
  vaultAddress: string | null;
  sandbox?: boolean;
  /** "testing" (a product test Sage planned), "gig" or "grant" */
  kind?: string;
  /** what the vault was funded with, in USD, when known */
  fundedUsd?: number | null;
  missions: { title: string; criteria: string[] }[];
}

/** A payout Sage made, as its records hold it. */
export interface SagePayoutRecord {
  tx: string;
  wallet: string;
  status: string;
  /** when the payout was decided (seconds) */
  paidAt: number;
  campaignId: string;
  campaignTitle: string;
  chainId: number;
  amountUsd?: number | null;
}

export interface SageRecordLookup {
  job(id: string): SageJobRecord | null;
  payout(tx: string): SagePayoutRecord | null;
  /** how many OTHER live submissions to this job already cite the record (a record counts once) */
  usedBy(bountyId: string, recordKey: string, exceptSubmissionId?: string): number;
  /** how many of this person's records of the same kind came BEFORE `before` (seconds), on real networks:
   *  jobs they launched (launched_job) or payouts Sage made them (was_paid) */
  earlier(action: SageRecordAction, wallet: string, before: number): number;
}

export interface SageRecordInput {
  wallet: string;
  evidenceUrl: string | null;
  note: string | null;
  /** this job: its id, when it went live (seconds), and who posted it */
  bountyId?: string;
  bountyCreatedAt?: number;
  bountyFounder?: string;
  submissionId?: string;
}

export interface SageRecordDeps {
  /** the ONE ownership compare (auth/founder.ts sameFounder), injected so this file stays pure */
  same: (a: string | null | undefined, b: string | null | undefined) => boolean;
  isMainnet: (chainId: number) => boolean;
  chainName: (chainId: number) => string;
}

/** A launched job: funded and put to work. A draft was never launched; a cancelled job was stopped and refunded. */
const LAUNCHED = new Set(["live", "paused", "completed"]);
const ZERO = /^0x0{40}$/i;

export interface SageRecordOutcome {
  result: VerificationResult;
  /** what Sage verified in its own records: server facts ONLY, for the judge's trusted block */
  facts: string[];
  /** what a record's author wrote (a job's title and missions): untrusted text, for the judge's untrusted block */
  authored: string[];
}

const fail = (detail: string, publicDetail: string): SageRecordOutcome => ({
  result: { verified: false, strength: "deterministic", detail, publicDetail },
  facts: [],
  authored: [],
});

const iso = (s: number) => new Date(s * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Check one submission against Sage's own records. Never throws; a missing lookup is the caller's to catch. */
export function verifySageRecord(c: SageRecordContract, input: SageRecordInput, lookup: SageRecordLookup, deps: SageRecordDeps): SageRecordOutcome {
  const on = c.chainId != null ? ` on ${deps.chainName(c.chainId)}` : "";
  if (c.action === "launched_job") {
    const id = sageJobIdFrom(input.evidenceUrl, input.note);
    if (!id) return fail("no Sage job link", "Submit the link to the job you launched on Sage (sagepays.xyz/c/…).");
    if (input.bountyId && id === input.bountyId) return fail("cited this job itself", "That's the link to this job. Submit the link to the job you launched.");
    const job = lookup.job(id);
    if (!job || job.sandbox) return fail(`no such job: ${id}`, "Sage has no job at that link. Check it and submit it again.");
    if (!deps.same(job.posterWallet, input.wallet)) return fail(`posted by another account: ${id}`, "That job was launched from another account. Submit a job you launched, from the account you launched it with.");
    if (input.bountyFounder && deps.same(job.posterWallet, input.bountyFounder)) return fail("the founder's own job", "A job launched by this job's own founder doesn't count.");
    if (!LAUNCHED.has(job.status) || !job.vaultAddress || ZERO.test(job.vaultAddress)) {
      return fail(`not launched: status ${job.status}`, job.status === "cancelled" ? "That job was stopped and refunded, so it doesn't count. Launch one and keep it running." : "That job hasn't been launched yet: fund it from your account, then submit it again.");
    }
    if (!deps.isMainnet(job.chainId)) return fail(`test network ${job.chainId}`, "That job is on a test network. Only a job funded with real money counts.");
    if (c.chainId != null && job.chainId !== c.chainId) return fail(`network ${job.chainId}, wanted ${c.chainId}`, `This job pays for a job launched${on}. Yours is on ${deps.chainName(job.chainId)}.`);
    if (input.bountyCreatedAt && job.createdAt < input.bountyCreatedAt) return fail("launched before this job", "That job was created before this one went live. Only a job launched after it counts.");
    if (input.bountyId && lookup.usedBy(input.bountyId, id, input.submissionId) > 0) return fail(`job already submitted: ${id}`, "That job has already been submitted here. Each job counts once.");
    const before = lookup.earlier("launched_job", input.wallet, job.createdAt);
    if (c.first && before > 0) return fail(`not their first: ${before} earlier`, `This job pays for someone's first job on Sage, and you had launched ${before === 1 ? "one" : before} before it.`);
    const funded = job.fundedUsd != null && job.fundedUsd > 0 ? `, its vault funded with $${job.fundedUsd.toFixed(2)}` : "";
    const kind = job.kind === "testing" ? "a product test Sage planned" : job.kind === "grant" ? "a grant paid in milestones" : job.kind === "gig" ? "a job paying for one piece of work" : null;
    return {
      result: {
        verified: true,
        strength: "deterministic",
        detail: `sage record: launched ${id} on ${job.chainId} at ${job.createdAt}`,
        // no title here: this line reaches the judge's TRUSTED block, and a job's title is its poster's words
        publicDetail: `Verified in Sage's own records: you launched a funded job on ${deps.chainName(job.chainId)}, after this job went live.`,
      },
      facts: [
        `Job ${id} was posted by the submitter's own account (${input.wallet}) on ${deps.chainName(job.chainId)} at ${iso(job.createdAt)}${input.bountyCreatedAt ? `, after this job went live (${iso(input.bountyCreatedAt)})` : ""}.`,
        `It was launched: status "${job.status}", with a vault${funded}. It is not this job, and it has not been submitted here before.`,
        ...(kind ? [`It is ${kind}.`] : []),
        before === 0 ? "It is the first job they launched on Sage." : `They had launched ${before} job${before === 1 ? "" : "s"} on Sage before this one.`,
      ],
      authored: [
        `Title: ${clip(job.title, 120)}`,
        ...job.missions.slice(0, 5).map((m, i) => `Mission ${i + 1}: ${clip(m.title, 120)}${m.criteria.length ? ` · ${m.criteria.length} acceptance criteria: ${m.criteria.slice(0, 6).map((x) => clip(x, 160)).join(" | ")}` : " · no acceptance criteria"}`),
      ],
    };
  }

  // was_paid
  const tx = sageReceiptTxFrom(input.evidenceUrl, input.note);
  if (!tx) return fail("no receipt", "Submit your Sage receipt link (sagepays.xyz/proof/…) or the payout's transaction hash.");
  const p = lookup.payout(tx);
  if (!p || p.status !== "paid") return fail(`no Sage payout: ${tx}`, "Sage has no payout with that receipt. Check it and submit it again.");
  if (!deps.same(p.wallet, input.wallet)) return fail("paid to another account", "That payout went to another account. Submit your own receipt, from the account you were paid in.");
  if (input.bountyId && p.campaignId === input.bountyId) return fail("a payout from this job", "A payout from this job itself doesn't count.");
  if (!deps.isMainnet(p.chainId)) return fail(`test network ${p.chainId}`, "That payout was on a test network. Only a real payout counts.");
  if (c.chainId != null && p.chainId !== c.chainId) return fail(`network ${p.chainId}, wanted ${c.chainId}`, `This job pays for a payout${on}. Yours was on ${deps.chainName(p.chainId)}.`);
  if (input.bountyCreatedAt && p.paidAt < input.bountyCreatedAt) return fail("paid before this job", "That payout was before this job went live. Only work paid after it counts.");
  if (input.bountyId && lookup.usedBy(input.bountyId, tx, input.submissionId) > 0) return fail(`receipt already submitted: ${tx}`, "That receipt has already been submitted here. Each payout counts once.");
  const before = lookup.earlier("was_paid", input.wallet, p.paidAt);
  if (c.first && before > 0) return fail(`not their first: ${before} earlier`, `This job pays for someone's first payout on Sage, and Sage had paid you ${before === 1 ? "once" : `${before} times`} before it.`);
  return {
    result: {
      verified: true,
      strength: "deterministic",
      detail: `sage record: paid ${tx} on ${p.chainId} at ${p.paidAt}`,
      publicDetail: `Verified in Sage's own records: Sage paid you for verified work on ${deps.chainName(p.chainId)}, after this job went live.`,
    },
    facts: [
      `Sage paid the submitter's own account (${input.wallet})${p.amountUsd ? ` $${p.amountUsd.toFixed(2)}` : ""} on ${deps.chainName(p.chainId)} at ${iso(p.paidAt)} (transaction ${tx}), for verified work on job ${p.campaignId}${input.bountyCreatedAt ? `, after this job went live (${iso(input.bountyCreatedAt)})` : ""}.`,
      "It is not a payout from this job, and it has not been submitted here before.",
      before === 0 ? "It is the first payout Sage made them." : `Sage had paid them ${before} time${before === 1 ? "" : "s"} before this one.`,
    ],
    authored: [`Title of the job it paid for: ${clip(p.campaignTitle, 120)}`],
  };
}

/** What an action means, in the words the card and the worker read. */
export function sageActionPhrase(action: SageRecordAction): string {
  return action === "launched_job" ? "launched a job on Sage" : "was paid by Sage for verified work";
}
