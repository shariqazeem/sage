-- ADVANCES MOVE TO METIS (26 Oct 2026, the founder's decision: one network). The pot is a Metis wallet of
-- its own; an advance is sent straight to the borrower's wallet; repayment is collected from each later
-- verified Metis payout under an allowance the borrower approved once (the Starknet escrow split cannot
-- exist where the vault pays the worker directly). `chain_id` says which rail an advance lives on: every
-- row before this one was Starknet.
ALTER TABLE `advances` ADD `chain_id` integer DEFAULT 900001 NOT NULL;--> statement-breakpoint
-- A Metis repayment is a transferFrom, not a claim leg: it has no commitment or secret, and a payout whose
-- share could not be collected (allowance withdrawn, funds already moved) is recorded with no transaction
-- and a note, so it is considered exactly once. SQLite cannot relax NOT NULL in place, so the table is
-- rebuilt with the same rows and the same two indexes.
CREATE TABLE `advance_repayments_new` (
  `id` text PRIMARY KEY NOT NULL,
  `advance_id` text NOT NULL,
  `submission_id` text NOT NULL,
  `amount_base` integer NOT NULL,
  `claim_commitment` text,
  `claim_secret` text,
  `escrow_tx` text,
  `note` text,
  `created_at` integer NOT NULL
);--> statement-breakpoint
INSERT INTO `advance_repayments_new` (`id`, `advance_id`, `submission_id`, `amount_base`, `claim_commitment`, `claim_secret`, `escrow_tx`, `created_at`)
  SELECT `id`, `advance_id`, `submission_id`, `amount_base`, `claim_commitment`, `claim_secret`, `escrow_tx`, `created_at` FROM `advance_repayments`;--> statement-breakpoint
DROP TABLE `advance_repayments`;--> statement-breakpoint
ALTER TABLE `advance_repayments_new` RENAME TO `advance_repayments`;--> statement-breakpoint
CREATE INDEX `advrep_advance_idx` ON `advance_repayments` (`advance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `advrep_submission_unq` ON `advance_repayments` (`submission_id`);--> statement-breakpoint
-- The pot covers the METIS fee of a borrower's one approval, once per wallet, so a worker paid only in
-- USDC can still approve. Recorded so no wallet is covered twice.
CREATE TABLE `advance_fee_topups` (
  `wallet` text PRIMARY KEY NOT NULL,
  `chain_id` integer NOT NULL,
  `amount_wei` text NOT NULL,
  `tx_hash` text NOT NULL,
  `created_at` integer NOT NULL
);
