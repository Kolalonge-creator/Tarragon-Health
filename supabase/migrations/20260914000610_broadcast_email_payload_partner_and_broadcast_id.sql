-- One-click unsubscribe support (patient-only) + groundwork for open/click
-- tracking stats. The edge function's broadcast_announcement handler needs
-- two things it did not previously receive: whether an email recipient is a
-- patient (marketing_opt_in-eligible, safe to offer unsubscribe to) or a
-- partner contact (pharmacy/specialist billing email — private.broadcast_
-- targets already resolves this per-row as `is_partner`, just not carried
-- into the notification payload before now); and which notification_
-- broadcasts row this send belongs to, so admin_broadcast_stats (added in a
-- later migration) can attribute open/click events back to a specific
-- broadcast. Both ride along in the existing payload jsonb, the same way
-- subject/body/email_content already do — no new column needed.
create or replace function public.admin_send_broadcast(p_broadcast_id uuid)
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
  if not private.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

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

do $$
begin
  if position('is_partner' in pg_get_functiondef('public.admin_send_broadcast(uuid)'::regprocedure)) = 0 then
    raise exception 'admin_send_broadcast did not pick up is_partner in payload';
  end if;
  if position('broadcast_id' in pg_get_functiondef('public.admin_send_broadcast(uuid)'::regprocedure)) = 0 then
    raise exception 'admin_send_broadcast did not pick up broadcast_id in payload';
  end if;
end $$;
