-- A Starknet payout that was escrowed behind a claim commitment rather than sent to an address.
--
-- On the private-capable rail the vault releases the reward to Sage, which immediately escrows it
-- in SageClaims behind a Poseidon commitment. The worker opens it with the preimage — publicly to
-- any address, or into a shielded note — so the income is never glued to the identity they used to
-- submit. Sage cannot drive the privacy pool itself: the viewing key lives in the wallet, so a
-- claim link is the only shape a private payout can take.
--
-- claim_secret IS THE MONEY. Whoever holds it can collect, which is exactly what makes the
-- collection unlinkable — binding it to an address would defeat the point. It is therefore
-- readable only by the authenticated worker whose submission it belongs to, and cleared once the
-- chain shows the claim collected, so a spent secret does not sit in the database forever.
--
-- claim_commitment is public: it is the on-chain key, and it is what lets Sage ask whether a claim
-- has been collected without knowing the secret.
--
-- All nullable, so every existing submission and the entire EVM rail are untouched.
ALTER TABLE submissions ADD `claim_secret` text;--> statement-breakpoint
ALTER TABLE submissions ADD `claim_commitment` text;--> statement-breakpoint
ALTER TABLE submissions ADD `claim_escrow_tx` text;
