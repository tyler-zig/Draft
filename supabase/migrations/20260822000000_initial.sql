create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'dark' check (theme in ('dark', 'light')),
  table_columns jsonb not null default '[]'::jsonb,
  ranking_method text not null default 'median' check (ranking_method in ('median', 'mean')),
  enabled_ranking_ids jsonb not null default '["builtin:sleeper"]'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.draft_states (
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_key text not null,
  queue_ids jsonb not null default '[]'::jsonb,
  keepers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, draft_key)
);

create table public.ranking_sets (
  user_id uuid not null references auth.users(id) on delete cascade,
  set_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, set_id)
);

create table public.provider_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('sleeper', 'espn')),
  external_user_id text not null default '',
  display_name text,
  last_league_id text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider, external_user_id)
);

create table public.data_artifacts (
  kind text primary key check (kind in ('rankings-latest', 'rankings-history', 'experts-ppr', 'experts-half', 'experts-standard', 'player-intelligence')),
  bucket text not null,
  object_path text not null,
  schema_version integer not null,
  generated_at timestamptz not null,
  byte_size bigint not null check (byte_size >= 0),
  metadata jsonb not null default '{}'::jsonb
);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create trigger profiles_updated_at before update on public.profiles
for each row execute procedure public.set_updated_at();
create trigger preferences_updated_at before update on public.user_preferences
for each row execute procedure public.set_updated_at();
create trigger draft_states_updated_at before update on public.draft_states
for each row execute procedure public.set_updated_at();
create trigger ranking_sets_updated_at before update on public.ranking_sets
for each row execute procedure public.set_updated_at();
create trigger connections_updated_at before update on public.provider_connections
for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.draft_states enable row level security;
alter table public.ranking_sets enable row level security;
alter table public.provider_connections enable row level security;
alter table public.data_artifacts enable row level security;

create policy "profiles own rows" on public.profiles for all to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "preferences own rows" on public.user_preferences for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "draft states own rows" on public.draft_states for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "ranking sets own rows" on public.ranking_sets for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "connections own rows" on public.provider_connections for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "artifact metadata public read" on public.data_artifacts for select to anon, authenticated using (true);

grant select, insert, update, delete on public.profiles, public.user_preferences, public.draft_states, public.ranking_sets, public.provider_connections to authenticated;
grant select on public.data_artifacts to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('draft-data', 'draft-data', true, 20971520, array['application/json'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
