-- PEOPLE AND TIME (6 Nov 2026). A job's own link for N people, on every plan (job_links, job_seats), and
-- a programme that runs one approved job every week for the same people (programmes, programme_rounds).
-- src/lib/people/seats.ts, src/lib/programmes/.
CREATE TABLE IF NOT EXISTS `job_links` (
  `code` text PRIMARY KEY NOT NULL,
  `campaign_id` text,
  `programme_id` text,
  `seats` integer NOT NULL,
  `created_by` text NOT NULL,
  `created_at` integer NOT NULL,
  `revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_links_campaign_idx` ON `job_links` (`campaign_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_links_programme_idx` ON `job_links` (`programme_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `job_seats` (
  `scope_id` text NOT NULL,
  `wallet` text NOT NULL,
  `link_code` text NOT NULL,
  `claimed_at` integer NOT NULL,
  `removed_at` integer,
  PRIMARY KEY(`scope_id`, `wallet`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_seats_link_idx` ON `job_seats` (`link_code`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `programmes` (
  `id` text PRIMARY KEY NOT NULL,
  `founder_wallet` text NOT NULL,
  `chain_id` integer NOT NULL,
  `title` text NOT NULL,
  `spec` text NOT NULL,
  `round_budget_base` integer NOT NULL,
  `every_days` integer NOT NULL,
  `rounds_total` integer NOT NULL,
  `next_round_at` integer,
  `status` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `programmes_due_idx` ON `programmes` (`status`, `next_round_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `programme_rounds` (
  `programme_id` text NOT NULL,
  `round` integer NOT NULL,
  `status` text NOT NULL,
  `job_id` text,
  `campaign_id` text,
  `attempts` integer DEFAULT 0 NOT NULL,
  `last_attempt_at` integer,
  `error` text,
  `opened_at` integer,
  `closed_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY(`programme_id`, `round`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `programme_rounds_campaign_idx` ON `programme_rounds` (`campaign_id`);
