-- send-pending-notifications has run with verify_jwt = false and a handler that checks nothing about the request, so anyone who
-- can reach its URL could force a drain of the queued notifications. This gives the database callers (pg_cron and four trigger/
-- sweep functions) a shared secret, sent in the x-sender-secret header, and gives the handler a service-role-only way to check it.
-- The secret lives only in the vault; the handler asks the database to compare, so nothing is copied into the function's
-- environment and there is no second place to keep in step.
--
-- Rollout order matters: this migration first (callers start sending the header, the old handler ignores it), then the handler is
-- deployed (it starts refusing requests without it). The reverse order would refuse the pager for the gap between the two.
--
-- Callers are rewritten from their LIVE bodies by one exact-text replacement each, not retyped, so nothing else in them can drift.
-- Each live caller has exactly one http_post to the sender (checked 2026-11-01); the DO block refuses to continue if that is no
-- longer true, and the closing block proves every caller now sends the header.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notification_sender_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'notification_sender_secret',
      'Shared secret the database sends to send-pending-notifications in the x-sender-secret header. Rotating it needs no deploy: the handler asks the database to compare.');
  end if;
end $$;

create or replace function public.verify_notification_sender_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_secret, '') <> ''
    and exists (
      select 1 from vault.decrypted_secrets
      where name = 'notification_sender_secret'
        and sha256(convert_to(decrypted_secret, 'utf8')) = sha256(convert_to(p_secret, 'utf8'))
    );
$$;

revoke all on function public.verify_notification_sender_secret(text) from public;
revoke all on function public.verify_notification_sender_secret(text) from anon, authenticated;
grant execute on function public.verify_notification_sender_secret(text) to service_role;

do $$
declare
  v_old constant text := $q$'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key')$q$;
  v_new constant text := v_old || $q$, 'x-sender-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notification_sender_secret')$q$;
  v_url constant text := '/functions/v1/send-pending-notifications';
  v_fn  record;
  v_def text;
  v_job record;
begin
  for v_fn in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('enqueue_critical_notification', 'escalate_unconfirmed_critical_notifications', 'kick_notification_sender', 'nudge_send_pending')
  loop
    v_def := pg_get_functiondef(v_fn.oid);
    if position('x-sender-secret' in v_def) > 0 then continue; end if;
    if (length(v_def) - length(replace(v_def, v_url, ''))) <> length(v_url)
       or (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) then
      raise exception '% does not have exactly one send-pending-notifications call with the expected Authorization header', v_fn.sig;
    end if;
    execute replace(v_def, v_old, v_new);
  end loop;

  for v_job in select jobid, jobname, command from cron.job where command like '%' || v_url || '%' loop
    if position('x-sender-secret' in v_job.command) > 0 then continue; end if;
    if (length(v_job.command) - length(replace(v_job.command, v_old, ''))) <> length(v_old) then
      raise exception 'cron job % does not have the expected Authorization header', v_job.jobname;
    end if;
    perform cron.alter_job(v_job.jobid, command := replace(v_job.command, v_old, v_new));
  end loop;
end $$;

do $$
declare
  v_missing text;
begin
  if not exists (select 1 from vault.secrets where name = 'notification_sender_secret') then
    raise exception 'notification_sender_secret was not created';
  end if;

  select string_agg(p.oid::regprocedure::text, ', ') into v_missing
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and p.prokind = 'f'
    and pg_get_functiondef(p.oid) like '%/functions/v1/send-pending-notifications%'
    and pg_get_functiondef(p.oid) not like '%x-sender-secret%';
  if v_missing is not null then
    raise exception 'callers of send-pending-notifications still send no x-sender-secret: %', v_missing;
  end if;

  select string_agg(jobname, ', ') into v_missing
  from cron.job
  where command like '%/functions/v1/send-pending-notifications%' and command not like '%x-sender-secret%';
  if v_missing is not null then
    raise exception 'cron jobs still send no x-sender-secret: %', v_missing;
  end if;

  if has_function_privilege('anon', 'public.verify_notification_sender_secret(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.verify_notification_sender_secret(text)', 'EXECUTE') then
    raise exception 'verify_notification_sender_secret must be callable by service_role only';
  end if;
  if not has_function_privilege('service_role', 'public.verify_notification_sender_secret(text)', 'EXECUTE') then
    raise exception 'service_role cannot call verify_notification_sender_secret';
  end if;
end $$;
