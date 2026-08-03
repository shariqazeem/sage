-- REPAIR: a stopped campaign stranded its testers' submissions forever.
--
-- Stopping a campaign revokes its vault on-chain, so nothing on it can ever settle. But the stop
-- path only set `campaigns.status = 'cancelled'`; it never resolved the submissions still awaiting
-- judgment. Those rows stayed `pending` with `decided_at` NULL, which meant:
--   * the sweep re-ran the whole decision pipeline over them every five minutes, forever;
--   * the public tester board counted them under "verifying" — an untruth, since a revoked vault
--     verifies nothing;
--   * the tester who did the work never got an answer.
--
-- Observed on prod 2026-08-04: two rows ~15 days old on `launch-yara-garden-8frabo` and
-- `launch-excalidraw-com-9y7tcu` (both cancelled), one of them a genuine own-words account of
-- drawing a rectangle in Excalidraw.
--
-- The code is fixed in three places: the founder's stop route and the on-chain reconcile both
-- resolve these rows now, and the sweep no longer selects submissions belonging to a campaign that
-- is not live. This repairs the rows already written.
--
-- DELIBERATELY NARROW. It touches a row only when ALL of these hold:
--   * its campaign is in a terminal state (cancelled/completed/closed/draft), and
--   * the submission is still `pending` or `approved` — awaiting a result, not holding one.
-- `settling` is excluded on purpose: that row may have a transaction in flight, and the sweep's
-- stale-settling recovery owns it. `paid` and `rejected` already have their answer.
-- Idempotent: re-running matches nothing once repaired.

UPDATE submissions
SET status = 'rejected',
    reject_reason = 'The founder stopped this campaign and withdrew the remaining funds before this submission was judged. That is not a verdict on your work — with the vault revoked on-chain there is nothing left to pay from.',
    decided_at = CAST(strftime('%s', 'now') AS INTEGER)
WHERE status IN ('pending', 'approved')
  AND campaign_id IN (
    SELECT id FROM campaigns
    WHERE lower(status) IN ('cancelled', 'completed', 'closed', 'draft')
  );
