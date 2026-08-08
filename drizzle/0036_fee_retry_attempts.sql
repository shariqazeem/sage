-- THE FEE THAT COULD NEVER BE PAID TWICE.
--
-- `runOperatorFee` derives its GOAT dappOrderId from the fee id (`fee-<id>`), which is FIXED for the
-- life of the fee. The first sweep creates that order; when it later expires unpaid, every retry
-- forever after dies on the facilitator's `failed to create order: order already exists` before it
-- ever reaches the transfer. Nine fees sat pending from 6 July to 9 August, ~8,000 silent retries,
-- and the merchant dashboard filled with 67 unpayable invoices reading as "US$5.10 revenue".
--
-- `attempts` makes the dappOrderId unique per try (`fee-<id>-<attempt>`), so a retry creates a
-- payable order instead of colliding with a dead one. Our own `fees.id` stays the idempotency key,
-- so a fee is still charged at most once no matter how many orders it takes to land.
--
-- `last_error` is the other half. payPendingFees discarded the error string that guardedFee already
-- returned, on the reasonable grounds that journalling every retry would be spam. The result was a
-- money path that failed for a month in complete silence. Storing it on the ROW is not spam: it is
-- overwritten in place, it is always current, and it can be read without grepping a log.
ALTER TABLE fees ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE fees ADD COLUMN last_error TEXT;
--> statement-breakpoint

-- The nine stranded fees keep their debt but start their attempt counter clean, so the next sweep
-- issues each a FRESH dappOrderId and can finally pay what is genuinely owed.
UPDATE fees SET attempts = 0, last_error = NULL WHERE status = 'pending';
