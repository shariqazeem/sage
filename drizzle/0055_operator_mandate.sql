CREATE TABLE `operator_mandates` (
	`founder_key` text PRIMARY KEY NOT NULL,
	`founder_address` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`product_url` text,
	`goal` text,
	`weekly_cap_base` integer NOT NULL,
	`per_campaign_cap_base` integer NOT NULL,
	`reserve_floor_base` integer DEFAULT 0 NOT NULL,
	`probe_base` integer NOT NULL,
	`max_scale` integer DEFAULT 3 NOT NULL,
	`max_concurrent` integer DEFAULT 3 NOT NULL,
	`max_exposure_bps` integer DEFAULT 6000 NOT NULL,
	`min_spacing_minutes` integer DEFAULT 90 NOT NULL,
	`stall_after_minutes` integer DEFAULT 2880 NOT NULL,
	`min_campaign_base` integer DEFAULT 1000000 NOT NULL,
	`veto_window_minutes` integer DEFAULT 20 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operator_launches` (
	`id` text PRIMARY KEY NOT NULL,
	`founder_key` text NOT NULL,
	`job_id` text,
	`campaign_id` text,
	`surface` text,
	`kind` text NOT NULL,
	`goal` text NOT NULL,
	`decided_by` text DEFAULT 'rules' NOT NULL,
	`budget_base` integer NOT NULL,
	`reason` text NOT NULL,
	`state` text DEFAULT 'proposed' NOT NULL,
	`commit_at` integer NOT NULL,
	`veto_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operator_launches_founder_idx` ON `operator_launches` (`founder_key`,`created_at`);
