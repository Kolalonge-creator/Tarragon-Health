-- Send-later scheduling. Extracts admin_send_broadcast's actual enqueue
-- logic into private.execute_broadcast (SECURITY DEFINER, no auth check of
-- its own — explicitly NOT granted to authenticated/anon, reachable only
-- from admin_send_broadcast, which still does the admin+already-sent checks
-- before delegating, and from the new cron-only process_due_broadcasts
-- below). admin_send_broadcast's own signature and externally-visible
-- "send now" behaviour are unchanged.
alter table public.notification_broadcasts add column scheduled_for timestamptz;

create function private.execute_broadcast(p_broadcast_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_b     public.notification_broadcasts%rowtype;
  v_ch    public.notification_channel;
  v_count integer;
begin
  select * into v_b from public.notification_broadcasts where id = p_broadcast_id;
  if not found then
    raise exception 'broadcast not found';
  end if;
  if v_b.status = 'sent' then
    raise exception 'broadcast already sent';
  end if;

  foreach v_ch in array v_b.channels loop
    if v_ch = 'email' then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      select t.organisation_id, t.recipient_id, 'email', 'pending', 'broadcast_announcement',
             jsonb_build_object(
               'subject', v_b.title, 'body', v_b.body, 'to_email', t.email,
               'email_content', v_b.email_content,
               'broadcast_id', v_b.id,
               'is_partner', t.is_partner
             )
      from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by, v_b.is_marketing) t
      where t.email is not null;

    elsif v_ch = 'sms' then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      select t.organisation_id, t.recipient_id, 'sms', 'pending', 'broadcast_announcement',
             jsonb_build_object('subject', v_b.title, 'body', v_b.body, 'to_phone', t.phone, 'broadcast_id', v_b.id)
      from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by, v_b.is_marketing) t
      where t.phone is not null;

    elsif v_ch = 'whatsapp' then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      select t.organisation_id, t.recipient_id, 'whatsapp', 'pending', 'broadcast_announcement',
             jsonb_build_object('subject', v_b.title, 'body', v_b.body, 'broadcast_id', v_b.id)
      from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by, v_b.is_marketing) t
      where t.phone is not null and t.is_partner = false;
    end if;
  end loop;

  select count(*) into v_count
  from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by, v_b.is_marketing) t
  where t.email is not null or t.phone is not null;

  update public.notification_broadcasts
    set status = 'sent', recipient_count = v_count, sent_at = now()
  where id = p_broadcast_id;

  return v_count;
end;
$function$;

revoke all on function private.execute_broadcast(uuid) from public;
revoke execute on function private.execute_broadcast(uuid) from authenticated;

create or replace function public.admin_send_broadcast(p_broadcast_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_status public.broadcast_status;
begin
  if not private.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select status into v_status from public.notification_broadcasts where id = p_broadcast_id;
  if not found then
    raise exception 'broadcast not found';
  end if;
  if v_status = 'sent' then
    raise exception 'broadcast already sent';
  end if;

  return private.execute_broadcast(p_broadcast_id);
end;
$function$;

-- Cron-only sweep (no auth check of its own — never grant to authenticated/
-- anon). Mirrors the plain "select private.some_function();" internal-job
-- pattern this project already uses for appointment-reminders etc.: pure DB
-- work, no Edge Function/HTTP round-trip needed.
create function private.process_due_broadcasts()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row record;
begin
  for v_row in
    select id from public.notification_broadcasts
    where status = 'draft' and scheduled_for is not null and scheduled_for <= now()
    order by scheduled_for
  loop
    perform private.execute_broadcast(v_row.id);
  end loop;
end;
$function$;

revoke all on function private.process_due_broadcasts() from public;
revoke execute on function private.process_due_broadcasts() from authenticated;

create function public.admin_cancel_scheduled_broadcast(p_broadcast_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not private.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  update public.notification_broadcasts
    set scheduled_for = null
  where id = p_broadcast_id and status = 'draft' and scheduled_for is not null;

  if not found then
    raise exception 'broadcast is not a pending scheduled draft';
  end if;
end;
$function$;

revoke all on function public.admin_cancel_scheduled_broadcast(uuid) from public;
grant execute on function public.admin_cancel_scheduled_broadcast(uuid) to authenticated;

select cron.schedule('process-due-broadcasts', '*/5 * * * *', $$select private.process_due_broadcasts();$$);

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'process-due-broadcasts') then
    raise exception 'process-due-broadcasts cron job was not registered';
  end if;
  if has_function_privilege('authenticated', 'private.execute_broadcast(uuid)', 'EXECUTE') then
    raise exception 'authenticated must not be able to call private.execute_broadcast directly';
  end if;
  if has_function_privilege('authenticated', 'private.process_due_broadcasts()', 'EXECUTE') then
    raise exception 'authenticated must not be able to call private.process_due_broadcasts directly';
  end if;
end $$;
