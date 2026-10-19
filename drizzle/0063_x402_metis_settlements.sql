-- x402 ON METIS: one row per Permit2 payment the Metis facilitator settles (src/lib/x402/metis/).
-- Keyed by Permit2's own replay primitive (network:payer:nonce), so the same payment can never be
-- broadcast twice, and every status change is a compare-and-set on the previous status.
CREATE TABLE `x402_metis_settlements` (
  `payment_key` text PRIMARY KEY NOT NULL,
  `network` text NOT NULL,
  `payer` text NOT NULL,
  `nonce` text NOT NULL,
  `asset` text NOT NULL,
  `amount` text NOT NULL,
  `pay_to` text NOT NULL,
  `deadline` text NOT NULL,
  `status` text NOT NULL,
  `tx_hash` text,
  `tx_nonce` integer,
  `error_reason` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `x402m_payer_idx` ON `x402_metis_settlements` (`payer`);
--> statement-breakpoint
CREATE INDEX `x402m_status_idx` ON `x402_metis_settlements` (`status`);
