-- WHAT PEOPLE FOUND (relaunch, 20 Nov 2026). The builder's report for one test: findings grouped from
-- the paid answers, kept so a reader never waits on a model. src/lib/report/.
CREATE TABLE IF NOT EXISTS `campaign_findings` (
  `campaign_id` text PRIMARY KEY NOT NULL,
  `json` text NOT NULL,
  `paid_answers` integer NOT NULL,
  `engine` text NOT NULL,
  `built_at` integer NOT NULL
);
--> statement-breakpoint
-- KEEP ME POSTED. A tester's own consent to hear from this builder, with the one contact they chose
-- to share. Deleting the row withdraws it. Only the test's owner ever reads `contact`.
CREATE TABLE IF NOT EXISTS `keep_posted` (
  `submission_id` text PRIMARY KEY NOT NULL,
  `campaign_id` text NOT NULL,
  `contact_kind` text NOT NULL,
  `contact` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `keep_posted_campaign_idx` ON `keep_posted` (`campaign_id`);
