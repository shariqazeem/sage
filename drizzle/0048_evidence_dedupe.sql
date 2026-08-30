-- Evidence uniqueness, scoped to evidence that actually DISTINGUISHES one tester from another.
--
-- The old index was unique(campaign_id, evidence_url): one evidence link per campaign, across every
-- wallet and every mission. That is the right guard when the link is something the TESTER MADE — a
-- page they published, a paste, an artifact carrying their wallet — because reusing one of those
-- across wallets is precisely how a Sybil cluster works.
--
-- It is wrong when the mission's own target IS the link. "Land on this contract page and report
-- what you see" sends every honest tester to the SAME url, so the second one on a two-slot mission
-- was refused for agreeing with the first. REPORTED live: slot 2 could not be taken at all.
--
-- So the key is now NULL whenever the evidence url is the mission's own target surface — SQLite
-- allows many NULLs in a unique index, which is exactly the "does not distinguish anybody"
-- semantics wanted here. The written account still has to be the tester's own: near-duplicate
-- detection judges that, and it is the stronger signal.
DROP INDEX IF EXISTS `sub_evidence_unq`;--> statement-breakpoint
ALTER TABLE submissions ADD `evidence_dedupe_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `sub_evidence_dedupe_unq` ON submissions (`evidence_dedupe_key`);
