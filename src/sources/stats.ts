// Precompute the figures the website shows on its topic, member, and analytics pages.
// They'd be too costly to calculate on each page view (the hosted database charges per
// row read), so they're stored as JSON documents in `site_stats`.
import type { DatabaseSync } from "node:sqlite";
import { nowIso } from "../config.ts";
import { all, one, transaction, upsert } from "../db.ts";

export function slugify(name: string): string {
  return name.toLowerCase().replaceAll("&", "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// How far a bill got, for pass-rate funnels. Only measures that can become law are counted.
const STAGE_SQL = `CASE status
  WHEN 'became_law' THEN 4
  WHEN 'passed_both' THEN 3 WHEN 'presented' THEN 3 WHEN 'vetoed' THEN 3
  WHEN 'passed_house' THEN 2 WHEN 'passed_senate' THEN 2
  WHEN 'reported' THEN 1
  ELSE 0 END`;
const LAWMAKING_TYPES = "('hr', 's', 'hjres', 'sjres')";

function topics(db: DatabaseSync) {
  const areas = all<{ area: string; bills: number; laws: number; advanced: number; latest: string }>(
    db,
    `SELECT policy_area AS area, COUNT(*) AS bills,
            SUM(status = 'became_law') AS laws,
            SUM(status NOT IN ('introduced', 'reported', 'failed')) AS advanced,
            MAX(latest_action_date) AS latest
       FROM bills WHERE policy_area IS NOT NULL
      GROUP BY policy_area ORDER BY bills DESC`,
  );
  const subjects = all<{ area: string; subject: string; bills: number }>(
    db,
    `SELECT b.policy_area AS area, s.subject, COUNT(*) AS bills
       FROM bill_subjects s JOIN bills b ON b.id = s.bill_id
      WHERE b.policy_area IS NOT NULL AND s.subject <> b.policy_area
      GROUP BY 1, 2 ORDER BY 1, 3 DESC`,
  );
  return areas.map((a) => ({
    ...a,
    slug: slugify(a.area),
    subjects: subjects
      .filter((s) => s.area === a.area)
      .slice(0, 12)
      .map((s) => ({ name: s.subject, slug: slugify(s.subject), bills: s.bills })),
  }));
}

function passRates(db: DatabaseSync) {
  const funnel = (groupBy: string, join = "") =>
    all<{ grp: string; introduced: number; reported: number; passed_one: number; passed_both: number; law: number }>(
      db,
      `SELECT ${groupBy} AS grp, COUNT(*) AS introduced,
              SUM(stage >= 1) AS reported, SUM(stage >= 2) AS passed_one,
              SUM(stage >= 3) AS passed_both, SUM(stage = 4) AS law
         FROM (SELECT b.*, ${STAGE_SQL} AS stage FROM bills b WHERE b.bill_type IN ${LAWMAKING_TYPES}) b ${join}
        GROUP BY 1 ORDER BY 1`,
    );
  return {
    all: funnel("'All bills'"),
    by_chamber: funnel("b.origin_chamber"),
    by_party: funnel("COALESCE(m.party, '?')", "LEFT JOIN members m ON m.bioguide_id = b.sponsor_id"),
  };
}

function billOutput(db: DatabaseSync) {
  return {
    introduced: all(
      db,
      `SELECT substr(introduced_date, 1, 7) AS month,
              SUM(bill_type IN ('hr', 'hjres')) AS house_bills,
              SUM(bill_type IN ('s', 'sjres')) AS senate_bills,
              SUM(bill_type IN ('hres', 'sres', 'hconres', 'sconres')) AS resolutions
         FROM bills WHERE introduced_date IS NOT NULL GROUP BY 1 ORDER BY 1`,
    ),
    laws: all(
      db,
      `SELECT substr(status_date, 1, 7) AS month, COUNT(*) AS laws
         FROM bills WHERE status = 'became_law' AND status_date IS NOT NULL GROUP BY 1 ORDER BY 1`,
    ),
  };
}

// Party unity follows the usual definition: on votes where most Democrats and most
// Republicans voted opposite ways, how often a member sided with their own party.
// Independents are counted with Democrats, with whom both current Independents caucus.
const UNITY_VOTES_SQL = `
  WITH party_pos AS (
    SELECT roll_call_id, CASE party WHEN 'R' THEN 'R' ELSE 'D' END AS p,
           SUM(position = 'yea') AS y, SUM(position = 'nay') AS n
      FROM member_votes GROUP BY 1, 2
  )
  SELECT d.roll_call_id,
         CASE WHEN d.y > d.n THEN 'yea' ELSE 'nay' END AS d_pos,
         CASE WHEN r.y > r.n THEN 'yea' ELSE 'nay' END AS r_pos
    FROM party_pos d JOIN party_pos r ON r.roll_call_id = d.roll_call_id
   WHERE d.p = 'D' AND r.p = 'R' AND d.y <> d.n AND r.y <> r.n AND (d.y > d.n) <> (r.y > r.n)`;

function memberStats(db: DatabaseSync) {
  const rows = all<{
    id: string; name: string; party: string; state: string; chamber: string; district: number | null;
    in_office: number; votes: number; missed: number; unity_votes: number; with_party: number;
    sponsored: number; cosponsored: number; with_cosponsors: number; bipartisan: number;
    terms: number; since: string | null;
  }>(
    db,
    `WITH unity AS (${UNITY_VOTES_SQL}),
     attendance AS (
       SELECT bioguide_id, COUNT(*) AS votes, SUM(position = 'not_voting') AS missed
         FROM member_votes GROUP BY 1
     ),
     loyalty AS (
       SELECT mv.bioguide_id, COUNT(*) AS unity_votes,
              SUM(mv.position = CASE WHEN mv.party = 'R' THEN u.r_pos ELSE u.d_pos END) AS with_party
         FROM member_votes mv JOIN unity u ON u.roll_call_id = mv.roll_call_id
        WHERE mv.position IN ('yea', 'nay') GROUP BY 1
     ),
     sponsored AS (
       SELECT b.sponsor_id AS bioguide_id, COUNT(*) AS sponsored,
              SUM(EXISTS (SELECT 1 FROM bill_cosponsors c WHERE c.bill_id = b.id)) AS with_cosponsors,
              SUM(EXISTS (SELECT 1 FROM bill_cosponsors c JOIN members cm ON cm.bioguide_id = c.bioguide_id
                           WHERE c.bill_id = b.id
                             AND (cm.party = 'R') <> (m.party = 'R'))) AS bipartisan
         FROM bills b JOIN members m ON m.bioguide_id = b.sponsor_id GROUP BY 1
     ),
     cosponsored AS (SELECT bioguide_id, COUNT(*) AS cosponsored FROM bill_cosponsors GROUP BY 1),
     tenure AS (SELECT bioguide_id, COUNT(*) AS terms, MIN(start_date) AS since FROM member_terms GROUP BY 1)
     SELECT m.bioguide_id AS id, m.full_name AS name, m.party, m.state, m.chamber, m.district, m.in_office,
            COALESCE(a.votes, 0) AS votes, COALESCE(a.missed, 0) AS missed,
            COALESCE(l.unity_votes, 0) AS unity_votes, COALESCE(l.with_party, 0) AS with_party,
            COALESCE(s.sponsored, 0) AS sponsored, COALESCE(c.cosponsored, 0) AS cosponsored,
            COALESCE(s.with_cosponsors, 0) AS with_cosponsors, COALESCE(s.bipartisan, 0) AS bipartisan,
            COALESCE(t.terms, 0) AS terms, substr(t.since, 1, 4) AS since
       FROM members m
       LEFT JOIN attendance a ON a.bioguide_id = m.bioguide_id
       LEFT JOIN loyalty l ON l.bioguide_id = m.bioguide_id
       LEFT JOIN sponsored s ON s.bioguide_id = m.bioguide_id
       LEFT JOIN cosponsored c ON c.bioguide_id = m.bioguide_id
       LEFT JOIN tenure t ON t.bioguide_id = m.bioguide_id
      ORDER BY m.bioguide_id`,
  );
  const pct = (part: number, whole: number) => (whole ? Math.round((1000 * part) / whole) / 10 : null);
  // Stored as a table (field names once, then one array per member) to keep the document small.
  const fields = [
    "id", "name", "party", "state", "chamber", "district", "in_office", "votes", "missed_pct",
    "unity_votes", "party_unity_pct", "sponsored", "cosponsored", "bipartisan_pct", "terms", "since",
  ];
  return {
    fields,
    rows: rows.map((r) => [
      r.id, r.name, r.party, r.state, r.chamber, r.district, r.in_office, r.votes, pct(r.missed, r.votes),
      r.unity_votes, pct(r.with_party, r.unity_votes), r.sponsored, r.cosponsored,
      pct(r.bipartisan, r.with_cosponsors), r.terms, r.since,
    ]),
  };
}

function voteMargins(db: DatabaseSync) {
  return all(
    db,
    `WITH unity AS (${UNITY_VOTES_SQL})
     SELECT substr(r.vote_date, 1, 7) AS month, r.chamber,
            COUNT(*) AS votes,
            SUM(r.id IN (SELECT roll_call_id FROM unity)) AS party_line,
            SUM(r.yea + r.nay > 0 AND abs(r.yea - r.nay) <= 0.05 * (r.yea + r.nay)) AS close
       FROM roll_calls r WHERE r.vote_date IS NOT NULL
      GROUP BY 1, 2 ORDER BY 1, 2`,
  );
}

function topicTrends(db: DatabaseSync) {
  const top = all<{ area: string }>(
    db,
    `SELECT policy_area AS area FROM bills WHERE policy_area IS NOT NULL
      GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 10`,
  ).map((r) => r.area);
  const rows = all<{ quarter: string; area: string; bills: number }>(
    db,
    `SELECT substr(introduced_date, 1, 4) || '-Q' || ((CAST(substr(introduced_date, 6, 2) AS INTEGER) + 2) / 3) AS quarter,
            policy_area AS area, COUNT(*) AS bills
       FROM bills WHERE policy_area IS NOT NULL AND introduced_date IS NOT NULL
      GROUP BY 1, 2 ORDER BY 1`,
  );
  return { areas: top, rows: rows.filter((r) => top.includes(r.area)) };
}

function overview(db: DatabaseSync) {
  return one(
    db,
    `SELECT (SELECT COUNT(*) FROM bills) AS bills,
            (SELECT COUNT(*) FROM bills WHERE status = 'became_law') AS laws,
            (SELECT COUNT(*) FROM roll_calls) AS votes,
            (SELECT SUM(yea) FROM roll_calls) AS yea_total,
            (SELECT SUM(nay) FROM roll_calls) AS nay_total,
            (SELECT ROUND(100.0 * SUM((result LIKE '%pass%' OR result LIKE '%agreed%' OR result LIKE '%confirmed%'
                                       OR result LIKE '%adopted%' OR result LIKE '%sustained%')
                                      AND result NOT LIKE '%not %') / COUNT(*), 1)
               FROM roll_calls) AS vote_pass_pct,
            (SELECT COUNT(*) FROM members WHERE in_office = 1) AS members,
            (SELECT MAX(latest_action_date) FROM bills) AS latest_action,
            (SELECT MAX(vote_date) FROM roll_calls WHERE chamber = 'house') AS latest_house_vote,
            (SELECT MAX(vote_date) FROM roll_calls WHERE chamber = 'senate') AS latest_senate_vote`,
  );
}

// Every vote in each chamber's session, in order, for the margin timeline on a vote page:
// one stored row instead of a scan of every roll call on each view.
// Keyed '{congress}-{chamber}-{session}'; each entry is [id, roll, yea, nay, date, question].
function voteTimelines(db: DatabaseSync) {
  const out: Record<string, unknown[][]> = {};
  for (const r of all<{ id: string; congress: number; chamber: string; session: number; roll_number: number; yea: number; nay: number; vote_date: string | null; question: string | null }>(
    db,
    "SELECT id, congress, chamber, session, roll_number, yea, nay, vote_date, question FROM roll_calls ORDER BY congress, chamber, session, roll_number",
  )) {
    (out[`${r.congress}-${r.chamber}-${r.session}`] ??= []).push([r.id, r.roll_number, r.yea, r.nay, r.vote_date, r.question]);
  }
  return out;
}

// Names, districts and photos of every member, so a page listing a vote's 435 or 100 voters
// needn't look each one up. Each entry is [id, full name, last name, district, photo].
function memberDirectory(db: DatabaseSync) {
  return all<{ bioguide_id: string; full_name: string; last_name: string | null; district: number | null; photo_url: string | null }>(
    db,
    "SELECT bioguide_id, full_name, last_name, district, photo_url FROM members ORDER BY bioguide_id",
  ).map((m) => [m.bioguide_id, m.full_name, m.last_name, m.district, m.photo_url]);
}

export async function syncStats(db: DatabaseSync): Promise<string> {
  const stats: Record<string, unknown> = {
    overview: overview(db),
    topics: topics(db),
    pass_rates: passRates(db),
    bill_output: billOutput(db),
    member_stats: memberStats(db),
    vote_margins: voteMargins(db),
    topic_trends: topicTrends(db),
    vote_timelines: voteTimelines(db),
    member_directory: memberDirectory(db),
  };
  const now = nowIso();
  transaction(db, () => {
    for (const [key, value] of Object.entries(stats)) {
      upsert(db, "site_stats", { key, json: JSON.stringify(value), updated_at: now }, ["key"]);
    }
  });
  return `${Object.keys(stats).length} stat documents`;
}
