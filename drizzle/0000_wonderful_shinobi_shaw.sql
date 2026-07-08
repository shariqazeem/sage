CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`criteria` text DEFAULT '[]' NOT NULL,
	`condition_type` text DEFAULT 'approval' NOT NULL,
	`onchain_check` text,
	`reward_amount` integer NOT NULL,
	`max_recipients` integer DEFAULT 0 NOT NULL,
	`vault_address` text NOT NULL,
	`poster_wallet` text NOT NULL,
	`owner_is_sage` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`wallet` text NOT NULL,
	`evidence_url` text,
	`note` text,
	`dedupe_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reject_reason` text,
	`payout_tx` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sub_dedupe_unq` ON `submissions` (`dedupe_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `sub_evidence_unq` ON `submissions` (`campaign_id`,`evidence_url`);