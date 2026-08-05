-- One row per x402 authorization Sage has accepted as payment.
--
-- The nonce is the primary key, and that is the whole point: an EIP-3009 authorization is redeemable
-- exactly once on-chain, so accepting the same one twice would be serving paid work for free. The
-- insert is the claim; a conflict means it has already bought something.
--
-- It is also the settlement ledger. Each row holds a signed instrument that can still be redeemed,
-- so if a payment is ever not collected, this is what says who owed what, for which call, and when.
CREATE TABLE IF NOT EXISTS `x402_payments` (
  `nonce` text PRIMARY KEY NOT NULL,
  `tool` text NOT NULL,
  `payer` text NOT NULL,
  `pay_to` text NOT NULL,
  `amount` text NOT NULL,
  `asset` text NOT NULL,
  `chain_id` integer NOT NULL,
  `valid_before` integer NOT NULL,
  `signature` text NOT NULL,
  `authorization_json` text NOT NULL,
  `created_at` integer NOT NULL,
  -- null until the authorization is redeemed on-chain; the tx hash once it is.
  `settled_tx` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `x402_payments_created_idx` ON `x402_payments` (`created_at`);
