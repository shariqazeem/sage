-- BUILDER UPDATES BY EMAIL (28 Nov 2026). One row per builder who turned email on: the address their own
-- sign-in carries (read on the server from Privy, never typed into a page). Muting keeps the row.
-- Testers are never in this table.
CREATE TABLE IF NOT EXISTS `builder_emails` (
  `founder_key` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `muted_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
