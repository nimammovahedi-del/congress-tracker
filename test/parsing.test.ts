import assert from "node:assert/strict";
import { test } from "node:test";
import { billIdFromRef, congressGovUrl } from "../src/bill-ids.ts";
import { deriveStatus, pickTitle } from "../src/bill-status.ts";
import { listingTime, parseBillStatus } from "../src/sources/bills.ts";
import { monthWindows } from "../src/sources/federal-register.ts";
import { clerkDate, parseHouseVote } from "../src/sources/house-votes.ts";
import { castPosition, senateVoteUrl } from "../src/sources/voteview.ts";

test("bill references from every source map to one id format", () => {
  assert.equal(billIdFromRef(119, "H R 1"), "119-hr-1");
  assert.equal(billIdFromRef(119, "H J RES 7"), "119-hjres-7");
  assert.equal(billIdFromRef(119, "HCONRES14"), "119-hconres-14");
  assert.equal(billIdFromRef(119, "SRES21"), "119-sres-21");
  assert.equal(billIdFromRef(119, "S. 5"), "119-s-5");
  assert.equal(billIdFromRef(119, "PN1129"), null);
  assert.equal(billIdFromRef(119, "QUORUM"), null);
});

test("Congress.gov links", () => {
  assert.equal(congressGovUrl(119, "hr", 1), "https://www.congress.gov/bill/119th-congress/house-bill/1");
  assert.equal(congressGovUrl(121, "sjres", 3), "https://www.congress.gov/bill/121st-congress/senate-joint-resolution/3");
});

test("titles prefer the popular name and skip 'portions' titles", () => {
  const titles = [
    { type: "Display Title", title: "An act to provide for reconciliation" },
    { type: "Short Titles as Enacted for portions of this bill", title: "FEHB Protection Act of 2025" },
    { type: "Popular Titles", title: "One Big Beautiful Bill Act" },
  ];
  assert.equal(pickTitle(titles, "fallback"), "One Big Beautiful Bill Act");
  assert.equal(pickTitle([{ type: "Short Title(s) as Introduced", title: "Laken Riley Act" }], "x"), "Laken Riley Act");
  assert.equal(pickTitle([], "Official title"), "Official title");
});

const action = (action_date: string, action_code: string | null, text = "") => ({ action_date, action_code, text });

test("bill status follows the furthest step reached", () => {
  assert.equal(deriveStatus("hr", [action("2025-01-03", "1000")], false).status, "introduced");
  assert.equal(deriveStatus("hr", [action("2025-01-03", "1010")], false).status, "reported");
  assert.equal(deriveStatus("hr", [action("2025-01-03", "1000"), action("2025-02-01", "8000")], false).status, "passed_house");
  assert.equal(deriveStatus("s", [action("2025-02-01", "17000"), action("2025-03-01", "8000")], false).status, "passed_both");
  assert.equal(deriveStatus("hres", [action("2025-02-01", "8000")], false).status, "agreed");
  assert.equal(deriveStatus("hconres", [action("2025-02-01", "8000"), action("2025-03-01", "17000")], false).status, "agreed");
  assert.equal(deriveStatus("hr", [action("2025-02-01", "9000")], false).status, "failed");
  assert.equal(deriveStatus("hr", [action("2025-02-01", "28000"), action("2025-02-10", "31000")], false).status, "vetoed");
  const law = deriveStatus("s", [action("2025-01-29", "36000", "Became Public Law No: 119-1.")], true);
  assert.deepEqual(law, { status: "became_law", date: "2025-01-29" });
});

test("date and time helpers", () => {
  assert.equal(clerkDate("3-Jul-2025"), "2025-07-03");
  assert.equal(listingTime("30-Oct-2026 20:45"), "2026-10-30 20:45");
  assert.deepEqual(monthWindows("2025-01-03", "2025-03-10"), [
    ["2025-01-03", "2025-01-31"],
    ["2025-02-01", "2025-02-28"],
    ["2025-03-01", "2025-03-10"],
  ]);
});

test("Voteview cast codes and Senate links", () => {
  assert.equal(castPosition("1"), "yea");
  assert.equal(castPosition("6"), "nay");
  assert.equal(castPosition("7"), "present");
  assert.equal(castPosition("9"), "not_voting");
  assert.equal(castPosition("0"), null);
  assert.equal(
    senateVoteUrl(119, 2, 256),
    "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00256.htm",
  );
});

test("House Clerk vote files", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<rollcall-vote><vote-metadata>
  <congress>119</congress><session>1st</session><rollcall-num>190</rollcall-num>
  <legis-num>H R 1</legis-num><vote-question>On Motion to Concur in the Senate Amendment</vote-question>
  <vote-type>RECORDED VOTE</vote-type><vote-result>Passed</vote-result><action-date>3-Jul-2025</action-date>
</vote-metadata><vote-data>
  <recorded-vote><legislator name-id="A000370" party="D" state="NC" role="legislator">Adams</legislator><vote>Nay</vote></recorded-vote>
  <recorded-vote><legislator name-id="A000055" party="R" state="AL" role="legislator">Aderholt</legislator><vote>Yea</vote></recorded-vote>
  <recorded-vote><legislator name-id="J000299" party="R" state="LA" role="legislator">Johnson (LA)</legislator><vote>Johnson (LA)</vote></recorded-vote>
</vote-data></rollcall-vote>`;
  const parsed = parseHouseVote(xml, "url", "now");
  assert.ok(parsed);
  assert.equal(parsed.rollCall.id, "h-119-1-190");
  assert.equal(parsed.rollCall.bill_id, "119-hr-1");
  assert.equal(parsed.rollCall.vote_date, "2025-07-03");
  assert.equal(parsed.rollCall.yea, 1);
  assert.equal(parsed.rollCall.nay, 1);
  assert.deepEqual(
    parsed.votes.map((v) => [v.bioguide_id, v.position, v.detail]),
    [["A000370", "nay", null], ["A000055", "yea", null], ["J000299", "other", "Johnson (LA)"]],
  );
  // The Clerk answers a vote that doesn't exist yet with an error document.
  assert.equal(parseHouseVote(`<xml>Error sanitizing file "roll999.xml". Please try again.</xml>`, "url", "now"), null);
});

test("bill status files", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<billStatus><bill>
  <number>5</number><updateDate>2025-02-01T00:00:00Z</updateDate><originChamber>Senate</originChamber>
  <type>S</type><introducedDate>2025-01-06</introducedDate><congress>119</congress>
  <actions>
    <item><actionDate>2025-01-29</actionDate><text>Became Public Law No: 119-1.</text><type>BecameLaw</type><actionCode>36000</actionCode></item>
    <item><actionDate>2025-01-22</actionDate><actionTime>14:00:00</actionTime><text>Passed House 263 - 156 (Roll no. 23).</text><type>Floor</type><actionCode>8000</actionCode>
      <recordedVotes><recordedVote><rollNumber>23</rollNumber><chamber>House</chamber><congress>119</congress><sessionNumber>1</sessionNumber></recordedVote></recordedVotes></item>
    <item><actionDate>2025-01-06</actionDate><text>Introduced in Senate</text><type>IntroReferral</type><actionCode>10000</actionCode></item>
  </actions>
  <sponsors><item><bioguideId>B001319</bioguideId></item></sponsors>
  <cosponsors>
    <item><bioguideId>A000001</bioguideId><isOriginalCosponsor>True</isOriginalCosponsor></item>
    <item><bioguideId>A000002</bioguideId><sponsorshipWithdrawnDate>2025-01-10</sponsorshipWithdrawnDate></item>
  </cosponsors>
  <laws><item><type>Public Law</type><number>119-1</number></item></laws>
  <title>A bill to require the Secretary of Homeland Security to take into custody certain aliens</title>
  <titles><item><titleType>Short Title(s) as Introduced</titleType><title>Laken Riley Act</title></item></titles>
  <textVersions><item><type>Enrolled Bill</type><formats><item><url>https://www.govinfo.gov/x.xml</url></item></formats></item></textVersions>
  <latestAction><actionDate>2025-01-29</actionDate><text>Became Public Law No: 119-1.</text></latestAction>
</bill></billStatus>`;
  const { bill, children } = parseBillStatus(xml, "now");
  assert.equal(bill.id, "119-s-5");
  assert.equal(bill.title, "Laken Riley Act");
  assert.equal(bill.status, "became_law");
  assert.equal(bill.law_number, "119-1");
  assert.equal(bill.cosponsor_count, 1);
  assert.equal(bill.text_url, "https://www.govinfo.gov/x.xml");
  const rows = (table: string) => children.find((c) => c.table === table)?.rows ?? [];
  assert.deepEqual(rows("bill_actions").map((a) => a.action_code), ["10000", "8000", "36000"]);
  assert.deepEqual(rows("bill_vote_refs").map((v) => [v.roll_call_id, v.action_seq]), [["h-119-1-23", 1]]);
});
