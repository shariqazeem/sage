CREATE TABLE `pending_withdrawals` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`amount_base` text NOT NULL,
	`to_address` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
