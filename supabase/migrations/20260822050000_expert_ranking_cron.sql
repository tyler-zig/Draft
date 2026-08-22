create table public.ranking_scrape_cursors (
  job_key text primary key,
  cursor integer not null default 0 check (cursor >= 0),
  updated_at timestamptz not null default now()
);
alter table public.ranking_scrape_cursors enable row level security;

create or replace function public.queue_ranking_scrape(p_body jsonb)
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1) || '/functions/v1/scrape-rankings',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'rankings_cron_secret' limit 1)
    ),
    body := p_body,
    timeout_milliseconds := 120000
  );
$function$;
revoke all on function public.queue_ranking_scrape(jsonb) from public, anon, authenticated;
grant execute on function public.queue_ranking_scrape(jsonb) to service_role;

create or replace function public.invoke_ranking_scraper()
returns bigint
language sql
security definer
set search_path = ''
as $function$
  select public.queue_ranking_scrape(jsonb_build_object('trigger', 'manual', 'requested_at', now()));
$function$;

create or replace function public.schedule_ranking_scraper(p_schedule text default '17 */6 * * *')
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  scheduled_job bigint;
  existing record;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url') then raise exception 'Vault secret project_url is required'; end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'rankings_cron_secret') then raise exception 'Vault secret rankings_cron_secret is required'; end if;

  for existing in select jobid from cron.job where jobname like 'draft-assistant-rankings%' loop
    perform cron.unschedule(existing.jobid);
  end loop;

  select cron.schedule('draft-assistant-rankings', p_schedule,
    $job$select public.queue_ranking_scrape(jsonb_build_object('trigger','cron','mode','collected','scheduled_at',now()));$job$
  ) into scheduled_job;
  perform cron.schedule('draft-assistant-rankings-experts-ppr', '2,17,32,47 * * * *',
    $job$select public.queue_ranking_scrape(jsonb_build_object('trigger','cron','mode','experts','scoring','ppr','scheduled_at',now()));$job$);
  perform cron.schedule('draft-assistant-rankings-experts-half', '7,22,37,52 * * * *',
    $job$select public.queue_ranking_scrape(jsonb_build_object('trigger','cron','mode','experts','scoring','half','scheduled_at',now()));$job$);
  perform cron.schedule('draft-assistant-rankings-experts-standard', '12,27,42,57 * * * *',
    $job$select public.queue_ranking_scrape(jsonb_build_object('trigger','cron','mode','experts','scoring','standard','scheduled_at',now()));$job$);
  return scheduled_job;
end;
$function$;
