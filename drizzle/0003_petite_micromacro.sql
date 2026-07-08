CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`engine` text NOT NULL,
	`model` text,
	`brief` text NOT NULL,
	`content_sha256` text,
	`evidence_ok` integer DEFAULT false NOT NULL,
	`latency_ms` integer,
	`cost_usd` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decisions_submission_unq` ON `decisions` (`submission_id`);