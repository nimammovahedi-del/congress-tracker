-- Objects only the website's database needs (Cloudflare D1, and the local copy used by
-- `npm run dev` in web/). The data pipeline's own database doesn't use these.

-- Full-text search over bill titles. Kept up to date by triggers as bills are uploaded.
CREATE VIRTUAL TABLE IF NOT EXISTS bills_fts USING fts5(
  title, official_title,
  content = 'bills', content_rowid = 'rowid',
  tokenize = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS bills_fts_insert AFTER INSERT ON bills BEGIN
  INSERT INTO bills_fts (rowid, title, official_title) VALUES (new.rowid, new.title, new.official_title);
END;

CREATE TRIGGER IF NOT EXISTS bills_fts_delete AFTER DELETE ON bills BEGIN
  INSERT INTO bills_fts (bills_fts, rowid, title, official_title) VALUES ('delete', old.rowid, old.title, old.official_title);
END;

CREATE TRIGGER IF NOT EXISTS bills_fts_update AFTER UPDATE OF title, official_title ON bills
WHEN old.title IS NOT new.title OR old.official_title IS NOT new.official_title BEGIN
  INSERT INTO bills_fts (bills_fts, rowid, title, official_title) VALUES ('delete', old.rowid, old.title, old.official_title);
  INSERT INTO bills_fts (rowid, title, official_title) VALUES (new.rowid, new.title, new.official_title);
END;

-- Index any bills that were already present when this file last changed. This file runs
-- only when it (or schema.sql) changes, so the rebuild doesn't repeat on every upload.
INSERT INTO bills_fts (bills_fts) VALUES ('rebuild');
