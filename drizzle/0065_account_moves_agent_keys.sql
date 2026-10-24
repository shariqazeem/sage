-- MONEY INSIDE THE ACCOUNT, AND AGENTS THAT ACT FOR THE OWNER (24 Oct 2026). `account_moves` records the
-- swaps between USDC and METIS and the METIS sends Sage makes from an account at the founder's request,
-- each with its transaction (a native METIS transfer leaves no log on Metis, so the activity could not
-- otherwise show it). `agent_keys` holds the keys a workspace owner mints for their own AI agent: a
-- SHA-256 of the key (never the key), the scopes the owner granted, and when it was last used or revoked.
CREATE TABLE `account_moves` (
  `id` text PRIMARY KEY NOT NULL,
  `founder` text NOT NULL,
  `wallet` text NOT NULL,
  `chain_id` integer NOT NULL,
  `kind` text NOT NULL,
  `asset_in` text NOT NULL,
  `amount_in` text NOT NULL,
  `asset_out` text,
  `amount_out` text,
  `counterparty` text NOT NULL,
  `tx_hash` text NOT NULL,
  `approve_tx_hash` text,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_moves_wallet_idx` ON `account_moves` (`wallet`);
--> statement-breakpoint
CREATE INDEX `account_moves_founder_idx` ON `account_moves` (`founder`);
--> statement-breakpoint
CREATE TABLE `agent_keys` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `founder` text NOT NULL,
  `name` text NOT NULL,
  `prefix` text NOT NULL,
  `key_hash` text NOT NULL,
  `scopes` text NOT NULL,
  `created_at` integer NOT NULL,
  `last_used_at` integer,
  `revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_keys_hash_idx` ON `agent_keys` (`key_hash`);
--> statement-breakpoint
CREATE INDEX `agent_keys_workspace_idx` ON `agent_keys` (`workspace_id`);
