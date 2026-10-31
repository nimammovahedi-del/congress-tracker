import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { DB_PATH, ROOT, nowIso } from "./config.ts";
import { columnMigrations } from "./migrations.ts";

export type Value = string | number | boolean | null | undefined;
export type Row = Record<string, Value>;

export function openDb(file: string = DB_PATH): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(fs.readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8"));
  const has = (table: string, column: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
  for (const sql of columnMigrations(has)) db.exec(sql);
  return db;
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const statements = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

function prepare(db: DatabaseSync, sql: string): StatementSync {
  let cache = statements.get(db);
  if (!cache) statements.set(db, (cache = new Map()));
  let stmt = cache.get(sql);
  if (!stmt) cache.set(sql, (stmt = db.prepare(sql)));
  return stmt;
}

// SQLite has no boolean type, and the driver rejects undefined.
function toSql(v: Value): string | number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

// Insert a row, or update the existing row that has the same key columns.
export function upsert(db: DatabaseSync, table: string, row: Row, keys: string[]): void {
  const cols = Object.keys(row);
  const updates = cols.filter((c) => !keys.includes(c));
  const onConflict = updates.length
    ? `DO UPDATE SET ${updates.map((c) => `${c} = excluded.${c}`).join(", ")}`
    : "DO NOTHING";
  const sql =
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) ` +
    `ON CONFLICT (${keys.join(", ")}) ${onConflict}`;
  prepare(db, sql).run(...cols.map((c) => toSql(row[c])));
}

// Insert a row, replacing any existing row with the same primary key.
export function insertOrReplace(db: DatabaseSync, table: string, row: Row): void {
  const cols = Object.keys(row);
  const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
  prepare(db, sql).run(...cols.map((c) => toSql(row[c])));
}

// Replace all of a parent's child rows, e.g. every action of one bill.
export function replaceChildren(db: DatabaseSync, table: string, parentCol: string, parentId: string, rows: Row[]): void {
  prepare(db, `DELETE FROM ${table} WHERE ${parentCol} = ?`).run(parentId);
  for (const row of rows) insertOrReplace(db, table, row);
}

export function getState(db: DatabaseSync, key: string): string | undefined {
  const row = prepare(db, "SELECT value FROM sync_state WHERE key = ?").get(key) as { value: string | null } | undefined;
  return row?.value ?? undefined;
}

export function setState(db: DatabaseSync, key: string, value: string): void {
  upsert(db, "sync_state", { key, value, updated_at: nowIso() }, ["key"]);
}

export function all<T>(db: DatabaseSync, sql: string, ...params: (string | number | null)[]): T[] {
  return prepare(db, sql).all(...params) as T[];
}

export function one<T>(db: DatabaseSync, sql: string, ...params: (string | number | null)[]): T | undefined {
  return prepare(db, sql).get(...params) as T | undefined;
}

export function run(db: DatabaseSync, sql: string, ...params: (string | number | null)[]): void {
  prepare(db, sql).run(...params);
}
