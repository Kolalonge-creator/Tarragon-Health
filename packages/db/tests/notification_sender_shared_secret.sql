-- Proof for 20261101231722_notification_sender_shared_secret.sql.
-- The notification sender only does work for callers that present the vault secret: the verifier says yes to the real secret and no
-- to empty, null and wrong ones, is callable by service_role only, and every database caller (pg_cron and the four functions) sends
-- the header. Sabotage: a caller without the header, and a verifier that is open to authenticated, must each fail the same checks.
-- The whole file rolls back.
begin;

do $$
declare
  v_secret text;
  v_missing text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notification_sender_secret';
  if v_secret is null then raise exception 'FAIL: no notification_sender_secret in the vault'; end if;

  if not public.verify_notification_sender_secret(v_secret) then raise exception 'FAIL: the real secret was refused'; end if;
  if public.verify_notification_sender_secret(v_secret || 'x') then raise exception 'FAIL: a wrong secret was accepted'; end if;
  if public.verify_notification_sender_secret('') then raise exception 'FAIL: an empty secret was accepted'; end if;
  if public.verify_notification_sender_secret(null) then raise exception 'FAIL: a null secret was accepted'; end if;

  if has_function_privilege('anon', 'public.verify_notification_sender_secret(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.verify_notification_sender_secret(text)', 'EXECUTE') then
    raise exception 'FAIL: the verifier is callable by a client role';
  end if;
  if not has_function_privilege('service_role', 'public.verify_notification_sender_secret(text)', 'EXECUTE') then
    raise exception 'FAIL: service_role cannot call the verifier';
  end if;

  select string_agg(p.oid::regprocedure::text, ', ') into v_missing
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema') and p.prokind = 'f'
    and pg_get_functiondef(p.oid) like '%/functions/v1/send-pending-notifications%'
    and pg_get_functiondef(p.oid) not like '%x-sender-secret%';
  if v_missing is not null then raise exception 'FAIL: callers send no secret: %', v_missing; end if;

  select string_agg(jobname, ', ') into v_missing from cron.job
  where command like '%/functions/v1/send-pending-notifications%' and command not like '%x-sender-secret%';
  if v_missing is not null then raise exception 'FAIL: cron jobs send no secret: %', v_missing; end if;
end $$;

-- Sabotage 1: strip the header out of one caller; the caller check must see it.
do $$
declare
  v_def text := pg_get_functiondef('private.kick_notification_sender()'::regprocedure);
  v_missing text;
begin
  execute replace(v_def, ', ''x-sender-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''notification_sender_secret'')', '');
  select string_agg(p.oid::regprocedure::text, ', ') into v_missing
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.prokind = 'f'
    and pg_get_functiondef(p.oid) like '%/functions/v1/send-pending-notifications%'
    and pg_get_functiondef(p.oid) not like '%x-sender-secret%';
  if v_missing is null then raise exception 'SABOTAGE NOT DETECTED: a caller without the header passed the check'; end if;
end $$;

-- Sabotage 2: open the verifier to authenticated; the privilege check must see it.
grant execute on function public.verify_notification_sender_secret(text) to authenticated;
do $$
begin
  if not has_function_privilege('authenticated', 'public.verify_notification_sender_secret(text)', 'EXECUTE') then
    raise exception 'SABOTAGE NOT DETECTED: grant had no effect';
  end if;
end $$;

rollback;
