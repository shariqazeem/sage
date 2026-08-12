-- THE FOUNDER'S TEST ACCOUNT — sealed credentials for signing in to their OWN product during the
-- field test. AES-256-GCM at rest (see test-account-crypto.ts); never logged, never returned by an
-- API, never placed in a prompt, and everything harvested while authenticated is redacted before it
-- can become corpus. This is what makes work behind a login verifiable, and therefore payable.
ALTER TABLE `inspection_jobs` ADD `test_account_sealed` text;
