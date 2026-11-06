import assert from "node:assert/strict";
import { test } from "node:test";
import type { Row } from "../src/db.ts";
import { changedTables, estimateRows, sqlLiteral, unitSql, UNIT_TYPES, type Unit } from "../src/units.ts";

const billType = UNIT_TYPES.find((t) => t.prefix === "bill")!;

function bill(summary: string, actions: number): Unit {
  return {
    id: "bill:119-hr-1",
    type: billType,
    key: "119-hr-1",
    sortDate: "2025-07-04",
    parts: new Map<string, Row[]>([
      ["bills", [{ id: "119-hr-1", title: "One Big Beautiful Bill Act", crs_summary: summary }]],
      ["bill_actions", Array.from({ length: actions }, (_, seq) => ({ bill_id: "119-hr-1", seq, text: "x".repeat(500) }))],
    ]),
    hashes: { bills: "a", bill_actions: "b", bill_cosponsors: "c" },
  };
}

test("SQL literals escape quotes and handle every value type", () => {
  assert.equal(sqlLiteral("O'Brien"), "'O''Brien'");
  assert.equal(sqlLiteral(null), "NULL");
  assert.equal(sqlLiteral(undefined), "NULL");
  assert.equal(sqlLiteral(42), "42");
  assert.equal(sqlLiteral(true), "1");
  assert.equal(sqlLiteral(Number.NaN), "NULL");
});

test("only tables whose fingerprint changed are resent", () => {
  const unit = bill("short", 1);
  assert.deepEqual(changedTables(unit, undefined), ["bills", "bill_actions", "bill_cosponsors"]);
  assert.deepEqual(changedTables(unit, { bills: "a", bill_actions: "OLD", bill_cosponsors: "c" }), ["bill_actions"]);
  assert.deepEqual(changedTables(unit, unit.hashes), []);
});

test("long text is sent in pieces and every statement stays under D1's 100 KB limit", () => {
  const summary = "<p>" + "a".repeat(174_000) + "</p>";
  const unit = bill(summary, 400);
  const statements = unitSql(unit, ["bills", "bill_actions"], unit.hashes, "now");
  for (const s of statements) assert.ok(s.length < 100_000, `statement of ${s.length} bytes`);
  const pieces = statements.filter((s) => s.startsWith("UPDATE bills SET crs_summary = crs_summary ||"));
  assert.equal(pieces.length, 5);
  assert.equal(pieces.map((s) => s.match(/\|\| '(.*)' WHERE/s)![1]).join(""), summary);
  assert.ok(statements[0].includes("crs_summary") && statements[0].includes("''"), "inserted empty, then appended");
  assert.equal(statements.filter((s) => s.startsWith("DELETE FROM bill_actions")).length, 1);
  assert.ok(statements.filter((s) => s.startsWith("INSERT OR REPLACE INTO bill_actions")).length > 1, "actions split across statements");
  assert.ok(statements.at(-1)!.startsWith("INSERT INTO published_units"));
});

test("write estimates count a changed child table twice (delete and reinsert)", () => {
  const unit = bill("short", 10);
  assert.equal(estimateRows(unit, ["bills", "bill_actions"], true), 1 + 1 + 10);
  assert.equal(estimateRows(unit, ["bill_actions"], false), 1 + 20);
});
