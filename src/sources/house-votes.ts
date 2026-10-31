// House roll-call votes from the Office of the Clerk (public domain), one XML file per vote.
import type { DatabaseSync } from "node:sqlite";
import { CONGRESS, congressYears, nowIso } from "../config.ts";
import { getState, replaceChildren, setState, transaction, upsert, type Row } from "../db.ts";
import { getText, mapLimit } from "../http.ts";
import { billIdFromRef } from "../bill-ids.ts";
import { list, parseXml, text, type Node } from "../xml.ts";

const CLERK = "https://clerk.house.gov/evs";
const BATCH = 6;

const POSITIONS: Record<string, string> = {
  Yea: "yea",
  Aye: "yea",
  Nay: "nay",
  No: "nay",
  Present: "present",
  "Not Voting": "not_voting",
};

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// '3-Jul-2025' -> '2025-07-03'
export function clerkDate(s: string | null): string | null {
  const m = s?.match(/^(\d{1,2})-(\w{3})-(\d{4})$/);
  return m ? `${m[3]}-${MONTHS[m[2]] ?? "00"}-${m[1].padStart(2, "0")}` : null;
}

export function voteUrl(year: number, roll: number): string {
  return `${CLERK}/${year}/roll${String(roll).padStart(3, "0")}.xml`;
}

export function parseHouseVote(xml: string, url: string, syncedAt: string): { rollCall: Row; votes: Row[] } | null {
  const doc: Node = parseXml(xml);
  // A vote that doesn't exist yet comes back as a short error document, not a 404.
  const rv = doc["rollcall-vote"];
  if (!rv) return null;
  const meta = rv["vote-metadata"];
  const congress = Number(text(meta.congress));
  const session = parseInt(text(meta.session) ?? "", 10); // '1st' -> 1
  const roll = Number(text(meta["rollcall-num"]));
  const id = `h-${congress}-${session}-${roll}`;

  const votes = list(rv["vote-data"]?.["recorded-vote"]).flatMap((r: Node) => {
    const bioguide = r.legislator?.["@_name-id"];
    if (typeof bioguide !== "string" || !/^[A-Z]\d{6}$/.test(bioguide)) return [];
    const raw = text(r.vote) ?? "";
    const position = POSITIONS[raw] ?? "other";
    return [
      {
        roll_call_id: id,
        bioguide_id: bioguide,
        position,
        detail: position === "other" ? raw : null,
        party: r.legislator["@_party"] ?? null,
        state: r.legislator["@_state"] ?? null,
      },
    ];
  });
  const count = (p: string) => votes.filter((v) => v.position === p).length;
  const ref = text(meta["legis-num"]);

  return {
    rollCall: {
      id,
      chamber: "house",
      congress,
      session,
      roll_number: roll,
      vote_date: clerkDate(text(meta["action-date"])),
      question: text(meta["vote-question"]),
      vote_type: text(meta["vote-type"]),
      result: text(meta["vote-result"]),
      description: text(meta["vote-desc"]),
      majority_requirement: null,
      bill_id: billIdFromRef(congress, ref),
      subject_ref: ref,
      yea: count("yea"),
      nay: count("nay"),
      present: count("present"),
      not_voting: count("not_voting"),
      source: "house-clerk",
      official_url: url,
      synced_at: syncedAt,
    },
    votes,
  };
}

export async function syncHouseVotes(db: DatabaseSync): Promise<string> {
  const thisYear = new Date().getFullYear();
  let added = 0;

  for (const { session, year } of congressYears(CONGRESS)) {
    if (year > thisYear) continue;
    const key = `house-votes:${CONGRESS}:${session}:last-roll`;
    let next = Number(getState(db, key) ?? 0) + 1;

    for (;;) {
      const rolls = Array.from({ length: BATCH }, (_, i) => next + i);
      const syncedAt = nowIso();
      const parsed = await mapLimit(rolls, BATCH, async (roll) =>
        parseHouseVote(await getText(voteUrl(year, roll)), voteUrl(year, roll), syncedAt),
      );
      const lastFound = parsed.findLastIndex((p) => p !== null);
      if (lastFound === -1) break; // a whole batch missing: we've reached the latest vote

      parsed.slice(0, lastFound + 1).forEach((p, i) => {
        if (!p) console.warn(`  House ${year} roll ${rolls[i]} is missing; skipped`);
      });
      transaction(db, () => {
        for (const p of parsed) {
          if (!p) continue;
          upsert(db, "roll_calls", p.rollCall, ["id"]);
          replaceChildren(db, "member_votes", "roll_call_id", String(p.rollCall.id), p.votes);
          added++;
        }
        setState(db, key, String(rolls[lastFound]));
      });
      if (lastFound < BATCH - 1) break;
      next += BATCH;
    }
  }
  return `${added} new House votes`;
}
