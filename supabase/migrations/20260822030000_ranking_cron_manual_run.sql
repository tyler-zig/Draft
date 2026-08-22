create or replace function public.invoke_ranking_scraper()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_id bigint;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url')
    or not exists (select 1 from vault.decrypted_secrets where name = 'rankings_cron_secret') then
    raise exception 'Ranking Cron Vault secrets are not configured';
  end if;

  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1) || '/functions/v1/scrape-rankings',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'rankings_cron_secret' limit 1)
    ),
    body := jsonb_build_object('trigger', 'manual', 'requested_at', now()),
    timeout_milliseconds := 120000
  ) into request_id;
  return request_id;
end;
$function$;

revoke all on function public.invoke_ranking_scraper() from public, anon, authenticated;
grant execute on function public.invoke_ranking_scraper() to service_role;
