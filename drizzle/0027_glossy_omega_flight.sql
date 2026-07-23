CREATE TABLE `payout_replay_journal` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`policy_digest` text NOT NULL,
	`probe_digest` text NOT NULL,
	`decision` text,
	`outcome_code` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`latency_ms` integer,
	`attempt` integer DEFAULT 1 NOT NULL,
	`probe_version` text DEFAULT 'mission-probe-v1' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prj_key_unq` ON `payout_replay_journal` (`submission_id`,`policy_digest`,`probe_digest`);