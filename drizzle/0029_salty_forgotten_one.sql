ALTER TABLE `campaigns` ADD `verification_policy_version` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `verification_policy_required` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `policy_source_revision_number` integer;