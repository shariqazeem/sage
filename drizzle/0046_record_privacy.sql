-- A worker's choice about whether their Verified Work Record shows amounts.
--
-- ABSENT MEANS PUBLIC, and that default is deliberate. Public receipts are the point of the record
-- for grants and MSME capital: a programme handing out money has to be able to show where it went.
-- Privacy is a WORKER's option, for someone who would rather not carry a public income graph — not
-- a property of the system. A row here exists only when someone has chosen.
CREATE TABLE record_preferences (
  wallet TEXT PRIMARY KEY NOT NULL,
  amounts_private INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
