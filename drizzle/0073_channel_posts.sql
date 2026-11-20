-- SAGE'S TELEGRAM CHANNEL OF OPEN TESTS (relaunch, 20 Nov 2026). One row per test ever posted to the public
-- channel testers follow, written before it is sent. src/lib/telegram/missions-channel.ts.
CREATE TABLE IF NOT EXISTS `channel_posts` (
  `subject_key` text PRIMARY KEY NOT NULL,
  `chat_id` text NOT NULL,
  `status` text NOT NULL,
  `message_id` integer,
  `reason` text,
  `created_at` integer NOT NULL,
  `posted_at` integer
);
