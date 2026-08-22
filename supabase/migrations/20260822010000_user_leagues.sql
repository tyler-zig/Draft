-- Per-user league storage.
--
-- provider_connections already records "which Sleeper account is this user" and
-- the last league they opened. It cannot hold the set of leagues someone has
-- connected, so every visit re-asked for a Sleeper username and every new
-- device started empty. One row per league per user fixes that.

create table public.user_leagues (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('sleeper', 'espn')),
  league_id text not null,
  season text not null,
  name text not null,
  draft_id text,
  -- The user's identity on the league site: a Sleeper user id, an ESPN team id.
  external_user_id text not null default '',
  team_name text,
  scoring_type text not null default 'unknown' check (scoring_type in ('ppr', 'half_ppr', 'std', 'unknown')),
  team_count integer not null default 0 check (team_count >= 0),
  last_opened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider, league_id, season)
);

-- The league list is always read newest-first for one user.
create index user_leagues_recent on public.user_leagues (user_id, last_opened_at desc);

create trigger user_leagues_updated_at before update on public.user_leagues
for each row execute procedure public.set_updated_at();

alter table public.user_leagues enable row level security;

create policy "user leagues own rows" on public.user_leagues for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_leagues to authenticated;
