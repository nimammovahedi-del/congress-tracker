// Data is uploaded to the hosted database in units: a bill with its actions,
// cosponsors, and so on; a roll call with its member votes; a member with their
// terms; or a Federal Register document. Each table within a unit gets a
// fingerprint, so an upload resends only the tables that changed.
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { all, type Row, type Value } from "./db.ts";

// Columns that change on every sync even when the data doesn't.
const VOLATILE = new Set(["synced_at", "updated_at"]);

interface ChildTable {
  table: string;
  parent: string; // column holding the unit's key
  order: string; // stable row order, for fingerprints
}

export interface UnitType {
  prefix: string;
  table: string;
  key: string;
  sortDate: string | null; // newest first when uploading for the first time
  children: ChildTable[];
}

export const UNIT_TYPES: UnitType[] = [
  {
    prefix: "member",
    table: "members",
    key: "bioguide_id",
    sortDate: null, // members go first: every other page refers to them
    children: [{ table: "member_terms", parent: "bioguide_id", order: "start_date, chamber" }],
  },
  {
    prefix: "bill",
    table: "bills",
    key: "id",
    sortDate: "latest_action_date",
    children: [
      { table: "bill_actions", parent: "bill_id", order: "seq" },
      { table: "bill_vote_refs", parent: "bill_id", order: "roll_call_id" },
      { table: "bill_cosponsors", parent: "bill_id", order: "bioguide_id" },
      { table: "bill_subjects", parent: "bill_id", order: "subject" },
      { table: "bill_committees", parent: "bill_id", order: "committee_code" },
      { table: "bill_text_versions", parent: "bill_id", order: "seq" },
      { table: "related_bills", parent: "bill_id", order: "related_bill_id, relationship, identified_by" },
      { table: "cbo_estimates", parent: "bill_id", order: "url" },
    ],
  },
  {
    prefix: "vote",
    table: "roll_calls",
    key: "id",
    sortDate: "vote_date",
    children: [{ table: "member_votes", parent: "roll_call_id", order: "bioguide_id" }],
  },
  { prefix: "fr", table: "fr_documents", key: "document_number", sortDate: "publication_date", children: [] },
];

export interface Unit {
  id: string; // e.g. 'bill:119-hr-1'
  type: UnitType;
  key: string;
  sortDate: string;
  parts: Map<string, Row[]>; // table -> rows; the unit's own table has one row
  hashes: Record<string, string>; // table -> fingerprint
}

function fingerprint(rows: Row[]): string {
  const hash = createHash("sha1");
  for (const row of rows) {
    hash.update(JSON.stringify(Object.entries(row).filter(([col]) => !VOLATILE.has(col))));
  }
  return hash.digest("base64url").slice(0, 16);
}

export function loadUnits(db: DatabaseSync): Unit[] {
  const units: Unit[] = [];
  for (const type of UNIT_TYPES) {
    const byKey = new Map<string, Unit>();
    for (const row of all<Row>(db, `SELECT * FROM ${type.table} ORDER BY ${type.key}`)) {
      const key = String(row[type.key]);
      const unit: Unit = {
        id: `${type.prefix}:${key}`,
        type,
        key,
        sortDate: type.sortDate ? String(row[type.sortDate] ?? "") : "9999",
        parts: new Map([[type.table, [row]]]),
        hashes: {},
      };
      byKey.set(key, unit);
      units.push(unit);
    }
    for (const child of type.children) {
      for (const row of all<Row>(db, `SELECT * FROM ${child.table} ORDER BY ${child.parent}, ${child.order}`)) {
        const unit = byKey.get(String(row[child.parent]));
        if (!unit) continue;
        const rows = unit.parts.get(child.table);
        if (rows) rows.push(row);
        else unit.parts.set(child.table, [row]);
      }
    }
    for (const unit of byKey.values()) {
      for (const table of [type.table, ...type.children.map((c) => c.table)]) {
        unit.hashes[table] = fingerprint(unit.parts.get(table) ?? []);
      }
    }
  }
  return units;
}

// Tables whose content differs from what was last uploaded (all of them for a new unit).
export function changedTables(unit: Unit, uploaded: Record<string, string> | undefined): string[] {
  return Object.keys(unit.hashes).filter((t) => uploaded?.[t] !== unit.hashes[t]);
}

// ---- SQL generation ----

// D1 rejects statements over 100 KB; stay well under it.
const MAX_STATEMENT = 90_000;
// Longer text values are sent in pieces (only a couple of CRS summaries are this long).
const LONG_TEXT = 40_000;

export function sqlLiteral(v: Value): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  return `'${String(v).replaceAll("\0", "").replaceAll("'", "''")}'`;
}

function upsertRow(table: string, key: string, row: Row): string[] {
  const cols = Object.keys(row);
  const long = cols.filter((c) => typeof row[c] === "string" && (row[c] as string).length > LONG_TEXT);
  const values = cols.map((c) => (long.includes(c) ? "''" : sqlLiteral(row[c])));
  const updates = cols.filter((c) => c !== key).map((c) => `${c} = excluded.${c}`);
  const statements = [
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${values.join(", ")}) ` +
      `ON CONFLICT (${key}) DO UPDATE SET ${updates.join(", ")};`,
  ];
  for (const col of long) {
    const text = row[col] as string;
    for (let i = 0; i < text.length; i += LONG_TEXT) {
      statements.push(
        `UPDATE ${table} SET ${col} = ${col} || ${sqlLiteral(text.slice(i, i + LONG_TEXT))} ` +
          `WHERE ${key} = ${sqlLiteral(row[key])};`,
      );
    }
  }
  return statements;
}

function replaceRows(table: string, parent: string, parentKey: string, rows: Row[]): string[] {
  const statements = [`DELETE FROM ${table} WHERE ${parent} = ${sqlLiteral(parentKey)};`];
  if (rows.length === 0) return statements;
  const cols = Object.keys(rows[0]);
  const head = `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES `;
  let tuples: string[] = [];
  let size = head.length;
  for (const row of rows) {
    const tuple = `(${cols.map((c) => sqlLiteral(row[c])).join(", ")})`;
    if (tuples.length && size + tuple.length + 2 > MAX_STATEMENT) {
      statements.push(`${head}${tuples.join(", ")};`);
      tuples = [];
      size = head.length;
    }
    tuples.push(tuple);
    size += tuple.length + 2;
  }
  statements.push(`${head}${tuples.join(", ")};`);
  return statements;
}

// Rows an upload of these tables writes, before index updates. A changed child table
// is deleted and reinserted, so it counts twice unless the unit is new.
export function estimateRows(unit: Unit, tables: string[], isNew: boolean): number {
  let rows = 1; // the published_units row
  for (const table of tables) {
    const n = unit.parts.get(table)?.length ?? 0;
    rows += table === unit.type.table ? 1 : n * (isNew ? 1 : 2);
  }
  return rows;
}

// SQL that brings the hosted copy of `unit` up to date for the given tables, and records
// the new fingerprints.
export function unitSql(unit: Unit, tables: string[], uploadedAt: string): string[] {
  const statements: string[] = [];
  for (const table of tables) {
    const tableRows = unit.parts.get(table) ?? [];
    if (table === unit.type.table) {
      statements.push(...upsertRow(table, unit.type.key, tableRows[0]));
    } else {
      const child = unit.type.children.find((c) => c.table === table)!;
      statements.push(...replaceRows(table, child.parent, unit.key, tableRows));
    }
  }
  statements.push(
    `INSERT INTO published_units (unit, hash, published_at) VALUES ` +
      `(${sqlLiteral(unit.id)}, ${sqlLiteral(JSON.stringify(unit.hashes))}, ${sqlLiteral(uploadedAt)}) ` +
      `ON CONFLICT (unit) DO UPDATE SET hash = excluded.hash, published_at = excluded.published_at;`,
  );
  return statements;
}
