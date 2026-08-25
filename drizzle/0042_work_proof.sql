-- WORK PROOF — the verification layer generalizes beyond product testing (docs/work-proof-design.md).
--
-- `missions.verification_contract`: an explicit, operator-authored VerificationContract (JSON, see
-- src/lib/verify/contract.ts) carried from the approved immutable plan revision. NULL on every
-- existing mission → exactly today's behavior (the verifiability-class routing). When present, the
-- judge runs the deterministic verifier as a PRE-gate before any model is consulted.
--
-- `campaigns.kind`: 'testing' (default, all existing rows) | 'grant' | 'gig' — copy/labels only;
-- no economic or settlement behavior keys off it.
--
-- `campaigns.allowlist`: optional JSON array of lowercased wallets. Enforced at the submit route
-- (application-level gate, documented honestly as such); caps/budget/replay stay vault-enforced.
ALTER TABLE missions ADD COLUMN verification_contract TEXT;
--> statement-breakpoint
ALTER TABLE campaigns ADD COLUMN kind TEXT NOT NULL DEFAULT 'testing';
--> statement-breakpoint
ALTER TABLE campaigns ADD COLUMN allowlist TEXT;
