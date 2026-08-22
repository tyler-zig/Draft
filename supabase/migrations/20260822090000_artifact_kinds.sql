-- The kind checks introduced with the live_adp migration listed every
-- artifact the uploader carried except player-twitter, so the uploader's
-- refresh of the X handle catalog tripped the constraint. Complete the list.
alter table public.data_artifacts drop constraint if exists data_artifacts_kind_check;
alter table public.data_artifacts add constraint data_artifacts_kind_check
  check (kind in ('rankings-latest', 'rankings-history', 'experts-ppr', 'experts-half', 'experts-standard', 'player-intelligence', 'player-twitter', 'adp-latest'));
