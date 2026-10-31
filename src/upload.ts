// Copy what changed in the local database to the hosted database (Cloudflare D1),
// spending no more than a daily budget of row writes.
//
//   npm run upload
//
// Settings (environment variables):
//   D1_DAILY_WRITE_BUDGET  rows written per day, default 45000 (Cloudflare's free plan
//                          allows 100,000 per account per day; the rest stays free for
//                          other projects on the same account)
//   D1_RUN_LIMIT           optional cap for a single run, e.g. for testing
//
// The budget is spread across the day so later hourly runs still have room for fresh
// updates. Updates to data already uploaded go first; then new data, newest first.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT, nowIso, todayIso } from "./config.ts";
import { d1ExecuteFile, d1Query } from "./d1.ts";
import { all, getState, one, openDb, setState, transaction, upsert } from "./db.ts";
import { ADDED_COLUMNS, columnMigrations } from "./migrations.ts";
import { changedTables, estimateRows, loadUnits, unitSql, type Unit } from "./units.ts";

const DAILY_BUDGET = Number(process.env.D1_DAILY_WRITE_BUDGET ?? 45_000);
const RUN_LIMIT = Number(process.env.D1_RUN_LIMIT ?? Infinity);
const BATCH_ROWS = 4_000; // estimated rows per uploaded file
const BATCH_BYTES = 4_000_000;
const BATCH_FILE = path.join(ROOT, "data", "upload-batch.sql");

const db = openDb();
const today = todayIso(); // Cloudflare's daily limits reset at midnight UTC
const spendKey = `d1-writes:${today}`;

// 1. Learn what the hosted database already has, if this local copy doesn't know yet
//    (for example, a fresh copy in GitHub Actions).
if ((one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM published_units")?.n ?? 0) === 0) {
  const remote = d1Query<{ unit: string; hash: string; published_at: string }>(
    "SELECT unit, hash, published_at FROM published_units",
  );
  transaction(db, () => {
    for (const r of remote) upsert(db, "published_units", r, ["unit"]);
  });
  if (remote.length) console.log(`Learned of ${remote.length} units already uploaded.`);
}

// 2. Bring the hosted database's tables and indexes in line with db/*.sql when they change,
//    and work out today's allowance.
const remoteState = new Map(
  d1Query<{ key: string; value: string }>(
    `SELECT key, value FROM sync_state WHERE key IN ('${spendKey}', 'schema-hash')`,
  ).map((r) => [r.key, r.value]),
);
const schemaFiles = ["schema.sql", "site.sql"].map((f) => path.join(ROOT, "db", f));
const schemaHash = createHash("sha1").update(schemaFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n")).digest("hex");
if (remoteState.get("schema-hash") !== schemaHash) {
  const [schemaFile, siteFile] = schemaFiles;
  d1ExecuteFile(schemaFile);
  // Columns added after a table was created (site.sql's search index needs them).
  const existing = new Set<string>();
  for (const table of new Set(ADDED_COLUMNS.map((c) => c.table))) {
    for (const r of d1Query<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`)) existing.add(`${table}.${r.name}`);
  }
  for (const sql of columnMigrations((table, column) => existing.has(`${table}.${column}`))) d1Query(sql);
  d1ExecuteFile(siteFile);
  d1Query(
    `INSERT INTO sync_state (key, value, updated_at) VALUES ('schema-hash', '${schemaHash}', '${nowIso()}') ` +
      `ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  console.log("Updated the hosted database's tables and indexes.");
}
let spent = Number(remoteState.get(spendKey) ?? 0);
const hour = new Date().getUTCHours();
const evenPace = Math.round((DAILY_BUDGET * (hour + 1)) / 24);
const allowance = Math.min(DAILY_BUDGET - spent, evenPace - spent, RUN_LIMIT);

// 3. Find what changed.
const uploaded = new Map(
  all<{ unit: string; hash: string }>(db, "SELECT unit, hash FROM published_units").map((r) => [
    r.unit,
    JSON.parse(r.hash) as Record<string, string>,
  ]),
);
const pending = loadUnits(db)
  .map((unit) => ({ unit, isNew: !uploaded.has(unit.id), tables: changedTables(unit, uploaded.get(unit.id)) }))
  .filter((p) => p.tables.length > 0)
  .sort((a, b) => Number(a.isNew) - Number(b.isNew) || (a.unit.sortDate < b.unit.sortDate ? 1 : -1));

const newCount = pending.filter((p) => p.isNew).length;
console.log(
  `${pending.length} units to upload (${pending.length - newCount} updated, ${newCount} new). ` +
    `Today: ${spent.toLocaleString()} of ${DAILY_BUDGET.toLocaleString()} writes used; this run may use ${Math.max(allowance, 0).toLocaleString()}.`,
);

// 4. Upload in batches until this run's allowance is used up.
// Cloudflare also counts index updates, so real writes run above the estimate;
// `ratio` learns by how much, and is remembered for the next run.
let ratio = Number(getState(db, "d1-write-ratio") ?? 2);
let used = 0;
let done = 0;
let index = 0;
while (index < pending.length) {
  const batch: Unit[] = [];
  const statements: string[] = [];
  let estimate = 0;
  let bytes = 0;
  while (index < pending.length) {
    const p = pending[index];
    const cost = estimateRows(p.unit, p.tables, p.isNew) * ratio;
    // Always allow one unit per run, so even a large unit eventually goes through.
    if (used + estimate + cost > allowance && (batch.length || used > 0 || allowance <= 0)) break;
    const sql = unitSql(p.unit, p.tables, nowIso());
    batch.push(p.unit);
    statements.push(...sql);
    estimate += cost;
    bytes += sql.reduce((n, s) => n + s.length, 0);
    index++;
    if (estimate >= BATCH_ROWS * ratio || bytes >= BATCH_BYTES) break;
  }
  if (batch.length === 0) break;

  fs.writeFileSync(BATCH_FILE, statements.join("\n"));
  const written = d1ExecuteFile(BATCH_FILE);
  ratio = Math.min(Math.max(written / (estimate / ratio), 1), 5);
  used += written;
  spent += written;
  done += batch.length;
  d1Query(
    `INSERT INTO sync_state (key, value, updated_at) VALUES ('${spendKey}', '${spent}', '${nowIso()}') ` +
      `ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  transaction(db, () => {
    for (const unit of batch) {
      upsert(db, "published_units", { unit: unit.id, hash: JSON.stringify(unit.hashes), published_at: nowIso() }, ["unit"]);
    }
    setState(db, "d1-write-ratio", ratio.toFixed(3));
  });
  console.log(`  uploaded ${batch.length} units, ${written.toLocaleString()} rows written`);
  if (used >= allowance) break;
}
fs.rmSync(BATCH_FILE, { force: true });

// 5. Report progress.
const remaining = pending.slice(done);
if (remaining.length === 0) {
  console.log(`Up to date. ${used.toLocaleString()} rows written this run.`);
} else {
  const remainingRows = remaining.reduce((n, p) => n + estimateRows(p.unit, p.tables, p.isNew), 0) * ratio;
  const days = Math.ceil(remainingRows / DAILY_BUDGET);
  console.log(
    `${done} units uploaded this run (${used.toLocaleString()} rows written). ` +
      `${remaining.length} left, roughly ${Math.round(remainingRows).toLocaleString()} writes: about ${days} more day${days === 1 ? "" : "s"} at this budget.`,
  );
}
db.close();
