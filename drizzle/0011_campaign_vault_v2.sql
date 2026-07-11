CREATE TABLE `missions` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`mission_key` text NOT NULL,
	`mission_id_hash` text NOT NULL,
	`title` text NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`criteria` text DEFAULT '[]' NOT NULL,
	`evidence_requirements` text,
	`reward_amount` integer NOT NULL,
	`max_completions` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `missions_campaign_key_unq` ON `missions` (`campaign_id`,`mission_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `missions_campaign_hash_unq` ON `missions` (`campaign_id`,`mission_id_hash`);--> statement-breakpoint
CREATE INDEX `missions_campaign_idx` ON `missions` (`campaign_id`,`display_order`);--> statement-breakpoint
ALTER TABLE `campaigns` ADD `vault_kind` text DEFAULT 'policy_v1' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `campaign_id_hash` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `mission_plan_digest` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `commitment_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `decisions` ADD `commitment_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `decisions` ADD `mission_id_hash` text;--> statement-breakpoint
ALTER TABLE `decisions` ADD `vault_kind` text;--> statement-breakpoint
ALTER TABLE `settlement_attempts` ADD `commitment_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `settlement_attempts` ADD `mission_id_hash` text;--> statement-breakpoint
ALTER TABLE `settlement_attempts` ADD `vault_kind` text DEFAULT 'policy_v1' NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `mission_id_hash` text;