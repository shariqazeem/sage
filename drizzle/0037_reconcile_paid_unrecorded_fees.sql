-- THREE FEES THAT WERE PAID AND RECORDED AS UNPAID.
--
-- `runOperatorFee` transferred the USDC and THEN waited on the facilitator to confirm the order.
-- When that wait expired it threw, and the throw discarded the txHash of money that had already
-- left the wallet. The fee went back on the pending queue, so the next sweep against a funded
-- wallet would have sent it a SECOND time. Only an empty balance prevented that.
--
-- Verified on-chain before writing this, not inferred from our own tables. Nine USDC transfers of
-- 0.1 left the agent wallet 0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6, every one to the merchant
-- receiving address 0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3, totalling exactly the 0.9 owed.
-- Six were recorded. These are the three that were not, in ascending block order:
--
--   blk 14441520  0xa6088ff5aef4f64b482a91d37f6630c841f9b69b7290e3548b1307fc28a180dc
--   blk 14441557  0xb283e1e7bb523bf1dcedbdaa53eb44b69f0eeef5832697e4f68c71d304bbec5f
--   blk 14441593  0xb175e98a41f1032d1606647c259eb7d532f1928b968f8a6401a4d9d86e0a9167
--
-- ASSUMPTION, stated because it is an inference rather than a stored fact: `payPendingFees`
-- iterates `listPendingFees()` in insertion order and the three transfers appear in ascending block
-- order, so the Nth remaining pending fee is paired with the Nth transfer. The AMOUNT is not in
-- doubt either way — 0.9 owed, 0.9 delivered — so the worst case of a mispairing is two rows
-- carrying each other's hash, not books that disagree with the chain.
--
-- The code fix that makes this unrepeatable ships in the same commit: the tx is persisted the
-- instant the transfer receipt lands, and a row already holding a payment_tx is never transferred
-- again, only settled.
UPDATE fees
SET status = 'settled',
    last_error = NULL,
    payment_tx = CASE id
      WHEN (SELECT id FROM fees WHERE status = 'pending' AND payment_tx IS NULL ORDER BY created_at LIMIT 1 OFFSET 0)
        THEN '0xa6088ff5aef4f64b482a91d37f6630c841f9b69b7290e3548b1307fc28a180dc'
      WHEN (SELECT id FROM fees WHERE status = 'pending' AND payment_tx IS NULL ORDER BY created_at LIMIT 1 OFFSET 1)
        THEN '0xb283e1e7bb523bf1dcedbdaa53eb44b69f0eeef5832697e4f68c71d304bbec5f'
      WHEN (SELECT id FROM fees WHERE status = 'pending' AND payment_tx IS NULL ORDER BY created_at LIMIT 1 OFFSET 2)
        THEN '0xb175e98a41f1032d1606647c259eb7d532f1928b968f8a6401a4d9d86e0a9167'
      ELSE payment_tx
    END
WHERE status = 'pending'
  AND payment_tx IS NULL
  AND id IN (
    SELECT id FROM fees WHERE status = 'pending' AND payment_tx IS NULL ORDER BY created_at LIMIT 3
  );
