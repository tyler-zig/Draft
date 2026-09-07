-- League snapshots pulled from MyFantasyLeague, for the auction cheat sheet.
--
-- MFL forbids calling their API from JavaScript outside myfantasyleague.com and rate
-- limits per IP, so the cheat sheet cannot read MFL from the browser. A scheduled job
-- pulls the league (paced a second per request, as MFL asks) and parks the result
-- here, where the page reads it with the anon key like every other artifact.
--
-- Keyed by league and season so more than one league can be served without a schema
-- change.
create table public.mfl_snapshots (
  league_id text not null,
  season integer not null,
  kind text not null default 'league-snapshot' check (kind in ('league-snapshot')),
  schema_version integer not null default 1,
  fetched_at timestamptz not null,
  payload jsonb not null,
  source text not null default 'manual' check (source in ('manual', 'cron')),
  updated_at timestamptz not null default now(),
  primary key (league_id, season, kind)
);

alter table public.mfl_snapshots enable row level security;

create policy "mfl snapshots public read" on public.mfl_snapshots
for select to anon, authenticated using (true);

grant select on public.mfl_snapshots to anon, authenticated;
