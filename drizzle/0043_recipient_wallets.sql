-- WALLETLESS RECIPIENTS (move 2 of the agent-is-the-interface pivot).
--
-- A recipient with no wallet opens Telegram from a founder's invite link: Sage mints them a Privy
-- server wallet (custodied by Privy, signed only through the app — the same honest custody model
-- as founder agent wallets), binds it to their chat, and appends it to the invited campaign's
-- allowlist. They submit proof IN CHAT; the app signs the SAME EIP-712 evidence claim every web
-- tester signs (proven live: Privy eth_signTypedData_v4 recovers under viem), so the one
-- payout-only-to-a-wallet-that-proved-control invariant is unchanged. USDC lands in their wallet.
CREATE TABLE recipient_wallets (
  chat_id TEXT PRIMARY KEY,
  privy_wallet_id TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX recipient_wallets_addr_unq ON recipient_wallets (address);
--> statement-breakpoint
-- One code = one invited person for one campaign, created by the campaign's own founder. Redemption
-- is WRITE-ONCE (redeemed_* set exactly once); re-tapping the link is idempotent for the SAME chat
-- and refused for a different one.
CREATE TABLE recipient_invites (
  code TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  created_by_wallet TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  redeemed_chat_id TEXT,
  redeemed_wallet TEXT,
  redeemed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX recipient_invites_campaign_idx ON recipient_invites (campaign_id);
