-- TESTERS HEAR WHAT HAPPENED, AND WHERE BUILDERS COME FROM (28 Nov 2026).
-- Every message a tester on the alerts roster was sent about their own answer, once: (submission, kind).
-- One row with submission_id '__baseline__' marks the first run, which said nothing about the past.
CREATE TABLE IF NOT EXISTS `tester_notices` (
  `submission_id` text NOT NULL,
  `kind` text NOT NULL,
  `sent_at` integer NOT NULL,
  PRIMARY KEY(`submission_id`, `kind`)
);--> statement-breakpoint
-- The first-touch tag a builder arrived with (`?via=tiktok`), kept on the test they started. Null on every
-- test before this and on any paste that carried none. A short word, never an address or a name.
ALTER TABLE `inspection_jobs` ADD `via` text;
