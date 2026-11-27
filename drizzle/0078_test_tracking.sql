-- SEE EVERYTHING (27 Nov 2026). Who came to a test, where from, and how far they got; where a builder hears
-- about their tests; and the record that makes each message to a builder a single message.
-- No IP address and no user agent is stored: a visitor is the hash of a random first-party cookie.
CREATE TABLE IF NOT EXISTS `test_visits` (
  `campaign_id` text NOT NULL,
  `visitor` text NOT NULL,
  `source` text NOT NULL,
  `wallet` text,
  `first_at` integer NOT NULL,
  `last_at` integer NOT NULL,
  `views` integer DEFAULT 1 NOT NULL,
  `signed_in_at` integer,
  `opened_at` integer,
  PRIMARY KEY(`campaign_id`, `visitor`)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `test_visits_campaign_idx` ON `test_visits` (`campaign_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `builder_channels` (
  `founder_key` text PRIMARY KEY NOT NULL,
  `channel` text NOT NULL,
  `target` text NOT NULL,
  `muted_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `builder_notices` (
  `campaign_id` text NOT NULL,
  `kind` text NOT NULL,
  `sent_at` integer NOT NULL,
  PRIMARY KEY(`campaign_id`, `kind`)
);
