ALTER TABLE `plan_revisions` ADD `verification_policy` text;--> statement-breakpoint
ALTER TABLE `plan_revisions` ADD `verification_policy_digest` text;--> statement-breakpoint
ALTER TABLE `plan_revisions` ADD `verification_policy_required` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `plan_revisions` ADD `grounded_provenance` text;