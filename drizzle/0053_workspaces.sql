-- SAGE FOR TEAMS: a workspace is the closed loop — an organization, its members, its invites.
-- A campaign belongs to the workspace of the founder who launched it; an unlisted workspace
-- campaign accepts submissions from members only.
CREATE TABLE `workspaces` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `slug` text NOT NULL,
  `owner_key` text NOT NULL,
  `plan` text DEFAULT 'free' NOT NULL,
  `plan_until` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unq` ON `workspaces` (`slug`);
--> statement-breakpoint
CREATE INDEX `workspaces_owner_idx` ON `workspaces` (`owner_key`);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
  `workspace_id` text NOT NULL,
  `member_key` text NOT NULL,
  `address` text,
  `role` text DEFAULT 'member' NOT NULL,
  `display_name` text,
  `invited_by` text,
  `joined_at` integer NOT NULL,
  PRIMARY KEY(`workspace_id`, `member_key`)
);
--> statement-breakpoint
CREATE INDEX `workspace_members_address_idx` ON `workspace_members` (`address`);
--> statement-breakpoint
CREATE INDEX `workspace_members_member_idx` ON `workspace_members` (`member_key`);
--> statement-breakpoint
CREATE TABLE `workspace_invites` (
  `code` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` integer NOT NULL,
  `max_uses` integer DEFAULT 50 NOT NULL,
  `uses` integer DEFAULT 0 NOT NULL,
  `revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `workspace_invites_workspace_idx` ON `workspace_invites` (`workspace_id`);
--> statement-breakpoint
ALTER TABLE `campaigns` ADD `workspace_id` text;
