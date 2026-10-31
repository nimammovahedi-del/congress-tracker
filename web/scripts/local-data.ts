// Fill the website's local development database with the full data from the pipeline
// (../data/congress.db, built by `npm run sync` in the project root).
//
//   npm run data
//
// `astro dev` runs the site against a local stand-in for Cloudflare D1 that lives under
// .wrangler/state. This creates that database, then copies every table into it directly,
// which takes seconds instead of replaying a 150 MB SQL file. Stop `npm run dev` first.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(WEB, "..");
const SOURCE = path.join(ROOT, "data", "congress.db");
const D1_DIR = path.join(WEB, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
const TABLES = [
  "members", "member_terms", "bills", "bill_actions", "bill_cosponsors", "bill_subjects",
  "bill_committees", "bill_text_versions", "related_bills", "cbo_estimates", "bill_vote_refs",
  "roll_calls", "member_votes", "fr_documents", "site_stats",
];

if (!fs.existsSync(SOURCE)) {
  console.error(`No data yet. Run \`npm run sync\` in ${ROOT} first.`);
  process.exit(1);
}

// Let Wrangler create the local database file, then find it.
execFileSync(path.join(WEB, "node_modules", ".bin", "wrangler"), ["d1", "execute", "congress-tracker", "--local", "--command", "SELECT 1"], {
  cwd: WEB,
  stdio: "ignore",
});
const files = fs.readdirSync(D1_DIR).filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
if (files.length !== 1) {
  console.error(`Expected one local database in ${D1_DIR}, found ${files.length}.`);
  process.exit(1);
}

const db = new DatabaseSync(path.join(D1_DIR, files[0]));
for (const table of [...TABLES, "bills_fts"]) db.exec(`DROP TABLE IF EXISTS ${table}`);
db.exec(fs.readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8"));
db.exec(fs.readFileSync(path.join(ROOT, "db", "site.sql"), "utf8"));
db.exec(`ATTACH DATABASE '${SOURCE.replaceAll("'", "''")}' AS source`);
db.exec("BEGIN");
for (const table of TABLES) {
  const cols = (db.prepare(`PRAGMA main.table_info(${table})`).all() as { name: string }[]).map((c) => c.name).join(", ");
  db.exec(`INSERT INTO main.${table} (${cols}) SELECT ${cols} FROM source.${table}`);
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM main.${table}`).get() as { n: number };
  console.log(`${table.padEnd(20)} ${n.toLocaleString()} rows`);
}
db.exec("COMMIT");
db.exec("DETACH DATABASE source");
db.close();
console.log("Local database ready. Run `npm run dev`.");
