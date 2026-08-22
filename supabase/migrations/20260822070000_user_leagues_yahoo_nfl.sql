-- Yahoo and NFL.com leagues use the same saved-league and connection rows as Sleeper/ESPN.
alter table public.user_leagues drop constraint if exists user_leagues_provider_check;
alter table public.user_leagues add constraint user_leagues_provider_check
  check (provider in ('sleeper', 'espn', 'yahoo', 'nfl'));

alter table public.provider_connections drop constraint if exists provider_connections_provider_check;
alter table public.provider_connections add constraint provider_connections_provider_check
  check (provider in ('sleeper', 'espn', 'yahoo', 'nfl'));
