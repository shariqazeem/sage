CREATE TABLE `vault_cursors` (
	`vault_address` text PRIMARY KEY NOT NULL,
	`last_block` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `events` ADD `log_index` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `vault_address` text;--> statement-breakpoint
CREATE UNIQUE INDEX `events_chain_unq` ON `events` (`tx_hash`,`log_index`);