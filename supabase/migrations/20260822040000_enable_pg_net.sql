-- pg_cron schedules the job; pg_net performs the asynchronous HTTP request.
create extension if not exists pg_net with schema extensions;
