-- ONE PERSON, ONE KEY — re-pad EVM addresses whose leading zeros were stripped before storage.
--
-- `getFounderAddress()` returned the COMPARISON form of an address (leading zeros removed), and
-- `founderStorageKey` — which deliberately preserves EVM padding — therefore never saw the padded
-- form. About one EVM address in sixteen begins with `0x0`, so those founders were filed under a
-- 39-digit string that is not their address. Measured on prod 2026-09-05: a workspace owned by
-- `0x4ca1a9d6…` whose owner is really `0x04ca1a9d6…`, and the same operator wallet appearing as
-- BOTH `0x0def3d…` and `0xdef3d…` in inspection_jobs — one person, two identities, decided by
-- which code path wrote the row.
--
-- Scope is exact: only values that are `0x` followed by hex ONLY, shorter than a full 20-byte
-- address, and non-empty. That excludes every felt (longer), and every sentinel this column also
-- holds (`anonymous`, `clawup:…`), which are not hex. Left-padding a stripped EVM address to 40
-- digits recovers it uniquely — an EVM address is exactly 20 bytes, so there is one padded form.
UPDATE `workspaces` SET `owner_key` =
  '0x' || substr('0000000000000000000000000000000000000000', 1, 42 - length(`owner_key`)) || substr(`owner_key`, 3)
WHERE `owner_key` GLOB '0x*' AND length(`owner_key`) > 2 AND length(`owner_key`) < 42
  AND NOT (lower(substr(`owner_key`, 3)) GLOB '*[^0-9a-f]*');
--> statement-breakpoint
UPDATE `workspace_members` SET `member_key` =
  '0x' || substr('0000000000000000000000000000000000000000', 1, 42 - length(`member_key`)) || substr(`member_key`, 3)
WHERE `member_key` GLOB '0x*' AND length(`member_key`) > 2 AND length(`member_key`) < 42
  AND NOT (lower(substr(`member_key`, 3)) GLOB '*[^0-9a-f]*');
--> statement-breakpoint
UPDATE `workspace_members` SET `address` =
  '0x' || substr('0000000000000000000000000000000000000000', 1, 42 - length(`address`)) || substr(`address`, 3)
WHERE `address` IS NOT NULL AND `address` GLOB '0x*' AND length(`address`) > 2 AND length(`address`) < 42
  AND NOT (lower(substr(`address`, 3)) GLOB '*[^0-9a-f]*');
--> statement-breakpoint
-- inspection_jobs may already hold BOTH spellings of one wallet (it does on prod). Re-padding makes
-- them agree; nothing is merged or deleted, so a job keeps its own row and its own history.
UPDATE `inspection_jobs` SET `founder_wallet` =
  '0x' || substr('0000000000000000000000000000000000000000', 1, 42 - length(`founder_wallet`)) || substr(`founder_wallet`, 3)
WHERE `founder_wallet` GLOB '0x*' AND length(`founder_wallet`) > 2 AND length(`founder_wallet`) < 42
  AND NOT (lower(substr(`founder_wallet`, 3)) GLOB '*[^0-9a-f]*');
