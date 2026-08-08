-- ONE RECEIPT MY OWN MIGRATION DROPPED.
--
-- 0037 assigned the three recovered hashes with a CASE whose WHEN arms were subqueries against
-- `fees` — the very table the UPDATE was writing. SQLite re-evaluates those per row, so as rows
-- stopped matching `status='pending' AND payment_tx IS NULL` the OFFSETs slid underneath it. Two of
-- the three hashes landed; fee 5EI97f4hdBA6 settled with payment_tx NULL and
-- 0xb175e98a...9167 was never written. A self-referential UPDATE is not a safe way to pair rows
-- with values, and this is the corrective.
--
-- Safe because it is not self-referential and the target is unambiguous: exactly one settled row
-- has a NULL payment_tx (verified on prod before writing this), and exactly one of the nine
-- on-chain transfers is unaccounted for. The pairing is therefore forced, not inferred.
--
--   blk 14441593  0xb175e98a41f1032d1606647c259eb7d532f1928b968f8a6401a4d9d86e0a9167
--
-- Money was never in question at any point: 0.9 USDC owed, 0.9 delivered, nine transfers on chain.
-- What was missing was the receipt, and a payout Sage cannot show a receipt for is exactly the
-- thing this product promises never to have.
UPDATE fees
SET payment_tx = '0xb175e98a41f1032d1606647c259eb7d532f1928b968f8a6401a4d9d86e0a9167'
WHERE status = 'settled' AND payment_tx IS NULL;
