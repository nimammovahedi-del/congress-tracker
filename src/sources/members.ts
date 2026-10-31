// Members of Congress from the unitedstates/congress-legislators project (public domain).
import type { DatabaseSync } from "node:sqlite";
import { CONGRESS, congressDates, nowIso, todayIso } from "../config.ts";
import { all, replaceChildren, transaction, upsert } from "../db.ts";
import { getJson } from "../http.ts";

const BASE = "https://unitedstates.github.io/congress-legislators";

interface Term {
  type: "rep" | "sen";
  start: string;
  end: string;
  state: string;
  district?: number;
  party?: string;
  url?: string;
  address?: string;
  office?: string;
  phone?: string;
  contact_form?: string;
}

interface Legislator {
  id: { bioguide: string; lis?: string; govtrack?: number; icpsr?: number };
  name: { first: string; last: string; official_full?: string };
  bio?: { birthday?: string; gender?: string };
  terms: Term[];
}

export function partyCode(party: string | undefined | null): string | null {
  if (!party) return null;
  return { Democrat: "D", Republican: "R", Independent: "I" }[party] ?? party.slice(0, 1).toUpperCase();
}

export async function syncMembers(db: DatabaseSync): Promise<string> {
  const { start, end } = congressDates(CONGRESS);
  const [current, historical] = await Promise.all([
    getJson<Legislator[]>(`${BASE}/legislators-current.json`),
    getJson<Legislator[]>(`${BASE}/legislators-historical.json`),
  ]);
  const currentIds = new Set(current.map((l) => l.id.bioguide));
  // Anyone already named in our votes or bills, even if their term ended the day the
  // Congress began (e.g. someone who appears only in the opening-day votes).
  const referenced = new Set(
    all<{ id: string }>(
      db,
      `SELECT bioguide_id AS id FROM member_votes
       UNION SELECT sponsor_id FROM bills WHERE sponsor_id IS NOT NULL
       UNION SELECT bioguide_id FROM bill_cosponsors`,
    ).map((r) => r.id),
  );
  // Everyone who served at any point during the tracked Congress, including people
  // who resigned or died, since they still cast votes.
  const people = [...current, ...historical].filter(
    (l) => referenced.has(l.id.bioguide) || l.terms.some((t) => t.start < end && t.end > start),
  );
  const today = todayIso();
  const now = nowIso();

  transaction(db, () => {
    for (const l of people) {
      const t = l.terms[l.terms.length - 1];
      upsert(
        db,
        "members",
        {
          bioguide_id: l.id.bioguide,
          full_name: l.name.official_full ?? `${l.name.first} ${l.name.last}`,
          first_name: l.name.first,
          last_name: l.name.last,
          party: partyCode(t.party),
          state: t.state,
          district: t.type === "rep" ? (t.district ?? null) : null,
          chamber: t.type === "sen" ? "senate" : "house",
          in_office: currentIds.has(l.id.bioguide) && t.end > today,
          term_start: t.start,
          term_end: t.end,
          phone: t.phone,
          office: t.office ?? t.address,
          website: t.url,
          contact_form: t.contact_form,
          birthday: l.bio?.birthday,
          gender: l.bio?.gender,
          icpsr_id: l.id.icpsr,
          lis_id: l.id.lis,
          govtrack_id: l.id.govtrack,
          photo_url: `https://unitedstates.github.io/images/congress/450x550/${l.id.bioguide}.jpg`,
          updated_at: now,
        },
        ["bioguide_id"],
      );
      replaceChildren(
        db,
        "member_terms",
        "bioguide_id",
        l.id.bioguide,
        l.terms.map((term) => ({
          bioguide_id: l.id.bioguide,
          chamber: term.type === "sen" ? "senate" : "house",
          state: term.state,
          district: term.type === "rep" ? (term.district ?? null) : null,
          party: partyCode(term.party),
          start_date: term.start,
          end_date: term.end,
        })),
      );
    }
  });
  return `${people.length} members (${people.filter((l) => currentIds.has(l.id.bioguide)).length} currently serving)`;
}
