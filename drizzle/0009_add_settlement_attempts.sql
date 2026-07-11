CREATE TABLE `settlement_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`payout_intent_hash` text NOT NULL,
	`decision_digest` text,
	`submission_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`chain_id` integer NOT NULL,
	`vault_address` text NOT NULL,
	`recipient` text NOT NULL,
	`amount_base` integer NOT NULL,
	`status` text DEFAULT 'prepared' NOT NULL,
	`tx_hash` text,
	`failed_check_index` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlement_attempts_intent_unq` ON `settlement_attempts` (`payout_intent_hash`);