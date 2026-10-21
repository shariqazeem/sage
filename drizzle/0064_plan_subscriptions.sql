-- PLANS THAT RENEW LIKE A CARD, AND PROMO CODES (21 Oct 2026). A paid plan renews itself from the owner's
-- Sage balance on Metis unless they turn renewal off; every payment remembers which plan it bought, the
-- period it covers and how it was paid, so a receipt can be printed for it. One renewal row per
-- workspace per period end, ever: the primary key is what makes a second charge for the same month
-- impossible. A promo code gives free days of a plan, or a share off the first payment; each
-- workspace redeems a code once (the primary key again), and the discount is computed on the server.
ALTER TABLE `workspaces` ADD `auto_renew` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `renew_reminded_for` integer;
--> statement-breakpoint
ALTER TABLE `workspace_payments` ADD `plan` text;
--> statement-breakpoint
ALTER TABLE `workspace_payments` ADD `period_start` integer;
--> statement-breakpoint
ALTER TABLE `workspace_payments` ADD `method` text;
--> statement-breakpoint
CREATE TABLE `plan_renewals` (
  `workspace_id` text NOT NULL,
  `period_end` integer NOT NULL,
  `plan` text NOT NULL,
  `status` text NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `last_attempt_at` integer,
  `tx_hash` text,
  `gas_tx_hash` text,
  `error` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY(`workspace_id`, `period_end`)
);
--> statement-breakpoint
CREATE INDEX `plan_renewals_status_idx` ON `plan_renewals` (`status`);
--> statement-breakpoint
CREATE TABLE `promo_codes` (
  `code` text PRIMARY KEY NOT NULL,
  `plan` text NOT NULL,
  `kind` text NOT NULL,
  `days` integer,
  `percent_off` integer,
  `max_uses` integer,
  `uses` integer DEFAULT 0 NOT NULL,
  `expires_at` integer,
  `new_only` integer DEFAULT 0 NOT NULL,
  `note` text,
  `created_at` integer NOT NULL,
  `disabled_at` integer
);
--> statement-breakpoint
CREATE TABLE `promo_redemptions` (
  `code` text NOT NULL,
  `workspace_id` text NOT NULL,
  `founder` text NOT NULL,
  `plan` text NOT NULL,
  `kind` text NOT NULL,
  `days_granted` integer,
  `percent_off` integer,
  `tx_hash` text,
  `plan_until` integer,
  `redeemed_at` integer NOT NULL,
  PRIMARY KEY(`code`, `workspace_id`)
);
--> statement-breakpoint
CREATE INDEX `promo_redemptions_workspace_idx` ON `promo_redemptions` (`workspace_id`);
