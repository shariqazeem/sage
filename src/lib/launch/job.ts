import "server-only";

import { createHash } from "node:crypto";
import { getInspectionJob, updateInspectionJob, resetInspectionForRetry, failStalledInspection, listStalledInspections } from "@/lib/db/inspection";
import { createRevision, getApprovedRevision, getCurrentRevision } from "@/lib/db/plan-revisions";
import { inspectAndPlan } from "./pipeline";
import { isWalletCanaryEligible, isValidFounderWallet, type CanaryIdentity } from "./mission-canary";
import { getAgentWallet } from "@/lib/db/agent-wallets";
import { fieldTestEnabled } from "./field-test";
import { openTestAccount, type TestAccount } from "./test-account-crypto";

/**
 * SAGE OWNS THE MAILBOX, SO FOUNDERS NEVER HAND OVER ONE.
 *
 * An email-code product (ClawUp, Privy, most modern SaaS) has no password — the mailbox IS the second
 * factor. Asking every founder for an IMAP app password to their own inbox is both a terrible ask and
 * a real risk. Instead Sage keeps ONE throwaway mailbox: the founder registers a test account on
 * their product using Sage's address, and Sage reads its own inbox.
 *
 * A founder-supplied mailbox still wins when they give one (they may prefer their own address); this
 * only fills the gap. Configured by SAGE_TEST_MAILBOX_* — absent, behaviour is exactly as before.
 */
function withServerMailbox(acct: TestAccount | null): TestAccount | null {
  if (!acct || acct.mailbox) return acct;
  const host = (process.env.SAGE_TEST_MAILBOX_HOST ?? "").trim();
  const user = (process.env.SAGE_TEST_MAILBOX_USER ?? "").trim();
  const appPassword = (process.env.SAGE_TEST_MAILBOX_APP_PASSWORD ?? "").trim();
  if (!host || !user || !appPassword) return acct;
  return { ...acct, mailbox: { host, user, appPassword } };
}
import { distillPrivateKey, OBS_BAR } from "@/lib/deputy/observation-verify";
import type { ValidationScope } from "./validate-mission";
import type { FieldTestSummary, FounderLaunchInput, MissionPlanV1, ProductMapV1 } from "./schemas";
import type { InspectionJob, InspectionStatus } from "@/lib/db/schema";

/**
 * P23 — the founder learns BEFORE funding whether this product supports autonomous payouts. Preview the
 * same corpus that gets pinned at attach (Sage's field-test observations minus the plan's public strings)
 * and check it's rich enough (≥ the eligibility bar) for observation missions to auto-verify. url-lane
 * missions autopay without a corpus, so an all-url plan is always "autonomous". Derived, never a promise.
 */
export interface CorpusReadiness {
  /** the plan contains observation-based missions (which need a rich corpus to auto-verify). */
  observation: boolean;
  /** distinct sources in the previewed corpus — "N distinct things Sage saw for itself". */
  sources: number;
  /** rich enough for autonomous verification of the observation work (else the founder will review). */
  autonomous: boolean;
}

function computeCorpusReadiness(map: ProductMapV1 | null, plan: MissionPlanV1 | null): CorpusReadiness | null {
  if (!plan) return null;
  const missions = plan.missions ?? [];
  const hasObservation = missions.some((m) => (m as { verifiabilityClass?: string }).verifiabilityClass === "observation-based");
  if (!hasObservation) return { observation: false, sources: 0, autonomous: true }; // url lane autopays sans corpus
  const publicStrings = missions.flatMap((m) => [
    m.title, m.objective, m.instructions, m.targetSurface,
    ...(m.criteria ?? []), ...(m.evidenceRequirements ?? []),
    ...((m as { whyItMatters?: string }).whyItMatters ? [(m as { whyItMatters?: string }).whyItMatters as string] : []),
  ]);
  const fieldTest = (map?.fieldTest ?? null) as FieldTestSummary | null;
  const sources = distillPrivateKey(fieldTest, publicStrings).distinctSources;
  // The operator's standing decision (2026-08-12): FULL AUTOPAY stays armed, bounded by the
  // per-wallet cap, the daily submit limit, near-dup detection and the injection guard. A
  // private-signal-based hold was built and REVERTED here because it silently overrode that choice;
  // `privateSignalSources` remains available (and tested) for when hardening is deliberately armed.
  return { observation: true, sources, autonomous: sources >= OBS_BAR.minKeySources };
}

/** JSON-safe serialization (bigint → string) for durable JSON columns + APIs. */
export function serialize<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}

/**
 * Run one inspection job to completion, persisting REAL stage transitions as the
 * pipeline enters them. On success it stores the result AND creates revision 1 of the
 * durable plan. Never throws — a failure is a `failed` status with a sanitized reason.
 */
/**
 * THE CANARY IDENTITY — a SERVER-VERIFIED wallet for the founder this job belongs to, or null.
 *
 * A job's `founderWallet` is an ownership NAMESPACE, not always an address: a SIWE web founder is
 * `0x…`, an anonymous job is "anonymous", and a Telegram or agent-started one is `clawup:<ref>`
 * (the real owner is claimed later at /launch/<id>). Only the first shape passed
 * `isValidFounderWallet`, so only web founders could ever reach the grounded planner.
 *
 * MEASURED over all 344 jobs: every one of the 20 grounded plans ever selected came from a `0x`
 * founder. All 43 Telegram founders were refused as `no_server_identity` — not once for a reason
 * about their product or their plan. They received the weaker legacy planner every single time,
 * for the same product and the same budget a web founder would have gotten the grounded one for.
 * That is not a rollout boundary, it is an accident of which string the namespace happened to hold.
 *
 * A Telegram founder DOES have a real, server-held, server-verified wallet: the Privy agent wallet
 * minted when they linked, keyed by the chat this namespace is derived from. It is the same wallet
 * that will fund the campaign. Resolving it here changes nothing about ownership, funding, or
 * approval — those still run through the claim and mandate paths — and a founder with no linked
 * wallet resolves to null, exactly as today.
 *
 * Nothing caller-supplied is trusted: the namespace is server-authored at job creation and the
 * lookup is a primary-key read against wallets minted by the link flow.
 */
export function resolveCanaryIdentity(founderWallet: string | null | undefined): CanaryIdentity | null {
  const raw = (founderWallet ?? "").trim();
  if (isValidFounderWallet(raw)) {
    return { wallet: raw, operatorAuthorized: isWalletCanaryEligible(raw), source: "server_session" };
  }
  if (!raw.toLowerCase().startsWith("clawup:")) return null;
  const chatId = raw.slice("clawup:".length);
  if (!chatId) return null;
  let address: string | null = null;
  try {
    address = getAgentWallet(chatId)?.privyWalletAddress ?? null;
  } catch {
    return null; // a lookup failure must degrade to today's behaviour, never grant authority
  }
  if (!address || !isValidFounderWallet(address)) return null;
  return {
    wallet: address.toLowerCase(),
    operatorAuthorized: isWalletCanaryEligible(address),
    source: "server_session",
  };
}

/** Failure reasons worth re-running the whole job for: the provider blinked, nothing is wrong with
 *  the product or the plan. Anything else (a real refusal, a needs-input, a bad URL) is not retried
 *  — repeating it would only make the founder wait for the same honest answer. */
const RETRYABLE_FAILURES = new Set([
  "provider_transient",
  "provider_timeout",
  "provider_error",
  "architect_failed",
  // A model that returned an unusable SHAPE five times is not a verdict about the founder's product
  // — a fresh run samples differently and usually clears it. Leaving this out made it the one
  // remaining dead end in the generality battery (a bot-walled store, nothing wrong with the plan).
  "schema_mismatch",
  "invalid_json",
  "truncated_output",
]);
/**
 * ONE retry, not two. A retry re-runs the WHOLE pipeline — browse, log in, vision, design — because
 * only the design step is known to have failed, not the browsing. At 2 retries that is THREE full
 * inspections stacked: the founder watches the same steps repeat, 84 states pile up, and 15 minutes
 * later it fails anyway. One retry keeps the genuine "the provider blinked" rescue and halves the
 * worst case a founder can ever sit through.
 */
const MAX_AUTO_RETRIES = 1;

/** A job whose runner died (a deploy restart kills the in-flight `after()` work) shows its last
 *  stamped stage forever. Every real stage stamps `updatedAt`, and the longest legitimate gap
 *  between stamps measured on prod is ~11 minutes (a slow field test + a full retry ladder), so
 *  15 minutes without movement is a dead runner, not a slow one. */
const STALL_SECONDS = 15 * 60;
/** How often a running inspection says it is still alive. Well inside STALL_SECONDS, so a live job
 *  is never mistaken for a dead one, and far apart enough to cost nothing. */
const HEARTBEAT_MS = 120_000;
const NON_TERMINAL: ReadonlySet<InspectionStatus> = new Set([
  "queued", "fetching", "field_test", "analyzing", "mapping", "generating_missions", "reviewing",
]);

/**
 * Reap a job whose runner died mid-flight. Measured on prod: three jobs sat in
 * `generating_missions` / `field_test` for DAYS — the founder's screen said Sage was working and
 * nothing was running, the worst kind of fabricated progress. Called from the status read (the
 * founder's polling is the one heartbeat we always have). CAS-guarded so a live run that advances
 * meanwhile is never touched and only one of N concurrent readers acts.
 *
 * Returns "retrying" when the caller should schedule `runInspectionJob` (observations from the
 * dead run survive in `result` and are unioned into the retry), "failed" when retries are spent,
 * null when the job is healthy.
 */
export function reapStalledJob(job: InspectionJob): "retrying" | "failed" | null {
  if (!NON_TERMINAL.has(job.status)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (now - job.updatedAt < STALL_SECONDS) return null;
  const won = failStalledInspection(
    job.id,
    { status: job.status, updatedAt: job.updatedAt },
    `stalled_in_${job.status}`,
  );
  if (!won) return null;
  if (job.retryCount < MAX_AUTO_RETRIES && resetInspectionForRetry(job.id)) return "retrying";
  return "failed";
}

/**
 * Reap stalled jobs on a HEARTBEAT THAT IS NOT THE FOUNDER'S ATTENTION.
 *
 * `reapStalledJob` fixes a dead job the moment someone looks at it, and the founder's status poll
 * was the only thing that ever looked. So a founder who closes the tab — which is exactly the
 * founder who does not come back to un-stick it — leaves the job saying "Sage is working" forever.
 *
 * MEASURED on production: five jobs sat non-terminal past the threshold, idle for 108, 110, 778,
 * 1371 and **3643 minutes** — the oldest for more than sixty hours. Two of those were killed by a
 * deploy restart earlier tonight, which is not a rare event: every deploy kills whatever `after()`
 * work is in flight.
 *
 * The sweep already runs unconditionally every ~5 minutes under pm2, so it is the heartbeat this
 * needed. Batched deliberately small: a retry re-runs a real field test in a real browser, and
 * turning five of those loose at once on one box would be its own outage. The rest keep until the
 * next tick, which is fine — they have already waited.
 */
export function reapStalledInspections(
  schedule: (fn: () => void | Promise<void>) => void,
  limit = 3,
): { retried: number; failed: number } {
  let retried = 0;
  let failed = 0;
  let stalled: InspectionJob[] = [];
  try {
    stalled = listStalledInspections(STALL_SECONDS, limit);
  } catch {
    return { retried, failed }; // a read failure must never take the whole sweep down
  }
  for (const job of stalled) {
    let outcome: "retrying" | "failed" | null = null;
    try {
      outcome = reapStalledJob(job);
    } catch {
      continue;
    }
    if (outcome === "retrying") {
      retried += 1;
      schedule(() => runInspectionJob(job.id));
    } else if (outcome === "failed") {
      failed += 1;
    }
  }
  return { retried, failed };
}

export async function runInspectionJob(jobId: string): Promise<void> {
  const job = getInspectionJob(jobId);
  if (!job || (job.status !== "queued" && job.status !== "needs_input" && job.status !== "failed")) return;

  const input: FounderLaunchInput = {
    productUrl: job.productUrl,
    repoUrl: job.repoUrl,
    goal: job.goal,
    targetUsers: job.targetUsers,
    totalBudgetBase: BigInt(job.totalBudgetBase),
    tokenDecimals: job.tokenDecimals,
    // Opened only here, at the moment the run needs it, and handed straight to the field test. A
    // seal that cannot be opened (rotated secret, tampered row) degrades to null — the inspection
    // simply runs logged-out, exactly as it did before this capability existed.
    testAccount: withServerMailbox(openTestAccount(job.testAccountSealed)),
  };

  // Phase 5 CANARY — a SERVER-VERIFIED identity, built ONLY from the SIWE-verified founder wallet the job was
  // created under. Never from founder text / goal / product content / model output. `operatorAuthorized` is the
  // operator's allowlisting of this wallet — NOT founder consent (the actual founder decision is the separate
  // SIWE approval of the generated revision). The wallet MUST be syntactically valid + non-anonymous, so an
  // "anonymous" job can never carry canary authority.
  const canaryIdentity = resolveCanaryIdentity(job.founderWallet);

  // WHAT EARLIER RUNS OF THIS JOB ALREADY SAW. A retry and a founder's clarification both re-run the
  // whole pipeline, and browsing is not deterministic: across production, the same url and goal
  // produced 0 to 36 states and 0 to 301 facts on different runs. Replacing the set each time means
  // answering Sage's question can hand the founder a THINNER plan than the one that prompted it.
  // Carrying the previous set forward makes a re-run strictly additive.
  const priorObservations = (() => {
    try {
      const prev = (job.result as { map?: { observations?: unknown } } | null)?.map?.observations;
      return (prev ?? null) as import("./observed-facts").ObservationSetV1 | null;
    } catch {
      return null;
    }
  })();

  /**
   * A HEARTBEAT, BECAUSE "IDLE" AND "SLOW" ARE NOT THE SAME THING.
   *
   * `updatedAt` moved only on a STAGE CHANGE, so a job sitting inside one long stage looked exactly
   * like a job whose process had been killed. The reaper below treats 15 minutes of silence as death
   * and RESTARTS the work — re-running the field test, which is the expensive part. On a reasoning
   * mission lane an architect-plus-critic sequence can hold `generating_missions` past that on its
   * own, so a genuinely-progressing plan could be restarted forever and never finish, burning a
   * browser run and model budget each time.
   *
   * Measured: P-GEN nonce 55 timed out on NINE of thirteen products, clustered at exactly the two
   * long stages (`generating_missions`, `field_test`).
   *
   * The heartbeat says only "this process is alive", which is precisely the question the reaper is
   * asking. A process killed by a deploy restart stops beating and is still reaped, so the guard
   * keeps the failure it exists for and loses the false positive.
   */
  const beat = setInterval(() => {
    try {
      updateInspectionJob(jobId, null, {});
    } catch {
      /* a heartbeat must never be able to fail the job it is reporting on */
    }
  }, HEARTBEAT_MS);
  if (typeof beat.unref === "function") beat.unref();

  try {
    const result = await inspectAndPlan(
      input,
      job.publicCampaignId,
      (stage) => {
        updateInspectionJob(jobId, stage as InspectionStatus, {});
      },
      0,
      { inspectionId: jobId, canaryIdentity, priorObservations },
    );

    const serialized = serialize(result);
    const outputDigest = createHash("sha256").update(JSON.stringify(serialized)).digest("hex");
    // Phase 0C — when the GROUNDED V2 plan was selected, job + revision metadata must reflect the grounded
    // architect, NOT the legacy brain.model. Fall through to the legacy model on every other path.
    const grounded = result.canary?.status === "selected" ? result.canary.provenance ?? null : null;
    const metaModel = grounded?.architectModel || result.brain?.model || null;
    const metaProvider = grounded?.architectProvider || result.brain?.provider || null;
    updateInspectionJob(jobId, result.stage as InspectionStatus, {
      result: serialized,
      productMapDigest: result.map?.digest ?? null,
      pagesInspected: result.map?.pagesInspected ?? 0,
      repoFilesInspected: result.map?.repoFilesInspected ?? 0,
      model: metaModel,
      provider: metaProvider,
      promptVersion: result.brain?.promptVersion || null,
      revision: result.plan?.revision ?? 0,
      failureReason: result.stage === "failed" ? (result.reason ?? "inspection failed") : null,
      outputDigest,
    });

    // durable revision 1 — the generated plan (only when none exists yet). A grounded-selected plan is
    // persisted with grounded provenance + the "generated_grounded_v2" reason so the revision is never
    // mistaken for a legacy plan.
    if (result.stage === "ready" && result.plan && !getCurrentRevision(jobId)) {
      const canary = result.canary?.status === "selected" ? result.canary : null;
      createRevision({
        jobId,
        authorWallet: job.founderWallet,
        reason: grounded ? "generated_grounded_v2" : "generated",
        plan: result.plan,
        budgetBase: result.plan.totalBudgetBase,
        validationOk: true,
        model: metaModel,
        provider: metaProvider,
        // Phase 2 — the VerificationPolicyV2 is bound to THIS revision (never sourced from job.result at approval).
        verificationPolicy: canary?.verificationPolicy ?? null,
        verificationPolicyDigest: canary?.verificationPolicyDigest ?? null,
        verificationPolicyRequired: canary?.verificationPolicyRequired ?? false,
        groundedProvenance: grounded ?? null,
      });
    }

    // A PROVIDER HICCUP IS NOT A VERDICT. Sage can spend minutes in a real browser gathering
    // evidence and then lose all of it because one model call caught a 503 — the founder sees
    // "Sage couldn't finish this one" for something that had nothing to do with their product.
    // So a transient failure re-runs itself, bounded and recorded, instead of ending there. A real
    // refusal is never retried: repeating it would only make the founder wait for the same answer.
    if (
      result.stage === "failed" &&
      RETRYABLE_FAILURES.has(result.reason ?? "") &&
      (getInspectionJob(jobId)?.retryCount ?? 0) < MAX_AUTO_RETRIES &&
      // the SAME atomic reset the founder's "Try again" uses — terminal-only, so a manual retry
      // already in flight wins and this becomes a no-op instead of a second concurrent run.
      resetInspectionForRetry(jobId)
    ) {
      const attempt = getInspectionJob(jobId)?.retryCount ?? 1;
      await new Promise((r) => setTimeout(r, 4_000 * attempt));
      await runInspectionJob(jobId);
    }
  } catch (err) {
    updateInspectionJob(jobId, "failed", { failureReason: (err instanceof Error ? err.message : "inspection error").slice(0, 200) });
  } finally {
    // stop beating the moment this run is over, success or failure — a heartbeat that outlives its
    // job would keep a genuinely dead row looking alive, which is the exact failure the reaper exists
    // to catch.
    clearInterval(beat);
  }
}

/* ─────────────────────────────────────────── validation scope ───────────── */

/** Reconstruct the inspected scope (URLs + hosts) from a job's stored product map. */
export function scopeForJob(job: InspectionJob): ValidationScope {
  const knownUrls = new Set<string>();
  const hosts = new Set<string>();
  try {
    hosts.add(new URL(job.productUrl).host.toLowerCase());
    knownUrls.add(new URL(job.productUrl).origin + "/");
  } catch { /* skip */ }
  const map = (job.result as { map?: ProductMapV1 } | null)?.map;
  if (map) {
    const findings = [...map.routes, ...map.browserConfirmed, ...map.interactiveSurfaces, ...map.trustSurfaces];
    for (const f of findings) {
      for (const s of f.sources ?? []) {
        if (s.kind === "page" && s.ref) {
          knownUrls.add(s.ref);
          try { hosts.add(new URL(s.ref).host.toLowerCase()); } catch { /* skip */ }
        }
      }
    }

    /**
     * AND EVERYWHERE THE FIELD TEST ACTUALLY WENT.
     *
     * `scopeFromObservations` — the scope a mission is VALIDATED against when it is generated —
     * includes the field test's own pages and states. This one did not, so the two disagreed: a
     * mission grounded in a page reachable only by INTERACTION passed at birth and failed the
     * moment anything re-validated it. Editing a plan, or rebalancing its budget, refused a
     * mission Sage had itself just written.
     *
     * REPORTED on starkscan.co, where the contract pages exist only behind the header search — so
     * they are field-test states and never crawled routes. It could not show up on a product whose
     * pages are all reachable by following links, which is why every earlier campaign was fine.
     *
     * A field-test state is a REAL observation: Sage drove a browser there and captured what it
     * saw. Treating it as unknown does not make the plan safer, it makes Sage disown its own eyes.
     */
    const fieldTest = (map as { fieldTest?: FieldTestSummary | null }).fieldTest;
    if (fieldTest?.ran) {
      const add = (raw: string | null | undefined) => {
        if (!raw) return;
        try {
          const u = new URL(raw);
          knownUrls.add(u.toString());
          knownUrls.add(u.toString().replace(/#.*$/, ""));
          hosts.add(u.host.toLowerCase());
        } catch {
          /* not a URL — nothing to add */
        }
      };
      add(fieldTest.startUrl);
      for (const p of fieldTest.pages ?? []) add(p.url);
      for (const st of fieldTest.states ?? []) add(st.url);
    }
  }
  return { knownUrls, hosts, repoPaths: new Set() };
}

/* ─────────────────────────────────────────── client-safe view ───────────── */

export interface JobView {
  id: string;
  status: InspectionStatus;
  productUrl: string;
  goal: string;
  totalBudgetBase: string;
  tokenDecimals: number;
  pagesInspected: number;
  repoFilesInspected: number;
  /** whether the Field Test browser stage applies to this run (FIELD_TEST_ENABLED). */
  fieldTestStage: boolean;
  model: string | null;
  provider: string | null;
  failureReason: string | null;
  /** inspection output: the product map + questions (bigints stringified). */
  result: { map: unknown; questions: string[]; reason: string | null } | null;
  /** the CURRENT revision's plan snapshot (serialized), or null. */
  plan: unknown;
  /** P23 — whether this plan's corpus supports autonomous payouts (founder learns before funding). */
  corpusReadiness: CorpusReadiness | null;
  revision: number;
  /** durable approval, when the current revision is approved. */
  approval: { approvedAt: number; revision: number; campaignIdHash: string; missionPlanDigest: string } | null;
  createdAt: number;
  updatedAt: number;
}

export function jobToView(job: InspectionJob): JobView {
  const current = getCurrentRevision(job.id);
  const approvedRow = getApprovedRevision(job.id);
  const res = job.result as { map?: unknown; questions?: string[]; reason?: string | null } | null;
  return {
    id: job.id,
    status: job.status,
    productUrl: job.productUrl,
    goal: job.goal,
    totalBudgetBase: String(job.totalBudgetBase),
    tokenDecimals: job.tokenDecimals,
    pagesInspected: job.pagesInspected,
    repoFilesInspected: job.repoFilesInspected,
    fieldTestStage: fieldTestEnabled(),
    model: job.model,
    provider: job.provider,
    failureReason: job.failureReason,
    result: res ? { map: res.map ?? null, questions: res.questions ?? [], reason: res.reason ?? null } : null,
    plan: current ? current.planJson : ((res as { plan?: unknown } | null)?.plan ?? null),
    corpusReadiness: computeCorpusReadiness(
      (res?.map ?? null) as ProductMapV1 | null,
      (current ? current.planJson : (res as { plan?: unknown } | null)?.plan ?? null) as MissionPlanV1 | null,
    ),
    revision: current?.revisionNumber ?? 0,
    approval:
      approvedRow && approvedRow.approvedAt != null
        ? { approvedAt: approvedRow.approvedAt, revision: approvedRow.revisionNumber, campaignIdHash: approvedRow.campaignIdHash, missionPlanDigest: approvedRow.missionPlanDigest }
        : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export type { MissionPlanV1 };
