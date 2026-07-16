CREATE TABLE `concierge_chats` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`messages_json` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL
);
