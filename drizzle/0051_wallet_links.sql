-- ONE BUSINESS, MANY RAILS: wallets proven by their own sign-ins, linked into one credit file.
CREATE TABLE `wallet_links` (
	`wallet_a` text NOT NULL,
	`wallet_b` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`wallet_a`, `wallet_b`)
);
