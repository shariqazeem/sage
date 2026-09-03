CREATE TABLE `work_alerts` (
	`wallet_key` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`channel` text NOT NULL,
	`target` text NOT NULL,
	`muted_at` integer,
	`last_notified_at` integer,
	`notify_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alert_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
