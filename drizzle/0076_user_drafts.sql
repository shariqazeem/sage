-- GET YOUR FIRST USERS (21 Nov 2026). The posts a model worded for a builder from a test's counted
-- facts, kept per version of those facts so the wording is paid for once. src/lib/users/.
CREATE TABLE IF NOT EXISTS `user_drafts` (
  `campaign_id` text PRIMARY KEY NOT NULL,
  `version` text NOT NULL,
  `json` text NOT NULL,
  `engine` text NOT NULL,
  `built_at` integer NOT NULL
);
