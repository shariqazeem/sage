-- PERSON IDENTITIES (20 Nov 2026, the tester door). A sign-in account a wallet's owner proved on the server:
-- Google or X through Privy's verified user record, or the Telegram chat a chat wallet belongs to. One
-- account is one person: the primary key binds a subject to the first wallet that presented it, and a
-- second wallet presenting it is linked to the first (wallet_links, origin "personhood"), never counted as
-- a second person. src/lib/db/person-identities.ts.
CREATE TABLE IF NOT EXISTS `person_identities` (
  `provider` text NOT NULL,
  `subject` text NOT NULL,
  `wallet_key` text NOT NULL,
  `wallet` text NOT NULL,
  `display` text,
  `created_at` integer NOT NULL,
  PRIMARY KEY(`provider`, `subject`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `person_identities_wallet_idx` ON `person_identities` (`wallet_key`);
