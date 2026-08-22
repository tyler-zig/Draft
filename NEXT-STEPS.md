# Next steps — FantasyPros expert rankings

Handoff notes for picking this up in a fresh session. Written 2026-08-21.

The goal: collect all 87 FantasyPros experts' individual draft boards across 3
scoring formats (261 pages), show last-synced times, let the user pick either
the consensus or a subset of individual experts, and auto-load the dataset
matching the connected league's scoring settings.

**Status update: the scraper and UI halves are now built and verified.** The
Rankings drawer detects league scoring, supports a manual format override,
switches exclusively between FantasyPros consensus and selected individual
experts, shows per-board and oldest-board sync times, and keeps the existing
import/collector tooling mounted below it. The original handoff details remain
below as implementation history.

---

## 1. Blockers to clear first

### `src/App.tsx` does not compile

`src/App.tsx:5` imports `./pages/PlayerIntelligence`, which does not exist:

```
src/App.tsx(5,36): error TS2307: Cannot find module './pages/PlayerIntelligence'
```

This is the only TypeScript error in the repo and it is unrelated to the
rankings work — it came from in-progress UI work. `npm run build` fails until
that page lands or the import is removed. Everything below typechecks cleanly.

### The rankings UI is dead code

The Command Center redesign dropped `RankingsPanel` from `DraftRoom`. Nothing
in the app renders it any more, so `RankingsPanel.tsx` **and** `ScraperPanel.tsx`
are currently unreachable. Both still work; they just have no mount point.

Also `src/pages/DraftRoom.tsx` now has:

```ts
const [rankTick] = useState(0)   // no setter
```

so `importedSets` never reloads after a rankings change. Restoring the setter is
required for any install flow to take effect without a page reload.

---

## 2. What is already built

### Collector (done, verified)

| File | Purpose |
| --- | --- |
| `scripts/lib/sources/fantasypros-experts.mjs` | Directory enumeration + board parser |
| `scripts/scrape-experts.mjs` | CLI, incremental, one output file per scoring format |
| `src/rankings/experts.ts` | App-side loader, scoring detection, `RankSet` construction |

Run it with:

```
npm run scrape:experts                              # all 3 formats, ~23 min cold
node scripts/scrape-experts.mjs --scoring=ppr       # one format, ~8 min cold
node scripts/scrape-experts.mjs --limit=3           # quick smoke test
node scripts/scrape-experts.mjs --force             # ignore --max-age
```

Boards already collected within `--max-age` (default 24h) are reused from the
previous snapshot, so re-runs are cheap and an interrupted run resumes by simply
running it again.

### The data is collected — a full sweep completed in 23 minutes

| Format | Experts | Players | Rows | Not published | Failures | Size |
| --- | --- | --- | --- | --- | --- | --- |
| `ppr` | 85 | 600 | 27,751 | 2 | 0 | 431 KB |
| `half` | 87 | 1,046 | 28,539 | 0 | 0 | 472 KB |
| `standard` | 86 | 590 | 28,018 | 1 | 0 | 433 KB |

258 boards, ~84,300 rows, ~1.3 MB total. All three files are in
`data/rankings/` and mirrored to `public/rankings/`. Zero failures, zero
malformed records.

**Not every expert ranks every format**, and that is normal rather than an
error. `wolf-of-roto-street` has no PPR or Standard board; `christopher-dell`
has no PPR board. Those pages either serve an empty table or **redirect to the
generic consensus board**, so `collectExpert` verifies the page title still
identifies the expert (`Name (Outlet) | ...`) before trusting the rows — without
that check a redirect would be recorded as that expert's personal ranking. Such
gaps land in `notPublished`, not `failures`. A board that exists but is
unexpectedly thin (<25 rows) still throws loudly, since that would mean the
markup moved.

### Verified facts

- **87 experts** publish their own draft board. They are the entries in
  `https://www.fantasypros.com/nfl/rankings/` carrying a `?type=draft` link;
  the rest only have `-consensus-rankings` / `-consensus-adp` variants.
- Board URL shape: `/nfl/rankings/<slug>.php?type=draft&scoring=PPR|HALF|STD`
- A board is a server-rendered `table#data`. Jason Willan PPR = **328 rows**.
- Per row: expert's rank, player, pos rank, team, bye, **ECR**, **vs. ECR**,
  **ADP**, **vs. ADP**. The `vs. ECR` delta is the point of the dataset — it is
  each expert's deviation from consensus, already computed.
- FantasyPros player ids come from the link class (`fp-id-19788`) and are
  present on ~308/328 rows. The misses are team defenses, which have no player
  link and match on team instead.

### Access

All of this is under `/nfl/rankings/`, which `robots.txt` **permits**. The
disallowed paths are `/nfl/ranker/`, `/api/`, `/json/`, `/ajax/` and are not
used. FantasyPros publishes `Crawl-delay: 5` and the collector honours it —
that delay is the entire reason a cold sweep takes ~22 minutes.

> Earlier in the session I claimed individual expert boards were only reachable
> via robots-disallowed paths. That was wrong. I tested the `filters` parameter
> on the consensus board, saw it ignored, and generalised from one negative
> result instead of looking for a separate page.

### Output schema (`experts-<scoring>.json`, schemaVersion 1)

Rows are `[playerKey, rank]` pairs against a shared player dictionary; written
naively the same data is roughly ten times larger.

```jsonc
{
  "schemaVersion": 1,
  "scoring": "ppr",              // ppr | half | standard
  "fetchedAt": 1787000000000,
  "expertCount": 87,
  "playerCount": 512,
  "experts": [
    {
      "slug": "jason-willan",
      "name": "Jason Willan",
      "outlet": "Gridiron Experts",
      "fetchedAt": 1787000000000, // per-board — drives "last synced"
      "count": 328,
      "ranks": [["19788", 1], ["22968", 2]]
    }
  ],
  "players": {
    "19788": { "n": "Ja'Marr Chase", "t": "CIN", "p": "WR", "b": 6, "ecr": 1, "adp": 3 }
  },
  "failures": []
}
```

Keys are the FantasyPros id, or `T:<TEAM>:DEF` for team defenses. Files are
written to `data/rankings/` and mirrored to `public/rankings/` so Vite serves
them as static assets.

### `src/rankings/experts.ts` API

```ts
scoringFor(scoringType)            // ScoringType -> { scoring, detected }
fetchExpertSnapshot(scoring)       // -> ExpertSnapshot | null (null = not collected yet)
toExpertRankSets(snapshot, slugs, directory)
installExpertSets(snapshot, slugs, directory)   // replaces prior `expert:` sets
oldestSync(snapshot)               // oldest board — the honest "last synced"
```

Each selected expert becomes **its own `RankSet`**, so the existing median/mean
machinery in `consensus.ts` does the aggregation. Picking eight experts and
taking their median *is* a custom consensus — no new maths needed.

Scoring map: `ppr → ppr`, `half_ppr → half`, `std → standard`, `unknown → ppr`
with `detected: false` so the UI can say it guessed.

---

## 3. Remaining work

### 3a. Build the rankings drawer (completed)

No drawer styles exist yet — add `.cc-drawer` to `src/pages/command-center.css`.
The panel needs:

- **Detected-scoring banner.** Read `session.scoringType` in `DraftRoom`, pass
  through, call `scoringFor()`. Say "Half PPR — detected from your league" when
  `detected`, and "defaulting to PPR" when not. Allow a manual override.
- **Source mode:** Consensus (the existing `collected:fantasypros-<scoring>`
  sets) *or* Individual experts. These are alternatives, not additive.
- **Expert multi-select** with a search box — 87 rows needs filtering. Each row
  shows name, outlet, row count, and its own last-synced time from
  `expert.fetchedAt`.
- **Last-synced summary** for the snapshot, using `oldestSync()` rather than the
  file's `fetchedAt` — with incremental collection the file is always "fresh"
  even when individual boards are a day old, so the oldest board is the honest
  number.

Reuse the existing `cc-*` classes (`cc-card`, `cc-check`, `cc-picker`,
`cc-wide`, `cc-eyebrow`) so it matches the Command Center design.

### 3b. Re-mount the rankings UI (completed)

Add a Rankings button to `cc-topbar-right` in `DraftRoom.tsx` opening the
drawer, containing the new experts panel **and** the existing `ScraperPanel`
(which drives the main collector via the dev-server endpoint). Restore the
`rankTick` setter so installs take effect immediately.

### 3c. Verify end-to-end once the UI exists (completed)

The data is already collected, so this is purely a UI check:

- `half` auto-selects for the connected ESPN league (league 146234 is Half PPR)
- Selecting a few experts installs sets and shifts the consensus ranks
- Per-expert last-synced times render, and `notPublished` experts are either
  hidden or shown as unavailable for the current format rather than as errors

Re-run `npm run scrape:experts` when the data goes stale; boards inside
`--max-age` are reused, so a refresh is far cheaper than the cold 23 minutes.

---

## 4. Context worth carrying over

- **The app is mid-redesign.** `DraftRoom` was rebuilt into the Command Center
  layout during the session and `src/pages/command-center.css` is the styling
  source of truth. `mockup/draft-command-center-mockup.html` is the
  reference mockup and matches `mockup/draft-command-center-mockup.png`.
- **The main collector is separate** and still works: `npm run scrape:rankings`
  gives 73 boards / 2,601 rows / 866 players in ~15s from RotoWire +
  FantasyPros consensus + an ESPN id crosswalk. The expert collector is
  deliberately a second, slower job — do not merge them.
- **RotoWire already gives named experts** (`official`, `consensus`,
  `gremminger`, `hartitz`, `may`, `erickson`, `coventry`) but only 10 rows per
  board. FantasyPros experts are ~330 rows each. They complement each other.
- **The Chrome extension sync is fixed and verified** against live ESPN league
  146234 — positions, payload trimming and change detection all confirmed.
  `npm run test:extension` runs 27 tests against stubbed Chrome APIs.
