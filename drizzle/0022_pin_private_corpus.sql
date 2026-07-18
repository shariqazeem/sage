ALTER TABLE `campaigns` ADD `private_corpus` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `private_corpus_digest` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `private_corpus_sources` integer DEFAULT 0 NOT NULL;