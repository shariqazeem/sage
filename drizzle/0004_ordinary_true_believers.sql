CREATE TABLE `locks` (
	`name` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `campaigns` ADD `autonomy` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `autopilot_threshold` real DEFAULT 0.85 NOT NULL;