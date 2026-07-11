ALTER TABLE `campaigns` ADD `settlement_token` text;--> statement-breakpoint
ALTER TABLE `settlement_attempts` ADD `sender_address` text;--> statement-breakpoint
ALTER TABLE `settlement_attempts` ADD `broadcast_nonce` integer;--> statement-breakpoint
ALTER TABLE `settlement_attempts` ADD `calldata_hash` text;--> statement-breakpoint
ALTER TABLE `settlement_attempts` ADD `broadcast_at` integer;