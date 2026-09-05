-- GAS STIPENDS: the operator covered a wallet's launch gas, once. Sent only against USDC the wallet
-- already holds for a plan, capped at the launch floor, recorded so no wallet is covered twice.
CREATE TABLE `gas_stipends` (
  `wallet` text PRIMARY KEY NOT NULL,
  `chain_id` integer NOT NULL,
  `amount_wei` text NOT NULL,
  `tx_hash` text NOT NULL,
  `budget_base` text NOT NULL,
  `created_at` integer NOT NULL
);
