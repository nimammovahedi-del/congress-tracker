# congress-tracker

A free tracker for the bills, votes, and regulations of the U.S. Congress (working name).

**Status:** the data pipeline runs hourly on GitHub Actions and uploads to Cloudflare D1.
The website (Phase 2, in `web/`) runs locally and isn't deployed yet.

## The website (`web/`)

An Astro 7 site for Cloudflare Workers, styled as a dark monitoring console. Pages:
home (this week in Congress), `/votes` (roll-call directory) and `/votes/[id]` (seat chart,
tally analysis, member inspector), `/bills/[id]`, `/members` and `/members/[id]`, `/topics`
and `/topics/[slug]`, `/search`, `/find` (address → representatives via the Census
geocoder), `/analytics`, and `/about`.

```bash
cd web
npm install
npm run data   # copy ../data/congress.db into the local stand-in for D1 (stop dev first)
npm run dev    # http://localhost:4321
npm run check  # type check
```

Pages read D1, which bills by rows read, so anything that would scan whole tables (topic
lists, analytics, member statistics) is precomputed by the pipeline's `stats` step into the
`site_stats` table. Full-text search uses an FTS5 table defined in `db/site.sql`.
Motion (decoding text, counters, panels unfolding) lives in `web/src/scripts/fx.ts` and is
switched off for visitors who prefer reduced motion.

## What it does

`npm run sync` pulls the current Congress's data from official and academic sources into a
SQLite database at `data/congress.db`. The first run downloads everything (about 2 minutes);
later runs fetch only what changed (seconds). Nothing needs an API key.

| Step | What it loads | Source | How fresh |
|---|---|---|---|
| `members` | Everyone who served in this Congress: party, state, district, DC office, phone, photo link | [congress-legislators](https://github.com/unitedstates/congress-legislators) | Updated by volunteers within days |
| `bills` | Every bill and resolution: status, actions, sponsors, cosponsors, subjects, committees, CRS summaries, links to official text, CBO cost estimates | [GovInfo BILLSTATUS](https://www.govinfo.gov/bulkdata/BILLSTATUS) (the data behind Congress.gov) | Same day |
| `statuses` | Re-derives each bill's status from its actions (see `src/bill-status.ts`) | Local | Every sync |
| `house-votes` | Every House roll call and how each member voted | [House Clerk](https://clerk.house.gov/Votes) | Same day |
| `senate-votes` | Every Senate roll call (including nominations) and how each senator voted; DW-NOMINATE scores for both chambers | [Voteview](https://voteview.com/) | Up to about a month behind |
| `federal-register` | Final rules, proposed rules, and presidential documents (executive orders, proclamations) | [Federal Register API](https://www.federalregister.gov/developers/documentation/api/v1) | Same day |

Bill text is never stored: each bill links to its official text on govinfo.gov. Those pages
can't be embedded in another site, so the website will link out to them.

## Commands

```bash
npm install          # once
npm run sync         # pull the latest data (all steps)
npm run sync -- bills house-votes   # only some steps
npm run upload       # copy what changed to the hosted database on Cloudflare
npm run report       # row counts, freshness, and data-quality checks
npm test             # unit tests
npm run check        # type check
```

## Hosting and the hourly job

The website will read from a Cloudflare D1 database named `congress-tracker` in the
**CongressZ** Cloudflare account (see `wrangler.jsonc`).

A GitHub Actions job (`.github/workflows/sync.yml`) runs every hour at :17. It runs
`npm run sync`, then `npm run upload`. It also runs when code changes are pushed, and can
be started by hand from the repo's **Actions** tab. It needs two repository secrets:
`CLOUDFLARE_API_TOKEN` (a token with D1 Edit permission on the CongressZ account) and
`CLOUDFLARE_ACCOUNT_ID`.

Cloudflare's free plan allows 100,000 database row writes per day per account. The upload
spends at most `D1_DAILY_WRITE_BUDGET` (default 95,000, keeping 5,000 in reserve), spread
evenly over the day, and resends only the parts of a bill, vote, or member that changed.
The first full upload (about 1.5–1.7 million writes) therefore trickles in over two to
three weeks, newest data first. Each run's log ends with how much is left and how many days that will take.

Requires Node.js 24 or newer (it runs TypeScript directly and has SQLite built in).

To switch to the next Congress after January 3, 2027, run with `CONGRESS=120`.

## Project layout

- `db/schema.sql`: every table, with comments on each column
- `src/sync.ts`: runs the steps in order
- `src/sources/`: one file per data source
- `src/bill-status.ts`: how "introduced", "passed House", "became law", and so on are decided
- `src/report.ts`: the data-quality report

## Known limits

- **Senate votes lag.** Voteview publishes Senate votes up to about a month late. Until then,
  a bill's action history still shows the result and tally (for example "passed 52–47").
  senate.gov blocks automated downloads, so it isn't used.
- **Vice-presidential tie-breakers** aren't in member-level vote data. Show the vote's
  `result` next to the tally.
- **Placeholder bills.** Numbers reserved for the Speaker (such as H.R. 2–10) have no actions
  until they're used; the website should hide them.
- **CRS summaries** exist for about a quarter of bills, mostly the ones that moved. The rest
  will get AI summaries in Phase 4.

## Data credits

- Bill data: Congress.gov and GovInfo (U.S. government works, public domain).
- House votes: Office of the Clerk, U.S. House of Representatives.
- Senate votes and DW-NOMINATE scores: Lewis, Jeffrey B., Keith Poole, Howard Rosenthal,
  Adam Boche, Aaron Rudkin, and Luke Sonnet. *Voteview: Congressional Roll-Call Votes Database.*
  https://voteview.com/
- Member data: the @unitedstates project's congress-legislators (CC0).
- Regulations: the Federal Register (public domain).
