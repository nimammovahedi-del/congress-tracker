// Database access. Pages read Cloudflare D1, which charges per row read, so queries
// use indexes and precomputed figures (site_stats) instead of scanning whole tables.
import { env } from "cloudflare:workers";

type Param = string | number | null;

export async function rows<T>(sql: string, ...params: Param[]): Promise<T[]> {
  const result = await env.DB.prepare(sql).bind(...params).all<T>();
  return result.results;
}

export async function row<T>(sql: string, ...params: Param[]): Promise<T | null> {
  return env.DB.prepare(sql).bind(...params).first<T>();
}

// Precomputed figures change at most hourly; keep them in memory for a few minutes.
const statCache = new Map<string, { at: number; value: unknown }>();
const STAT_TTL_MS = 5 * 60_000;

export async function stat<T>(key: string): Promise<T | null> {
  const hit = statCache.get(key);
  if (hit && Date.now() - hit.at < STAT_TTL_MS) return hit.value as T;
  const r = await row<{ json: string }>("SELECT json FROM site_stats WHERE key = ?", key);
  const value = r ? (JSON.parse(r.json) as T) : null;
  statCache.set(key, { at: Date.now(), value });
  return value;
}

// When the data was last refreshed (the hourly job rewrites the overview each run).
let syncCache: { at: number; value: string | null } | null = null;
export async function lastSync(): Promise<string | null> {
  if (syncCache && Date.now() - syncCache.at < STAT_TTL_MS) return syncCache.value;
  const r = await row<{ updated_at: string }>("SELECT updated_at FROM site_stats WHERE key = 'overview'");
  syncCache = { at: Date.now(), value: r?.updated_at ?? null };
  return syncCache.value;
}

// ---- Shapes of what pages read ----

export interface Bill {
  id: string;
  congress: number;
  bill_type: string;
  number: number;
  title: string;
  official_title: string | null;
  origin_chamber: string | null;
  introduced_date: string | null;
  sponsor_id: string | null;
  policy_area: string | null;
  status: string;
  status_date: string | null;
  latest_action_date: string | null;
  latest_action_text: string | null;
  law_number: string | null;
  cosponsor_count: number;
  crs_summary: string | null;
  crs_summary_version: string | null;
  crs_summary_date: string | null;
  ai_summary: string | null;
  text_url: string | null;
  text_version: string | null;
  congress_gov_url: string;
}

// The columns lists of bills need, with the sponsor joined in.
export type BillListItem = Pick<
  Bill,
  "id" | "bill_type" | "number" | "title" | "status" | "status_date" | "latest_action_date" | "latest_action_text" | "policy_area" | "cosponsor_count"
> & { sponsor_name: string | null; sponsor_party: string | null; sponsor_state: string | null };

export const BILL_LIST_COLUMNS = `b.id, b.bill_type, b.number, b.title, b.status, b.status_date, b.latest_action_date,
  b.latest_action_text, b.policy_area, b.cosponsor_count,
  m.full_name AS sponsor_name, m.party AS sponsor_party, m.state AS sponsor_state`;
export const BILL_LIST_JOIN = "LEFT JOIN members m ON m.bioguide_id = b.sponsor_id";

export interface Member {
  bioguide_id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  party: string | null;
  state: string | null;
  district: number | null;
  chamber: string | null;
  in_office: number;
  term_start: string | null;
  term_end: string | null;
  phone: string | null;
  office: string | null;
  website: string | null;
  contact_form: string | null;
  photo_url: string | null;
  nominate_dim1: number | null;
}

export interface RollCall {
  id: string;
  chamber: string;
  congress: number;
  session: number;
  roll_number: number;
  vote_date: string | null;
  question: string | null;
  vote_type: string | null;
  result: string | null;
  description: string | null;
  majority_requirement: string | null;
  bill_id: string | null;
  subject_ref: string | null;
  yea: number;
  nay: number;
  present: number;
  not_voting: number;
  source: string;
  official_url: string | null;
}

export interface MemberVote {
  bioguide_id: string;
  position: string;
  detail: string | null;
  party: string | null;
  state: string | null;
  full_name: string | null;
  last_name: string | null;
  district: number | null;
  photo_url: string | null;
}

export async function memberVotes(rollCallId: string): Promise<MemberVote[]> {
  return rows<MemberVote>(
    `SELECT mv.bioguide_id, mv.position, mv.detail, mv.party, mv.state,
            m.full_name, m.last_name, m.district, m.photo_url
       FROM member_votes mv LEFT JOIN members m ON m.bioguide_id = mv.bioguide_id
      WHERE mv.roll_call_id = ?`,
    rollCallId,
  );
}

export interface Topic {
  area: string;
  slug: string;
  bills: number;
  laws: number;
  advanced: number;
  latest: string;
  subjects: { name: string; slug: string; bills: number }[];
}

export interface MemberStats {
  id: string;
  name: string;
  party: string;
  state: string;
  chamber: string;
  district: number | null;
  in_office: boolean;
  votes: number;
  missed_pct: number | null;
  unity_votes: number;
  party_unity_pct: number | null;
  sponsored: number;
  cosponsored: number;
  bipartisan_pct: number | null;
  terms: number;
  since: string | null;
}

// member_stats is stored as { fields, rows } to keep it small; expand it here.
export async function memberStats(): Promise<MemberStats[]> {
  const doc = await stat<{ fields: string[]; rows: unknown[][] }>("member_stats");
  if (!doc) return [];
  return doc.rows.map((r) => Object.fromEntries(doc.fields.map((f, i) => [f, r[i]])) as unknown as MemberStats);
}
