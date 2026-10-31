// AI-written bill summaries and the search text built from every bill's descriptions.
//
// Summaries live as JSON files in summaries/bills/<bill id>.json, committed to the repo, so
// they survive database rebuilds (the hourly job rebuilds from government sources) and stay
// reviewable. "full" summaries stand in for a missing official summary; "clarification"
// summaries add plain-English detail beside a thin one.
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ROOT } from "../config.ts";
import { all, run, transaction } from "../db.ts";

const DIR = path.join(ROOT, "summaries", "bills");

interface SummaryFile {
  id: string;
  kind: "full" | "clarification";
  overview: string;
  for: string;
  against: string;
  text_version?: string;
  text_url?: string;
  written?: string;
  model?: string;
}

function isSummary(s: Partial<SummaryFile>): s is SummaryFile {
  return (
    typeof s.id === "string" &&
    (s.kind === "full" || s.kind === "clarification") &&
    typeof s.overview === "string" &&
    typeof s.for === "string" &&
    typeof s.against === "string"
  );
}

export async function syncSummaries(db: DatabaseSync): Promise<string> {
  if (!fs.existsSync(DIR)) return "no summaries yet";
  let loaded = 0;
  const problems: string[] = [];
  transaction(db, () => {
    for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()) {
      let s: Partial<SummaryFile>;
      try {
        s = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
      } catch {
        problems.push(`${file}: not valid JSON`);
        continue;
      }
      if (!isSummary(s)) {
        problems.push(`${file}: missing id, kind, overview, for, or against`);
        continue;
      }
      const stored = {
        kind: s.kind,
        overview: s.overview,
        for: s.for,
        against: s.against,
        text_version: s.text_version ?? null,
        text_url: s.text_url ?? null,
        written: s.written ?? null,
        model: s.model ?? null,
      };
      run(db, "UPDATE bills SET ai_summary = ?, ai_summary_updated_at = ? WHERE id = ?", JSON.stringify(stored), s.written ?? null, s.id);
      loaded++;
    }
  });
  for (const p of problems) console.warn(`  skipped ${p}`);
  return `${loaded} AI summaries${problems.length ? `, ${problems.length} skipped` : ""}`;
}

const stripTags = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;|&#\d+;/gi, " ").replace(/\s+/g, " ").trim();

// Words people search with often aren't in a bill's title. Give search a plain-text field
// with the policy area, subject tags, and summaries (official and AI).
export async function buildSearchText(db: DatabaseSync): Promise<string> {
  const subjects = new Map<string, string[]>();
  for (const r of all<{ bill_id: string; subject: string }>(db, "SELECT bill_id, subject FROM bill_subjects ORDER BY bill_id")) {
    const list = subjects.get(r.bill_id);
    if (list) list.push(r.subject);
    else subjects.set(r.bill_id, [r.subject]);
  }
  const bills = all<{ id: string; policy_area: string | null; crs_summary: string | null; ai_summary: string | null; search_text: string | null }>(
    db,
    "SELECT id, policy_area, crs_summary, ai_summary, search_text FROM bills",
  );
  let changed = 0;
  transaction(db, () => {
    for (const b of bills) {
      let ai = "";
      if (b.ai_summary) {
        try {
          ai = (JSON.parse(b.ai_summary) as { overview?: string }).overview ?? "";
        } catch {
          // a malformed summary just adds nothing to search
        }
      }
      const text = [b.policy_area ?? "", (subjects.get(b.id) ?? []).join(" · "), stripTags(b.crs_summary ?? "").slice(0, 2500), ai]
        .filter(Boolean)
        .join(" · ");
      if (text === (b.search_text ?? "")) continue;
      run(db, "UPDATE bills SET search_text = ? WHERE id = ?", text, b.id);
      changed++;
    }
  });
  return `${changed} of ${bills.length} bills' search text updated`;
}
