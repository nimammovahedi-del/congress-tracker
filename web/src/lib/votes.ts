// Vote math shared by vote and bill pages.
import type { MemberStats, MemberVote, RollCall } from "./db";
import { billNumberFromId } from "./format";

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

// The rule in words, with a sentence explaining it for people who haven't met it before.
export function ruleInfo(t: Threshold): { name: string; tip: string } {
  if (t.label === "2/3")
    return {
      name: "Two-thirds",
      tip: "Two of every three members voting must vote yes. The House uses this for bills brought up under “suspension of the rules”, a fast track with short debate and no amendments. Both chambers need it to override a veto.",
    };
  if (t.label === "3/5")
    return {
      name: "Three-fifths",
      tip: "In the Senate, 60 senators must vote yes. This is the rule for cloture, the vote that ends debate (or a filibuster) so the Senate can move on to a final vote.",
    };
  return { name: "Simple majority", tip: "More than half of the members voting must vote yes." };
}

// A plain-English line for the kinds of question people most often don't recognise
// ("On Motion to Suspend the Rules and Pass", "On the Cloture Motion"...). Null when the
// question explains itself.
export function explainQuestion(question: string | null | undefined, nomination = false): string | null {
  const q = question ?? "";
  if (/suspend the rules/i.test(q))
    return "Suspension of the rules is a House fast track for bills with broad support: debate is short, no changes are allowed, and two-thirds must vote yes.";
  if (/cloture/i.test(q))
    return "Cloture is a Senate vote to end debate so a bill or nomination can get a final vote. It usually needs 60 senators.";
  if (/motion to proceed/i.test(q)) return "A motion to proceed is a vote on whether the Senate should start debating this item.";
  if (/recommit|motion to commit|motion to refer/i.test(q)) return "This motion asks to send the bill back to a committee instead of voting on it now.";
  if (/previous question/i.test(q)) return "Ordering the previous question ends debate and moves the House straight to a vote, usually on the rules for debating a bill.";
  if (/table/i.test(q)) return "A motion to table sets a proposal aside, which usually ends it.";
  if (/discharge/i.test(q)) return "A motion to discharge pulls a bill or nomination out of a committee so the full chamber can take it up.";
  if (/objections of the president|veto/i.test(q)) return "A vote to override the President's veto. It needs two-thirds of both chambers.";
  if (/concur/i.test(q)) return "To concur is to accept the other chamber's changes, so both have passed the same text.";
  if (/conference report/i.test(q)) return "A conference report is the final text that negotiators from both chambers agreed on.";
  if (/quorum|call by states|call of the house/i.test(q)) return "A quorum call checks that enough members are present to do business.";
  if (/adjourn/i.test(q)) return "A vote to end the day's session.";
  if (/point of order|decision of the chair/i.test(q)) return "A vote on a ruling about the chamber's own procedure.";
  if (nomination || /nomination/i.test(q)) return "A vote to confirm someone the President nominated, such as a judge or agency head.";
  return null;
}

// What a vote was on, as a short tag: the bill number, a nomination, or the vote's number.
export function voteRef(r: { bill_id: string | null; subject_ref: string | null; roll_number: number }): string {
  if (r.bill_id) return billNumberFromId(r.bill_id);
  if (r.subject_ref?.startsWith("PN")) return `Nomination ${r.subject_ref.slice(2)}`;
  return `Vote ${r.roll_number}`;
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
