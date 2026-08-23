# Draft Assistant

## Ranking collection

`npm run scrape:rankings` collects public expert rankings from the command
line and writes an immutable timestamped snapshot, `data/rankings/latest.json`,
and a copy at `public/rankings/latest.json` that the app reads as a static
asset. No browser tabs, credentials, or extension are needed.

Schedule it with Windows Task Scheduler, cron, or a hosted job runner.
Six-hourly is a reasonable maximum frequency; the underlying boards update
roughly daily.

### Sources

| Source | What it gives | Volume |
| --- | --- | --- |
| FantasyPros | Expert consensus (ECR) for PPR, half-PPR and standard, with per-expert spread (best/worst/average/std-dev), tier and bye week | ~1,900 rows over 3 boards, ~100 experts each |
| FantasyPros real-time ADP | The live draft-position board from ESPN/Yahoo/Sleeper platform ADPs, with per-platform ranks and ownership | ~600 rows over 1 board |
| RotoWire | Seven expert boards x three scoring formats x five positions, with ADP and trend | ~700 rows over ~70 boards |
| ESPN | Player id crosswalk (identity only, no ranks) | ~4,500 players |

`npm run scrape:adp` collects just the real-time ADP board (robots checks off);
`--only=fantasypros-adp` does the same through the main script.

A run currently yields **74 boards, ~3,200 rows and ~870 distinct players**, of
which ~98% carry an ESPN id.

Each board is collected independently: one failure never ends the run, and
every failure is recorded in the output under `failures` rather than swallowed.
Sources also fail loudly on suspiciously thin results, so a silent layout
change surfaces as an error instead of an empty file.

### Options

```
--only=<a,b>      Collect only these groups (rotowire, fantasypros,
                 fantasypros-adp, espn)
--season=<year>   Override the ESPN season (defaults to the current one)
--concurrency=<n> Max in-flight requests per host (default 4)
--out=<dir>       Output directory (default data/rankings)
--no-mirror       Skip the public/rankings copy the app reads
--ignore-robots   Skip robots.txt checks entirely
--quiet           Only print the final summary
```

Note that `--only` still overwrites `latest.json`, so a partial run replaces a
full one. Use `--out` if you want to collect a subset without disturbing the
current snapshot.

### Front-end controls

The collector can also be driven from the app. Open **Rankings** in the draft
room and use the *Rankings collector* card to pick sources, set per-host
concurrency, run a collection with a live log, and load the result into the
consensus list.

This is wired through dev-server middleware (`scripts/vite-scraper-plugin.mjs`).
The browser cannot spawn a Node process, and those ranking hosts do not send
CORS headers, so the collector exists only under `npm run dev` and
`npm run preview`. A static production build has no server attached, and the
card says so instead of offering a button that cannot work.

Sleeper lookups are different: the app calls `/sleeper/...` so the browser
never talks to `api.sleeper.app` directly. Vite proxies that path locally;
`vercel.json` rewrites it to Sleeper on the hosted app.

Only validated fields reach the CLI -- source names are checked against a fixed
list and concurrency is clamped -- so the endpoint cannot be talked into
running an arbitrary command line.

**Load as** controls how the snapshot enters the rankings list:

- *One set per scoring format* (default) gives six sets: each source collapsed
  per scoring format. RotoWire's positional boards are merged by ADP, which is
  the only field that orders players across positions.
- *One set per board* keeps all ~73 boards separate, for weighing individual
  experts against each other.

Loading replaces any previously loaded collector sets; lists you imported by
hand are left alone.

### Access and rate limiting

The collector does not sign in, bypass a paywall, or evade access controls. It
reads `robots.txt` per origin, honours `Disallow` and `Crawl-delay`, and paces
requests per host.

The default run respects every `robots.txt` it finds and honours `Disallow`
and `Crawl-delay`. One source is the exception by design: the real-time ADP
page is allowed, but the board itself is fetched from
`partners.fantasypros.com` (`Disallow: /`) -- the same public
`expert-rankings.php` request the page's own browser code makes. `--ignore-robots`
collects it anyway; the flag is what the convenience command `npm run scrape:adp`
passes. For every other source the flag only drops the crawl-delay and the
guard that would notice a source's terms changing under a scheduled run.

Pacing is also self-interested: an unattended job that trips a rate limiter
loses the whole run, so staying under the limit collects more than firing
everything at once.

### Output

`latest.json` is schema v2:

- `stats` — row, set and player counts for the run
- `sets[]` — one entry per collected board, each with its own `rows`
- `players[]` — a flat per-player digest across all boards (best/worst/median
  rank, ADP, tier, bye, contributing sources)
- `failures[]` / `skipped[]` — what did not make it, and why

Boards are kept separate rather than pre-merged so the app's consensus controls
can enable and weigh them individually.

When the real-time ADP board is collected, it is also written to its own
`adp-latest.json` beside `latest.json` (and mirrored to `public/rankings/`), so
the standalone ADP cron job and the broad snapshot can move independently.

## Season projection collection

`npm run scrape:projections` collects public season-long stat lines from CBS,
ESPN, and FantasySharks, averages each stat across the sources that published
it, and writes `data/projections/latest.json` plus a `public/projections/`
copy. The app blends that consensus with the live Sleeper/RotoWire board and
scores the result to the connected league, which is what VORP reads.

| Source | What it gives | Volume |
| --- | --- | --- |
| FantasySharks | Position CSVs with stable player ids | ~580 rows over QB/RB/WR/TE/K/DEF |
| CBS Sports | Server-rendered PPR tables (volume is the same as standard) | ~450 rows over six positions |
| ESPN | Default-league `kona_player_info` season totals, keyed by ESPN id | ~800 rows with season projections |

There is no login or paywall bypass. FantasySharks publishes `Crawl-delay: 60`,
so a full run spends several minutes spacing those six CSVs. That is above the
Edge Function wall-clock cap, which is why the scheduled path is GitHub
Actions (`.github/workflows/sync-projections.yml`, `41 */6 * * *` UTC) rather
than `pg_cron`. `workflow_dispatch` accepts optional `season` and `only`
inputs. `npm run supabase:cron:setup` is unchanged.

A source that fails is recorded under `failures` and does not abort the others.
Thin boards fail loudly. `--only=cbs,espn` skips the slow FantasySharks host.

The app prefers the hosted `projections-latest` snapshot, then Storage, then
the static file. A missing artifact leaves Sleeper/RotoWire as the only source.

## Player intelligence sync

Run `npm run sync:intelligence` to build the historical player dataset consumed
by both the full Players page and the Draft Room player modal. Completed seasons
are frozen on disk after the first successful ingest. Later runs keep those
years and only add missing ones — by default the last two completed NFL seasons
if they are not already stored. Use
`npm run sync:intelligence -- --seasons=2021,2022,2023` to add older years once,
or append `--refresh` to rebuild the newest stored season (or only the years
passed to `--seasons`) from nflverse.

The pipeline stores raw source files under `data/intelligence/raw/nflverse/`,
one frozen slice per season under `data/intelligence/normalized/<year>/season.json`,
and atomically publishes the merged `public/intelligence/latest.json`. It
combines weekly player stats, weekly
rosters, snap counts, and compressed play-by-play to produce:

- weekly and season PPR/standard output;
- touch share, red-zone opportunity share, and snap share;
- games played and bye-aware games missed;
- the current regular-season schedule and scoring-aware matchup ranks;
- remaining strength of schedule by fantasy position;
- GSIS/ESPN/Sleeper/PFR identity crosswalks and source metadata.

Practice-squad (`DEV`) and cut (`CUT`) roster weeks are excluded from games
missed, and a midweek team change can count at most once. Run
`npm run check:intelligence` to validate the published artifact without
downloading anything. Raw, normalized, and public outputs are generated and
gitignored; nflverse attribution is retained in the artifact and UI.

On Vercel the app only reads the hosted file. `fetchArtifact` prefers
Supabase Storage `intelligence/latest.json`, then the static copy. Do not run
the historical rebuild inside Vercel; play-by-play ingest stays a local
`npm run sync:intelligence` job.

After the first local sync and `npm run upload:supabase`, pg_cron calls the
`sync-intelligence` Edge Function twice a day (`23 */12 * * *` UTC, override
with `INTELLIGENCE_CRON_SCHEDULE`). That job refreshes the nflverse schedule
and scoring-aware matchup / SOS ranks from the stored player history, and
blends in the current season's weekly stats when nflverse has published them.
It does not rebuild frozen seasons. `npm run supabase:cron:setup` deploys both
the ranking and intelligence functions and schedules both jobs. Use
`npm run supabase:cron:run:intelligence` for an immediate hosted refresh.

## ESPN extension sync

`extension/` syncs a live ESPN draft into the app. Load it unpacked from
`chrome://extensions` with Developer mode on, then keep your ESPN draft tab
open alongside the app.

How it flows: `espn-inject.js` runs in the page (MAIN world) so it can call
ESPN's API with your session cookies, `espn-content.js` relays to the service
worker, and `background.js` stores the snapshot and pushes it to any open app
tab. Nothing is scraped from the DOM and no credentials are read or stored.

Two things worth knowing if you are changing it:

- **Snapshots are incremental.** The injector polls every two seconds but only
  posts when the board actually changes, and omits the player list when it has
  not been refetched. `background.js` rehydrates it, so the app always sees a
  complete snapshot. Player records are trimmed to the fields the app reads --
  full `kona_player_info` is ~7 MB per snapshot, which does not fit in
  `chrome.storage.session` at all.
- **Any loopback port works, and so does the Vercel deploy.** The app tab is
  matched by host, not by a pinned `:5173`. Local Vite ports and
  `https://*.vercel.app` both receive the snapshot. Reload the unpacked
  extension after a manifest change, then refresh the hosted app tab.

## Keepers

Keeper leagues are set up from **Menu > Keepers** in the Draft Room. A keeper
is stored as the team that keeps the player plus the round it costs, and the
app turns each one into the pick it consumes -- so kept players drop out of the
pool, land on their team's roster, take their slot on the board, and stop
counting toward "picks until your turn". Entries are saved in `localStorage`
per draft, so they survive a reload.

Sync depends on how far along the league is:

- **League rules** (`keeperCount`, and ESPN's per-player `keeperValue`) sync
  the whole pre-draft window. ESPN's keeper prices prefill the editor as
  suggestions under "Keepable on ESPN".
- **Actual selections** only sync once the commissioner locks them, which is
  often days before the draft. Until then ESPN genuinely does not have them and
  hand-entered keepers are the only source.

When the site does publish keepers, it wins: synced entries become read-only
and any hand-entered entry it contradicts is reported as a conflict rather than
silently rewritten. Sleeper publishes keepers as picks flagged `is_keeper`, so
they arrive on the board already.

Run `npm run test:extension` after changing the worker or the injector. The
suites in `extension/tests/` load those files against stubbed Chrome APIs and
cover snapshot merging, quota failure, change detection and tab matching.

---

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
# Supabase (optional)

The app remains fully local when Supabase environment variables are absent. To enable sign-in, cross-device preferences/draft state/ranking sets/saved leagues, provider connection metadata, and hosted data artifacts:

1. Create a Supabase project and copy `.env.example` to `.env.local`. Add the project URL and publishable/anon key. The filename matters: Vite only reads `.env.local`, not `env.local`.
2. Link the hosted project with `npm run supabase:link`, then apply the migrations in `supabase/migrations/` with `npm run supabase:push`. Add the deployed app URL to Auth redirect URLs.
3. Generate the ranking and intelligence snapshots, then set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the shell and run `npm run upload:supabase`.

The service-role key is uploader-only. Never put it in a `VITE_` variable or browser deployment settings. User-owned rows are protected by row-level security; the `draft-data` bucket is public-read and service-role-write.

### Sign-in

Three ways in, all through the account button in the header:

- **Email + password** — the default. Sign-up honours Supabase's email-confirmation setting: when confirmation is required the panel says so rather than pretending the session started.
- **Magic link** — passwordless, emails a one-time sign-in link.
- **Password reset** — emails a recovery link to the app origin.

### Saved leagues

Opening a league's draft room records it in `public.user_leagues` (one row per user, provider, league and season) with your seat on that league site and the team name, so a returning drafter clicks straight back in instead of retyping a Sleeper username.

The list works signed out: it saves to `localStorage` and uploads on first sign-in. Cloud and local copies are merged rather than one overwriting the other — the most recently opened copy of each league wins — because a league opened on a signed-out device is as real as one the account already knew about. `useSavedLeagues` listens for the `draft-assistant:cloud-synced` event so the list refreshes after that merge.

The Supabase CLI is pinned as a project development dependency. Use the named scripts above, `npx supabase <command>`, or the general passthrough form `npm run supabase -- <command>`. Local `start`, `stop`, and database `reset` scripts are also available; the local stack requires Docker Desktop or another Docker-compatible runtime.

## Scheduled ranking collection

The production collector runs as the protected `scrape-rankings` Edge Function. Supabase Cron calls it through `pg_net`; the function writes the complete `rankings-latest` JSON payload directly to `public.ranking_snapshots` and records every attempt in `public.ranking_scrape_runs`. Browser loaders read Postgres first and retain Storage/static snapshots only as a migration and offline fallback.

After enabling the `pg_cron` and `pg_net` extensions, run:

```powershell
npm run supabase:cron:setup
```

That command pushes the schema, deploys the Edge Functions, copies existing ranking and intelligence artifacts into Storage/Postgres, generates and installs a private function secret, stores the matching secret and project URL in Vault, and creates the ranking, live-ADP and intelligence jobs. The broad 73-board collector defaults to `17 */6 * * *` in UTC; override it with `RANKINGS_CRON_SCHEDULE` in `.env.local`. Individual FantasyPros boards run in five-expert batches every 15 minutes, staggered by scoring format, so their published crawl delay stays comfortably inside Edge Function limits while every format completes a sweep roughly every 4.5 hours. The intelligence schedule / SOS refresh defaults to `23 */12 * * *`; override it with `INTELLIGENCE_CRON_SCHEDULE`.

Live ADP is its own field, not just a board inside the broad snapshot. A dedicated job checks the FantasyPros real-time ADP `published` stamp every 15 minutes (`*/15 * * * *` UTC, override with `ADP_CRON_SCHEDULE`) and only downloads a board that has moved. Unchanged FantasyPros boards reuse the stored rows and skip Draft Wizard. The job writes to the `live_adp` column on both `ranking_snapshots` and `data_artifacts` under kind `adp-latest`, with a matching Storage copy at `rankings/adp-latest.json`.

Use `npm run supabase:cron:run` for an immediate broad collection, `npm run supabase:cron:run:adp` for a hosted live-ADP refresh, and `npm run supabase:cron:run:intelligence` for a hosted schedule refresh. The corresponding expert smoke commands are `supabase:cron:run:experts:ppr`, `supabase:cron:run:experts:half`, and `supabase:cron:run:experts:standard`.

Cron request credentials are encrypted in Supabase Vault. The Edge Function service-role credential is supplied by the Supabase runtime and never included in the cron request or browser bundle.
