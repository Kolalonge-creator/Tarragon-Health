-- Follow-up FU-notify B (OQ-332, OQ-333; founder answers 2026-10-16): no SMS anywhere in the notification ladders.
--
--   OQ-332  The clinician ladder ends at push (Critical Alerts) plus a clinician phone-call task. No ladder hop is ever sms or voice:
--           private.normalize_escalation_channels drops them (the CMO-signed escalation_slas row is NOT edited; a future version should
--           drop its sms literals), and the two hard-coded default ladders become push, email. The exhausted-ladder alarm still fires
--           (the ladder simply has fewer rungs). The INV-08 trigger notifications_suppress_sms_voice stays exactly as is.
--   OQ-333  The emergency-contact SMS exception is removed. The contact still gets push, in-app and email copies when they are a Tarragon
--           account, now queued directly by private.alert_emergency_contact_copies (matched by a CONFIRMED phone, one account only,
--           consent re-checked), instead of fanning out from an sms row. The go-live guard sms_emergency_contact_enabled stays in the
--           table born off (a guard is never deleted by design) and is now unused; public.sms_emergency_contact_open() is dropped.
--
-- LIVE COUNTS BEFORE (2026-10-16, read only): every sms row is suppressed or failed by the INV-08 trigger at insert, so no sms ever
-- reached a provider and the old fan-out (which ran from the sms row at send time) had never run. No conversion step is needed.
-- Rewritten functions start from their LIVE definitions. No begin/commit here: the auto-apply workflow wraps this file.

-- OQ-332 -----------------------------------------------------------------------------------------------------------------
create or replace function private.normalize_escalation_channels(p_raw text[])
returns public.notification_channel[]
language sql
immutable
set search_path to ''
as $function$
  select coalesce(array_agg(mapped.ch order by raw.ord), array[]::public.notification_channel[])
  from unnest(p_raw) with ordinality as raw(token, ord)
  cross join lateral (
    select regexp_replace(trim(split_part(lower(raw.token), ',', 1)), '_nudge$', '') as candidate
  ) stripped
  cross join lateral (
    select case
      when stripped.candidate = 'whatsapp' then 'email'::public.notification_channel
      -- OQ-332: sms and voice are never a ladder hop (INV-08); a signed sequence that still names them simply has fewer rungs.
      when stripped.candidate in ('push', 'email', 'in_app')
        then stripped.candidate::public.notification_channel
      else null
    end as ch
  ) mapped
  where mapped.ch is not null;
$function$;

do $$
declare v_def text; v_new text; v_sig text;
begin
  foreach v_sig in array array[
    'private.enqueue_critical_notification(uuid, uuid, text, jsonb, text, public.alert_level, text, uuid)',
    'private.escalate_unconfirmed_critical_notifications()'] loop
    v_def := pg_get_functiondef(v_sig::regprocedure);
    v_new := replace(v_def, 'array[''push'', ''email'', ''sms'']::public.notification_channel[]', 'array[''push'', ''email'']::public.notification_channel[]');
    if v_new = v_def then raise exception 'FU-notify: default ladder marker not found in % (definition drifted)', v_sig; end if;
    execute v_new;
  end loop;
end $$;

-- OQ-333 -----------------------------------------------------------------------------------------------------------------
-- Queues the push, in-app and email copies for the patient's emergency contact when that contact is a Tarragon account. Returns the
-- number of copies queued (0 when the contact has no confirmed account, the number is shared, consent is missing, or the event is
-- not active). Idempotent: the unique index notifications_emergency_contact_copy_once makes a repeat a no-op.
create function private.alert_emergency_contact_copies(p_event_id uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  e public.emergency_events%rowtype;
  p public.profiles%rowtype;
  v_contact uuid; v_email text; v_n integer := 0; v_rows integer; v_matches integer; v_phone text;
  v_name text;
begin
  select * into e from public.emergency_events where id = p_event_id;
  if not found or e.status <> 'active' or e.suppress_contact_notify then return 0; end if;
  select * into p from public.profiles where id = e.patient_id;
  if not found or p.emergency_contact_phone is null or p.emergency_contact_consent is not true then return 0; end if;
  v_phone := regexp_replace(p.emergency_contact_phone, '^\+', '');
  select count(*), min(u.id::text)::uuid into v_matches, v_contact
    from public.profiles c join auth.users u on u.id = c.id
   where c.phone = p.emergency_contact_phone and c.id <> e.patient_id
     and u.phone_confirmed_at is not null and regexp_replace(coalesce(u.phone, ''), '^\+', '') = v_phone;
  if v_matches <> 1 then return 0; end if;
  select email into v_email from auth.users where id = v_contact;
  v_name := coalesce(p.full_name, 'someone who lists you as their emergency contact');
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, priority, payload)
  select e.organisation_id, v_contact, ch, 'pending', 'emergency_contact_alert', 'routine',
         jsonb_build_object('patient_name', v_name, 'patient_id', e.patient_id, 'source_notification_id', e.id::text)
         || case when ch = 'email' then jsonb_build_object('to_email', v_email) else '{}'::jsonb end
    from unnest(array['push', 'in_app'] || case when v_email is not null then array['email'] else array[]::text[] end) as ch0(ch_text),
         lateral (select ch0.ch_text::public.notification_channel as ch) x
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  v_n := v_rows;
  return v_n;
end;
$$;
revoke all on function private.alert_emergency_contact_copies(uuid) from public, anon, authenticated;

alter table public.emergency_events add column contact_unreachable_checked_at timestamptz;
comment on column public.emergency_events.contact_unreachable_checked_at is 'Last time the emergency-contact alert found nobody it could reach (contact not a Tarragon account). The sweep skips the event for 30 minutes after this, so an unreachable contact is not re-scanned every tick for a day.';

-- LIVE body, the sms insert replaced by the copies above. contact_notified_at is stamped only when a copy was queued, so an
-- unreachable contact is not recorded as "notified" (the loop looks again until the event is a day old).
create or replace function private.notify_unacknowledged_emergencies()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_event public.emergency_events%rowtype;
begin
  for v_event in
    select * from public.emergency_events e
    where e.status = 'active'
      and e.acknowledged_at is null
      and e.contact_notified_at is null
      and e.suppress_contact_notify = false
      and e.created_at < now() - interval '10 minutes'
      and e.created_at > now() - interval '1 day'
      and (e.contact_unreachable_checked_at is null or e.contact_unreachable_checked_at < now() - interval '30 minutes')
  loop
    if private.alert_emergency_contact_copies(v_event.id) > 0 then
      update public.emergency_events set contact_notified_at = now() where id = v_event.id;
    else
      update public.emergency_events set contact_unreachable_checked_at = now() where id = v_event.id;
    end if;
  end loop;
end;
$function$;

-- The patient's "alert my contact now" button (apps/web alert-contact.ts). Service role only.
create function public.alert_emergency_contact(p_event_id uuid, p_actor_id uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  v_n := private.alert_emergency_contact_copies(p_event_id);
  if v_n > 0 then perform public.mark_emergency_contact_notified(p_event_id, p_actor_id); end if;
  return v_n;
end;
$$;
revoke all on function public.alert_emergency_contact(uuid, uuid) from public, anon, authenticated;
grant execute on function public.alert_emergency_contact(uuid, uuid) to service_role;

drop function public.sms_emergency_contact_open();

do $$
begin
  if has_function_privilege('anon', 'public.alert_emergency_contact(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.alert_emergency_contact(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.alert_emergency_contact_copies(uuid)', 'EXECUTE') then
    raise exception 'FU-notify assertion: an emergency-contact function is executable by anon or authenticated';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'private' and p.proname in ('enqueue_critical_notification', 'escalate_unconfirmed_critical_notifications')
                and p.prosrc like '%''email'', ''sms''%') then
    raise exception 'FU-notify assertion: a default ladder still names sms';
  end if;
  if exists (select 1 from unnest(private.normalize_escalation_channels(array['push', 'whatsapp', 'sms', 'voice'])) c where c::text in ('sms', 'voice')) then
    raise exception 'FU-notify assertion: normalize still lets sms through';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.notifications'::regclass and tgname = 'notifications_suppress_sms_voice') then
    raise exception 'FU-notify assertion: the INV-08 trigger must still exist';
  end if;
end $$;
