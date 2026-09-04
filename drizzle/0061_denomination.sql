-- A DENOMINATED OBLIGATION IS A FIRST-CLASS OBJECT.
--
-- The composer accepted J$ (and thirteen other currencies), converted at a stamped, source-attributed
-- rate — and then threw the quote away at compile. Nothing on the board, the receipt or the record was
-- denominated in anything but USD, so "obligations denominate in 14 currencies" was true only for the
-- half-second the compiler held the number. These columns keep what the founder typed and the rate it
-- was stamped at, beside the USD base that is the money. Absent (NULL) means priced in USD.
ALTER TABLE `campaigns` ADD COLUMN `currency` text;
--> statement-breakpoint
ALTER TABLE `campaigns` ADD COLUMN `local_total` real;
--> statement-breakpoint
ALTER TABLE `campaigns` ADD COLUMN `rate` real;
--> statement-breakpoint
ALTER TABLE `campaigns` ADD COLUMN `rate_source` text;
--> statement-breakpoint
ALTER TABLE `campaigns` ADD COLUMN `rate_at` integer;
--> statement-breakpoint
ALTER TABLE `missions` ADD COLUMN `reward_local` real;
