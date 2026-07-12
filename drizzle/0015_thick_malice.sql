CREATE TABLE `plan_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`parent_revision_id` text,
	`author_wallet` text NOT NULL,
	`reason` text DEFAULT 'generated' NOT NULL,
	`product_map_digest` text,
	`plan_json` text NOT NULL,
	`budget_base` integer NOT NULL,
	`validation_ok` integer DEFAULT true NOT NULL,
	`campaign_id_hash` text NOT NULL,
	`mission_plan_digest` text NOT NULL,
	`model` text,
	`provider` text,
	`approved_at` integer,
	`approver_wallet` text,
	`approval_record` text,
	`superseded_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `inspection_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_revisions_job_num_unq` ON `plan_revisions` (`job_id`,`revision_number`);--> statement-breakpoint
CREATE INDEX `plan_revisions_job_idx` ON `plan_revisions` (`job_id`,`revision_number`);