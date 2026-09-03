-- SAGE FOR TEAMS: a Pro plan is paid in USDC on chain; each payment's hash is recorded once.
CREATE TABLE `workspace_payments` (
  `tx_hash` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `chain_id` integer NOT NULL,
  `payer` text NOT NULL,
  `amount_base` integer NOT NULL,
  `paid_at` integer NOT NULL,
  `plan_until` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspace_payments_workspace_idx` ON `workspace_payments` (`workspace_id`);
