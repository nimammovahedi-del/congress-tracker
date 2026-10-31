// Vote math shared by vote and bill pages.
import type { MemberStats, MemberVote, RollCall } from "./db";

export interface Threshold {
  label: string; // 'SIMPLE', '2/3', '3/5'
  needed: number; // yeas needed to pass
}

// What a vote needed to pass. House suspension votes need two-thirds of those voting; Senate
// cloture needs three-fifths of the full Senate (60); most others need a simple majority.
export function threshold(r: RollCall): Threshold {
  const voting = r.yea + r.nay;
  const rule = r.majority_requirement ?? (/2\/3/.test(r.vote_type ?? "") ? "2/3" : "1/2");
  if (rule === "2/3") return { label: "2/3", needed: Math.ceil((2 * voting) / 3) };
  if (rule === "3/5") return { label: "3/5", needed: r.chamber === "senate" ? 60 : Math.ceil((3 * voting) / 5) };
  return { label: "SIMPLE", needed: Math.floor(voting / 2) + 1 };
}

export function passed(r: RollCall): boolean | null {
  if (!r.result) return null;
  if (/fail|reject|\bnot\b|defeat/i.test(r.result)) return false;
  if (/pass|agree|confirm|adopt|sustain/i.test(r.result)) return true;
  return null;
}

// The kind of question a roll call decided, for the vote directory's categories.
export const VOTE_CATEGORIES = [
  { key: "passage", label: "Passage" },
  { key: "amendments", label: "Amendments" },
  { key: "nominations", label: "Nominations" },
  { key: "cloture", label: "Cloture" },
  { key: "procedural", label: "Procedural" },
] as const;

export const CATEGORY_SQL = `CASE
  WHEN r.subject_ref LIKE 'PN%' OR r.question LIKE '%Nomination%' THEN 'nominations'
  WHEN r.question LIKE '%Cloture%' THEN 'cloture'
  WHEN r.question LIKE '%Passage%' OR r.question LIKE '%and Pass%' OR r.question LIKE '%Concur%'
    OR r.question LIKE '%Agreeing to the Resolution%' OR r.question LIKE 'On the Resolution%'
    OR r.question LIKE 'On the Joint Resolution%' OR r.question LIKE 'On the Concurrent Resolution%'
    OR r.question LIKE '%Conference Report%' OR r.question LIKE '%Veto%' THEN 'passage'
  WHEN r.question LIKE '%Amendment%' THEN 'amendments'
  ELSE 'procedural' END`;

// Members' details for the seat inspector, keyed by Bioguide ID, in a compact form the
// page embeds as JSON.
export interface SeatInfo {
  n: string; // name
  p: string; // party
  s: string; // state
  d: number | null; // district
  v: string; // position
  x: string | null; // raw vote when position is 'other'
  ph: string | null; // photo
  u: number | null; // party unity %
  sp: number | null; // bills sponsored
  t: number | null; // terms served
  si: string | null; // serving since (year)
}

export function seatInfo(votes: (MemberVote & { photo_url?: string | null })[], stats: MemberStats[]): Record<string, SeatInfo> {
  const byId = new Map(stats.map((s) => [s.id, s]));
  return Object.fromEntries(
    votes.map((v) => {
      const s = byId.get(v.bioguide_id);
      return [
        v.bioguide_id,
        {
          n: v.full_name ?? v.bioguide_id,
          p: v.party === "D" || v.party === "R" ? v.party : "I",
          s: v.state ?? "",
          d: v.district,
          v: v.position,
          x: v.detail,
          ph: v.photo_url ?? null,
          u: s?.party_unity_pct ?? null,
          sp: s?.sponsored ?? null,
          t: s?.terms ?? null,
          si: s?.since ?? null,
        },
      ];
    }),
  );
}
