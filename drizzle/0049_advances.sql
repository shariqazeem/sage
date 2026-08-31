-- CAPITAL IN — advances against witnessed inflow, and the waterfall that repays them.
--
-- The transformation layer: third-party capital (first lender, the Sage pot) moves against a
-- record this system verified into existence, and is repaid by splitting each subsequent verified
-- payout's escrow into two claim legs. Terms are stored so /record can show the published
-- arithmetic; Sage computes capacity from a lender-supplied multiple and scores nobody.
CREATE TABLE `advances` (
  `id` text PRIMARY KEY NOT NULL,
  `borrower_wallet` text NOT NULL,
  `principal_base` integer NOT NULL,
  `multiple` real NOT NULL,
  `waterfall_bps` integer NOT NULL,
  `pot_address` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `outstanding_base` integer NOT NULL,
  `disburse_tx` text,
  `disburse_claim_commitment` text,
  `disburse_claim_secret` text,
  `created_at` integer NOT NULL,
  `repaid_at` integer
);--> statement-breakpoint
CREATE INDEX `adv_borrower_idx` ON `advances` (`borrower_wallet`);--> statement-breakpoint
-- ONE ACTIVE ADVANCE PER BORROWER. Stacking advances against the same inflow is how cash-flow
-- lending turns into payday lending; the schema refuses the shape so no code path has to.
CREATE UNIQUE INDEX `adv_active_unq` ON `advances` (`borrower_wallet`) WHERE `status` = 'active';--> statement-breakpoint
CREATE TABLE `advance_repayments` (
  `id` text PRIMARY KEY NOT NULL,
  `advance_id` text NOT NULL,
  `submission_id` text NOT NULL,
  `amount_base` integer NOT NULL,
  `claim_commitment` text NOT NULL,
  `claim_secret` text NOT NULL,
  `escrow_tx` text NOT NULL,
  `created_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `advrep_advance_idx` ON `advance_repayments` (`advance_id`);--> statement-breakpoint
-- A payout splits ONCE: two repayment rows from one submission would mean the waterfall ran twice
-- against the same money.
CREATE UNIQUE INDEX `advrep_submission_unq` ON `advance_repayments` (`submission_id`);
