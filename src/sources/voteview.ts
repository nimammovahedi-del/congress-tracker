// Senate roll-call votes, plus DW-NOMINATE scores for both chambers, from Voteview (UCLA).
// Voteview asks to be cited: Lewis, Poole, Rosenthal, Boche, Rudkin & Sonnet,
// "Voteview: Congressional Roll-Call Votes Database", https://voteview.com/
// Its data trails the Senate by up to about a month; bills show the vote totals from
// their action history in the meantime.
import type { DatabaseSync } from "node:sqlite";
import { parse } from "csv-parse/sync";
import { CONGRESS, nowIso } from "../config.ts";
import { replaceChildren, run, transaction, upsert, type Row } from "../db.ts";
import { getText } from "../http.ts";
import { billIdFromRef } from "../bill-ids.ts";

const VOTEVIEW = "https://voteview.com/static/data/out";

type CsvRow = Record<string, string>;

const PARTIES: Record<string, string> = { "100": "D", "200": "R", "328": "I" };

// Voteview cast codes: 1-3 yea (incl. paired/announced), 4-6 nay, 7-8 present, 9 not voting.
export function castPosition(code: string): string | null {
  const n = Number(code);
  if (n >= 1 && n <= 3) return "yea";
  if (n >= 4 && n <= 6) return "nay";
  if (n === 7 || n === 8) return "present";
  if (n === 9) return "not_voting";
  return null; // 0 = not a member at the time
}

export function senateVoteUrl(congress: number, session: number, roll: number): string {
  return (
    `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/` +
    `vote_${congress}_${session}_${String(roll).padStart(5, "0")}.htm`
  );
}

async function csv(file: string): Promise<CsvRow[]> {
  return parse(await getText(`${VOTEVIEW}/${file}`), { columns: true, skip_empty_lines: true }) as CsvRow[];
}

const num = (s: string | undefined) => (s === undefined || s === "" ? null : Number(s));

export async function syncSenateVotes(db: DatabaseSync): Promise<string> {
  const c = CONGRESS;
  const [rollcalls, votes, senators, representatives] = await Promise.all([
    csv(`rollcalls/S${c}_rollcalls.csv`),
    csv(`votes/S${c}_votes.csv`),
    csv(`members/S${c}_members.csv`),
    csv(`members/H${c}_members.csv`),
  ]);

  const senatorsByIcpsr = new Map<string, CsvRow>();
  for (const m of senators) if (m.chamber === "Senate" && m.bioguide_id) senatorsByIcpsr.set(m.icpsr, m);

  const votesByRoll = new Map<string, CsvRow[]>();
  for (const v of votes) {
    const rows = votesByRoll.get(v.rollnumber);
    if (rows) rows.push(v);
    else votesByRoll.set(v.rollnumber, [v]);
  }

  const syncedAt = nowIso();
  let latest = "";
  transaction(db, () => {
    for (const m of [...senators, ...representatives]) {
      if (!m.bioguide_id || m.chamber === "President") continue;
      run(
        db,
        "UPDATE members SET nominate_dim1 = ?, nominate_dim2 = ? WHERE bioguide_id = ?",
        num(m.nominate_dim1),
        num(m.nominate_dim2),
        m.bioguide_id,
      );
    }

    for (const r of rollcalls) {
      const session = Number(r.session);
      const roll = Number(r.clerk_rollnumber);
      const id = `s-${c}-${session}-${roll}`;
      const positions: Row[] = [];
      for (const v of votesByRoll.get(r.rollnumber) ?? []) {
        const senator = senatorsByIcpsr.get(v.icpsr);
        const position = castPosition(v.cast_code);
        if (!senator || !position) continue;
        positions.push({
          roll_call_id: id,
          bioguide_id: senator.bioguide_id,
          position,
          detail: null,
          party: PARTIES[senator.party_code] ?? null,
          state: senator.state_abbrev,
        });
      }
      const count = (p: string) => positions.filter((v) => v.position === p).length;
      upsert(
        db,
        "roll_calls",
        {
          id,
          chamber: "senate",
          congress: c,
          session,
          roll_number: roll,
          vote_date: r.date,
          question: r.vote_question || null,
          vote_type: null,
          result: r.vote_result || null,
          description: r.vote_desc || r.dtl_desc || null,
          majority_requirement: r.majority_requirement || null,
          bill_id: billIdFromRef(c, r.bill_number),
          subject_ref: r.bill_number || null,
          yea: count("yea"),
          nay: count("nay"),
          present: count("present"),
          not_voting: count("not_voting"),
          source: "voteview",
          official_url: senateVoteUrl(c, session, roll),
          synced_at: syncedAt,
        },
        ["id"],
      );
      replaceChildren(db, "member_votes", "roll_call_id", id, positions);
      if (r.date > latest) latest = r.date;
    }
  });
  return `${rollcalls.length} Senate votes (latest ${latest || "none"})`;
}
