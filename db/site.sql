-- Objects only the website's database needs (Cloudflare D1, and the local copy used by
-- `npm run dev` in web/). The data pipeline's own database doesn't use these.
-- This file runs only when it (or schema.sql) changes, so it rebuilds the search index from
-- scratch each time: drop, recreate, and re-index whatever bills are already present.

DROP TRIGGER IF EXISTS bills_fts_insert;
DROP TRIGGER IF EXISTS bills_fts_delete;
DROP TRIGGER IF EXISTS bills_fts_update;
DROP TABLE IF EXISTS bills_fts;

-- Full-text search over bill titles plus search_text (policy area, subjects, summaries), so
-- everyday words find bills even when they aren't in the title. Kept up to date by triggers
-- as bills are uploaded.
CREATE VIRTUAL TABLE bills_fts USING fts5(
  title, official_title, search_text,
  content = 'bills', content_rowid = 'rowid',
  tokenize = 'porter unicode61'
);

CREATE TRIGGER bills_fts_insert AFTER INSERT ON bills BEGIN
  INSERT INTO bills_fts (rowid, title, official_title, search_text) VALUES (new.rowid, new.title, new.official_title, new.search_text);
END;

CREATE TRIGGER bills_fts_delete AFTER DELETE ON bills BEGIN
  INSERT INTO bills_fts (bills_fts, rowid, title, official_title, search_text) VALUES ('delete', old.rowid, old.title, old.official_title, old.search_text);
END;

CREATE TRIGGER bills_fts_update AFTER UPDATE OF title, official_title, search_text ON bills
WHEN old.title IS NOT new.title OR old.official_title IS NOT new.official_title OR old.search_text IS NOT new.search_text BEGIN
  INSERT INTO bills_fts (bills_fts, rowid, title, official_title, search_text) VALUES ('delete', old.rowid, old.title, old.official_title, old.search_text);
  INSERT INTO bills_fts (rowid, title, official_title, search_text) VALUES (new.rowid, new.title, new.official_title, new.search_text);
END;

INSERT INTO bills_fts (bills_fts) VALUES ('rebuild');
