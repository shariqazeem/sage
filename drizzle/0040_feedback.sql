-- FEEDBACK — the shortest path from "something felt wrong" to the operator's phone.
--
-- Anonymous-first by design: no account, no required contact. A founder watching their plan or a
-- tester on the board leaves one textarea of text; the row lands here and a Telegram notification
-- reaches the operator immediately. `inspection_id` ties the words to the exact plan on screen
-- when they were written.
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`contact` text,
	`page` text,
	`inspection_id` text,
	`surface` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feedback_created_idx` ON `feedback` (`created_at`);
