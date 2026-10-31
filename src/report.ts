// Print what's in the database and flag likely data problems.
//
//   npm run report
import { all, one, openDb } from "./db.ts";

const db = openDb();
const count = (sql: string) => one<{ n: number }>(db, sql)?.n ?? 0;
const table = (title: string, rows: object[]) => {
  console.log(`\n${title}`);
  console.table(rows);
};

table("Rows per table", [
  "members", "bills", "bill_actions", "bill_cosponsors", "bill_subjects", "bill_vote_refs",
  "roll_calls", "member_votes", "fr_documents",
].map((t) => ({ table: t, rows: count(`SELECT COUNT(*) AS n FROM ${t}`) })));

table("Bills by status", all(db, "SELECT status, COUNT(*) AS bills FROM bills GROUP BY status ORDER BY bills DESC"));

table("Bills by type", all(db, `
  SELECT bill_type AS type, COUNT(*) AS bills,
         SUM(crs_summary IS NOT NULL) AS with_crs_summary,
         SUM(crs_summary IS NULL) AS need_ai_summary,
         MAX(latest_action_date) AS latest_action
    FROM bills GROUP BY bill_type ORDER BY bills DESC`));

table("Roll-call votes", all(db, `
  SELECT chamber, session, COUNT(*) AS votes, MIN(roll_number) AS first_roll, MAX(roll_number) AS last_roll,
         MAX(vote_date) AS latest, SUM(bill_id IS NOT NULL) AS linked_to_bill
    FROM roll_calls GROUP BY chamber, session ORDER BY chamber, session`));

table("Federal Register documents", all(db, `
  SELECT doc_type, COUNT(*) AS documents, SUM(abstract IS NOT NULL) AS with_abstract, MAX(publication_date) AS latest
    FROM fr_documents GROUP BY doc_type`));

// Data-quality checks: each should be zero or close to it.
table("Checks (should be 0 or small)", [
  {
    check: "votes cast by people missing from members",
    count: count("SELECT COUNT(DISTINCT bioguide_id) AS n FROM member_votes WHERE bioguide_id NOT IN (SELECT bioguide_id FROM members)"),
  },
  {
    check: "bill sponsors missing from members",
    count: count("SELECT COUNT(DISTINCT sponsor_id) AS n FROM bills WHERE sponsor_id IS NOT NULL AND sponsor_id NOT IN (SELECT bioguide_id FROM members)"),
  },
  {
    check: "House votes a bill cites that we don't have",
    count: count("SELECT COUNT(DISTINCT roll_call_id) AS n FROM bill_vote_refs WHERE roll_call_id LIKE 'h-%' AND roll_call_id NOT IN (SELECT id FROM roll_calls)"),
  },
  {
    check: "Senate votes a bill cites, not yet in Voteview",
    count: count("SELECT COUNT(DISTINCT roll_call_id) AS n FROM bill_vote_refs WHERE roll_call_id LIKE 's-%' AND roll_call_id NOT IN (SELECT id FROM roll_calls)"),
  },
  {
    // The House can reach 441: its 6 non-voting delegates vote in the Committee of the Whole.
    check: "votes whose member counts don't match the chamber size",
    count: count(`SELECT COUNT(*) AS n FROM roll_calls r
                   WHERE (SELECT COUNT(*) FROM member_votes v WHERE v.roll_call_id = r.id)
                         NOT BETWEEN (CASE r.chamber WHEN 'senate' THEN 95 ELSE 420 END)
                                 AND (CASE r.chamber WHEN 'senate' THEN 100 ELSE 441 END)`),
  },
  {
    // Bill numbers reserved for the Speaker are placeholders with no actions yet.
    check: "bills with no actions (excluding reserved numbers)",
    count: count(`SELECT COUNT(*) AS n FROM bills
                   WHERE id NOT IN (SELECT DISTINCT bill_id FROM bill_actions)
                     AND title NOT LIKE 'Reserved for%'`),
  },
]);

db.close();
