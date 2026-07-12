CREATE TABLE `deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`founder_wallet` text NOT NULL,
	`chain_id` integer NOT NULL,
	`state` text DEFAULT 'prepared' NOT NULL,
	`settings` text NOT NULL,
	`campaign_id_hash` text NOT NULL,
	`mission_plan_digest` text NOT NULL,
	`calldata_digest` text NOT NULL,
	`total_budget_base` integer NOT NULL,
	`predicted_vault` text NOT NULL,
	`deployed_vault` text,
	`claim_nonce` text,
	`claim_signature` text,
	`create_tx` text,
	`approve_tx` text,
	`fund_tx` text,
	`activate_tx` text,
	`attached_campaign_id` text,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `inspection_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `plan_revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deployments_job_idx` ON `deployments` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `deployments_revision_idx` ON `deployments` (`revision_id`);