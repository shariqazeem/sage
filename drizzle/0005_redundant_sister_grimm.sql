CREATE TABLE `fees` (
	`id` text PRIMARY KEY NOT NULL,
	`settle_tx` text NOT NULL,
	`campaign_id` text,
	`submission_id` text,
	`amount_base` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payment_tx` text,
	`order_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fees_settle_unq` ON `fees` (`settle_tx`);--> statement-breakpoint
ALTER TABLE `decisions` ADD `x402_payment_tx` text;