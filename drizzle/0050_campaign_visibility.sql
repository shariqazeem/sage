-- SAGE FOR TEAMS — a company hands gigs and milestone grants to its own people without listing
-- them publicly. `unlisted` campaigns never appear on the marketplace, the sitemap or the agent's
-- mission list; their door is /c/<id>, shared by the founder. Existing rows stay `listed`.
ALTER TABLE campaigns ADD `visibility` text DEFAULT 'listed' NOT NULL;
