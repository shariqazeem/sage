-- WHAT A FOUNDER TOLD SAGE ONCE (5 Nov 2026): the repository, invite link or product URL a founder typed into
-- a job card, remembered for their workspace so the next card that asks arrives filled in. One value per kind
-- per workspace; nothing secret and no contract address is ever stored (src/lib/launch/remembered.ts).
CREATE TABLE IF NOT EXISTS `workspace_facts` (
  `workspace_id` text NOT NULL,
  `kind` text NOT NULL,
  `value` text NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY(`workspace_id`, `kind`)
);
