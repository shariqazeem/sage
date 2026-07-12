CREATE TABLE `inspection_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`founder_wallet` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`public_campaign_id` text NOT NULL,
	`product_url` text NOT NULL,
	`repo_url` text,
	`goal` text DEFAULT '' NOT NULL,
	`target_users` text DEFAULT '' NOT NULL,
	`total_budget_base` integer NOT NULL,
	`token_decimals` integer DEFAULT 6 NOT NULL,
	`pages_inspected` integer DEFAULT 0 NOT NULL,
	`repo_files_inspected` integer DEFAULT 0 NOT NULL,
	`product_map_digest` text,
	`model` text,
	`provider` text,
	`prompt_version` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`result` text,
	`failure_reason` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`input_digest` text,
	`output_digest` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspection_jobs_idem_unq` ON `inspection_jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `inspection_jobs_owner_idx` ON `inspection_jobs` (`founder_wallet`,`created_at`);