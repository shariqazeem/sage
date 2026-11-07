-- MILESTONES (7 Nov 2026). The first moment one of Sage's numbers reached a round figure, written once so
-- the operator is told once. src/lib/numbers/milestones.ts.
CREATE TABLE IF NOT EXISTS `milestones` (
  `key` text PRIMARY KEY NOT NULL,
  `series` text NOT NULL,
  `threshold` integer NOT NULL,
  `value` integer NOT NULL,
  `reached_at` integer NOT NULL,
  `announced` integer DEFAULT false NOT NULL
);
