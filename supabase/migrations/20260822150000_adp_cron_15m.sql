-- Live ADP checks FantasyPros `published` and aborts unchanged boards, so the
-- dedicated job can poll every 15 minutes without pulling a full board each time.
-- Minutes 0/15/30/45 stay off the expert-batch slots (2/7/12 and their +15s).

create or replace function public.schedule_ranking_adp(p_schedule text default '*/15 * * * *')
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  scheduled_job bigint;
  existing record;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url') then
    raise exception 'Vault secret project_url is required';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'rankings_cron_secret') then
    raise exception 'Vault secret rankings_cron_secret is required';
  end if;

  for existing in select jobid from cron.job where jobname = 'draft-assistant-rankings-adp' loop
    perform cron.unschedule(existing.jobid);
  end loop;

  select cron.schedule(
    'draft-assistant-rankings-adp',
    p_schedule,
    $job$select public.queue_ranking_adp(jsonb_build_object('trigger','cron','scheduled_at',now()));$job$
  ) into scheduled_job;
  return scheduled_job;
end;
$function$;
revoke all on function public.schedule_ranking_adp(text) from public, anon, authenticated;
grant execute on function public.schedule_ranking_adp(text) to service_role;

create or replace function public.configure_ranking_cron(
  p_project_url text,
  p_cron_secret text,
  p_schedule text default '17 */6 * * *',
  p_intelligence_schedule text default '23 */12 * * *',
  p_adp_schedule text default '*/15 * * * *'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  secret_id uuid;
  ranking_job bigint;
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
    perform vault.create_secret(p_cron_secret, 'rankings_cron_secret', 'Authenticates scheduled ranking and intelligence jobs');
  else
    perform vault.update_secret(secret_id, p_cron_secret, 'rankings_cron_secret', 'Authenticates scheduled ranking and intelligence jobs');
  end if;

  ranking_job := public.schedule_ranking_scraper(p_schedule);
  perform public.schedule_intelligence_sync(p_intelligence_schedule);
  perform public.schedule_ranking_adp(p_adp_schedule);
  return ranking_job;
end;
$function$;
revoke all on function public.configure_ranking_cron(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.configure_ranking_cron(text, text, text, text, text) to service_role;
