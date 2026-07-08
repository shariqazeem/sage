CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`submission_id` text,
	`kind` text NOT NULL,
	`detail` text,
	`tx_hash` text,
	`amount` integer,
	`failed_check_index` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_campaign_idx` ON `events` (`campaign_id`,`created_at`);