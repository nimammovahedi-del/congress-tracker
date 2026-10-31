// Columns added to existing tables after they were first created. `CREATE TABLE IF NOT
// EXISTS` in db/schema.sql gives new databases these columns, but databases that already
// exist (the local copy, GitHub's cached copy, and Cloudflare D1) need them added once.
export const ADDED_COLUMNS = [{ table: "bills", column: "search_text", type: "TEXT" }];

// ALTER statements for the columns `has` says are missing.
export function columnMigrations(has: (table: string, column: string) => boolean): string[] {
  return ADDED_COLUMNS.filter((c) => !has(c.table, c.column)).map((c) => `ALTER TABLE ${c.table} ADD COLUMN ${c.column} ${c.type};`);
}
