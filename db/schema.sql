-- Database schema for congress-tracker.
-- Plain SQLite so the same file works locally and on Cloudflare D1.
-- Every statement is idempotent: it runs each time the database is opened.

-- People who served in a tracked Congress. Source: unitedstates/congress-legislators.
CREATE TABLE IF NOT EXISTS members (
  bioguide_id   TEXT PRIMARY KEY,          -- official Congress ID, e.g. 'C000127'
  full_name     TEXT NOT NULL,
  first_name    TEXT,
  last_name     TEXT,
  party         TEXT,                      -- D, R, I (most recent term)
  state         TEXT,
  district      INTEGER,                   -- House only; 0 = at-large
  chamber       TEXT,                      -- 'house' or 'senate' (most recent term)
  in_office     INTEGER NOT NULL DEFAULT 0,
  term_start    TEXT,
  term_end      TEXT,
  phone         TEXT,
  office        TEXT,
  website       TEXT,
  contact_form  TEXT,
  birthday      TEXT,
  gender        TEXT,
  icpsr_id      INTEGER,                   -- Voteview's member ID
  lis_id        TEXT,                      -- Senate's member ID
  govtrack_id   INTEGER,
  nominate_dim1 REAL,                      -- Voteview DW-NOMINATE scores (academic ideology measure)
  nominate_dim2 REAL,
  photo_url     TEXT,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS members_state ON members (state, chamber);

CREATE TABLE IF NOT EXISTS member_terms (
  bioguide_id TEXT NOT NULL,
  chamber     TEXT NOT NULL,
  state       TEXT,
  district    INTEGER,
  party       TEXT,
  start_date  TEXT NOT NULL,
  end_date    TEXT,
  PRIMARY KEY (bioguide_id, chamber, start_date)
);

-- Bills and resolutions. Source: GovInfo BILLSTATUS bulk data (same data as Congress.gov).
-- We keep links to the official text, never the text itself.
CREATE TABLE IF NOT EXISTS bills (
  id                    TEXT PRIMARY KEY,  -- '{congress}-{type}-{number}', e.g. '119-hr-1'
  congress              INTEGER NOT NULL,
  bill_type             TEXT NOT NULL,     -- hr, s, hjres, sjres, hconres, sconres, hres, sres
  number                INTEGER NOT NULL,
  title                 TEXT NOT NULL,     -- popular or short title when there is one
  official_title        TEXT,
  origin_chamber        TEXT,
  introduced_date       TEXT,
  sponsor_id            TEXT,
  policy_area           TEXT,
  status                TEXT NOT NULL,     -- see src/bill-status.ts
  status_date           TEXT,
  latest_action_date    TEXT,
  latest_action_text    TEXT,
  law_number            TEXT,              -- e.g. '119-21'
  cosponsor_count       INTEGER NOT NULL DEFAULT 0,
  crs_summary           TEXT,              -- HTML written by the Congressional Research Service
  crs_summary_version   TEXT,
  crs_summary_date      TEXT,
  ai_summary            TEXT,              -- filled in Phase 4
  ai_summary_updated_at TEXT,
  text_url              TEXT,              -- latest text version on govinfo.gov
  text_version          TEXT,
  congress_gov_url      TEXT NOT NULL,
  source_updated_at     TEXT,
  synced_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bills_sponsor ON bills (sponsor_id);
CREATE INDEX IF NOT EXISTS bills_latest_action ON bills (latest_action_date);
CREATE INDEX IF NOT EXISTS bills_policy_area ON bills (policy_area);
CREATE INDEX IF NOT EXISTS bills_status ON bills (status);

CREATE TABLE IF NOT EXISTS bill_actions (
  bill_id     TEXT NOT NULL,
  seq         INTEGER NOT NULL,            -- 0 = oldest action
  action_date TEXT NOT NULL,
  action_time TEXT,
  text        TEXT NOT NULL,
  action_type TEXT,
  action_code TEXT,
  source      TEXT,
  PRIMARY KEY (bill_id, seq)
);

CREATE TABLE IF NOT EXISTS bill_cosponsors (
  bill_id          TEXT NOT NULL,
  bioguide_id      TEXT NOT NULL,
  sponsorship_date TEXT,
  is_original      INTEGER,
  withdrawn_date   TEXT,
  PRIMARY KEY (bill_id, bioguide_id)
);
CREATE INDEX IF NOT EXISTS bill_cosponsors_member ON bill_cosponsors (bioguide_id);

CREATE TABLE IF NOT EXISTS bill_subjects (
  bill_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  PRIMARY KEY (bill_id, subject)
);
CREATE INDEX IF NOT EXISTS bill_subjects_subject ON bill_subjects (subject);

CREATE TABLE IF NOT EXISTS bill_committees (
  bill_id        TEXT NOT NULL,
  committee_code TEXT NOT NULL,            -- e.g. 'hsbu00'
  name           TEXT,
  chamber        TEXT,
  PRIMARY KEY (bill_id, committee_code)
);

CREATE TABLE IF NOT EXISTS bill_text_versions (
  bill_id      TEXT NOT NULL,
  seq          INTEGER NOT NULL,           -- 0 = newest, as listed in the source
  version_type TEXT,
  version_date TEXT,
  url          TEXT NOT NULL,
  PRIMARY KEY (bill_id, seq)
);

CREATE TABLE IF NOT EXISTS related_bills (
  bill_id         TEXT NOT NULL,
  related_bill_id TEXT NOT NULL,
  relationship    TEXT NOT NULL,
  identified_by   TEXT NOT NULL,
  PRIMARY KEY (bill_id, related_bill_id, relationship, identified_by)
);

CREATE TABLE IF NOT EXISTS cbo_estimates (
  bill_id     TEXT NOT NULL,
  pub_date    TEXT,
  title       TEXT,
  url         TEXT NOT NULL,
  description TEXT,
  PRIMARY KEY (bill_id, url)
);

-- Roll-call votes that a bill's actions point to. Lets a bill show Senate results
-- right away, before member-level data arrives from Voteview.
CREATE TABLE IF NOT EXISTS bill_vote_refs (
  bill_id      TEXT NOT NULL,
  roll_call_id TEXT NOT NULL,
  action_seq   INTEGER NOT NULL,
  action_date  TEXT,
  action_text  TEXT,
  PRIMARY KEY (bill_id, roll_call_id)
);
CREATE INDEX IF NOT EXISTS bill_vote_refs_roll_call ON bill_vote_refs (roll_call_id);

-- Roll-call votes. Sources: House Clerk (House) and Voteview (Senate).
CREATE TABLE IF NOT EXISTS roll_calls (
  id                   TEXT PRIMARY KEY,   -- '{h|s}-{congress}-{session}-{roll}', e.g. 'h-119-1-190'
  chamber              TEXT NOT NULL,      -- 'house' or 'senate'
  congress             INTEGER NOT NULL,
  session              INTEGER NOT NULL,
  roll_number          INTEGER NOT NULL,
  vote_date            TEXT,
  question             TEXT,
  vote_type            TEXT,
  result               TEXT,
  description          TEXT,
  majority_requirement TEXT,
  bill_id              TEXT,               -- null for nominations, quorum calls, etc.
  subject_ref          TEXT,               -- what was voted on, as the source writes it
  yea                  INTEGER,
  nay                  INTEGER,
  present              INTEGER,
  not_voting           INTEGER,
  source               TEXT NOT NULL,      -- 'house-clerk' or 'voteview'
  official_url         TEXT,               -- the chamber's own record of the vote
  synced_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS roll_calls_bill ON roll_calls (bill_id);
CREATE INDEX IF NOT EXISTS roll_calls_date ON roll_calls (vote_date);

CREATE TABLE IF NOT EXISTS member_votes (
  roll_call_id TEXT NOT NULL,
  bioguide_id  TEXT NOT NULL,
  position     TEXT NOT NULL,              -- yea, nay, present, not_voting, other
  detail       TEXT,                       -- raw vote when position is 'other' (e.g. Speaker elections)
  party        TEXT,                       -- at the time of the vote
  state        TEXT,
  PRIMARY KEY (roll_call_id, bioguide_id)
);
CREATE INDEX IF NOT EXISTS member_votes_member ON member_votes (bioguide_id);

-- Rules, proposed rules, and presidential documents. Source: Federal Register API.
CREATE TABLE IF NOT EXISTS fr_documents (
  document_number        TEXT PRIMARY KEY,
  doc_type               TEXT NOT NULL,    -- 'Rule', 'Proposed Rule', 'Presidential Document'
  subtype                TEXT,             -- e.g. 'Executive Order'
  title                  TEXT NOT NULL,
  abstract               TEXT,             -- written by the agency
  action                 TEXT,
  agencies               TEXT,             -- JSON array of agency names
  publication_date       TEXT NOT NULL,
  effective_on           TEXT,
  comments_close_on      TEXT,
  signing_date           TEXT,
  executive_order_number INTEGER,
  significant            INTEGER,
  docket_ids             TEXT,             -- JSON array
  regulation_id_numbers  TEXT,             -- JSON array
  html_url               TEXT NOT NULL,
  pdf_url                TEXT,
  synced_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fr_documents_date ON fr_documents (publication_date);
CREATE INDEX IF NOT EXISTS fr_documents_type ON fr_documents (doc_type, publication_date);

-- Bookkeeping for incremental syncs.
CREATE TABLE IF NOT EXISTS sync_state (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_files (
  url           TEXT PRIMARY KEY,
  last_modified TEXT NOT NULL,             -- as GovInfo's listing reports it
  synced_at     TEXT NOT NULL
);
