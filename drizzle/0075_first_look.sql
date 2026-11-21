-- SAGE'S FIRST LOOK (the core, 21 Nov 2026). What Sage itself noticed while it tried a product: the
-- trail, the evidence, each problem with a fix, the comprehension read. One row per inspection.
-- src/lib/first-look/.
CREATE TABLE IF NOT EXISTS `first_looks` (
  `inspection_id` text PRIMARY KEY NOT NULL,
  `json` text NOT NULL,
  `engine` text NOT NULL,
  `built_at` integer NOT NULL
);
--> statement-breakpoint
-- WHAT A TESTER TAPPED on the core mission: how far they got, and whether they would use it again.
-- Counted by the report; never read or written by a model. src/lib/core-test/.
CREATE TABLE IF NOT EXISTS `core_answers` (
  `submission_id` text PRIMARY KEY NOT NULL,
  `campaign_id` text NOT NULL,
  `reached` text NOT NULL,
  `again` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `core_answers_campaign_idx` ON `core_answers` (`campaign_id`);
