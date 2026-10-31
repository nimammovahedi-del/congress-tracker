// Rules, proposed rules, and presidential documents from the Federal Register API
// (public domain, no key). Notices are left out: there are 10,000+ a year.
import type { DatabaseSync } from "node:sqlite";
import { CONGRESS, congressDates, nowIso, todayIso } from "../config.ts";
import { getState, setState, transaction, upsert } from "../db.ts";
import { getJson } from "../http.ts";

const API = "https://www.federalregister.gov/api/v1/documents.json";
const TYPES = ["RULE", "PRORULE", "PRESDOCU"];
const FIELDS = [
  "document_number", "type", "subtype", "title", "abstract", "action", "agencies",
  "publication_date", "effective_on", "comments_close_on", "signing_date",
  "executive_order_number", "significant", "docket_ids", "regulation_id_numbers",
  "html_url", "pdf_url",
];

interface FrDocument {
  document_number: string;
  type: string;
  subtype: string | null;
  title: string;
  abstract: string | null;
  action: string | null;
  agencies: { name?: string; raw_name?: string }[] | null;
  publication_date: string;
  effective_on: string | null;
  comments_close_on: string | null;
  signing_date: string | null;
  executive_order_number: number | null;
  significant: boolean | null;
  docket_ids: string[] | null;
  regulation_id_numbers: string[] | null;
  html_url: string;
  pdf_url: string | null;
}

interface FrPage {
  results?: FrDocument[];
  next_page_url?: string | null;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Split a date range into calendar months; the API caps any one query at 10,000 results.
export function monthWindows(from: string, to: string): [string, string][] {
  const windows: [string, string][] = [];
  let start = from;
  while (start <= to) {
    const d = new Date(`${start}T00:00:00Z`);
    const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const end = monthEnd < to ? monthEnd : to;
    windows.push([start, end]);
    start = addDays(end, 1);
  }
  return windows;
}

function queryUrl(from: string, to: string): string {
  const params = new URLSearchParams({ per_page: "1000", order: "oldest" });
  for (const t of TYPES) params.append("conditions[type][]", t);
  params.append("conditions[publication_date][gte]", from);
  params.append("conditions[publication_date][lte]", to);
  for (const f of FIELDS) params.append("fields[]", f);
  return `${API}?${params}`;
}

export async function syncFederalRegister(db: DatabaseSync): Promise<string> {
  const key = `federal-register:${CONGRESS}:synced-through`;
  const last = getState(db, key);
  // Re-read the last week each time to pick up corrections.
  const from = last ? addDays(last, -7) : congressDates(CONGRESS).start;
  const to = todayIso();
  let saved = 0;

  for (const [start, end] of monthWindows(from, to)) {
    let url: string | null = queryUrl(start, end);
    while (url) {
      const page: FrPage = await getJson<FrPage>(url);
      const syncedAt = nowIso();
      transaction(db, () => {
        for (const d of page.results ?? []) {
          upsert(
            db,
            "fr_documents",
            {
              document_number: d.document_number,
              doc_type: d.type,
              subtype: d.subtype,
              title: d.title,
              abstract: d.abstract,
              action: d.action,
              agencies: JSON.stringify((d.agencies ?? []).map((a) => a.name ?? a.raw_name).filter(Boolean)),
              publication_date: d.publication_date,
              effective_on: d.effective_on,
              comments_close_on: d.comments_close_on,
              signing_date: d.signing_date,
              executive_order_number: d.executive_order_number,
              significant: d.significant,
              docket_ids: JSON.stringify(d.docket_ids ?? []),
              regulation_id_numbers: JSON.stringify(d.regulation_id_numbers ?? []),
              html_url: d.html_url,
              pdf_url: d.pdf_url,
              synced_at: syncedAt,
            },
            ["document_number"],
          );
          saved++;
        }
      });
      url = page.next_page_url ?? null;
    }
  }
  setState(db, key, to);
  return `${saved} documents published ${from} to ${to}`;
}
