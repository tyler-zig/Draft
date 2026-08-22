# Player Intelligence: Real Data Implementation Plan

## Objective

Replace every derived placeholder on the Player Intelligence page with sourced, reproducible NFL and fantasy-football data while preserving the current visual design.

The finished page should clearly distinguish:

- observed facts, such as player measurements and historical carries;
- market data, such as ADP and consensus rank;
- calculated analytics, such as touch share and matchup strength;
- forecasts, such as projected points;
- generated editorial content, such as analyst notes.

Every record should include its source and update timestamp. Missing information should render as unavailable rather than silently falling back to fabricated values.

## Current State

The application already has useful foundations:

- `src/providers/sleeperProvider.ts` loads and normalizes Sleeper's player directory.
- `src/api/playerCache.ts` caches normalized player records in IndexedDB for 24 hours.
- `scripts/scrape-rankings.mjs` collects rankings from FantasyPros, ESPN, and RotoWire.
- `src/rankings/` imports, matches, and combines ranking sources.
- `Player` already carries Sleeper and ESPN identifiers, ADP, tier, bye week, and injury status.

The Player Intelligence page currently uses real identity and ranking fields but calculates the remaining visual values from player rank. Those formulas must be removed as each real-data phase lands.

## Source Strategy

### Tier 1: Existing and free sources

#### Sleeper

Use Sleeper for:

- player name and identifiers;
- team and position;
- age, height, and weight;
- active and injury status;
- depth-chart position;
- bye week when supplied;
- add/drop trend counts.

The player directory should be fetched server-side or through the existing Vite proxy, cached, and refreshed at most once per day. Sleeper documents that the player response is roughly 5 MB and should not be requested repeatedly. Sleeper permits free non-commercial use; commercial use requires a licensing discussion.

Source: [Sleeper API documentation](https://docs.sleeper.com/)

#### Existing ranking collectors

Continue using the current ESPN, FantasyPros, and RotoWire collectors for:

- source rank;
- ADP when the source exposes it;
- tier;
- consensus rank and rank range.

Add immutable dated snapshots instead of retaining only `latest.json`. These snapshots will provide the real ADP/rank trend chart.

#### nflverse

Use nflverse for:

- weekly and seasonal player statistics;
- play-by-play;
- schedules and game results;
- weekly and seasonal rosters;
- snap counts and participation;
- player-ID mappings across Sleeper, ESPN, GSIS, and other sources.

The data is published in downloadable CSV and Parquet formats, making it suitable for a Node ingestion job without adding a Python or R runtime.

Sources:

- [nflverse data repository](https://github.com/nflverse/nflverse-data)
- [nflverse organization](https://github.com/nflverse)

### Tier 2: Optional paid feed

Use a commercial provider if externally produced projections, licensed global ownership percentages, richer injury history, or stricter update guarantees are required.

Recommended first evaluation: SportsDataIO, because its NFL offering combines fantasy projections with injuries, depth charts, player data, and schedules.

Alternative: Sportradar for authoritative player profiles, schedules, statistics, depth charts, and detailed weekly injuries. Projection data may still require a separate model or fantasy feed.

Sources:

- [SportsDataIO NFL API](https://sportsdata.io/developers/api-documentation/nfl)
- [Sportradar NFL API overview](https://developer.sportradar.com/football/reference/nfl-overview)
- [Sportradar weekly injuries](https://developer.sportradar.com/football/reference/nfl-weekly-injuries)

API keys must remain server-side and must never be included in the Vite client bundle.

## Field-to-Source Mapping

| UI field | Primary source | Fallback or calculation |
| --- | --- | --- |
| Name, position, team | Sleeper | nflverse roster |
| Age, height, weight | Sleeper | Paid player-profile feed |
| Bye week | nflverse schedule | Sleeper |
| Injury status | Paid weekly injury feed | Sleeper status |
| Availability/rostered percentage | Licensed fantasy feed | Percentage across connected leagues, explicitly labeled |
| ADP | Existing ranking collectors | Paid fantasy feed |
| Consensus rank | Existing consensus engine | None |
| Rank range | Minimum and maximum enabled source ranks | None |
| ADP trend | Daily ranking snapshots | None |
| Projected points | Paid projection feed or internal model | Unavailable until projections exist |
| Projected carries and targets | Paid projection feed or internal model | Unavailable until projections exist |
| Weekly output chart | Weekly projection feed | Historical weekly points when viewing a completed season |
| Touch share | nflverse play-by-play/player stats | None |
| Red-zone touch share | nflverse play-by-play | None |
| Games missed | Schedule plus weekly participation/rosters | Paid injury-history feed |
| Injury risk | Documented internal model | Current injury only; do not invent a score |
| Upcoming opponents | nflverse schedule | Paid schedule feed |
| Matchup strength | Calculated from positional fantasy points allowed | Paid matchup feed |
| Analyst note | Generated from sourced metrics | Handwritten editorial copy |

## Target Data Model

Create `src/intelligence/types.ts` with a normalized, source-aware schema:

```ts
export interface SourcedValue<T> {
  value: T | null
  source: string
  updatedAt: string
}

export interface RankHistoryPoint {
  date: string
  source: string
  rank: number | null
  adp: number | null
}

export interface WeeklyProjection {
  week: number
  opponent: string | null
  fantasyPoints: number | null
  carries: number | null
  targets: number | null
  source: string
}

export interface PlayerIntelligenceRecord {
  playerId: string
  season: number
  identity: {
    age: SourcedValue<number>
    height: SourcedValue<string>
    weight: SourcedValue<number>
    depthChartOrder: SourcedValue<number>
  }
  market: {
    adp: SourcedValue<number>
    consensusRank: SourcedValue<number>
    rankLow: number | null
    rankHigh: number | null
    history: RankHistoryPoint[]
  }
  projections: {
    seasonPoints: SourcedValue<number>
    carries: SourcedValue<number>
    targets: SourcedValue<number>
    pointsPerGame: SourcedValue<number>
    weekly: WeeklyProjection[]
  }
  usage: {
    touchShare: SourcedValue<number>
    redZoneTouchShare: SourcedValue<number>
    snapShare: SourcedValue<number>
  }
  durability: {
    gamesMissedLastTwoSeasons: SourcedValue<number>
    currentStatus: SourcedValue<string>
    riskScore: SourcedValue<number>
  }
  schedule: Array<{
    week: number
    opponent: string
    home: boolean
    matchupRank: number | null
  }>
  analystNote: {
    text: string | null
    generated: boolean
    generatedAt: string | null
  }
  updatedAt: string
}
```

Also extend `SleeperPlayer` and the provider-neutral `Player` type with optional fields for age, height, weight, depth-chart order, GSIS ID, Sportradar ID, and FantasyData ID.

## Calculations

All calculations should live in pure functions under `src/intelligence/calculations/` and have unit tests.

### Touch share

```text
(player carries + player targets) / (team carries + team targets)
```

Specify whether quarterback attempts and sacks are included. The initial definition should use fantasy opportunities only: carries plus targets.

### Red-zone touch share

```text
(player carries + targets inside opponent 20)
/
(team carries + targets inside opponent 20)
```

Use play-by-play field position rather than a provider's undocumented aggregate.

### Games missed

Count regular-season games in which the player was on the team roster but did not participate. Distinguish injury absences from suspensions, healthy scratches, and bye weeks when the source permits it.

### Matchup strength

For each opponent and fantasy position:

1. Compute fantasy points allowed per game over a documented window.
2. Adjust for the scoring format displayed by the page.
3. Rank all 32 defenses from easiest to hardest.
4. Require a minimum sample size early in the season.
5. Blend prior-season and current-season results until enough current games exist.

The UI should display the model window and scoring format in a tooltip.

### Injury risk

Do not expose a risk score until there is a documented model and enough source data. The first real-data release should display current injury status and games missed. A later risk model can use recent absences, injury recurrence, age, position, and workload, with its methodology documented.

### Analyst note

Build the note from structured facts only. The generation input should contain the metric values and their sources. Store the generated timestamp and label the result "Generated analysis." Do not present generated claims as reporting.

## Storage Layout

Keep raw, normalized, and public artifacts separate:

```text
data/
  intelligence/
    raw/
      sleeper/
      nflverse/
      projections/
    normalized/
      2026/
        players.json
        weekly-stats.json
        schedule.json
    snapshots/
      rankings/
        2026-08-21.json

public/
  intelligence/
    latest.json
    players/
      <player-id>.json
```

Raw and normalized data should normally be generated artifacts and excluded from Git unless a small fixture is intentionally committed. Public output should follow the same deployment policy already used by `public/rankings/latest.json`.

## Ingestion Architecture

Add a Node entry point at `scripts/sync-player-intelligence.mjs`.

```text
Sleeper directory ───────────────┐
Ranking snapshots ──────────────┤
nflverse stats/PBP/schedules ───┼─> ID resolution ─> normalization
Optional projection provider ───┘                       │
                                                       v
                                           derived metric calculators
                                                       │
                                                       v
                                      public/intelligence/latest.json
```

The ingestion process should:

1. Download sources with timeouts, retries, user-agent identification, and conditional requests where supported.
2. Save source metadata, retrieval time, and source URL with every raw artifact.
3. Resolve identities through stable IDs before attempting normalized-name matching.
4. Reject or quarantine ambiguous matches.
5. Calculate derived metrics from normalized source rows.
6. Validate the final JSON against explicit invariants.
7. Write output atomically so a failed run cannot corrupt `latest.json`.
8. Produce a concise machine-readable run summary.

Add scripts to `package.json`:

```json
{
  "sync:intelligence": "node scripts/sync-player-intelligence.mjs",
  "check:intelligence": "node scripts/validate-player-intelligence.mjs"
}
```

For deployed environments, run the sync on a scheduler and serve the resulting JSON from object storage, a CDN, or an application API. The Vite development plugin can expose manual run/status endpoints using the same validated argument and child-process pattern as the rankings collector.

## Phased Delivery

### Phase 1: Real identity and market fields

- Extend Sleeper API types with age, height, weight, depth-chart fields, and source IDs.
- Extend `Player` without breaking existing providers.
- Update `mapPlayer` to retain those values.
- Replace placeholder profile measurements.
- Calculate consensus rank and range from enabled rankings.
- Render unavailable fields as an em dash with source-aware tooltips.
- Remove rank-derived identity values.

Exit criteria:

- No fabricated profile measurements remain.
- Each displayed identity/market field is sourced or explicitly unavailable.
- Existing draft-room behavior is unchanged.

### Phase 2: Ranking history and real trend chart

- Preserve dated outputs from every rankings collection run.
- Add a compaction step that emits per-player history.
- Graph real daily ADP/rank values.
- Handle source additions, removals, and missing days without interpolating silently.

Exit criteria:

- Every chart point corresponds to a stored snapshot.
- Chart labels state whether the series is ADP or rank and identify its source or consensus method.

### Phase 3: nflverse ingestion and historical analytics

- Download rosters, schedules, weekly stats, snap counts, and required play-by-play columns.
- Implement ID resolution.
- Calculate touch share, red-zone share, snap share, games missed, and historical fantasy points.
- Add deterministic fixtures and calculation tests.

Exit criteria:

- Usage values reconcile with fixture inputs.
- Bye weeks are not counted as missed games.
- Each derived metric identifies its season and calculation window.

### Phase 4: Schedule and matchup model

- Load the current schedule.
- Calculate positional fantasy points allowed.
- Add early-season prior/current blending.
- Populate the four matchup cards with real opponents and ranks.

Exit criteria:

- Opponents match the official schedule.
- All 32 teams receive a unique or tie-aware matchup ranking.
- Scoring format changes produce expected rankings.

### Phase 5: Projections

Choose one path:

#### Option A: Licensed projection provider

- Add a server-side provider adapter.
- Map provider IDs to internal IDs.
- Cache season and weekly projections according to license and rate limits.
- Never expose credentials or raw licensed payloads when redistribution is prohibited.

#### Option B: Internal projection model

- Establish a baseline based on historical opportunity, efficiency, team volume, depth chart, and schedule.
- Train and evaluate without future-data leakage.
- Version model inputs and output.
- Publish error metrics by position.

Exit criteria:

- The UI names the projection source and update time.
- Carries, targets, weekly output, PPG, and season points come from the same coherent projection set.
- No rank-derived projection formulas remain.

### Phase 6: Availability and analyst notes

- Decide whether global roster percentage justifies a paid license.
- If not, calculate ownership only across connected leagues and label it accordingly.
- Generate analyst notes from structured real metrics.
- Add provenance and generated-content labels.

Exit criteria:

- "Rostered" has an explicit population definition.
- Generated notes cannot cite unavailable metrics.
- Stale source data is visibly marked.

## Testing Plan

### Unit tests

- Player ID resolution and ambiguous-match rejection.
- PPR, half-PPR, and standard fantasy-point calculations.
- Touch-share and red-zone-share calculations.
- Games-missed logic, including byes and team changes.
- Matchup rankings and early-season blending.
- Consensus rank/range with missing and disabled sources.

### Contract tests

- Validate saved source fixtures against adapters.
- Fail clearly when upstream fields change type or disappear.
- Keep fixtures small and scrub API keys and licensed payloads.

### Integration tests

- Run the complete pipeline from fixture inputs to public JSON.
- Verify atomic output and behavior when one optional source fails.
- Confirm a prior successful public file remains available after a failed run.

### UI tests

- Real values render for a fully populated player.
- Missing fields render as unavailable rather than zero.
- Source and update-time tooltips are correct.
- Search and player selection remain functional.
- The page remains visually aligned at the reference 1536 × 1024 viewport.

## Data Quality and Observability

Every sync should report:

- source success/failure and response age;
- number of raw and normalized records;
- exact-ID, mapped-ID, name-match, ambiguous, and unmatched counts;
- missing-field rates for important metrics;
- output validation status;
- duration and final artifact timestamp.

Set alerts or fail validation when:

- active-player coverage drops unexpectedly;
- ID-match coverage falls below the agreed threshold;
- the current schedule is missing;
- ranking data is older than its allowed freshness window;
- projections use a different season than the application.

## Security, Licensing, and Attribution

- Keep provider keys in server environment variables such as `SPORTSDATAIO_API_KEY`; never prefix secrets with `VITE_`.
- Do not log credentials or full authenticated URLs.
- Record license and attribution requirements for every source.
- Confirm redistribution rights before writing paid-provider payloads to `public/`.
- Include Sleeper attribution when its trending data is displayed.
- Preserve nflverse/third-party attribution required by the specific datasets used.
- Rate-limit manual sync endpoints and accept only validated arguments.

## Recommended First Implementation Slice

Start with Phases 1 and 2. They provide immediate visible improvement without adding a paid dependency:

1. Retain real Sleeper measurements and IDs.
2. Remove all placeholder identity values.
3. Add dated rank snapshots.
4. Render a real market trend chart.
5. Add source/update metadata to profile and market cards.

Then implement nflverse historical analytics before choosing a projection provider. This sequencing prevents the paid-feed decision from blocking useful, verifiable improvements.

## Implementation Progress (2026-08-22)

Phases 1 through 3 are complete:

- Sleeper profile measurements, depth-chart fields, and stable provider IDs are retained in the normalized `Player` record.
- The player cache version was advanced so previously cached records cannot hide the new fields.
- The source-aware intelligence schema now exists in `src/intelligence/types.ts`.
- Consensus rank and rank range are calculated from only the enabled ranking sets, with each reporting source and timestamp exposed in the UI.
- Source-provided ranks, including fractional or tied values, are preserved instead of being silently reassigned to sequential integers. Score-only imports are still normalized.
- Rank-derived profile measurements, roster percentage, projections, usage, durability scores, trend lines, schedules, matchup ranks, and analyst notes were removed from the Player Intelligence page. Missing feeds now render an explicit unavailable state.
- Every rankings collection keeps its timestamped source snapshot and now atomically rebuilds `public/rankings/history.json` from those immutable observations.
- The history artifact resolves players by stable ESPN ID where possible, retains the observed median, ADP, range, and source-row count, and does not interpolate missing observations.
- The real ADP/rank history component is shared by the full Player Intelligence page and the Draft Room player modal.
- The Draft Room consensus engine now carries enabled-source range, provenance, and update times on each player. ESPN draft players are enriched from the Sleeper directory by stable ID so sourced measurements also reach their modal without replacing provider draft IDs.
- UI tests cover sourced values, missing-data behavior, and modal provenance; unit tests cover Sleeper normalization, profile joins, history compaction/loading, and enabled-source rank ranges.
- `npm run sync:intelligence` now conditionally downloads the last two completed seasons of nflverse weekly player stats, weekly rosters, snap counts, and compressed play-by-play, retaining raw source metadata and writing normalized/public output atomically.
- GSIS is the primary historical identity key; roster crosswalks provide ESPN, Sleeper, and PFR IDs. Ambiguous name matching is not used in ingestion.
- Pure, tested calculators produce PPR variants, touch share, red-zone touch share, weighted snap share, and games missed. Byes and DEV/CUT weeks are excluded, and team changes count at most once per week.
- The current 2024–2025 artifact contains 1,300 exact-GSIS player profiles and passes the standalone data validator.
- Observed weekly PPR output, usage shares, games played, and games missed now render on both the full Player Intelligence page and Draft Room modal with nflverse attribution and timestamps.
- Projection and injury-risk fields remain explicitly unavailable because historical observations are not silently presented as forecasts.

Phase 4 is complete:

- `npm run sync:intelligence` always refreshes the nflverse `games.csv` schedule, even when historical seasons stay frozen.
- Team-week schedules, including byes, are written to `data/intelligence/normalized/<season>/schedule.json` and published on `public/intelligence/latest.json`.
- Positional fantasy points allowed are calculated from stored weekly stats for PPR, half PPR, and standard. Current-season results blend with the prior season until a defense has four games.
- Remaining strength of schedule is the average of those opponent ranks. Rank 1 is the easiest remaining slate.
- The Players page and Draft Room modal resolve the schedule from the player's current team and the selected scoring format. Missing teams and unmodeled positions stay unavailable.

Hosted refresh uses the same pg_cron path as rankings: `sync-intelligence` downloads the current nflverse schedule, optionally the current-season weekly stats, rebuilds matchup / SOS on the Storage artifact, and leaves frozen historical seasons alone. Vercel only serves the app and reads `intelligence/latest.json` from Storage.

The next implementation slice is Phase 5: licensed or internal projections.

## Definition of Done

The real-data project is complete when:

- no displayed numeric value is generated from player rank merely to fill the design;
- every value has a source, calculation method, and update time;
- missing data is represented honestly;
- source credentials and licenses are handled correctly;
- scheduled ingestion produces validated atomic artifacts;
- the page passes build, lint, data-contract, calculation, integration, and UI tests;
- documentation explains how every metric is obtained or calculated.
