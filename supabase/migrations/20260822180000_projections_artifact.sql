-- Collected season-projection consensus (CBS, ESPN, FantasySharks).
-- Same snapshot + storage path the rankings artifacts already use, so the
-- app reads it through readRankingArtifact('projections-latest', ...).

alter table public.ranking_snapshots drop constraint if exists ranking_snapshots_kind_check;
alter table public.ranking_snapshots add constraint ranking_snapshots_kind_check
  check (kind in ('rankings-latest', 'rankings-history', 'experts-ppr', 'experts-half', 'experts-standard', 'adp-latest', 'projections-latest'));

alter table public.data_artifacts drop constraint if exists data_artifacts_kind_check;
alter table public.data_artifacts add constraint data_artifacts_kind_check
  check (kind in ('rankings-latest', 'rankings-history', 'experts-ppr', 'experts-half', 'experts-standard', 'player-intelligence', 'player-twitter', 'adp-latest', 'projections-latest'));
