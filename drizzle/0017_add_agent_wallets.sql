CREATE TABLE `agent_wallets` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`founder_address` text NOT NULL,
	`privy_wallet_id` text NOT NULL,
	`privy_wallet_address` text NOT NULL,
	`policy_id` text NOT NULL,
	`per_campaign_cap_base` integer NOT NULL,
	`chain_id` integer DEFAULT 2345 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
