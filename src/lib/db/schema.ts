import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { StoredBrief } from "../deputy/brain-core";

/** The on-chain condition a campaign can auto-verify (condition_type = 'onchain'). */
export interface OnchainCheck {
  chainId: number;
  address: string;
  kind: "event" | "method";
  signature: string;
  minCount: number;
}

/** Which vault contract backs a campaign. Legacy rows = policy_v1; V2 = campaign_v2. */
export type VaultKind = "policy_v1" | "campaign_v2";

/**
 * A mission's lifecycle within a campaign_v2 campaign.
 *   draft   — editable, not yet bound to a deployed/activated vault (cannot pay).
 *   active  — locked + live; economic fields (reward, cap, id hashes) are immutable.
 *   paused  — temporarily not accepting/paying, economics still frozen.
 *   closed  — terminal.
 * `lockedAt` records when the economics froze (set on the draft→active transition).
 */
export type MissionStatus = "draft" | "active" | "paused" | "closed";

/**
 * A reward campaign — a poster funds a vault and defines a task; participants
 * submit; approved submissions settle real USDC from the campaign's vault. This
 * is what turns Sage from a demo of one loop into a product other teams run.
 */
export const campaigns = sqliteTable("campaigns", {
  /** short public slug (nanoid) — used in /c/[slug]. */
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  descriptionMd: text("description_md").notNull().default(""),
  /** the criteria the Deputy matches each submission against. */
  criteria: text("criteria", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  /** 'approval' (human signs off) | 'onchain' (autonomous, verified condition). */
  conditionType: text("condition_type").notNull().default("approval"),
  onchainCheck: text("onchain_check", { mode: "json" }).$type<OnchainCheck>(),
  /** reward per approved submission, in USDC base units (6dp). */
  rewardAmount: integer("reward_amount").notNull(),
  maxRecipients: integer("max_recipients").notNull().default(0),
  /** P18 Sybil cap: the most times ANY ONE wallet can be PAID across this whole campaign (across all
   *  its missions). Default 1 (max farming resistance — a fresh payout needs a fresh wallet); a founder
   *  raises it at launch when they want trusted testers doing several missions. Enforced in preflight. */
  perWalletPayoutCap: integer("per_wallet_cap").notNull().default(1),
  /**
   * P16 PINNED PRIVATE ANSWER KEY — the distilled field-test observations (Sage's field-test corpus
   * MINUS every public plan/card string), for observation-mode verification. Pinned AT ATTACH, before
   * any tester sees a card, so it's an immutable snapshot like the mission plan + vault settings. Null
   * on legacy campaigns → they stay founder-approved (Step 0). The digest anchors the proof receipt.
   */
  privateCorpus: text("private_corpus", { mode: "json" }).$type<{ source: string; text: string }[]>(),
  privateCorpusDigest: text("private_corpus_digest"),
  /** distinct SOURCES in the pinned key — the campaign-eligibility signal (thin key → founder-only). */
  privateCorpusSources: integer("private_corpus_sources").notNull().default(0),
  /**
   * P23 — Sage's OWN exploration breadth, so the board can show "Sage explored this product itself:
   * N screens, M elements". Persisted at attach (+ re-pin) from the field-test summary — screens =
   * states/pages Sage reached, elements = distinct UI things it saw. 0 = unknown/not explored (hide it).
   */
  exploredScreens: integer("explored_screens").notNull().default(0),
  exploredElements: integer("explored_elements").notNull().default(0),
  vaultAddress: text("vault_address").notNull(),
  /**
   * The network this campaign settles on, by chainId. Default 59902 (Metis
   * Sepolia) so every existing campaign stays on testnet; 2345 = GOAT mainnet
   * (real USDC). Reads/writes resolve their network from this via the chain
   * registry (src/lib/deputy/networks.ts).
   */
  chainId: integer("chain_id").notNull().default(59902),
  posterWallet: text("poster_wallet").notNull(),
  /** true when Sage owns/operates the vault (sponsored campaigns). */
  ownerIsSage: integer("owner_is_sage", { mode: "boolean" })
    .notNull()
    .default(false),
  /** 'draft' | 'live' | 'paused' | 'completed'. */
  status: text("status").notNull().default("draft"),
  /**
   * The standing mandate. 'manual' (default): the poster confirms every payout.
   * 'autopilot': the Deputy auto-pays submissions its LLM brain verifies, inside
   * the vault's enforced policy. The vault still decides whether money can move.
   */
  autonomy: text("autonomy").$type<"manual" | "autopilot">().notNull().default("manual"),
  /** Autopilot pays only when the LLM confidence is >= this (0..1). */
  autopilotThreshold: real("autopilot_threshold").notNull().default(0.85),
  /**
   * Optional public Telegram chat the poster wants settle/blocked announces sent
   * to (outbound only — see src/lib/telegram). Null = no announce. It carries
   * only public campaign facts (title, amount, recipient, proof link); nothing
   * session-gated is ever posted to it.
   */
  announceChatId: text("announce_chat_id"),
  /**
   * A sandbox campaign exists ONLY to run the public "try to jailbreak the Deputy"
   * pipeline. It can NEVER settle: `settleSubmission` throws for it, the autonomy
   * pipeline early-returns before any spend, and its decisions are excluded from
   * the reputation + /agents stats. Payment is structurally unreachable, not just
   * unlikely.
   */
  sandbox: integer("sandbox", { mode: "boolean" }).notNull().default(false),
  /** which vault contract backs this campaign — legacy rows default to policy_v1. */
  vaultKind: text("vault_kind").$type<VaultKind>().notNull().default("policy_v1"),
  /** V2: the on-chain campaign identity hash (bytes32 hex), else null. */
  campaignIdHash: text("campaign_id_hash"),
  /** V2: the immutable on-chain mission-plan digest (bytes32 hex), else null. */
  missionPlanDigest: text("mission_plan_digest"),
  /**
   * V2: the settlement token (ERC-20 address) the founder deployed the vault with,
   * recorded INDEPENDENTLY at campaign creation from the chain's configured token —
   * NEVER read back from the vault. The DB↔chain agreement compares this against the
   * vault's on-chain token so a vault created with the wrong token fails closed. Null
   * on V1 rows (V1 uses the vault's own policy token, unchanged).
   */
  settlementToken: text("settlement_token"),
  /** which DecisionCommitment version this campaign settles under (1 = V1, 2 = V2). */
  commitmentVersion: integer("commitment_version").notNull().default(1),
  /**
   * Phase 3 — the immutable VerificationPolicyV1 bound to this campaign's approved plan (one MissionProbeV1 per
   * action mission). NULL on every campaign that has no action-replay policy (byte-identical to before). This
   * is an ADDITIONAL off-chain restriction the payout action-replay (Phase 4) enforces; it can only REDUCE
   * settlement eligibility, never expand it. The on-chain budget/mission commitment is unchanged.
   */
  verificationPolicy: text("verification_policy", { mode: "json" }).$type<unknown>(),
  /** Phase 3 — sha256 of the bound policy (tamper check); recomputed at settlement, must match. */
  verificationPolicyDigest: text("verification_policy_digest"),
  /** Phase 3 (v2) — the attached policy version, the "autonomous payout requires coverage" marker, and the
   *  approved plan revision that supplied it. Write-once: only an approved current revision may attach, once. */
  verificationPolicyVersion: text("verification_policy_version"),
  verificationPolicyRequired: integer("verification_policy_required", { mode: "boolean" }).notNull().default(false),
  policySourceRevisionNumber: integer("policy_source_revision_number"),
  createdAt: integer("created_at").notNull(),
});

/**
 * A participant submission. Deduped two ways at the DB level: one submission per
 * (campaign, wallet) via the deterministic dedupe_key, and one per (campaign,
 * evidence_url) so the same proof can't be reused across wallets.
 */
export const submissions = sqliteTable(
  "submissions",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    wallet: text("wallet").notNull(),
    evidenceUrl: text("evidence_url"),
    note: text("note"),
    /** V2: the mission (bytes32 hex) this submission targets, else null (legacy). */
    missionIdHash: text("mission_id_hash"),
    /** V2: the MissionSpecV1 digest this submission was captured against (integrity anchor). */
    missionSpecDigest: text("mission_spec_digest"),
    /**
     * Uniqueness key: for a V2 mission submission this is mission-scoped
     * (keccak(missionIdHash + ':' + lowercased wallet)) so one wallet pays at most once
     * PER MISSION; for a V1 submission it is campaign-scoped. One column, one unique
     * index — V1 and V2 keys never collide, so V1 semantics are unchanged.
     */
    dedupeKey: text("dedupe_key").notNull(),
    /** 'pending' | 'approved' | 'rejected' | 'paid' | 'blocked'. */
    status: text("status").notNull().default("pending"),
    rejectReason: text("reject_reason"),
    /** settling/blocking tx hash once decided on-chain. */
    payoutTx: text("payout_tx"),
    decidedAt: integer("decided_at"),
    createdAt: integer("created_at").notNull(),
    /**
     * P20 retry-while-held: how many times this OBSERVATION submission has been judged (1..3). A held,
     * not-yet-final observation submission can be revised in place — the latest attempt SUPERSEDES (still
     * one row, one payout per wallet). createdAt stays the ORIGINAL time so causal near-dup is stable.
     */
    attempt: integer("attempt").notNull().default(1),
  },
  (t) => [
    uniqueIndex("sub_dedupe_unq").on(t.dedupeKey),
    // NULL evidence_url rows don't collide (SQLite treats NULLs as distinct).
    uniqueIndex("sub_evidence_unq").on(t.campaignId, t.evidenceUrl),
  ],
);

/** The real events that form a Deputy's work journal (§2d) — never fabricated. */
export type EventKind =
  | "campaign_created"
  | "submission_received"
  | "submission_approved"
  | "submission_rejected"
  | "vendor_queued"
  | "vendor_allowlisted"
  | "settled"
  | "blocked"
  | "revoked"
  | "decision_recorded"
  | "autopay_settled"
  | "autopay_held"
  | "fee_settled"
  | "fee_pending";

/**
 * An append-only log of things that actually happened. Every row is emitted at
 * the moment its action occurs (a submission arrives, a spend settles on-chain),
 * so the journal is a replay of real work, not decoration.
 */
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    submissionId: text("submission_id"),
    kind: text("kind").$type<EventKind>().notNull(),
    /** a short human detail (a wallet, a reason) — already composed. */
    detail: text("detail"),
    /** on-chain tx for settled / blocked / vendor_queued / vendor_allowlisted. */
    txHash: text("tx_hash"),
    /** log index within the tx — set for chain-reconciled rows (idempotency). */
    logIndex: integer("log_index"),
    /** the vault an on-chain event was read from — set for chain-reconciled rows. */
    vaultAddress: text("vault_address"),
    /** reward in USDC base units (6dp) for settled / blocked. */
    amount: integer("amount"),
    /** SpendRejected.failedCheckIndex (1..6) for blocked. */
    failedCheckIndex: integer("failed_check_index"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("events_campaign_idx").on(t.campaignId, t.createdAt),
    // Chain-reconciled events dedupe by (tx, logIndex). App events leave both
    // NULL (SQLite treats NULLs as distinct), so they never collide here.
    uniqueIndex("events_chain_unq").on(t.txHash, t.logIndex),
  ],
);

/**
 * Per-vault reconciliation cursor: the last block whose vendor events have been
 * folded into the journal. Lets us read the chain incrementally instead of
 * rescanning from genesis on every page load.
 */
export const vaultCursors = sqliteTable("vault_cursors", {
  vaultAddress: text("vault_address").primaryKey(),
  lastBlock: integer("last_block").notNull().default(0),
});

/**
 * The Deputy's verification receipt for one submission — a verifiable record of
 * how the eligibility call was reached: which engine (llm | heuristic), which
 * model, the model's brief (criteria/fraud/recommendation/summary as json), the
 * sha256 of the evidence it read, latency and estimated cost. One per submission
 * (unique). Advisory only: the human still approves, and the vault still enforces.
 */
export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    /** 'llm' | 'heuristic'. */
    engine: text("engine").notNull(),
    /** the model id when engine = 'llm', else null. */
    model: text("model"),
    /** the judgment (criteria / fraud / recommendation / reasonCode / summary) + the deciding provider. */
    brief: text("brief", { mode: "json" }).$type<StoredBrief>().notNull(),
    /**
     * P16 SHADOW LOG — the observation-mode "would-have-autopaid" record (counts + scalars only, never
     * a matched string), persisted on EVERY observation submission while OBSERVATION_AUTOPAY is off, so
     * the bar's N-values calibrate against real data before the flag is ever armed. Null on url-verifiable
     * decisions and legacy rows. Its shape is `ObservationShadow` (src/lib/deputy/observation-judge.ts).
     */
    observationShadow: text("observation_shadow", { mode: "json" }).$type<Record<string, unknown>>(),
    /** sha256 of the fetched evidence bytes (provenance), or null. */
    contentSha256: text("content_sha256"),
    evidenceOk: integer("evidence_ok", { mode: "boolean" }).notNull().default(false),
    latencyMs: integer("latency_ms"),
    /** estimated USD cost of the LLM call (fraction of a cent), or null. */
    costUsd: real("cost_usd"),
    /** RAIL 1: the real GOAT x402 tx that paid for this verification, or null. */
    x402PaymentTx: text("x402_payment_tx"),
    /** RAIL 1 status: paid | live_fallback | not_configured | not_required | legacy_unknown (null on pre-model rows). */
    x402Status: text("x402_status"),
    /** sanitized failure reason code when status = live_fallback, else null. */
    x402Reason: text("x402_reason"),
    /** which DecisionCommitment version produced this decision (1 = V1, 2 = V2). */
    commitmentVersion: integer("commitment_version").notNull().default(1),
    /** V2: the mission (bytes32 hex) this decision authorized, else null. */
    missionIdHash: text("mission_id_hash"),
    /** V2: the MissionSpecV1 digest this decision judged against (integrity anchor). */
    missionSpecDigest: text("mission_spec_digest"),
    /** V2 recovery: the vault kind this decision settles under, else null (legacy = policy_v1). */
    vaultKind: text("vault_kind").$type<VaultKind>(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("decisions_submission_unq").on(t.submissionId)],
);

/**
 * RAIL 2 — the operator fee owed to the Sage merchant per settled payout. One row
 * per settle tx (unique). 'pending' until a REAL GOAT x402 payment lands (or
 * forever, honestly, until merchant creds arrive); 'settled' carries the real
 * paymentTx. Nothing here ever displays a fee that didn't move on-chain.
 */
export const fees = sqliteTable(
  "fees",
  {
    id: text("id").primaryKey(),
    /** the payout tx this fee follows. */
    settleTx: text("settle_tx").notNull(),
    campaignId: text("campaign_id"),
    submissionId: text("submission_id"),
    /** fee amount in USDC base units (6dp) — 0.1 USDC = 100000. */
    amountBase: integer("amount_base").notNull(),
    /** 'pending' | 'settled'. */
    status: text("status").notNull().default("pending"),
    /** the real GOAT x402 fee payment tx, set only when settled. */
    paymentTx: text("payment_tx"),
    orderId: text("order_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("fees_settle_unq").on(t.settleTx)],
);

/** The lifecycle of one durable settlement attempt. */
export type SettlementStatus =
  | "prepared" // row written, nothing signed or sent yet — safe to broadcast fresh
  | "broadcasting" // sender+nonce+calldata persisted; a tx MAY be in flight — AMBIGUOUS, never blind-resend
  | "broadcast" // the tx hash is durably known; read that tx, never re-send
  | "settled" // Settled event decoded — money moved
  | "rejected" // Rejected event decoded — a policy check blocked it
  | "failed"; // an unexpected error (RPC/revert) — resume via on-chain reconciliation, never blind-resend

/**
 * A crash-recoverable ledger of on-chain payout attempts. Exactly ONE row per
 * `payoutIntentHash` (unique) — the same key the vault consumes for replay
 * protection (check 7). The row is written BEFORE the tx is broadcast and its
 * `txHash` is persisted the instant the tx is sent, so a crash between broadcast
 * and receipt is recoverable: on resume we read that tx's receipt (or the vault's
 * `isIntentUsed`) instead of blind-resending. This table is the app-side twin of
 * the on-chain replay guard: the chain guarantees an intent settles at most once,
 * and this guarantees we always learn which way it went.
 */
export const settlementAttempts = sqliteTable(
  "settlement_attempts",
  {
    id: text("id").primaryKey(),
    /** The vault's replay-protected intent hash — the natural key (one attempt per intent). */
    payoutIntentHash: text("payout_intent_hash").notNull(),
    /** The decision digest this intent was derived from, or null for a legacy intent. */
    decisionDigest: text("decision_digest"),
    /** which DecisionCommitment version this attempt settles under (1 = V1, 2 = V2). */
    commitmentVersion: integer("commitment_version").notNull().default(1),
    /** V2: the mission (bytes32 hex) this payout targets, else null. */
    missionIdHash: text("mission_id_hash"),
    /** the vault kind this attempt settles against (policy_v1 | campaign_v2). */
    vaultKind: text("vault_kind").$type<VaultKind>().notNull().default("policy_v1"),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    chainId: integer("chain_id").notNull(),
    vaultAddress: text("vault_address").notNull(),
    recipient: text("recipient").notNull(),
    /** payout amount in USDC base units (6dp). */
    amountBase: integer("amount_base").notNull(),
    status: text("status").$type<SettlementStatus>().notNull().default("prepared"),
    /** the requestSpend tx — persisted the instant it is broadcast, before the receipt. */
    txHash: text("tx_hash"),
    /**
     * BROADCAST IDENTITY (V2) — persisted the instant we enter `broadcasting`, BEFORE
     * the tx is submitted, so a crash while the RPC may have accepted a tx is durable.
     * On recovery of an ambiguous broadcast we never blind-resend: we reconcile by the
     * intent's on-chain events, and only re-broadcast when the reserved `nonce` is
     * provably unused (no tx was accepted). Null on V1 attempts + pre-existing rows.
     */
    senderAddress: text("sender_address"),
    /** the operator nonce reserved for this broadcast (used-nonce ⟺ a tx was accepted). */
    broadcastNonce: integer("broadcast_nonce"),
    /** keccak256 of the exact requestPayout calldata (diagnostic + tamper check). */
    calldataHash: text("calldata_hash"),
    /** unix seconds the broadcast was attempted (staleness / operator triage). */
    broadcastAt: integer("broadcast_at"),
    /** SpendRejected.failedCheckIndex (1..7) when status = 'rejected'. */
    failedCheckIndex: integer("failed_check_index"),
    /** the last error string when status = 'failed' (diagnostics only). */
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("settlement_attempts_intent_unq").on(t.payoutIntentHash)],
);

/**
 * A mission within a campaign_v2 campaign — the founder-approved unit of paid work.
 * Its `missionIdHash` is the exact bytes32 the CampaignVault stores; `rewardAmount`
 * and `maxCompletions` mirror the immutable on-chain mission. The mission-generation
 * AI populates these in a later pass; for now the domain model + validated creation
 * exist so V2 can be exercised. Legacy (policy_v1) campaigns have no missions.
 */
export const missions = sqliteTable(
  "missions",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    /** stable public mission id (human-facing, stable across edits). */
    missionKey: text("mission_key").notNull(),
    /** the bytes32 (hex) mission id the CampaignVault enforces. */
    missionIdHash: text("mission_id_hash").notNull(),
    title: text("title").notNull(),
    descriptionMd: text("description_md").notNull().default(""),
    /** MissionSpecV1: a concise tester-facing objective. */
    objective: text("objective").notNull().default(""),
    /** MissionSpecV1: step-by-step instructions the tester follows. */
    instructions: text("instructions").notNull().default(""),
    /** MissionSpecV1: the target surface or URL the mission is performed against. */
    targetSurface: text("target_surface").notNull().default(""),
    /** ordered acceptance criteria. */
    criteria: text("criteria", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    /**
     * P16 verifiability class — a MONEY GATE, not just a label: "url-verifiable" work Sage can confirm
     * from a public URL + quoted text (auto-payable); "observation-based" work Sage can only judge
     * against its own private eyes (never auto-paid without OBSERVATION_AUTOPAY + a confident match —
     * held for the founder otherwise). Default is the SAFE side: an unclassified/legacy mission holds.
     */
    verifiabilityClass: text("verifiability_class").$type<"url-verifiable" | "observation-based">().notNull().default("observation-based"),
    /** legacy single free-text evidence requirement (V1-era), or null. */
    evidenceRequirements: text("evidence_requirements"),
    /** MissionSpecV1: ordered evidence requirements. */
    evidenceList: text("evidence_list", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    /** exact reward in token base units (6dp) — mirrors the on-chain mission. */
    rewardAmount: integer("reward_amount").notNull(),
    /** max paid completions — mirrors the on-chain mission cap. */
    maxCompletions: integer("max_completions").notNull(),
    status: text("status").$type<MissionStatus>().notNull().default("active"),
    displayOrder: integer("display_order").notNull().default(0),
    /** the canonical MissionSpecV1 digest — the app-level integrity record of the prose. */
    specDigest: text("spec_digest"),
    /** the public mission id this mission is a revision of (a material edit → new mission). */
    revisionOf: text("revision_of"),
    /** unix seconds the mission plan was locked (economic fields become immutable). */
    lockedAt: integer("locked_at"),
    /** unix seconds the mission was closed, or null. */
    closedAt: integer("closed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("missions_campaign_key_unq").on(t.campaignId, t.missionKey),
    uniqueIndex("missions_campaign_hash_unq").on(t.campaignId, t.missionIdHash),
    index("missions_campaign_idx").on(t.campaignId, t.displayOrder),
  ],
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type CampaignEvent = typeof events.$inferSelect;
export type NewCampaignEvent = typeof events.$inferInsert;
export type VaultCursor = typeof vaultCursors.$inferSelect;
export type NewVaultCursor = typeof vaultCursors.$inferInsert;
export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;
export type Fee = typeof fees.$inferSelect;
export type NewFee = typeof fees.$inferInsert;
export type SettlementAttempt = typeof settlementAttempts.$inferSelect;
export type NewSettlementAttempt = typeof settlementAttempts.$inferInsert;
export type Mission = typeof missions.$inferSelect;
export type NewMission = typeof missions.$inferInsert;

/**
 * A named advisory lock with an expiry — the singleton guard for the Deputy
 * sweep so overlapping cron ticks (or a cron + a dev watcher) don't run the
 * pipeline over the same submissions at once. Same shape idea as vault_cursors:
 * one row per lock name, stolen only once expired.
 */
export const locks = sqliteTable("locks", {
  name: text("name").primaryKey(),
  /** unix seconds until which the lock is held. */
  expiresAt: integer("expires_at").notNull(),
});

export type Lock = typeof locks.$inferSelect;

export type InspectionStatus =
  | "queued"
  | "fetching"
  | "field_test"
  | "mapping"
  | "analyzing"
  | "generating_missions"
  | "reviewing"
  | "ready"
  | "needs_input"
  | "failed"
  | "superseded";

/**
 * A durable founder-launch inspection job — Sage inspects a real product and generates
 * a product-specific mission plan. The status reflects REAL persisted work (updated as
 * the pipeline enters each stage), never a timer. Provenance is stored so an inspection
 * is reproducible; provider secrets + raw credentials are NEVER stored. `idempotencyKey`
 * makes a repeated create a no-op instead of a duplicate job/model run.
 */
export const inspectionJobs = sqliteTable(
  "inspection_jobs",
  {
    id: text("id").primaryKey(),
    /** the founder/session identity that owns this job. */
    founderWallet: text("founder_wallet").notNull(),
    /** de-dupes repeated create requests (founder + normalized url + budget hash). */
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").$type<InspectionStatus>().notNull().default("queued"),
    /** the public campaign id frozen for this plan (the DB id + slug on approval). */
    publicCampaignId: text("public_campaign_id").notNull(),
    /** normalized product URL. */
    productUrl: text("product_url").notNull(),
    repoUrl: text("repo_url"),
    goal: text("goal").notNull().default(""),
    targetUsers: text("target_users").notNull().default(""),
    totalBudgetBase: integer("total_budget_base").notNull(),
    tokenDecimals: integer("token_decimals").notNull().default(6),
    pagesInspected: integer("pages_inspected").notNull().default(0),
    repoFilesInspected: integer("repo_files_inspected").notNull().default(0),
    /** the canonical ProductMapV1 digest (hex), when mapped. */
    productMapDigest: text("product_map_digest"),
    model: text("model"),
    provider: text("provider"),
    promptVersion: text("prompt_version"),
    /** the current plan revision (each material edit bumps it). */
    revision: integer("revision").notNull().default(0),
    /** the whole LaunchResult (map + brain + allocation + plan), JSON. bigints→strings. */
    result: text("result", { mode: "json" }).$type<unknown>(),
    /** a sanitized failure reason (never a stack or secret). */
    failureReason: text("failure_reason"),
    retryCount: integer("retry_count").notNull().default(0),
    /** sha256 of the founder input + the produced plan (integrity/observability). */
    inputDigest: text("input_digest"),
    outputDigest: text("output_digest"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("inspection_jobs_idem_unq").on(t.idempotencyKey),
    index("inspection_jobs_owner_idx").on(t.founderWallet, t.createdAt),
  ],
);

export type InspectionJob = typeof inspectionJobs.$inferSelect;
export type NewInspectionJob = typeof inspectionJobs.$inferInsert;

/**
 * A durable, immutable-once-approved plan revision. The generated plan is revision 1;
 * every founder edit / rebalance / regeneration creates a NEW revision (prior ones stay
 * readable). Exactly one revision may be the active APPROVED one. The full canonical
 * MissionPlanV1 snapshot lives in `planJson` (it already carries campaignIdHash,
 * missionIdHashes, specDigests, missionPlanDigest, and exact economics), so approval is
 * a transactional flag on an immutable snapshot — never a client boolean.
 */
export const planRevisions = sqliteTable(
  "plan_revisions",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull().references(() => inspectionJobs.id),
    revisionNumber: integer("revision_number").notNull(),
    parentRevisionId: text("parent_revision_id"),
    authorWallet: text("author_wallet").notNull(),
    /** why this revision exists: "generated" | "edit" | "rebalance" | "regenerate". */
    reason: text("reason").notNull().default("generated"),
    productMapDigest: text("product_map_digest"),
    /** the complete canonical MissionPlanV1 snapshot (bigints as strings), JSON. */
    planJson: text("plan_json", { mode: "json" }).$type<unknown>().notNull(),
    budgetBase: integer("budget_base").notNull(),
    validationOk: integer("validation_ok", { mode: "boolean" }).notNull().default(true),
    campaignIdHash: text("campaign_id_hash").notNull(),
    missionPlanDigest: text("mission_plan_digest").notNull(),
    model: text("model"),
    provider: text("provider"),
    /** unix seconds this revision was approved (immutable thereafter), or null. */
    approvedAt: integer("approved_at"),
    approverWallet: text("approver_wallet"),
    /** the immutable approval record (canonical hashes + provenance), JSON, when approved. */
    approvalRecord: text("approval_record", { mode: "json" }).$type<unknown>(),
    /**
     * Phase 2 — the VerificationPolicyV2 bound to THIS revision (not sourced from mutable job.result at
     * approval). NULL when the plan has no action-replay policy. `verificationPolicyRequired` is the explicit
     * marker that autonomous payout MUST have complete replay coverage for this plan.
     */
    verificationPolicy: text("verification_policy", { mode: "json" }).$type<unknown>(),
    verificationPolicyDigest: text("verification_policy_digest"),
    verificationPolicyRequired: integer("verification_policy_required", { mode: "boolean" }).notNull().default(false),
    /** bounded grounded provenance bound to the revision (architect/critic models+providers+contract versions). */
    groundedProvenance: text("grounded_provenance", { mode: "json" }).$type<unknown>(),
    /** unix seconds this revision was superseded by a newer one, or null. */
    supersededAt: integer("superseded_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("plan_revisions_job_num_unq").on(t.jobId, t.revisionNumber),
    index("plan_revisions_job_idx").on(t.jobId, t.revisionNumber),
  ],
);

export type PlanRevision = typeof planRevisions.$inferSelect;
export type NewPlanRevision = typeof planRevisions.$inferInsert;

/**
 * A durable founder-vault deployment. Turns an APPROVED plan revision into a real, funded,
 * founder-owned CampaignVaultV2 through the product. It is the refresh-safe state of the
 * whole deploy flow: the `state` enum (see deployment-machine.ts) is the single source of
 * progress; the per-step tx hashes are WRITE-ONCE (a step with a hash is polled, never
 * re-broadcast); and once a vault exists on-chain a stall routes to `recovery_required`,
 * never a second deploy. The founder's wallet signs every tx — the server stores hashes +
 * the founder's EIP-712 claim signature, never a private key. Exactly one non-terminal
 * deployment may exist per (jobId, revisionId).
 */
export const deployments = sqliteTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull().references(() => inspectionJobs.id),
    /** the approved plan revision this deploys (immutable economic binding). */
    revisionId: text("revision_id").notNull().references(() => planRevisions.id),
    revisionNumber: integer("revision_number").notNull(),
    /** the claimed founder wallet (vault owner / msg.sender). */
    founderWallet: text("founder_wallet").notNull(),
    /** testnet only this pass — hard-asserted 59902. */
    chainId: integer("chain_id").notNull(),
    /** the durable state machine position. */
    state: text("state").notNull().default("prepared"),
    /** the frozen deploy parameters (addresses + limits), JSON. */
    settings: text("settings", { mode: "json" }).$type<unknown>().notNull(),
    /** the canonical identity this deployment is bound to (fail-closed at resume). */
    campaignIdHash: text("campaign_id_hash").notNull(),
    missionPlanDigest: text("mission_plan_digest").notNull(),
    calldataDigest: text("calldata_digest").notNull(),
    totalBudgetBase: integer("total_budget_base").notNull(),
    /** the CREATE2-predicted vault address (before deploy). */
    predictedVault: text("predicted_vault").notNull(),
    /** the ACTUAL vault address emitted by the create receipt (must equal predicted). */
    deployedVault: text("deployed_vault"),
    /** the founder's single-use EIP-712 claim nonce + signature (proof of ownership). */
    claimNonce: text("claim_nonce"),
    claimSignature: text("claim_signature"),
    /** write-once tx hashes — presence = "already broadcast, poll don't resend". */
    createTx: text("create_tx"),
    approveTx: text("approve_tx"),
    fundTx: text("fund_tx"),
    activateTx: text("activate_tx"),
    /** the campaign row id once the verified vault is atomically attached (=> live). */
    attachedCampaignId: text("attached_campaign_id"),
    /** a sanitized failure/recovery reason (never a stack or secret). */
    failureReason: text("failure_reason"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("deployments_job_idx").on(t.jobId, t.createdAt),
    index("deployments_revision_idx").on(t.revisionId),
  ],
);

export type Deployment = typeof deployments.$inferSelect;
export type NewDeployment = typeof deployments.$inferInsert;

/**
 * A founder's agent-wallet binding — the state that lets the Telegram agent spend for them. Their
 * chat is linked (via SIWE) to a Privy server wallet the agent signs through, guarded by a standing
 * mandate (a Privy policy). One row per founder chat. The Privy wallet is the on-chain "founder
 * wallet": it owns + funds the campaigns it creates (msg.sender), exactly as the founder's browser
 * wallet does on the web app; the founder's real, SIWE-proven address is the only reclaim
 * destination the mandate allows.
 */
export const agentWallets = sqliteTable("agent_wallets", {
  /** the Telegram chat id — the founder's session key. */
  chatId: text("chat_id").primaryKey(),
  /** the founder's real wallet, proven via SIWE — the sole reclaim destination. */
  founderAddress: text("founder_address").notNull(),
  /** the Privy server wallet the agent signs through (msg.sender / vault owner). */
  privyWalletId: text("privy_wallet_id").notNull(),
  privyWalletAddress: text("privy_wallet_address").notNull(),
  /** the attached Privy policy id = the standing mandate. */
  policyId: text("policy_id").notNull(),
  /** max USDC (base units, 6dp) the agent may spend on a single campaign. */
  perCampaignCapBase: integer("per_campaign_cap_base").notNull(),
  chainId: integer("chain_id").notNull().default(2345),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type AgentWallet = typeof agentWallets.$inferSelect;
export type NewAgentWallet = typeof agentWallets.$inferInsert;

/**
 * Durable per-chat memory for the Telegram concierge. The conversational agent used to keep history
 * only in-process, so any restart (a deploy) wiped a founder's thread mid-conversation — after which
 * a bare "launch" had no context and the model could wander (e.g. inspect a hallucinated URL).
 * Persisting the short rolling history here makes the agent survive restarts.
 */
export const conciergeChats = sqliteTable("concierge_chats", {
  /** the Telegram chat id. */
  chatId: text("chat_id").primaryKey(),
  /** the rolling ChatMessage[] history, JSON-encoded (already trimmed to the last N turns). */
  messagesJson: text("messages_json").notNull().default("[]"),
  updatedAt: integer("updated_at").notNull(),
});

export type ConciergeChat = typeof conciergeChats.$inferSelect;

/**
 * A prepared-but-unconfirmed withdrawal from a founder's agent wallet. `sage_request_withdrawal`
 * stores the exact amount + recipient here (server-side, NOT in the model's hands); a matching
 * `sage_confirm_withdrawal` consumes it EXACTLY ONCE and sends. Durable so a pm2 restart between
 * request and confirm no longer drops it. One pending per chat — a fresh request replaces the old.
 */
export const pendingWithdrawals = sqliteTable("pending_withdrawals", {
  chatId: text("chat_id").primaryKey(),
  /** USDC base units (6dp), bigint as string. */
  amountBase: text("amount_base").notNull(),
  toAddress: text("to_address").notNull(),
  /** unix seconds; a confirm after this is rejected as expired. */
  expiresAt: integer("expires_at").notNull(),
  /** one-shot guard: set true when confirmed so a retry can never double-send. */
  consumed: integer("consumed", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export type PendingWithdrawalRow = typeof pendingWithdrawals.$inferSelect;

/**
 * Phase 5 — payout ACTION-REPLAY journal. One row per (submissionId, policyDigest, probeDigest): the
 * idempotency key. A COMPLETED row (completedAt set) is reused on a payout retry with the SAME digests; a
 * changed policy/probe is a different key → a fresh replay; an in-flight row (completedAt null) is an
 * ambiguous crash that must be reconciled (re-run — replay is read-only) before any settlement retry. Stores
 * only identifiers/digests + bounded outcome + timings — NEVER raw page text, screenshots, cookies, or prompts.
 * Replay never settles, so it can never cause a duplicate payout; the vault intentHash/CAS still guard money.
 */
export const payoutReplayJournal = sqliteTable(
  "payout_replay_journal",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id").notNull(),
    policyDigest: text("policy_digest").notNull(),
    probeDigest: text("probe_digest").notNull(),
    /** "allow" | "hold" (the settlement-facing decision for this probe), or null while in-flight. */
    decision: text("decision"),
    /** bounded PayoutReplayCode; null while in-flight. */
    outcomeCode: text("outcome_code"),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
    latencyMs: integer("latency_ms"),
    attempt: integer("attempt").notNull().default(1),
    /** the probe/browser runner version (for cache invalidation across runner changes). */
    probeVersion: text("probe_version").notNull().default("mission-probe-v1"),
    /** P4 — the ACTIVE lease id. begin() mints a fresh runId; complete() CAS-updates only while it matches, so
     *  a superseded/late completion of an older run can never overwrite the current one. */
    runId: text("run_id"),
  },
  (t) => [uniqueIndex("prj_key_unq").on(t.submissionId, t.policyDigest, t.probeDigest)],
);

export type PayoutReplayJournalRow = typeof payoutReplayJournal.$inferSelect;
