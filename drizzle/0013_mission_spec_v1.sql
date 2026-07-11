ALTER TABLE `decisions` ADD `mission_spec_digest` text;--> statement-breakpoint
ALTER TABLE `missions` ADD `objective` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `missions` ADD `instructions` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `missions` ADD `target_surface` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `missions` ADD `evidence_list` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `missions` ADD `spec_digest` text;--> statement-breakpoint
ALTER TABLE `missions` ADD `revision_of` text;--> statement-breakpoint
ALTER TABLE `missions` ADD `locked_at` integer;--> statement-breakpoint
ALTER TABLE `missions` ADD `closed_at` integer;--> statement-breakpoint
ALTER TABLE `submissions` ADD `mission_spec_digest` text;