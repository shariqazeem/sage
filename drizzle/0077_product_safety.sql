-- NEVER SEND A TESTER INTO HARM (22 Nov 2026). The product safety screen's record, one row per product (its host, or its page on a shared platform): what
-- it last found, whether the operator was told, and a person's decision. src/lib/safety/.
CREATE TABLE IF NOT EXISTS `product_screens` (
  `subject` text PRIMARY KEY NOT NULL,
  `product_url` text NOT NULL,
  `job_id` text,
  `outcome` text NOT NULL,
  `signals` text NOT NULL,
  `first_seen_at` integer NOT NULL,
  `last_seen_at` integer NOT NULL,
  `alerted_outcome` text,
  `alerted_at` integer,
  `decision` text,
  `decided_at` integer,
  `decision_note` text
);--> statement-breakpoint
-- A test whose product is held for review is never public; null everywhere else, and on every test before this.
ALTER TABLE `campaigns` ADD `safety_hold` text;
