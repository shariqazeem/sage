CREATE TABLE `identity_proofs` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_key` text NOT NULL,
	`wallet` text NOT NULL,
	`provider` text NOT NULL,
	`nullifier` text NOT NULL,
	`level` text,
	`verified_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_wallet_provider_unq` ON `identity_proofs` (`wallet_key`,`provider`);
--> statement-breakpoint
CREATE INDEX `identity_nullifier_idx` ON `identity_proofs` (`provider`,`nullifier`);
