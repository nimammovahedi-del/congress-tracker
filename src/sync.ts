// Pull the latest data from every source into the local database.
//
//   npm run sync                      all sources
//   npm run sync -- bills senate-votes   only the named steps
import type { DatabaseSync } from "node:sqlite";
import { openDb, run } from "./db.ts";
import { recomputeStatuses, syncBills } from "./sources/bills.ts";
import { syncFederalRegister } from "./sources/federal-register.ts";
import { syncHouseVotes } from "./sources/house-votes.ts";
import { syncMembers } from "./sources/members.ts";
import { syncStats } from "./sources/stats.ts";
import { syncSenateVotes } from "./sources/voteview.ts";

// Members go first: the Voteview step adds scores to existing member rows.
const STEPS: Record<string, (db: DatabaseSync) => Promise<string>> = {
  members: syncMembers,
  bills: syncBills,
  statuses: recomputeStatuses,
  "house-votes": syncHouseVotes,
  "senate-votes": syncSenateVotes,
  "federal-register": syncFederalRegister,
  stats: syncStats,
};

// Fill in a vote's bill from the bill's own action history when the vote source
// didn't name one (e.g. some procedural votes).
function linkVotesToBills(db: DatabaseSync): void {
  run(
    db,
    `UPDATE roll_calls
        SET bill_id = (SELECT r.bill_id FROM bill_vote_refs r WHERE r.roll_call_id = roll_calls.id ORDER BY r.bill_id LIMIT 1)
      WHERE bill_id IS NULL
        AND EXISTS (SELECT 1 FROM bill_vote_refs r WHERE r.roll_call_id = roll_calls.id)`,
  );
}

const requested = process.argv.slice(2);
const unknown = requested.filter((s) => !(s in STEPS));
if (unknown.length) {
  console.error(`Unknown step: ${unknown.join(", ")}. Steps: ${Object.keys(STEPS).join(", ")}`);
  process.exit(1);
}

const db = openDb();
const failures: string[] = [];
for (const [name, step] of Object.entries(STEPS)) {
  if (requested.length && !requested.includes(name)) continue;
  const started = Date.now();
  console.log(`→ ${name}`);
  try {
    const summary = await step(db);
    console.log(`✓ ${name}: ${summary} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (err) {
    failures.push(name);
    console.error(`✗ ${name} failed: ${(err as Error).stack ?? err}`);
  }
}
linkVotesToBills(db);
db.close();

if (failures.length) {
  console.error(`\nFinished with failures: ${failures.join(", ")}`);
  process.exitCode = 1;
}
