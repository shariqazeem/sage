-- HOW A TEST IS SHARED (relaunch, 20 Nov 2026). The builder's answers on the offer card. No row means
-- nothing is posted and the findings stay private. src/lib/sharing/.
CREATE TABLE IF NOT EXISTS `campaign_sharing` (
  `campaign_id` text PRIMARY KEY NOT NULL,
  `post_mission` integer DEFAULT false NOT NULL,
  `post_result` integer DEFAULT false NOT NULL,
  `findings_public` integer DEFAULT false NOT NULL,
  `updated_at` integer NOT NULL
);
