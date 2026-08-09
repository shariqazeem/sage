-- THE FIRST REVENUE LINE.
--
-- Sage had no take-rate. `allocateBudget` holds Σ(rewardBase × maxCompletions) === totalBudgetBase
-- exactly, so every cent a founder funded reached testers, and the only x402 payment in the system
-- was the operator fee — which Sage paid to its own wallet. That proved the rail and earned nothing.
--
-- This table records the fee a founder pays to LAUNCH a funded campaign, charged over x402 so each
-- one also lands in the GOAT Flow merchant dashboard as a real order.
--
-- Deliberately NOT the existing `fees` table. That one is per-payout, fires after settlement, and
-- was just repaired after a month of silent failure; this one is per-campaign and fires at launch.
-- Different lifecycle, different payer, and no reason to put a new money path through code whose
-- bugs are still fresh.
--
-- `payer_address` and `self_funded` exist because the operator funds seed campaigns from their own
-- wallets. Those fees are charged (no exemptions, by their decision) but they are NOT revenue —
-- money moving between two pockets the same person owns. Recording the distinction means any number
-- shown to GOAT, a grant, or an investor can exclude it. A revenue figure that quietly counts your
-- own wallet is the kind of claim that gets checked.
--
-- `attempts` / `last_error` / the payment_tx-before-confirmation discipline are carried over from
-- the operator-fee repair rather than relearned: a fixed dappOrderId strands a fee forever once its
-- order expires, and money that has moved must be recorded before anything downstream can fail.
CREATE TABLE IF NOT EXISTS `campaign_fees` (
  `id` text PRIMARY KEY NOT NULL,
  `campaign_id` text,
  `inspection_id` text,
  -- what the founder funded, and the 10% charged on it — both in USDC base units (6dp)
  `budget_base` integer NOT NULL,
  `amount_base` integer NOT NULL,
  -- 'pending' | 'settled' | 'waived'
  `status` text DEFAULT 'pending' NOT NULL,
  `payment_tx` text,
  `order_id` text,
  `payer_address` text,
  -- 1 when the payer is one of the operator's own wallets: charged, but never counted as revenue
  `self_funded` integer DEFAULT 0 NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `last_error` text,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
-- One fee per campaign. The launch path is retryable and a founder can double-submit, so uniqueness
-- is enforced by the engine rather than by remembering to check first.
CREATE UNIQUE INDEX IF NOT EXISTS `campaign_fees_campaign_unq` ON `campaign_fees` (`campaign_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `campaign_fees_status_idx` ON `campaign_fees` (`status`);
