-- SAGE ON X (relaunch, 20 Nov 2026). Sage's own X account posts a test's mission and its result when the
-- builder said yes, and replies when someone tags it with a product link. Every post is written here as
-- `drafted` BEFORE it is sent, then posted / skipped / failed with the reason and what it cost.
-- Timestamps are epoch seconds. src/lib/x/.
CREATE TABLE IF NOT EXISTS `x_posts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,
  `subject_key` text NOT NULL,
  `text` text NOT NULL,
  `has_url` integer DEFAULT false NOT NULL,
  `in_reply_to` text,
  `status` text DEFAULT 'drafted' NOT NULL,
  `reason` text,
  `tweet_id` text,
  `cost_micros` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `posted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `x_posts_subject_unq` ON `x_posts` (`subject_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `x_posts_created_idx` ON `x_posts` (`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `x_mentions` (
  `tweet_id` text PRIMARY KEY NOT NULL,
  `author_id` text NOT NULL,
  `author_username` text,
  `author_created_at` integer,
  `text` text NOT NULL,
  `url` text,
  `state` text DEFAULT 'new' NOT NULL,
  `reason` text,
  `started_id` text,
  `created_at` integer NOT NULL,
  `handled_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `x_mentions_state_idx` ON `x_mentions` (`state`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `x_mentions_author_idx` ON `x_mentions` (`author_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `x_mentions_started_idx` ON `x_mentions` (`started_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `x_cursor` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `x_spend` (
  `day` text PRIMARY KEY NOT NULL,
  `cost_micros` integer DEFAULT 0 NOT NULL,
  `calls` integer DEFAULT 0 NOT NULL,
  `updated_at` integer NOT NULL
);
