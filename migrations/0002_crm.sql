-- CRM layer. 0001 (marketing, from armada) creates contacts; this guarantees
-- the CRM columns/tables exist whether or not 0001 already added them.
-- D1 runs each statement independently; ALTERs that duplicate 0001 columns
-- are applied only when missing (see deploy script, which filters by PRAGMA).

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  stage TEXT DEFAULT 'lead',
  notes TEXT DEFAULT '',
  next_followup TEXT DEFAULT '',
  consent_sms INTEGER DEFAULT 0,
  consent_email INTEGER DEFAULT 0,
  source TEXT DEFAULT 'manual',
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  body TEXT DEFAULT '',
  ts TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_stage ON contacts(stage);
CREATE INDEX IF NOT EXISTS idx_contacts_followup ON contacts(next_followup);
CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id, ts);
