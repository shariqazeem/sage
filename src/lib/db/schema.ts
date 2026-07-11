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
    /** keccak256(campaign_id + ':' + lowercased wallet) — one entry per wallet. */
    dedupeKey: text("dedupe_key").notNull(),
    /** 'pending' | 'approved' | 'rejected' | 'paid' | 'blocked'. */
    status: text("status").notNull().default("pending"),
    rejectReason: text("reject_reason"),
    /** settling/blocking tx hash once decided on-chain. */
    payoutTx: text("payout_tx"),
    decidedAt: integer("decided_at"),
    createdAt: integer("created_at").notNull(),
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
    /** sha256 of the fetched evidence bytes (provenance), or null. */
    contentSha256: text("content_sha256"),
    evidenceOk: integer("evidence_ok", { mode: "boolean" }).notNull().default(false),
    latencyMs: integer("latency_ms"),
    /** estimated USD cost of the LLM call (fraction of a cent), or null. */
    costUsd: real("cost_usd"),
    /** RAIL 1: the real GOAT x402 tx that paid for this verification, or null. */
    x402PaymentTx: text("x402_payment_tx"),
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
