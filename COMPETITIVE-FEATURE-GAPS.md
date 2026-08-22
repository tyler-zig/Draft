# Feature gaps vs other draft assistants

Written 2026-08-22. A survey of what FantasyPros Draft Wizard, the Sleeper /
ESPN / Yahoo native draft rooms, Draft Sharks, Boris Chen tiers, and the
auction-focused tools do that this app currently does not — and which of those
are worth building.

Everything here was checked against the code, not assumed. Where the app already
has a partial version, that is stated.

---

## What we already have

For contrast, the current feature set:

- Live sync with Sleeper (polling) and ESPN (Chrome extension bridge).
- Consensus rankings from FantasyPros / RotoWire, plus 87 **individual expert
  boards** across three scoring formats — a genuinely differentiated dataset most
  competitors do not expose (`scripts/scrape-experts.mjs`,
  `src/rankings/experts.ts`).
- Scoring-format detection with manual override, per-board sync times.
- Player intelligence: historical usage, snap share, red-zone share, durability,
  matchup/SoS, weekly actuals by season (`src/intelligence/`) — all backward-
  looking; see the #1 write-up below for why "projections" was the wrong word
  for any of this before today.
- Draft board, queue, roster needs, keepers, ADP-delta value flag
  (`src/draft/value.ts`), a heuristic recommender (`src/draft/recommend.ts`).
- Market history / rank movement (`src/components/MarketHistory.tsx`).

---

## Tier 1 — biggest gaps, highest payoff

### 1. Projection-based value (VORP) instead of rank arithmetic — ✅ done (2026-08-22)

**Who has it:** Draft Sharks, the FantasyPros Value Board, essentially every
spreadsheet cheat sheet, and every auction tool.

**Where we were:** `recommend.ts:69` scored players as `450 - searchRank` plus
bonuses. That is rank arithmetic — the gap between RB5 and RB6 was treated as
identical to the gap between TE1 and TE2, which is exactly backwards.

**Correction to the original writeup:** this doc originally said "we already
ingest `projections.seasonPoints`" — that was wrong. `PlayerIntelligenceRecord`
in `src/intelligence/types.ts` is a dead type: nothing produces or consumes its
`projections` field, and there is no forward-projection source anywhere in the
app. What actually built up:

- `src/api/playerHistorical.ts` → `getProjectedPointsPool(scoring)`: pulls each
  player's **most recent completed season's actuals** out of
  `public/intelligence/latest.json` (nflverse-sourced) and scores them to the
  league's format (`fantasyPoints` / `fantasyPointsPpr` / their average for half).
  This is a real limitation, not a placeholder — a rookie or a player with a
  new role/team has no entry, and the recommender falls back to rank arithmetic
  for those players. A true projection source (points added, an external
  provider) would fix this properly later.
- `src/draft/vorp.ts` → `replacementLevels()` / `vorp()`: computes replacement
  level per position from the league's actual `SlotCounts` × `teams`, handling
  FLEX by letting the highest-value remaining RB/WR/TE claim it regardless of
  position (not a fixed per-position split), and folding SUPER_FLEX starters
  into the QB baseline. Covered by `src/draft/vorp.test.ts`.
- `src/intelligence/players.ts` → `attachProjectedPoints()`: matches the points
  pool onto the live player list by gsis/espn/sleeper id, falling back to
  name+position.
- `src/pages/DraftRoom.tsx`: a new `projectedPointsQuery` feeds a `valuedPlayers`
  pipeline (replacing the old `rankedPlayers` as the value passed to the table,
  board, recommender, queue and keeper panel) that attaches `projectedPoints`
  and `vorp` to every player once a session (and its scoring/slots/teams) is
  known.
- `src/draft/recommend.ts` → `baseScore()`: uses `vorp * 3` as the base score
  when a player has VORP, falling back to the old `450 - rank` formula
  otherwise, so the existing need/scarcity/value bonuses stay proportional
  either way.
- `src/components/PlayerTable.tsx` / `src/preferences.ts`: new sortable `VORP`
  column (blank when a player has no prior season on record).

**Why it matters:** it is the single change that makes the "who to pick" list
defensible rather than heuristic, and it is a prerequisite for auction values,
draft grades, and trade math.

### 2. Custom league scoring applied to projections — ✅ done for Sleeper and ESPN (2026-08-22)

**Who has it:** Sleeper, ESPN, FantasyPros with a league connection.

**Where we were:** #1's VORP read `receptionPremium` only implicitly, through
the three-way `fantasyPoints`/`fantasyPointsPpr`/average split in
`pointsForScoring()` — scoring-*format* aware, not scoring-*settings* aware, so
a league with 6-point passing TDs or first-down scoring got the generic
PPR/standard math regardless.

**What actually built up:**

- `DraftSession.scoringSettings` (`src/providers/types.ts`) — a new optional
  `Record<string, number>` carrying the league's raw per-stat scoring config.
- `src/providers/sleeperProvider.ts` sets it from `league.scoring_settings`,
  which Sleeper already returns and which is safe to trust: its keys are
  self-describing strings (`pass_td`, `rec_yd`, ...), not an opaque numeric map.
- `src/api/playerHistorical.ts` → `pointsFromSettings()` recomputes a season's
  points from the settings against the component stats we actually store
  (`SETTINGS_STAT_MAP` covers `pass_yd`, `pass_td`, `pass_int`, `rush_yd`,
  `rush_td`, `rec`, `rec_yd`, `rec_td`); `getProjectedPointsPool()` now tries
  this first and only falls back to the plain format split when none of those
  keys are present. Covered by four new cases in `playerHistorical.test.ts`.

**ESPN update (2026-08-22, same day):** this originally shipped with ESPN
deliberately unsupported — `scoringSettings.scoringItems` is keyed by numeric
`statId` with no schema ESPN publishes, and guessing the mapping risked
silently wrong point values. Web search turned up two independent,
actively-maintained community mappings that agree with each other and with
this codebase's own already-working code: `cwendt94/espn-api` (Python) and
`ffverse/ffscrapr` (R) — the latter reads points from this exact
`scoringSettings.scoringItems` path, the same one `mapEspn.ts`'s
`receptionItem()` already trusted for statId 53. That statId even appears
verbatim in both third-party tables, cross-confirming the one ESPN mapping
already in production here. Where a stat has two known ids (e.g. 3 and 22 both
name "passing yards"), both libraries map either to the same field, so no
guessing between them was needed — a league's settings only ever contain one,
and either resolves correctly.

- `src/espn/mapEspn.ts` → `ESPN_STAT_ID_TO_KEY` / `mapScoringSettings()`:
  converts ESPN's statId-keyed array into the same `pass_yd`/`pass_td`/`rec`/...
  shape Sleeper already provides, so both providers share the one
  `pointsFromSettings()` calculation from item #2's original build. Wired into
  `mapEspnSession()`'s `scoringSettings` field. Covered by four new cases in
  `mapEspn.test.ts`.

Also not covered by either provider: fumbles, two-point conversions, and bonus
yardage thresholds, since the underlying nflverse-derived dataset doesn't carry
those fields per player-season. A league that scores those meaningfully still
gets an approximation, not a hard error.

### 3. Tier breaks that actually drive the board — ✅ done (2026-08-22)

**Who has it:** Boris Chen (it *is* the product), FantasyPros, Sleeper's board
colouring.

**Where we were:** `tier` was parsed and stored (`src/rankings/parse.ts`,
`consensus.ts`) and rendered as a column in `PlayerTable.tsx`, but only when a
source happened to publish one — most boards don't, so most players fell back
to `PlayerTable`'s old synthetic bucketing (`Math.ceil(rank / 15)`, clamped to
6), a fixed-width bucket over the *overall* rank that ignores position and has
no relationship to where real tier breaks are.

**What actually built up:**

- `src/rankings/tiers.ts` → `assignTiers()`: clusters each position's ranked
  players using the expert-spread data `applyConsensusRanks` already produces
  (`rankLow`/`rankHigh` — the best and worst rank any enabled expert gave a
  player). Two adjacent players stay in the same tier when their expert-rank
  ranges overlap (genuine disagreement, not a real gap); a tier breaks where
  every expert agreed on the order with no overlap. Falls back to an adaptive
  rank-gap threshold when there's only one source (no spread to compare).
  Covered by `src/rankings/tiers.test.ts`.
- `src/rankings/consensus.ts` now runs this at the end of every
  `applyConsensusRanks` call and sets `player.tier` from it — but only when the
  active sources didn't already publish one (RotoWire boards commonly do; a
  real per-expert tier call still wins over our clustering).
- `src/draft/recommend.ts`: a new "Last Tier N `<POS>`" bonus/reason fires when
  a player is the only one left in their position+tier among available
  players — the actual "3 players left in this tier, take one now" signal the
  original write-up asked for, now literally computed from live availability
  rather than a static count. Covered by new cases in `recommend.test.ts`.
- `src/components/PlayerTable.tsx`: the tier pill now shows a real, position-
  aware tier number instead of the old rank/15 bucket; since a deep position's
  tier count can run past the CSS's 6 defined colors, `tierColorClass()` cycles
  the color (not the displayed number) back into that range.

**Not built:** an explicit divider row between tiers in the table, and the
on-the-clock panel doesn't surface the "last in tier" flag yet (only the
recommender does) — the tier pill plus the recommender bonus cover the same
information without adding new UI surface area, so this was left out as scope
creep unless it turns out to be wanted.

**Why it matters:** it turns our expert-spread dataset into an actual decision,
and tier scarcity is the most-cited reason real drafters deviate from a list.

### 4. "Will he be there next time?" — pick-survival probability — ✅ done (2026-08-22)

**Who has it:** FantasyPros Draft Wizard (its core selling point), Draft Sharks'
war room.

**Where we were:** we showed `picksUntilSlot` and a static recommendation list,
with a `lastsUntilYourPick` boolean already in `playerContext.ts` that compared
a player's ADP/rank to your next pick with no notion of uncertainty — a hard
yes/no where the real answer is a probability.

**What actually built up:**

- `src/draft/survival.ts` → `survivalProbability(mean, stdDev, nextPickNo)`: a
  normal-CDF calculation (Abramowitz-Stegun `erf` approximation, no external
  dependency) over a player's market baseline and rank spread — exactly the
  "not a simulation" approach this write-up asked for. `spreadFor()` sources
  the spread honestly: FantasyPros's own per-player rank std-dev when a source
  reports one (`RankRow.stdDev`, newly threaded through `consensus.ts` onto
  `Player.rankStdDev`, the same first-source-wins pattern as `adp`/`tier`),
  falling back to a quarter of the enabled sources' best/worst range, and
  `null` — not a guess — when there's no real spread to compute from.
  Covered by `src/draft/survival.test.ts`.
- `src/draft/playerContext.ts`: `PlayerDraftContext` gained a
  `survivalProbability` field alongside the existing boolean (kept, unchanged,
  so nothing regresses); `src/components/PlayerDetail.tsx` shows it as "N%
  likely to last" next to the existing should-last/gone-by-then verdict.
- `src/draft/recommend.ts`: a new `yourNextPickNo` option drives the actual
  *expected value lost by waiting* the original write-up asked for — a player
  with under 50% survival odds to your next turn gets a score bump
  proportional to that urgency, with the percentage surfaced as a reason
  string. `Recommendation` now carries `survivalProbability` for display.
  Covered by new cases in `recommend.test.ts`.
- `src/pages/DraftRoom.tsx`: hoisted `yourNextPickNo` (previously computed only
  inline for the player-detail modal) into a shared memo feeding both the
  recommender and the modal, so both now reason about the same next-pick
  number.
- Also fixed in passing: the "Best available" card's "Projected Points" meter
  was reading the same synthetic rank-based formula as `PlayerTable`'s old fake
  projection column; it now shows `projectedPoints` from #1 when available.

**Not built:** the on-the-clock/"Best available" card doesn't show survival
odds directly (only the player-detail modal and the recommendation reasons
do) — same scope call as #3, left out rather than adding new UI surface area
speculatively.
competitors have.

---

## Tier 2 — commonly expected, moderate effort

### 5. Mock draft / draft simulation — ✅ done (2026-08-22)

**Who has it:** FantasyPros Draft Wizard, Sleeper mocks, the ESPN mock lobby.

**Where we were:** `demoProvider` supported `draftPick: true`, but there was no
mock mode with simulated opponents, no clock, and no way to rehearse a draft
slot.

**What actually built up:**

- `src/providers/demoProvider.ts` is now a configurable mock engine.
  `initDemoDraft(options)` rebuilds the singleton room from any teams
  (2–20), rounds (1–30), draft slot, scoring format, reach setting, and
  auto-draft toggle — out-of-range values clamp instead of crashing, and
  `getLeagues()` reports the configured team count/scoring so the connect page
  and league summary stay honest after a small mock.
- One CPU pick (`demoTick(players, keptIds)`) scores every draftable player as
  market baseline (ADP, or rank math when ADP is missing) minus a roster-need
  bonus for the slot on the clock (`fillRoster` + `needForPosition` — starter
  85 / flex 45 / superflex 55), plus normal noise scaled by the player's
  expert-disagreement spread and a **reach knob**: `2.5 − 1.5 × reach`, so a
  disciplined room (0) follows the board and a reachy one (1) lets noise
  override it. That spread reuse is the survival-model link the original ask
  wanted. `src/draft/survival.ts` gained the `sampleNormal()` Box-Muller
  primitive behind it (injectable rng for deterministic tests).
- Kickers and defenses wait until the last round; keepers are never
  CPU-drafted and manual picks refuse them.
- `src/pages/DraftRoom.tsx`: the Settings dialog gains a Mock draft section
  (demo rooms only) — teams, rounds, your slot, scoring, reach slider, sim
  speed, auto-draft checkbox — and `Start new mock` rebuilds the room in place.
- The end-of-mock roster report **is the draft-grades sheet from #6**: when a
  demo draft ticks to completion the grades modal opens itself, with every
  team's lineup, coverage, value tally, and grade.
- Covered by 8 engine tests in `src/providers/demoProvider.test.ts` (clamping,
  slot gating, reach divergence, auto-draft hands-free vs stall, keeper
  exclusion, K/DEF deferral, completion) and an e2e smoke test that runs a 4×2
  mock to the grades report and restores the default room afterwards.

### 6. Draft grade / live roster projection — ✅ done (2026-08-22)

**Who has it:** ESPN, Yahoo, Sleeper post-draft grades; Draft Sharks live.

**What actually built up:**

- `src/draft/grades.ts` → `projectedLineupPoints()` (fills each team's lineup
  with the existing `fillRoster` primitive and sums `projectedPoints` over
  non-bench slots; players with no projection count as uncovered rather than
  inflating the total) and `leagueProjections()` (groups picks by draft slot,
  tallies per-pick value as `pickNo − marketBaseline`, counts picks with no
  market baseline separately, and computes a z-score grade per team only when
  at least 4 teams are gradable — `gradeFromZ`: A ≥ +1, B ≥ +0.3, C ≥ −0.3,
  D ≥ −1, else F). Covered by `src/draft/grades.test.ts`.
- `src/components/DraftGrades.tsx`: a sortable table — team, projected lineup
  points, starter coverage, value gained (±N), grade — with your row
  highlighted. Covered by `src/components/DraftGrades.test.tsx`.
- `src/pages/DraftRoom.tsx`: a Grades button in the top bar, and the modal
  auto-opens when a demo draft completes (the mock report, see #5).


### 7. Positional run detection — ✅ done (2026-08-22)

**Who has it:** Draft Sharks, Sleeper's position-run nudge.

**Where we were:** `recommend.ts` had a crude proxy — `remainingElite <= 3` over
a 24-pick window — which measures scarcity, not momentum.

**What actually built up:** `recommend.ts` now looks at the 8 most recent picks
league-wide (own picks and everyone else's, from the shared `picks` list, using
`pick.meta.position` for players not in our own pool) and flags a position as
"running" when it's at least half of that window. A player at a running
position who fills a starter/flex/superflex need gets a `${POS} run` bonus and
reason. Bench-only need doesn't trigger it — chasing a run for a bench spot
isn't the situation this is for. Requires at least 4 picks made league-wide
before it activates, so it doesn't fire off noise at the very start of a draft.
Covered by a new case in `recommend.test.ts`.

### 8. Bye-week and stacking awareness — ✅ partly done (2026-08-22)

**Who has it:** most native rooms warn on bye stacking; best-ball tools lean
hard on QB stacks.

**Where we were:** `bye` was parsed and displayed, never used in a decision.

**What actually built up:** `recommend.ts` now counts how many of your rostered
players at a position already share a bye with the candidate; two already
there (meaning the candidate would be the third) knocks the score down and adds
a `"3 RBs on bye 7"`-style reason. Covered by a new case in `recommend.test.ts`.

**The QB↔pass-catcher half (2026-08-22):** the stacking ask is now closed.
`recommend.ts` fires a `Stack with <name>` bonus for a QB candidate sharing a
team with a rostered WR/TE, and a `QB stack with <name>` bonus for a WR/TE
candidate sharing a team with a rostered QB — team names compared through the
same normalized form the intelligence pipeline uses, so JAC/JAX-style aliases
don't miss. Covered by new cases in `recommend.test.ts`.

### 9. Handcuff / depth-chart linkage — ✅ partly done (2026-08-22)

**Who has it:** Draft Sharks ("Handcuff Kings"), FantasyPros.

**Where we were:** `depthChartOrder` and `depthChartPosition` were stored on
`Player` and never joined to anything.

**What actually built up:** `recommend.ts` now checks, for each available
player, whether any of your rostered players share his team and position with
a better (lower) `depthChartOrder` — if so he's flagged `"Handcuff for
<name>"` with a small bonus. Covered by a new case in `recommend.test.ts`.

**The two open halves (2026-08-22):** the depth join now runs from both
directions. A backup whose starter has *already been drafted by another team*
(same normalized team+position, starter has a lower `depthChartOrder`, starter
isn't yours — the existing handcuff check keeps claiming the case where it is)
gets a `Starter <name> already drafted` bonus. A backup with
`depthChartOrder >= 2` and VORP ≥ 0 gets a `Standalone value (POSn)` bonus
regardless of whose roster the starter is on — VORP from #1 is the
usage-proxy judgment call the earlier pass deferred, and it makes the flag
forwards-looking rather than a second guess at the depth chart. Covered by new
cases in `recommend.test.ts`.

### 10. Playoff-weeks strength of schedule — ✅ done (2026-08-22)

**Who has it:** Draft Sharks, FantasyPros, most in-season tools.

**Where we were:** `src/intelligence/calculations/matchup.ts` computed SoS and
`PlayerIntelligence` displayed it, but it was season-long and not weighted
toward weeks 15–17.

**What actually built up:**

- `playoffStrengthOfSchedule({ model, scoring, position, weekStart, weekEnd })`
  in `supabase/functions/_shared/matchup.ts` (re-exported through
  `src/intelligence/calculations/matchup.ts`): the same positional
  matchup-rank loop as season-long SoS, filtered to the playoff window and to
  games that are actually played (bye weeks and completed matchups excluded);
  ascending rank, 1 = easiest slate; teams with no games in the window rank
  `null` instead of a guess. Covered by new cases in the matchup tests.
- `DraftSession.playoffWeeks` — parsed from Sleeper's
  `playoff_week_start` + `playoff_rounds` (rounds include the championship, so
  `end = start + rounds − 1`, clamped to 18); null elsewhere, and the UI falls
  back to `DEFAULT_PLAYOFF_WEEKS` 15–17 when the league doesn't report one.
- `src/api/playerHistorical.ts` → `getPublishedScheduleModel(signal)`: exposes
  the already-fetched schedule artifact's matchup model, so the column costs
  no extra request.
- `src/intelligence/players.ts` → `attachPlayoffSos()`: stamps per-position
  window ranks onto the draft pool (QB/RB/WR/TE; DEF and unknown teams get
  nothing, since DEF tables aren't in the model).
- `src/components/PlayerTable.tsx`: a new sortable **SoS** column —
  `3rd`-style ordinal with easy/neutral/tough/hard tone colors, `—` when the
  model is unavailable; the column hint states the fallback weeks.
- `src/components/PlayerSchedule.tsx`: playoff weeks highlighted on the
  schedule grid with a legend entry and a `Playoffs WK 15–17` footer note —
  shown whenever the caller supplies a window (the draft room does; the
  intelligence page stays on its season-long view).

---

## Tier 3 — real gaps, narrower audience

### 11. Auction drafts

**Who has it:** everyone. `src/pages/DraftRoom.tsx:222` currently renders
*"Auction drafts are not in v1."*

**What it needs:** per-team budget tracking, dollar values derived from VORP (#1),
inflation as money leaves the board, nomination strategy, and max-bid math. This
is a mode, not a feature — worth doing only after #1, but it is the largest
single category of draft we outright refuse to serve.

### 12. Dynasty / keeper valuation beyond the current year

**Where we are:** `src/draft/keepers.ts` handles keeper cost in round picks,
which is the accounting side and genuinely useful.

**What to build:** age-curve-adjusted multi-year values and rookie-pick valuation
for dynasty leagues. Our intelligence dataset already carries `age` and
multi-season history.

### 13. Traded draft picks mid-draft

**Who has it:** Sleeper and ESPN natively.

**Where we are:** `src/draft/snake.ts` derives pick ownership purely from slot
arithmetic (`ownerSlotForPick`), so a traded pick is attributed to the wrong
team. Sleeper's API does report traded picks. This is a correctness bug for any
league that trades picks, not only a missing feature.

### 14. News and injury feed

**Who has it:** Sleeper, Rotoworld, Draft Sharks.

**Where we are:** `injuryStatus` is a static string on the player record.

**What to build:** a per-player news line in `PlayerDetail`, polled politely
alongside the existing collector. The access posture documented in `README.md`
applies — pick a source with a usable feed rather than scraping article bodies.

### 15. Cheat-sheet export and offline drafting

**Who has it:** FantasyPros print cheat sheets; every tool has CSV export.

**What to build:** export the merged board (with tiers and VORP) to CSV/PDF, plus
an offline mode where you mark players off by hand. The offline mode is what
makes this usable at a live in-person draft — today we require Sleeper or ESPN to
be running the draft.

### 16. Multi-device sync of a live draft

**Where we are:** the queue lives in `sessionStorage` with `mirrorDraftState`
writing to Supabase (`src/supabase/cloudStore.ts`). Worth confirming that this
round-trips well enough to run the board on a laptop and the queue on a phone —
a common competitor pattern that we may be one small step away from.

---

## Deliberate non-goals

- **Best-ball optimisers** and **DFS lineup tools** are separate products.
- **Betting-market props as a ranking input:** interesting, but the data-access
  story is poor and it is not what a draft assistant is judged on.

---

## Suggested order

1. ~~VORP from last-season actuals (#1)~~ — done 2026-08-22, unlocks #2, #6, #11.
2. ~~Custom scoring recompute (#2)~~ — done for Sleeper and ESPN, both 2026-08-22.
3. ~~Tiers that drive the board (#3)~~ — done 2026-08-22.
4. ~~Survival probability (#4)~~ — done 2026-08-22, unlocks #5.
5. ~~Cheap wins: position runs (#7), bye stacking (#8), handcuffs (#9)~~ — done
   2026-08-22, including the QB-stack and standalone/starter-gone halves of #8/#9.
6. ~~Tier 2 remainder: mock drafts (#5), draft grades (#6), playoff SoS (#10)~~ —
   done 2026-08-22.
7. Next: auction (#11) remains the largest unserved draft mode; traded picks
   (#13) is still the top correctness hole.

Two of these — traded picks (#13) and offline drafting (#15) — are less new
features than holes that make the app unusable for particular leagues, so they
may deserve to jump the queue if those leagues matter.
