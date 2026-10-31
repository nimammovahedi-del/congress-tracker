// Bills and resolutions from GovInfo's BILLSTATUS bulk data (public domain).
// This is the same data Congress.gov shows, and it needs no API key.
import type { DatabaseSync } from "node:sqlite";
import { unzipSync } from "fflate";
import { BILL_TYPES, CONGRESS, type BillType, nowIso } from "../config.ts";
import { all, one, replaceChildren, run, transaction, upsert, type Row } from "../db.ts";
import { getBytes, getJson, getText, mapLimit } from "../http.ts";
import { billId, congressGovUrl } from "../bill-ids.ts";
import { type ActionLike, deriveStatus, pickTitle } from "../bill-status.ts";
import { list, parseXml, text, type Node } from "../xml.ts";

const BULK = "https://www.govinfo.gov/bulkdata";

interface ListingFile {
  name: string;
  link: string;
  fileExtension: string;
  folder: boolean;
  formattedLastModifiedTime: string; // e.g. '30-Oct-2026 20:45'
}

export interface ParsedBill {
  bill: Row;
  children: { table: string; rows: Row[] }[];
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// '30-Oct-2026 20:45' -> '2026-10-30 20:45', so times compare as strings.
export function listingTime(s: string): string {
  const m = s.match(/^(\d{1,2})-(\w{3})-(\d{4}) (\d{2}:\d{2})$/);
  return m ? `${m[3]}-${MONTHS[m[2]] ?? "00"}-${m[1].padStart(2, "0")} ${m[4]}` : s;
}

function rollCallId(chamber: string, congress: number, session: number, roll: number): string {
  return `${chamber.toLowerCase().startsWith("s") ? "s" : "h"}-${congress}-${session}-${roll}`;
}

export function parseBillStatus(xml: string, syncedAt: string): ParsedBill {
  const b: Node = parseXml(xml).billStatus.bill;
  const congress = Number(text(b.congress));
  const type = String(text(b.type)).toLowerCase() as BillType;
  const number = Number(text(b.number));
  const id = billId(congress, type, number);

  // The source lists actions newest first; store them oldest first.
  const sortedActions = list(b.actions?.item)
    .reverse()
    .map((a: Node) => ({ raw: a, date: text(a.actionDate) ?? "", time: text(a.actionTime) ?? "" }))
    .sort((x, y) => (x.date + x.time < y.date + y.time ? -1 : x.date + x.time > y.date + y.time ? 1 : 0));
  const actions = sortedActions.map(({ raw }, seq) => ({
    bill_id: id,
    seq,
    action_date: text(raw.actionDate) ?? "",
    action_time: text(raw.actionTime),
    text: text(raw.text) ?? "",
    action_type: text(raw.type),
    action_code: text(raw.actionCode),
    source: text(raw.sourceSystem?.name),
  }));

  const voteRefs = sortedActions.flatMap(({ raw }, seq) =>
    list(raw.recordedVotes?.recordedVote).map((v: Node) => ({
      bill_id: id,
      roll_call_id: rollCallId(
        text(v.chamber) ?? "",
        Number(text(v.congress) ?? congress),
        Number(text(v.sessionNumber)),
        Number(text(v.rollNumber)),
      ),
      action_seq: seq,
      action_date: actions[seq].action_date,
      action_text: actions[seq].text,
    })),
  );

  const cosponsors = list(b.cosponsors?.item).map((c: Node) => ({
    bill_id: id,
    bioguide_id: text(c.bioguideId),
    sponsorship_date: text(c.sponsorshipDate),
    is_original: text(c.isOriginalCosponsor) === "True",
    withdrawn_date: text(c.sponsorshipWithdrawnDate),
  }));

  const subjects = list(b.subjects?.legislativeSubjects?.item).map((s: Node) => ({ bill_id: id, subject: text(s.name) }));

  const committees = list(b.committees?.item).map((c: Node) => ({
    bill_id: id,
    committee_code: text(c.systemCode),
    name: text(c.name),
    chamber: text(c.chamber),
  }));

  const textVersions = list(b.textVersions?.item).flatMap((t: Node, seq: number) => {
    const url = text(list(t.formats?.item)[0]?.url);
    return url ? [{ bill_id: id, seq, version_type: text(t.type), version_date: text(t.date), url }] : [];
  });

  const related = list(b.relatedBills?.item).flatMap((r: Node) =>
    list(r.relationshipDetails?.item).map((d: Node) => ({
      bill_id: id,
      related_bill_id: billId(Number(text(r.congress)), String(text(r.type)), Number(text(r.number))),
      relationship: text(d.type) ?? "Related bill",
      identified_by: text(d.identifiedBy) ?? "",
    })),
  );

  const cbo = list(b.cboCostEstimates?.item).flatMap((e: Node) => {
    const url = text(e.url);
    return url
      ? [{ bill_id: id, pub_date: text(e.pubDate), title: text(e.title), url, description: text(e.description) }]
      : [];
  });

  // Keep the most recent CRS summary.
  const summary = list(b.summaries?.summary)
    .map((s: Node) => ({
      version: text(s.actionDesc),
      date: text(s.actionDate) ?? "",
      updated: text(s.updateDate) ?? "",
      html: text(s.text),
    }))
    .sort((x, y) => (x.date + x.updated < y.date + y.updated ? -1 : 1))
    .at(-1);

  const laws = list(b.laws?.item).map((l: Node) => text(l.number)).filter(Boolean);
  const titles = list(b.titles?.item).map((t: Node) => ({ type: text(t.titleType) ?? "", title: text(t.title) ?? "" }));
  const officialTitle = text(b.title) ?? "";
  const sponsor = list(b.sponsors?.item)[0];
  const status = deriveStatus(type, actions, laws.length > 0);

  const bill: Row = {
    id,
    congress,
    bill_type: type,
    number,
    title: pickTitle(titles, officialTitle),
    official_title: officialTitle,
    origin_chamber: text(b.originChamber),
    introduced_date: text(b.introducedDate),
    sponsor_id: text(sponsor?.bioguideId),
    policy_area: text(b.policyArea?.name) ?? text(b.subjects?.policyArea?.name),
    status: status.status,
    status_date: status.date,
    latest_action_date: text(b.latestAction?.actionDate),
    latest_action_text: text(b.latestAction?.text),
    law_number: laws[0] ?? null,
    cosponsor_count: cosponsors.filter((c) => !c.withdrawn_date).length,
    crs_summary: summary?.html ?? null,
    crs_summary_version: summary?.version ?? null,
    crs_summary_date: summary?.date || null,
    text_url: textVersions[0]?.url ?? null,
    text_version: textVersions[0]?.version_type ?? null,
    congress_gov_url: congressGovUrl(congress, type, number),
    source_updated_at: text(b.updateDate),
    synced_at: syncedAt,
  };

  return {
    bill,
    children: [
      { table: "bill_actions", rows: actions },
      { table: "bill_vote_refs", rows: voteRefs },
      { table: "bill_cosponsors", rows: cosponsors },
      { table: "bill_subjects", rows: subjects },
      { table: "bill_committees", rows: committees },
      { table: "bill_text_versions", rows: textVersions },
      { table: "related_bills", rows: related },
      { table: "cbo_estimates", rows: cbo },
    ],
  };
}

function saveBill(db: DatabaseSync, parsed: ParsedBill): void {
  upsert(db, "bills", parsed.bill, ["id"]);
  for (const { table, rows } of parsed.children) {
    replaceChildren(db, table, "bill_id", String(parsed.bill.id), rows);
  }
}

// Parse and save bill files, 500 per database transaction. Returns how many failed.
function saveAll(db: DatabaseSync, files: { name: string; xml: string }[]): number {
  const syncedAt = nowIso();
  let failed = 0;
  for (let i = 0; i < files.length; i += 500) {
    transaction(db, () => {
      for (const f of files.slice(i, i + 500)) {
        try {
          saveBill(db, parseBillStatus(f.xml, syncedAt));
        } catch (err) {
          failed++;
          console.warn(`  could not read ${f.name}: ${(err as Error).message}`);
        }
      }
    });
  }
  return failed;
}

// Re-derive every bill's status from its stored actions. Runs after each sync so
// changes to the status rules apply to all bills without re-downloading anything.
export async function recomputeStatuses(db: DatabaseSync): Promise<string> {
  const bills = all<{ id: string; bill_type: string; law_number: string | null }>(
    db,
    "SELECT id, bill_type, law_number FROM bills",
  );
  const actionsByBill = new Map<string, ActionLike[]>();
  for (const a of all<ActionLike & { bill_id: string }>(
    db,
    "SELECT bill_id, action_date, action_code, text FROM bill_actions ORDER BY bill_id, seq",
  )) {
    const rows = actionsByBill.get(a.bill_id);
    if (rows) rows.push(a);
    else actionsByBill.set(a.bill_id, [a]);
  }
  let changed = 0;
  transaction(db, () => {
    for (const b of bills) {
      const s = deriveStatus(b.bill_type, actionsByBill.get(b.id) ?? [], b.law_number !== null);
      const before = one<{ status: string; status_date: string | null }>(
        db,
        "SELECT status, status_date FROM bills WHERE id = ?",
        b.id,
      );
      if (before?.status === s.status && before.status_date === s.date) continue;
      run(db, "UPDATE bills SET status = ?, status_date = ? WHERE id = ?", s.status, s.date, b.id);
      changed++;
    }
  });
  return `${changed} of ${bills.length} bill statuses changed`;
}

export async function syncBills(db: DatabaseSync): Promise<string> {
  const decoder = new TextDecoder();
  let updated = 0;
  let total = 0;
  let failed = 0;

  for (const type of BILL_TYPES) {
    const folder = `${BULK}/BILLSTATUS/${CONGRESS}/${type}`;
    const listing = await getJson<{ files: ListingFile[] }>(`${BULK}/json/BILLSTATUS/${CONGRESS}/${type}`);
    const files = listing.files.filter((f) => !f.folder && f.fileExtension === "xml");
    const zip = listing.files.find((f) => f.fileExtension === "zip");
    total += files.length;

    const known = new Map(
      all<{ url: string; last_modified: string }>(
        db,
        "SELECT url, last_modified FROM source_files WHERE url LIKE ?",
        `${folder}/%`,
      ).map((r) => [r.url, r.last_modified]),
    );
    const changed = files.filter((f) => known.get(f.link) !== f.formattedLastModifiedTime);
    if (changed.length === 0) continue;

    let toFetch = changed;
    // On the first run, or after a large change, one zip download beats hundreds of requests.
    if (zip && (known.size === 0 || changed.length > 500)) {
      const entries = unzipSync(await getBytes(zip.link), { filter: (f) => f.name.endsWith(".xml") });
      failed += saveAll(
        db,
        Object.entries(entries).map(([name, bytes]) => ({ name, xml: decoder.decode(bytes) })),
      );
      // Files changed after the zip was built still need fetching one by one.
      const zipTime = listingTime(zip.formattedLastModifiedTime);
      toFetch = changed.filter((f) => listingTime(f.formattedLastModifiedTime) > zipTime);
    }

    const fetched = await mapLimit(toFetch, 6, async (f) => ({ name: f.name, xml: await getText(f.link) }));
    failed += saveAll(db, fetched);

    const now = nowIso();
    transaction(db, () => {
      for (const f of changed) {
        upsert(db, "source_files", { url: f.link, last_modified: f.formattedLastModifiedTime, synced_at: now }, ["url"]);
      }
    });
    updated += changed.length;
    console.log(`  ${type}: ${changed.length} new or changed of ${files.length}`);
  }

  return `${updated} new or changed of ${total} bills${failed ? `, ${failed} could not be read` : ""}`;
}
