-- Supabase-native scheduled ranking collection and current snapshots.
create table public.ranking_snapshots (
  kind text primary key check (kind in ('rankings-latest', 'rankings-history', 'experts-ppr', 'experts-half', 'experts-standard')),
  schema_version integer not null,
  fetched_at timestamptz not null,
  payload jsonb not null,
  source text not null default 'manual' check (source in ('manual', 'cron')),
  updated_at timestamptz not null default now()
);

create table public.ranking_scrape_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_source text not null default 'cron' check (trigger_source in ('cron', 'manual')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  failures jsonb not null default '[]'::jsonb,
  error text
);

alter table public.ranking_snapshots enable row level security;
alter table public.ranking_scrape_runs enable row level security;

create policy "ranking snapshots public read" on public.ranking_snapshots
for select to anon, authenticated using (true);

grant select on public.ranking_snapshots to anon, authenticated;

-- Called once after `project_url` and `rankings_cron_secret` exist in Vault.
-- The Edge Function validates the same secret before doing any expensive work.
create or replace function public.schedule_ranking_scraper(p_schedule text default '17 */6 * * *')
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  scheduled_job bigint;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url') then
    raise exception 'Vault secret project_url is required';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'rankings_cron_secret') then
    raise exception 'Vault secret rankings_cron_secret is required';
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'draft-assistant-rankings';

  select cron.schedule(
    'draft-assistant-rankings',
    p_schedule,
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1) || '/functions/v1/scrape-rankings',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'rankings_cron_secret' limit 1)
        ),
        body := jsonb_build_object('trigger', 'cron', 'scheduled_at', now()),
        timeout_milliseconds := 120000
      );
    $job$
  ) into scheduled_job;
  return scheduled_job;
end;
$function$;

revoke all on function public.schedule_ranking_scraper(text) from public, anon, authenticated;
grant execute on function public.schedule_ranking_scraper(text) to service_role;

create or replace function public.configure_ranking_cron(
  p_project_url text,
  p_cron_secret text,
  p_schedule text default '17 */6 * * *'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  secret_id uuid;
begin
  if p_project_url !~ '^https://[a-z0-9-]+\.supabase\.co/?$' then
    raise exception 'Invalid Supabase project URL';
  end if;
  if length(p_cron_secret) < 32 then
    raise exception 'Cron secret must contain at least 32 characters';
  end if;

  select id into secret_id from vault.decrypted_secrets where name = 'project_url' limit 1;
  if secret_id is null then
    perform vault.create_secret(rtrim(p_project_url, '/'), 'project_url', 'Draft Assistant Edge Function base URL');
  else
    perform vault.update_secret(secret_id, rtrim(p_project_url, '/'), 'project_url', 'Draft Assistant Edge Function base URL');
  end if;

  select id into secret_id from vault.decrypted_secrets where name = 'rankings_cron_secret' limit 1;
  if secret_id is null then
    perform vault.create_secret(p_cron_secret, 'rankings_cron_secret', 'Authenticates the scheduled ranking scraper');
  else
    perform vault.update_secret(secret_id, p_cron_secret, 'rankings_cron_secret', 'Authenticates the scheduled ranking scraper');
  end if;

  return public.schedule_ranking_scraper(p_schedule);
end;
$function$;

revoke all on function public.configure_ranking_cron(text, text, text) from public, anon, authenticated;
grant execute on function public.configure_ranking_cron(text, text, text) to service_role;
