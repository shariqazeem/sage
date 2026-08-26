-- ARTIFACT TWIN DETECTION (FC Phase 1) — the normalized content hash of a fetched work-proof
-- artifact (addresses stripped, whitespace collapsed), written at decision time. Two submissions
-- in one campaign with the same hash are the marker-swap collusion shape: the same page with only
-- the wallet changed. Nullable: only fetchable work-proof lanes (artifact_url / public_url) set it.
ALTER TABLE submissions ADD `artifact_sha256` text;--> statement-breakpoint
CREATE INDEX `sub_artifact_twin_idx` ON `submissions` (`campaign_id`,`artifact_sha256`);
