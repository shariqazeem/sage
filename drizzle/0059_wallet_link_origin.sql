-- WHERE A WALLET LINK CAME FROM.
--
-- One table held two opposite meanings. The consolidation watch writes a link when it INFERS a
-- cluster from on-chain behaviour — that is evidence of wallet rotation. The Settings "bind" button
-- writes one when a person proves control of both wallets and asks for them to be joined, and a
-- personhood proof writes one when the same World ID nullifier appears on a second wallet. Standing
-- flagged on ANY link, so a founder who bound their own two wallets — exactly what the UI invites —
-- was told "this wallet is linked on-chain to 1 other that took paid work here" and locked out of
-- the better-paid tiers. Measured on prod 2026-09-05, on the operator's own two wallets.
--
-- Existing rows default to 'discovered', which is the conservative direction: it keeps the recorded
-- farm cluster flagged. A person who really did declare theirs re-binds once and the row is
-- rewritten. A declaration never overwrites a discovery — see linkWallets.
ALTER TABLE `wallet_links` ADD COLUMN `origin` text DEFAULT 'discovered' NOT NULL;
--> statement-breakpoint
-- BACKFILL, PROVABLY SCOPED: every EXISTING cross-rail link is a declared bind.
--
-- A consolidation link records an on-chain payout forward, and a forward happens within one chain —
-- so the watch cannot produce a link whose two sides are on different rails. A personhood link
-- could, but `identity_proofs` was empty when this migration was written (verified on prod
-- 2026-09-05), so none exists. That leaves `/api/record/link`, which reads exactly one EVM session
-- and one Starknet session and can only ever write this shape.
--
-- Same-rail rows are untouched, so the recorded farm cluster stays flagged. The condition compares
-- significant hex length: an EVM address is 40 digits or fewer, a Starknet felt is longer, and `!=`
-- between the two booleans is the exclusive-or that means "one of each".
UPDATE `wallet_links` SET `origin` = 'declared'
WHERE (length(ltrim(replace(lower(`wallet_a`), '0x', ''), '0')) > 40)
   != (length(ltrim(replace(lower(`wallet_b`), '0x', ''), '0')) > 40);
