-- S01c: remove WhatsApp as a channel (founder decision F-02, 2026-09-30; spec Part C.2).
--
-- WhatsApp was never a working channel. COUNTED BEFORE CUTTING (live project koiplnmbgnqnbywhpjlf, 2026-09-30):
--   notifications sent on whatsapp, ever   77 rows: 68 failed ("recipient has no phone number on file" x67,
--                                          "unknown template" x1), 9 suppressed, 0 sent or delivered
--   of those, critical (clinician ladder)  58 rows, every one already has a next escalation hop, so relabelling
--                                          them cannot make private.escalate_unconfirmed_critical_notifications
--                                          page anyone again
--   alert_deliveries on whatsapp            6 rows (history of clinician alert fan-out)
--   notification_escalation_failures       51 rows, all with whatsapp in channel_sequence_exhausted (history:
--                                          escalation ladders that ran out)
--   notification_templates.default_channels 55 of 96 rows include whatsapp
--   notification_template_locales           0 whatsapp rows (148 total)
--   profiles with whatsapp preference       0 of 11; preferred_reminder_channel = whatsapp 0 of 11
--   patient_notification_preferences        0 rows; care_outreach_contacts 0; support_tickets 0; lpe_task_templates 0
--   support_messages (WhatsApp inbox)       0 rows
--   employer_announcements / notification_broadcasts with whatsapp   0 / 0
-- Patients reachable only via WhatsApp: 0 (no profile has a whatsapp preference, no WhatsApp row was ever
-- delivered), so nobody loses a channel they were actually receiving.
--
-- WHAT THIS DOES
--   * Deletes the WhatsApp value from four enums by rebuilding them: notification_channel (email, sms, in_app,
--     push, voice), outreach_contact_channel (call), support_ticket_channel (in_app, phone, email, faq,
--     chatbot), lpe_task_channel (app). Four array columns and five CHECK constraints are rewritten with them,
--     and notifications.channel's DEFAULT moves from whatsapp to in_app.
--   * Patient reminders: 40 SQL functions inserted channel 'whatsapp' and a BEFORE INSERT trigger
--     (notifications_remap_channel) rewrote it to push or email when the patient had either. That trigger is
--     dropped; each insert now asks private.patient_reminder_channel(recipient), which returns email (only if
--     the patient prefers it), else push (if they have an active subscription), else in_app. A reminder always
--     lands somewhere; it no longer sits as a failed WhatsApp row.
--   * CLINICIAN ESCALATION (the safety-critical part). The CMO-signed escalation_slas v8 still names whatsapp
--     in its ladders (urgent: push, whatsapp_nudge; emergency: push, whatsapp, sms). Editing signed clinical
--     config is not an agent's act, so it is NOT edited. Instead private.normalize_escalation_channels reads a
--     whatsapp or whatsapp_nudge token as email (founder decision D-12: paging is push, in-console alarm and
--     email), which keeps every ladder the same length and gives both live clinicians (real email on file)
--     a working second hop. The built-in fallback ladder becomes push, email, sms. See OQ-29 (CMO to sign a v9).
--   * Emergency contact alert: the whatsapp half is removed (see OQ-30: the sms half has never worked either).
--   * Drops the WhatsApp inbox: table support_messages (0 rows) and its two readers' support blocks
--     (ops_exception_queue, ops_today_summary.support_unread), and patient_notification_preferences.whatsapp_enabled.
--
-- HISTORY KEPT, NOT DELETED. The 77 old rows are relabelled in_app with payload.legacy_channel = 'whatsapp' (status
-- and error text untouched); the 6 alert_deliveries rows likewise; the 51 exhausted-ladder rows have whatsapp
-- replaced by email, the shim's equivalent, so the recorded ladder length is preserved.
--
-- The 10s lock_timeout protects live traffic: the enum rebuild takes ACCESS EXCLUSIVE on notifications and
-- profiles. If a lock is not free in time the whole migration rolls back cleanly; re-run in a quiet window.

set local lock_timeout = '10s';

-- ---------------------------------------------------------------------------------------------
-- 1. The WhatsApp-only remap trigger
-- ---------------------------------------------------------------------------------------------
drop trigger if exists notifications_remap_channel on public.notifications;
drop function if exists private.remap_notification_channel();

-- ---------------------------------------------------------------------------------------------
-- 2. Relabel history that uses the value (before the enum is rebuilt)
-- ---------------------------------------------------------------------------------------------
update public.notifications
   set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('legacy_channel', 'whatsapp'),
       channel = 'in_app'
 where channel::text = 'whatsapp';

update public.alert_deliveries set channel = 'in_app' where channel::text = 'whatsapp';

update public.notification_escalation_failures
   set channel_sequence_exhausted = array_replace(channel_sequence_exhausted::text[], 'whatsapp', 'email')::public.notification_channel[]
 where 'whatsapp' = any (channel_sequence_exhausted::text[]);

update public.notification_templates
   set default_channels = case
         when cardinality(array_remove(default_channels::text[], 'whatsapp')) = 0
           then array['in_app']::public.notification_channel[]
         else array_remove(default_channels::text[], 'whatsapp')::public.notification_channel[]
       end
 where 'whatsapp' = any (default_channels::text[]);

update public.employer_announcements
   set channels = array_remove(channels::text[], 'whatsapp')::public.notification_channel[]
 where 'whatsapp' = any (channels::text[]);

update public.notification_broadcasts
   set channels = array_remove(channels::text[], 'whatsapp')::public.notification_channel[]
 where 'whatsapp' = any (channels::text[]);

-- ---------------------------------------------------------------------------------------------
-- 3. Drop what depends on the old enum so it can be rebuilt
-- ---------------------------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_no_clinical_on_open_rail;
alter table public.employer_announcements drop constraint employer_announcements_channels_are_content_class_safe;
alter table public.profiles drop constraint profiles_notification_channel_preference_check;
alter table public.profiles drop constraint profiles_preferred_reminder_channel_check;
drop function private.normalize_escalation_channels(text[]);

-- ---------------------------------------------------------------------------------------------
-- 4. Delete the enum VALUES: rebuild each enum without the whatsapp label (Postgres cannot drop one label)
-- ---------------------------------------------------------------------------------------------
do $$
declare
  e record;
  r record;
  v_old text;
  v_default text;
  v_is_array boolean;
  v_new_type text;
begin
  for e in
    select * from (values
      ('notification_channel',      array['email','sms','in_app','push','voice']),
      ('outreach_contact_channel',  array['call']),
      ('support_ticket_channel',    array['in_app','phone','email','faq','chatbot']),
      ('lpe_task_channel',          array['app'])
    ) as t(typ, labels)
  loop
    v_old := e.typ || '_old';
    execute format('alter type public.%I rename to %I', e.typ, v_old);
    execute format('create type public.%I as enum (%s)', e.typ,
                   (select string_agg(quote_literal(l), ', ') from unnest(e.labels) l));

    for r in
      select c.table_schema, c.table_name, c.column_name, c.column_default, c.udt_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.udt_name in (v_old, '_' || v_old)
    loop
      v_is_array := left(r.udt_name, 1) = '_';
      v_default := r.column_default;
      if v_default is not null then
        execute format('alter table %I.%I alter column %I drop default', r.table_schema, r.table_name, r.column_name);
      end if;
      if v_is_array then
        execute format('alter table %I.%I alter column %I type public.%I[] using %I::text[]::public.%I[]',
                       r.table_schema, r.table_name, r.column_name, e.typ, r.column_name, e.typ);
      else
        execute format('alter table %I.%I alter column %I type public.%I using %I::text::public.%I',
                       r.table_schema, r.table_name, r.column_name, e.typ, r.column_name, e.typ);
      end if;
      if v_default is not null and v_default not ilike '%whatsapp%' then
        execute format('alter table %I.%I alter column %I set default %s', r.table_schema, r.table_name, r.column_name,
                       replace(v_default, v_old, e.typ));
      end if;
    end loop;

    execute format('drop type public.%I', v_old);
  end loop;
end $$;

-- notifications.channel defaulted to 'whatsapp' (skipped above); anything that omits a channel now lands in-app.
alter table public.notifications alter column channel set default 'in_app';

-- ---------------------------------------------------------------------------------------------
-- 5. Recreate the constraints without whatsapp, and the two routing functions
-- ---------------------------------------------------------------------------------------------
alter table public.notifications add constraint notifications_no_clinical_on_open_rail
  check (content_class = 'non_clinical' or channel <> all (array['sms'::public.notification_channel, 'email'::public.notification_channel]));
alter table public.employer_announcements add constraint employer_announcements_channels_are_content_class_safe
  check (channels <@ array['in_app'::public.notification_channel, 'email'::public.notification_channel, 'sms'::public.notification_channel]);
alter table public.profiles add constraint profiles_notification_channel_preference_check
  check (notification_channel_preference = any (array['sms'::public.notification_channel, 'email'::public.notification_channel, 'push'::public.notification_channel])
         or notification_channel_preference is null);
-- Vestigial: only 'voice' is left and nothing consumes it (the WhatsApp-to-call remap is gone). Kept so the column stays valid.
alter table public.profiles add constraint profiles_preferred_reminder_channel_check
  check (preferred_reminder_channel = 'voice');

-- A whatsapp or whatsapp_nudge token in the CMO-signed escalation ladder is read as email (D-12, OQ-29). Every other
-- behaviour is exactly as before, so a ladder keeps its length and its order.
create function private.normalize_escalation_channels(p_raw text[])
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
      when stripped.candidate in ('push', 'sms', 'email', 'in_app', 'voice')
        then stripped.candidate::public.notification_channel
      else null
    end as ch
  ) mapped
  where mapped.ch is not null;
$function$;
revoke all on function private.normalize_escalation_channels(text[]) from public, anon;
grant execute on function private.normalize_escalation_channels(text[]) to authenticated, service_role;

-- Where a patient reminder should go now that the WhatsApp placeholder channel is gone. Mirrors what the old
-- remap trigger did for the routes that worked (email if preferred, push if subscribed) and falls back to the
-- in-app inbox instead of a dead channel. p_allow_email = false is for call sites that already insert their own
-- explicit email row for the same event, so the patient is never emailed twice.
create function private.patient_reminder_channel(p_recipient uuid, p_allow_email boolean default true)
 returns public.notification_channel
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select case
    when p_allow_email
         and (select notification_channel_preference from public.profiles where id = p_recipient) = 'email'
      then 'email'::public.notification_channel
    when exists (select 1 from public.push_subscriptions where profile_id = p_recipient and disabled_at is null)
      then 'push'::public.notification_channel
    else 'in_app'::public.notification_channel
  end;
$function$;
revoke all on function private.patient_reminder_channel(uuid, boolean) from public, anon;
grant execute on function private.patient_reminder_channel(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. Rewrite every surviving function without the whatsapp channel (definitions read from live 2026-09-30)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_appointment(p_appointment_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_appt public.appointments;
  v_policy public.appointment_cancellation_policies;
  v_hours_until numeric;
  v_actor_is_patient boolean;
  v_is_patient_side boolean;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'appointment not found';
  end if;

  v_actor_is_patient := v_appt.patient_id = v_uid;
  v_is_patient_side := v_actor_is_patient;

  if not (v_is_patient_side or private.is_org_staff(v_appt.organisation_id)) then
    if private.can_act_for(v_appt.patient_id, 'book_appointments'::public.caregiver_permission) then
      v_is_patient_side := true;
    else
      raise exception 'not authorized';
    end if;
  end if;
  if v_appt.status in ('completed', 'cancelled', 'patient_cancelled', 'provider_cancelled', 'no_show', 'expired', 'failed', 'rescheduled') then
    raise exception 'appointment is already %', v_appt.status;
  end if;

  v_policy := private.resolve_cancellation_policy(v_appt.organisation_id, v_appt.appointment_type);
  v_hours_until := extract(epoch from (v_appt.scheduled_for - now())) / 3600.0;

  update public.appointments set
    status = case
      when v_is_patient_side then 'patient_cancelled'::public.appointment_status
      else 'provider_cancelled'::public.appointment_status
    end,
    cancelled_at = now(),
    cancelled_by = v_uid,
    cancellation_reason = p_reason,
    hold_expires_at = null,
    payment_status = case
      when payment_status = 'paid'
        and v_policy.id is not null
        and v_policy.refund_pct_within_window > 0
        and v_hours_until >= v_policy.cancellation_window_hours
      then 'refund_due'
      else payment_status
    end
  where id = p_appointment_id
  returning * into v_appt;

  perform private.offer_next_waiting_list_candidate(
    v_appt.organisation_id, v_appt.clinician_id, v_appt.appointment_type,
    v_appt.consultation_method, v_appt.location, v_appt.scheduled_for, v_appt.ends_at
  );

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (
    v_appt.organisation_id, v_appt.patient_id, private.patient_reminder_channel(v_appt.patient_id), 'pending', 'appointment_cancelled',
    jsonb_build_object(
      'appointment_id', v_appt.id, 'scheduled_for', v_appt.scheduled_for,
      'cancelled_by_patient', v_actor_is_patient,
      'cancelled_by_caregiver', (not v_actor_is_patient) and v_is_patient_side
    ),
    'non_clinical'
  );

  if v_appt.patient_id <> v_uid then
    perform private.log_care_access(v_appt.patient_id, 'acted_for', 'booking', jsonb_build_object('appointment_id', v_appt.id, 'stage', 'cancelled'));
  end if;

  return v_appt;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cascade_provider_time_off()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_appt record;
  v_default_reason text;
begin
  v_default_reason := case when new.kind = 'leave'
    then 'Your provider is on leave for this time'
    else 'Your provider is unavailable at this time'
  end;

  for v_appt in
    select *
    from public.appointments
    where clinician_id = new.clinician_id
      and status in ('held', 'booked', 'confirmed')
      and tstzrange(scheduled_for, ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
    for update
  loop
    update public.appointments
      set status = 'provider_cancelled',
          cancelled_at = now(),
          cancellation_reason = coalesce(new.reason, v_default_reason),
          hold_expires_at = null
      where id = v_appt.id;

    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    values (
      v_appt.organisation_id, v_appt.patient_id, private.patient_reminder_channel(v_appt.patient_id), 'pending', 'appointment_provider_cancelled',
      jsonb_build_object(
        'appointment_id', v_appt.id,
        'scheduled_for', v_appt.scheduled_for,
        'appointment_type', v_appt.appointment_type,
        'reason', coalesce(new.reason, v_default_reason)
      ),
      'non_clinical'
    );

    insert into public.appointment_waiting_list (
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      preferred_from, preferred_until, source_appointment_id
    ) values (
      v_appt.organisation_id, v_appt.patient_id, v_appt.clinician_id, v_appt.appointment_type, v_appt.consultation_method,
      now(), v_appt.scheduled_for + interval '30 days', v_appt.id
    );
  end loop;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_appointment_booking(p_appointment_id uuid)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_appt public.appointments;
  v_product_code text;
  v_consult_context public.video_consultation_context;
  v_consult_id uuid;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'appointment not found';
  end if;
  if v_appt.patient_id <> v_uid
     and not private.is_org_staff(v_appt.organisation_id)
     and not private.can_act_for(v_appt.patient_id, 'book_appointments'::public.caregiver_permission) then
    raise exception 'not authorized';
  end if;
  if v_appt.status not in ('held', 'booked') then
    raise exception 'appointment is not on hold';
  end if;
  if v_appt.status = 'held' and v_appt.hold_expires_at < now() then
    update public.appointments set status = 'expired', hold_expires_at = null where id = p_appointment_id;
    raise exception 'hold has expired — pick another slot';
  end if;

  if v_appt.payment_status = 'pending' then
    v_product_code := case v_appt.appointment_type
      when 'telemedicine' then 'video_visit_credit'
      when 'result_interpretation' then 'result_interpretation_credit'
      else null
    end;
    if v_product_code is not null then
      begin
        perform public.redeem_available_service_purchase(
          v_appt.patient_id, v_product_code, 'appointment', v_appt.id
        );
        v_appt.payment_status := 'paid';
      exception when others then
        if sqlerrm not like 'no available%' then
          raise;
        end if;
      end;
    end if;
  end if;

  update public.appointments
    set payment_status = v_appt.payment_status,
        status = case when v_appt.payment_status in ('paid', 'not_required', 'waived')
                      then 'confirmed'::public.appointment_status
                      else 'booked'::public.appointment_status end,
        confirmed_at = case when v_appt.payment_status in ('paid', 'not_required', 'waived') then now() else confirmed_at end,
        hold_expires_at = null
    where id = p_appointment_id
    returning * into v_appt;

  if v_appt.status = 'confirmed'
     and v_appt.video_consultation_id is null
     and v_appt.appointment_type in ('telemedicine', 'result_interpretation') then
    v_consult_context := case v_appt.appointment_type
      when 'result_interpretation' then 'lab_result_consult'
      else 'general_checkin'
    end;

    insert into public.video_consultations
      (organisation_id, patient_id, context, initiated_by, status, scheduled_at)
    values
      (v_appt.organisation_id, v_appt.patient_id, v_consult_context, v_appt.patient_id, 'scheduled', v_appt.scheduled_for)
    returning id into v_consult_id;

    update public.appointments set video_consultation_id = v_consult_id where id = v_appt.id
    returning * into v_appt;
  end if;

  if v_appt.status = 'confirmed' then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    values (
      v_appt.organisation_id, v_appt.patient_id, private.patient_reminder_channel(v_appt.patient_id), 'pending', 'appointment_booking_confirmation',
      jsonb_build_object('appointment_id', v_appt.id, 'scheduled_for', v_appt.scheduled_for, 'appointment_type', v_appt.appointment_type),
      'non_clinical'
    );
  end if;

  if v_appt.patient_id <> v_uid then
    perform private.log_care_access(v_appt.patient_id, 'acted_for', 'booking', jsonb_build_object('appointment_id', v_appt.id, 'stage', v_appt.status::text));
  end if;

  return v_appt;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_critical_notification(p_organisation_id uuid, p_recipient_id uuid, p_template text, p_payload jsonb, p_pathway text, p_alert_tier alert_level, p_source_table text DEFAULT NULL::text, p_source_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_raw text[];
  v_channels public.notification_channel[];
  v_id uuid;
begin
  v_raw := private.escalation_channel_sequence_or_null(p_pathway, p_alert_tier);
  v_channels := private.normalize_escalation_channels(coalesce(v_raw, array[]::text[]));
  if array_length(v_channels, 1) is null then
    -- Previously unreachable: escalation_channel_sequence() raised here for an
    -- unregistered pathway, which aborted the clinical INSERT that triggered
    -- this call rather than degrading to a default.
    v_channels := array['push', 'email', 'sms']::public.notification_channel[];
    raise warning 'escalation_slas has no active entry for pathway=% tier=% — notifying on the default channel sequence instead',
      p_pathway, p_alert_tier;
  end if;

  insert into public.notifications
    (organisation_id, recipient_id, channel, template, payload, priority,
     escalation_pathway, escalation_alert_tier, escalation_hop, source_table, source_id)
  values
    (p_organisation_id, p_recipient_id, v_channels[1], p_template, p_payload, 'critical',
     p_pathway, p_alert_tier, 1, p_source_table, p_source_id)
  returning id into v_id;

  begin
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
        || '/functions/v1/send-pending-notifications',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
        'Content-Type', 'application/json'
      ),
      timeout_milliseconds := 8000
    );
  exception when others then
    null;
  end;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_lab_order_lab_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_patient       public.profiles%rowtype;
  v_patient_email text;
  v_provider      public.lab_providers%rowtype;
  v_facility_name text;
  v_bundle_name   text;
begin
  select * into v_patient from public.profiles where id = new.patient_id;
  select email into v_patient_email from auth.users where id = new.patient_id;

  if new.provider_id is not null then
    select * into v_provider from public.lab_providers where id = new.provider_id;
  end if;
  if new.facility_id is not null then
    select name into v_facility_name from public.facilities where id = new.facility_id;
  end if;
  select name into v_bundle_name from public.panel_bundles where id = new.panel_bundle_id;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id, false), 'pending', 'lab_order_patient_confirmation',
    jsonb_build_object('order_number', new.order_number, 'patient_name', coalesce(v_patient.full_name, 'there'),
      'patient_number', v_patient.patient_number, 'lab_name', coalesce(v_facility_name, v_provider.name, 'the lab'),
      'test_name', coalesce(v_bundle_name, 'your test')));

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (new.organisation_id, new.patient_id, 'in_app', 'pending', 'lab_order_patient_confirmation',
    jsonb_build_object('order_number', new.order_number, 'patient_name', coalesce(v_patient.full_name, 'there'),
      'patient_number', v_patient.patient_number, 'lab_name', coalesce(v_facility_name, v_provider.name, 'the lab'),
      'test_name', coalesce(v_bundle_name, 'your test')));

  if v_patient_email is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (new.organisation_id, new.patient_id, 'email', 'pending', 'lab_order_patient_confirmation',
      jsonb_build_object('to_email', v_patient_email, 'order_number', new.order_number, 'patient_name', coalesce(v_patient.full_name, 'there'),
        'patient_number', v_patient.patient_number, 'lab_name', coalesce(v_facility_name, v_provider.name, 'the lab'),
        'test_name', coalesce(v_bundle_name, 'your test')));
  end if;

  if v_provider.contact_phone is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (new.organisation_id, new.patient_id, 'sms', 'pending', 'lab_order_lab_alert',
      jsonb_build_object('to_phone', v_provider.contact_phone, 'lab_name', v_provider.name, 'facility_name', coalesce(v_facility_name, ''),
        'patient_name', coalesce(v_patient.full_name, 'a patient'), 'patient_number', v_patient.patient_number,
        'order_number', new.order_number, 'test_name', coalesce(v_bundle_name, 'a lab test')));
  end if;

  if v_provider.contact_email is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (new.organisation_id, new.patient_id, 'email', 'pending', 'lab_order_lab_alert',
      jsonb_build_object('to_email', v_provider.contact_email, 'lab_name', v_provider.name, 'facility_name', coalesce(v_facility_name, ''),
        'patient_name', coalesce(v_patient.full_name, 'a patient'), 'patient_number', v_patient.patient_number,
        'order_number', new.order_number, 'test_name', coalesce(v_bundle_name, 'a lab test')));
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_lab_order_requested_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_patient       public.profiles%rowtype;
  v_patient_email text;
  v_test_name     text;
  v_order_ref     text;
  v_self_booked   boolean;
begin
  -- Every lab order notifies the patient. Self-booked orders get a showable
  -- confirmation to present at the lab; doctor/system orders get a "requested
  -- for you" message. The template branches on self_booked.
  v_self_booked := (new.origin = 'patient_initiated' and new.ordered_by is null);

  select * into v_patient from public.profiles where id = new.patient_id;
  select email into v_patient_email from auth.users where id = new.patient_id;

  select name into v_test_name from public.panel_bundles where id = new.panel_bundle_id;
  v_test_name := coalesce(v_test_name, 'a lab test');
  v_order_ref := coalesce(new.order_number, 'your order');

  -- Email — the required, guaranteed channel.
  if v_patient_email is not null then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'email', 'pending',
      'lab_order_requested_patient',
      jsonb_build_object(
        'to_email',     v_patient_email,
        'patient_name', coalesce(v_patient.full_name, 'there'),
        'order_number', v_order_ref,
        'test_name',    v_test_name,
        'self_booked',  v_self_booked,
        -- New: lets send-pending-notifications fetch and attach the PDF via
        -- /api/internal/notifications/lab-order-request-pdf/{order_id}. Kept
        -- as its own field rather than folded into order_number (a display
        -- string) because the Edge Function needs the real uuid, not the
        -- human-readable reference.
        'order_id',     new.id
      )
    );
  end if;

  -- Best-effort patient notice on the patient's own channel (push or email when they have one,
  -- otherwise in-app). No PDF goes over a notification channel; it is not a document-delivery one.
  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  values (
    new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id, false), 'pending',
    'lab_order_requested_patient',
    jsonb_build_object(
      'patient_name', coalesce(v_patient.full_name, 'there'),
      'order_number', v_order_ref,
      'test_name',    v_test_name,
      'self_booked',  v_self_booked
    )
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_medication_prescribed_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_patient       public.profiles%rowtype;
  v_patient_email text;
  v_details       text;
begin
  if new.source not in ('clinician', 'specialist') or new.is_active is not true then
    return new;
  end if;

  select * into v_patient from public.profiles where id = new.patient_id;
  select email into v_patient_email from auth.users where id = new.patient_id;

  v_details := new.drug_name
    || coalesce(' ' || nullif(new.dose, ''), '')
    || coalesce(', ' || nullif(new.frequency, ''), '');

  if v_patient_email is not null then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'email', 'pending',
      'medication_prescribed_patient',
      jsonb_build_object(
        'to_email',        v_patient_email,
        'patient_name',    coalesce(v_patient.full_name, 'there'),
        'drug_name',       new.drug_name,
        'dose',            coalesce(new.dose, ''),
        'frequency',       coalesce(new.frequency, ''),
        'details',         v_details,
        'prescriber_name', coalesce(new.prescriber_name, '')
      )
    );
  end if;

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  values (
    new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id, false), 'pending',
    'medication_prescribed_patient',
    jsonb_build_object(
      'patient_name',    coalesce(v_patient.full_name, 'there'),
      'drug_name',       new.drug_name,
      'dose',            coalesce(new.dose, ''),
      'frequency',       coalesce(new.frequency, ''),
      'details',         v_details,
      'prescriber_name', coalesce(new.prescriber_name, '')
    )
  );

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  values (
    new.organisation_id, new.patient_id, 'in_app', 'pending',
    'medication_prescribed_patient',
    jsonb_build_object(
      'patient_name',    coalesce(v_patient.full_name, 'there'),
      'drug_name',       new.drug_name,
      'dose',            coalesce(new.dose, ''),
      'frequency',       coalesce(new.frequency, ''),
      'details',         v_details,
      'prescriber_name', coalesce(new.prescriber_name, '')
    )
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_pharmacy_order_fulfilment_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_patient       public.profiles%rowtype;
  v_patient_email text;
  v_pharmacy      public.pharmacy_partners%rowtype;
  v_logistics     public.logistics_partners%rowtype;
  v_items_summary text;
  v_alt_names     text;
  v_failure       public.delivery_failure_reason;
  v_template      text;
  v_payload       jsonb;
begin
  select * into v_patient from public.profiles where id = new.patient_id;
  select email into v_patient_email from auth.users where id = new.patient_id;

  if new.pharmacy_partner_id is not null then
    select * into v_pharmacy from public.pharmacy_partners where id = new.pharmacy_partner_id;
  end if;
  if new.logistics_partner_id is not null then
    select * into v_logistics from public.logistics_partners where id = new.logistics_partner_id;
  end if;

  select string_agg(
           coalesce(item->>'drug_name', 'item')
             || case when (item->>'quantity') is not null then ' x' || (item->>'quantity') else '' end,
           ', ')
    into v_items_summary
  from jsonb_array_elements(new.items) as item;
  v_items_summary := coalesce(v_items_summary, 'your medication');

  if new.status = 'dispensed' then
    if new.fulfilment_method = 'pickup' then
      v_template := 'pharmacy_order_ready_for_collection';
      v_payload := jsonb_build_object(
        'order_number',   new.order_number,
        'patient_name',   coalesce(v_patient.full_name, 'there'),
        'patient_number', v_patient.patient_number,
        'pharmacy_name',  coalesce(v_pharmacy.name, 'the pharmacy'),
        'items_summary',  v_items_summary
      );
    end if;
    -- fulfilment_method = 'delivery': no notification here, out_for_delivery covers it.

  elsif new.status = 'out_for_delivery' then
    v_template := 'pharmacy_order_out_for_delivery';
    v_payload := jsonb_build_object(
      'order_number',          new.order_number,
      'patient_name',          coalesce(v_patient.full_name, 'there'),
      'items_summary',         v_items_summary,
      'courier_name',          coalesce(v_logistics.name, 'your courier'),
      'estimated_delivery_at', new.estimated_delivery_at,
      'requires_cold_chain',   new.requires_cold_chain
    );

  elsif new.status = 'delivered' then
    v_template := 'pharmacy_order_delivered';
    v_payload := jsonb_build_object(
      'order_number',  new.order_number,
      'patient_name',  coalesce(v_patient.full_name, 'there'),
      'items_summary', v_items_summary
    );

  elsif new.status = 'delivery_failed' then
    select failure_reason into v_failure
    from public.pharmacy_order_delivery_attempts
    where pharmacy_order_id = new.id
    order by attempted_at desc
    limit 1;

    v_template := 'pharmacy_order_delivery_failed';
    v_payload := jsonb_build_object(
      'order_number',    new.order_number,
      'patient_name',    coalesce(v_patient.full_name, 'there'),
      'items_summary',   v_items_summary,
      'failure_reason',  coalesce(v_failure::text, 'other')
    );

  elsif new.status = 'unavailable' then
    select string_agg(name, ', ') into v_alt_names
    from (
      select name from public.pharmacy_partners
      where is_active = true
        and id is distinct from new.pharmacy_partner_id
        and (v_pharmacy.regions is null or regions && v_pharmacy.regions)
      order by name
      limit 3
    ) alt;

    v_template := 'pharmacy_order_unavailable';
    v_payload := jsonb_build_object(
      'order_number',   new.order_number,
      'patient_name',   coalesce(v_patient.full_name, 'there'),
      'items_summary',  v_items_summary,
      'pharmacy_name',  coalesce(v_pharmacy.name, 'the pharmacy'),
      'reason',         coalesce(new.unavailable_reason, ''),
      'alternatives',   coalesce(v_alt_names, '')
    );
  end if;

  if v_template is null then
    return new;
  end if;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id, false), 'pending', v_template, v_payload);

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (new.organisation_id, new.patient_id, 'in_app', 'pending', v_template, v_payload);

  if v_patient_email is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'email', 'pending', v_template,
      v_payload || jsonb_build_object('to_email', v_patient_email)
    );
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_pharmacy_order_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_patient       public.profiles%rowtype;
  v_patient_email text;
  v_pharmacy      public.pharmacy_partners%rowtype;
  v_items_summary text;
begin
  select * into v_patient from public.profiles where id = new.patient_id;
  select email into v_patient_email from auth.users where id = new.patient_id;

  if new.pharmacy_partner_id is not null then
    select * into v_pharmacy from public.pharmacy_partners
      where id = new.pharmacy_partner_id;
  end if;

  select string_agg(
           coalesce(item->>'drug_name', 'item')
             || case
                  when (item->>'quantity') is not null
                  then ' x' || (item->>'quantity')
                  else ''
                end,
           ', ')
    into v_items_summary
  from jsonb_array_elements(new.items) as item;
  v_items_summary := coalesce(v_items_summary, 'your medication');

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  values (
    new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id, false), 'pending',
    'pharmacy_order_patient_confirmation',
    jsonb_build_object(
      'order_number',   new.order_number,
      'patient_name',   coalesce(v_patient.full_name, 'there'),
      'patient_number', v_patient.patient_number,
      'pharmacy_name',  coalesce(v_pharmacy.name, 'the pharmacy'),
      'items_summary',  v_items_summary
    )
  );

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  values (
    new.organisation_id, new.patient_id, 'in_app', 'pending',
    'pharmacy_order_patient_confirmation',
    jsonb_build_object(
      'order_number',   new.order_number,
      'patient_name',   coalesce(v_patient.full_name, 'there'),
      'patient_number', v_patient.patient_number,
      'pharmacy_name',  coalesce(v_pharmacy.name, 'the pharmacy'),
      'items_summary',  v_items_summary
    )
  );

  if v_patient_email is not null then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'email', 'pending',
      'pharmacy_order_patient_confirmation',
      jsonb_build_object(
        'to_email',       v_patient_email,
        'order_number',   new.order_number,
        'patient_name',   coalesce(v_patient.full_name, 'there'),
        'patient_number', v_patient.patient_number,
        'pharmacy_name',  coalesce(v_pharmacy.name, 'the pharmacy'),
        'items_summary',  v_items_summary
      )
    );
  end if;

  if v_pharmacy.contact_phone is not null then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'sms', 'pending',
      'pharmacy_order_pharmacy_alert',
      jsonb_build_object(
        'to_phone',       v_pharmacy.contact_phone,
        'pharmacy_name',  v_pharmacy.name,
        'patient_name',   coalesce(v_patient.full_name, 'a patient'),
        'patient_number', v_patient.patient_number,
        'order_number',   new.order_number,
        'items_summary',  v_items_summary
      )
    );
  end if;

  if v_pharmacy.contact_email is not null then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'email', 'pending',
      'pharmacy_order_pharmacy_alert',
      jsonb_build_object(
        'to_email',       v_pharmacy.contact_email,
        'pharmacy_name',  v_pharmacy.name,
        'patient_name',   coalesce(v_patient.full_name, 'a patient'),
        'patient_number', v_patient.patient_number,
        'order_number',   new.order_number,
        'items_summary',  v_items_summary
      )
    );
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_pharmacy_order_response_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pharmacy_name text;
begin
  select name into v_pharmacy_name from public.pharmacy_partners where id = new.pharmacy_partner_id;

  if new.status = 'confirmed' and new.accepted_at is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id), 'pending',
      'pharmacy_order_accepted',
      jsonb_build_object(
        'order_number', new.order_number,
        'pharmacy_name', coalesce(v_pharmacy_name, 'the pharmacy'),
        'confirmed_quantity', new.confirmed_quantity,
        'estimated_fulfilment_at', new.estimated_fulfilment_at
      )
    );
  elsif new.status = 'cancelled' and new.declined_by is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id), 'pending',
      'pharmacy_order_declined',
      jsonb_build_object(
        'order_number', new.order_number,
        'pharmacy_name', coalesce(v_pharmacy_name, 'the pharmacy'),
        'reason', new.cancellation_reason
      )
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_referral_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_patient       public.profiles%rowtype;
  v_patient_email text;
  v_provider      public.specialist_providers%rowtype;
begin
  select * into v_patient from public.profiles where id = new.patient_id;
  select email into v_patient_email from auth.users where id = new.patient_id;

  if new.specialist_provider_id is not null then
    select * into v_provider from public.specialist_providers where id = new.specialist_provider_id;
  end if;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id, false), 'pending', 'referral_patient_confirmation',
    jsonb_build_object('referral_number', new.referral_number, 'patient_name', coalesce(v_patient.full_name, 'there'),
      'patient_number', v_patient.patient_number, 'specialist_name', coalesce(v_provider.name, 'your specialist'),
      'specialist_type', new.specialist_type::text));

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (new.organisation_id, new.patient_id, 'in_app', 'pending', 'referral_patient_confirmation',
    jsonb_build_object('referral_number', new.referral_number, 'patient_name', coalesce(v_patient.full_name, 'there'),
      'patient_number', v_patient.patient_number, 'specialist_name', coalesce(v_provider.name, 'your specialist'),
      'specialist_type', new.specialist_type::text));

  if v_patient_email is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (new.organisation_id, new.patient_id, 'email', 'pending', 'referral_patient_confirmation',
      jsonb_build_object('to_email', v_patient_email, 'referral_number', new.referral_number, 'patient_name', coalesce(v_patient.full_name, 'there'),
        'patient_number', v_patient.patient_number, 'specialist_name', coalesce(v_provider.name, 'your specialist'),
        'specialist_type', new.specialist_type::text));
  end if;

  if v_provider.contact_phone is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (new.organisation_id, new.patient_id, 'sms', 'pending', 'referral_specialist_alert',
      jsonb_build_object('to_phone', v_provider.contact_phone, 'specialist_name', v_provider.name,
        'patient_name', coalesce(v_patient.full_name, 'a patient'), 'patient_number', v_patient.patient_number,
        'referral_number', new.referral_number, 'specialist_type', new.specialist_type::text,
        'referral_reason', coalesce(new.referral_reason, '')));
  end if;

  if v_provider.contact_email is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (new.organisation_id, new.patient_id, 'email', 'pending', 'referral_specialist_alert',
      jsonb_build_object('to_email', v_provider.contact_email, 'specialist_name', v_provider.name,
        'patient_name', coalesce(v_patient.full_name, 'a patient'), 'patient_number', v_patient.patient_number,
        'referral_number', new.referral_number, 'specialist_type', new.specialist_type::text,
        'referral_reason', coalesce(new.referral_reason, '')));
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.escalate_diagnostic_follow_up_non_completion()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.diagnostic_episodes;
  v_since date;
  v_days_overdue integer;
  v_message text;
begin
  for r in
    select de.*
    from public.diagnostic_episodes de
    where de.status = 'open'
      and (de.requires_referral or de.requires_repeat_test)
  loop
    v_since := private.diagnostic_episode_overdue_since(r);
    if v_since is null then
      continue;
    end if;

    v_days_overdue := current_date - v_since;
    v_message := format('Follow-up for a diagnostic episode (opened %s) is %s day(s) overdue.', r.opened_at::date, v_days_overdue);

    -- Hop 1: first patient reminder.
    if v_days_overdue >= 0
       and not exists (select 1 from public.diagnostic_follow_up_escalations where diagnostic_episode_id = r.id and hop = 1)
    then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values (r.organisation_id, r.patient_id, private.patient_reminder_channel(r.patient_id), 'pending', 'diagnostic_follow_up_reminder',
        jsonb_build_object('diagnostic_episode_id', r.id));
      insert into public.diagnostic_follow_up_escalations (diagnostic_episode_id, hop) values (r.id, 1);
      update public.diagnostic_episodes
        set follow_up_reminder_count = follow_up_reminder_count + 1, follow_up_last_reminded_at = now()
        where id = r.id;
    end if;

    -- Hop 2: second attempt, 5 days later.
    if v_days_overdue >= 5
       and not exists (select 1 from public.diagnostic_follow_up_escalations where diagnostic_episode_id = r.id and hop = 2)
    then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values (r.organisation_id, r.patient_id, private.patient_reminder_channel(r.patient_id), 'pending', 'diagnostic_follow_up_second_reminder',
        jsonb_build_object('diagnostic_episode_id', r.id));
      insert into public.diagnostic_follow_up_escalations (diagnostic_episode_id, hop) values (r.id, 2);
      update public.diagnostic_episodes
        set follow_up_reminder_count = follow_up_reminder_count + 1, follow_up_last_reminded_at = now()
        where id = r.id;
    end if;

    -- Hop 3: care coordinator, 10 days.
    if v_days_overdue >= 10
       and not exists (select 1 from public.diagnostic_follow_up_escalations where diagnostic_episode_id = r.id and hop = 3)
    then
      insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, trigger_detail, priority)
      values (r.organisation_id, r.patient_id, 'unactioned_abnormal',
        jsonb_build_object('diagnostic_episode_id', r.id, 'days_overdue', v_days_overdue), 1)
      on conflict (patient_id, trigger_type) where status in ('open', 'in_progress', 'contacted') do nothing;
      insert into public.diagnostic_follow_up_escalations (diagnostic_episode_id, hop) values (r.id, 3);
      update public.diagnostic_episodes set follow_up_coordinator_escalated_at = now() where id = r.id;
    end if;

    -- Hop 4: clinical escalation, 17 days.
    if v_days_overdue >= 17
       and not exists (select 1 from public.diagnostic_follow_up_escalations where diagnostic_episode_id = r.id and hop = 4)
    then
      perform private.raise_clinician_alert(
        r.organisation_id, r.patient_id, 'urgent_escalation',
        'Diagnostic follow-up not completed',
        v_message, 'clinical', 'abnormal_result'
      );
      insert into public.diagnostic_follow_up_escalations (diagnostic_episode_id, hop) values (r.id, 4);
      update public.diagnostic_episodes set follow_up_clinically_escalated_at = now() where id = r.id;
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION private.escalate_unconfirmed_critical_notifications()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  v_channels public.notification_channel[];
  v_total_channels int;
  v_sla_minutes int;
  v_hop_minutes numeric;
  v_next_channel public.notification_channel;

  -- The ladder the engine has always carried as a fallback and could never
  -- actually reach, because escalation_channel_sequence() raises instead of
  -- returning null. It is now the real ladder for an unpathwayed critical.
  c_default_channels constant public.notification_channel[] :=
    array['push', 'email', 'sms']::public.notification_channel[];

  -- The contact SLA for an emergency_event, the closest configured analogue
  -- to "a clinician has been paged and has not confirmed". Divided by the
  -- ladder length below, it puts ~40 minutes between hops.
  c_default_sla_minutes constant int := 120;

  -- See the header: bounds the first run after this migration to notifications
  -- recent enough that hopping them is still useful.
  c_lookback constant interval := interval '7 days';
begin
  for r in
    select n.*
    from public.notifications n
    where n.priority = 'critical'
      and n.opened_at is null
      and n.created_at > now() - c_lookback
      -- The engine's own admin alarm. Escalating it would make the engine
      -- alarm about its own alarms without end.
      and n.template is distinct from 'critical_notification_escalation_exhausted'
      and (n.status = 'failed' or (n.status in ('sent', 'delivered') and n.sent_at is not null))
      and not exists (select 1 from public.notifications nxt where nxt.escalated_from_id = n.id)
      and not exists (select 1 from public.notification_escalation_failures f where f.notification_id = n.id)
  loop
    if r.escalation_pathway is null then
      v_channels    := c_default_channels;
      v_sla_minutes := c_default_sla_minutes;
    else
      -- escalation_slas is admin-editable, so a pathway can lose its config
      -- while notifications carrying it are still in flight. Previously that
      -- raised out of the whole loop; now it degrades this one row.
      begin
        v_channels := private.normalize_escalation_channels(
          private.escalation_channel_sequence(r.escalation_pathway, r.escalation_alert_tier)
        );
        v_sla_minutes := private.escalation_sla_minutes(r.escalation_pathway, r.escalation_alert_tier);
      exception when others then
        v_channels    := null;
        v_sla_minutes := null;
      end;
    end if;

    if array_length(v_channels, 1) is null then
      v_channels := c_default_channels;
    end if;
    v_sla_minutes := coalesce(v_sla_minutes, c_default_sla_minutes);
    v_total_channels := array_length(v_channels, 1);

    if r.status <> 'failed' then
      v_hop_minutes := greatest(2, floor(v_sla_minutes::numeric / v_total_channels));
      if now() - r.sent_at < (v_hop_minutes || ' minutes')::interval then
        continue;
      end if;
    end if;

    if r.escalation_hop >= v_total_channels then
      insert into public.notification_escalation_failures
        (organisation_id, notification_id, source_table, source_id,
         escalation_pathway, escalation_alert_tier, channel_sequence_exhausted)
      values
        (r.organisation_id, r.id, r.source_table, r.source_id,
         r.escalation_pathway, r.escalation_alert_tier, v_channels)
      on conflict (notification_id) do nothing;

      insert into public.notifications (organisation_id, recipient_id, channel, template, payload, priority)
      select
        r.organisation_id,
        p.id,
        'in_app',
        'critical_notification_escalation_exhausted',
        jsonb_build_object(
          'notification_id', r.id,
          'source_table', r.source_table,
          'source_id', r.source_id,
          'pathway', r.escalation_pathway
        ),
        'critical'
      from public.profiles p
      where p.role = 'admin';

      continue;
    end if;

    v_next_channel := v_channels[r.escalation_hop + 1];

    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, priority,
       escalation_pathway, escalation_alert_tier, escalation_hop, escalated_from_id, source_table, source_id)
    values
      (r.organisation_id, r.recipient_id, v_next_channel, r.template, r.payload, 'critical',
       r.escalation_pathway, r.escalation_alert_tier, r.escalation_hop + 1, r.id, r.source_table, r.source_id);

    begin
      perform net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
          || '/functions/v1/send-pending-notifications',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
          'Content-Type', 'application/json'
        ),
        timeout_milliseconds := 8000
      );
    exception when others then
      null;
    end;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION private.evaluate_vitals_monitoring_gaps()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item                 record;
  v_last_reading_at       timestamptz;
  v_days_since            integer;
  v_gap_days              integer;
  v_risk                  public.risk_level;
  v_grace                 integer;
  v_due_threshold         integer;
  v_overdue_threshold     integer;
  v_escalated_threshold   integer;
  v_vital_label           text;
  v_existing_alert_id     uuid;
begin
  for v_item in
    select * from public.monitoring_schedule_items
    where status = 'active' and (end_date is null or end_date >= current_date)
  loop
    select max(taken_at) into v_last_reading_at
    from public.vitals_readings
    where patient_id = v_item.patient_id
      and vital_type = v_item.vital_type
      and taken_at >= v_item.start_date::timestamptz;

    v_days_since := current_date - coalesce(v_last_reading_at::date, v_item.start_date);
    v_gap_days := ceil(7.0 / v_item.frequency_per_week)::int;

    v_risk := private.patient_worst_risk_level(v_item.patient_id);
    v_grace := private.vitals_monitoring_grace_days(v_risk);

    v_due_threshold := v_gap_days + v_grace;
    v_overdue_threshold := v_gap_days + (2 * v_grace);
    v_escalated_threshold := v_gap_days + (3 * v_grace);

    -- Always used through lower() below, so this only needs to turn the enum's
    -- underscore_case into words — no point capitalising what gets lowered again.
    v_vital_label := replace(v_item.vital_type::text, '_', ' ');

    if v_days_since >= v_escalated_threshold and v_item.reminder_stage is distinct from 'escalated' then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values
        (v_item.organisation_id, v_item.patient_id, private.patient_reminder_channel(v_item.patient_id), 'pending', 'vitals_monitoring_escalated',
         jsonb_build_object('vital_type', v_item.vital_type, 'days_since', v_days_since)),
        (v_item.organisation_id, v_item.patient_id, 'in_app', 'pending', 'vitals_monitoring_escalated',
         jsonb_build_object('vital_type', v_item.vital_type, 'days_since', v_days_since));

      -- blood_pressure already has its own dedicated missing-reading path
      -- (private.flag_overdue_vitals) — skip so a missed BP schedule never
      -- raises two independently-tracked clinician_alerts for one gap.
      if v_item.vital_type <> 'blood_pressure' then
        select id into v_existing_alert_id
        from public.clinician_alerts
        where monitoring_schedule_item_id = v_item.id and status = 'open'
        order by created_at desc
        limit 1;

        if v_existing_alert_id is null then
          insert into public.clinician_alerts
            (organisation_id, patient_id, level, status, title, detail, sla_due_at,
             escalation_level, monitoring_schedule_item_id)
          values (
            v_item.organisation_id, v_item.patient_id, 'clinician_review', 'open',
            format('Missing expected %s readings', lower(v_vital_label)),
            format(
              'No %s reading logged in %s days (expected roughly every %s day(s) at this patient''s prescribed frequency; risk level %s).',
              lower(v_vital_label), v_days_since, v_gap_days, coalesce(v_risk::text, 'unrated')
            ),
            now() + interval '72 hours', 2, v_item.id
          );
        end if;
      end if;

      update public.monitoring_schedule_items
        set reminder_stage = 'escalated', reminder_sent_at = now()
      where id = v_item.id;

    elsif v_days_since >= v_overdue_threshold and (v_item.reminder_stage is null or v_item.reminder_stage = 'due') then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values
        (v_item.organisation_id, v_item.patient_id, private.patient_reminder_channel(v_item.patient_id), 'pending', 'vitals_monitoring_overdue',
         jsonb_build_object('vital_type', v_item.vital_type, 'days_since', v_days_since)),
        (v_item.organisation_id, v_item.patient_id, 'in_app', 'pending', 'vitals_monitoring_overdue',
         jsonb_build_object('vital_type', v_item.vital_type, 'days_since', v_days_since));

      update public.monitoring_schedule_items
        set reminder_stage = 'overdue', reminder_sent_at = now()
      where id = v_item.id;

    elsif v_days_since >= v_due_threshold and v_item.reminder_stage is null then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values
        (v_item.organisation_id, v_item.patient_id, private.patient_reminder_channel(v_item.patient_id), 'pending', 'vitals_monitoring_due',
         jsonb_build_object('vital_type', v_item.vital_type, 'days_since', v_days_since)),
        (v_item.organisation_id, v_item.patient_id, 'in_app', 'pending', 'vitals_monitoring_due',
         jsonb_build_object('vital_type', v_item.vital_type, 'days_since', v_days_since));

      update public.monitoring_schedule_items
        set reminder_stage = 'due', reminder_sent_at = now()
      where id = v_item.id;
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION private.execute_broadcast(p_broadcast_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      if v_b.email_content_b is not null then
        insert into public.notifications
          (organisation_id, recipient_id, channel, status, template, payload)
        select
          bucketed.organisation_id, bucketed.recipient_id, 'email', 'pending', 'broadcast_announcement',
          jsonb_build_object(
            'subject', v_b.title, 'body', v_b.body, 'to_email', bucketed.email,
            'email_content',
              case when bucketed.variant_bucket < v_b.variant_split_pct then v_b.email_content else v_b.email_content_b end,
            'broadcast_id', v_b.id,
            'is_partner', bucketed.is_partner,
            'variant', case when bucketed.variant_bucket < v_b.variant_split_pct then 'a' else 'b' end
          )
        from (
          select
            t.*,
            abs(hashtextextended(t.recipient_id::text || v_b.id::text, 0)) % 100 as variant_bucket
          from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by, v_b.is_marketing) t
        ) bucketed
        where bucketed.email is not null;
      else
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
      end if;

    elsif v_ch = 'sms' then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      select t.organisation_id, t.recipient_id, 'sms', 'pending', 'broadcast_announcement',
             jsonb_build_object('subject', v_b.title, 'body', v_b.body, 'to_phone', t.phone, 'broadcast_id', v_b.id)
      from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by, v_b.is_marketing) t
      where t.phone is not null;

    elsif v_ch = 'in_app' then
      -- Replaces the retired phone-based branch (same audience rule: never a partner). Reaches everyone without
      -- needing a phone number, because the in-app inbox is always available.
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      select t.organisation_id, t.recipient_id, 'in_app', 'pending', 'broadcast_announcement',
             jsonb_build_object('subject', v_b.title, 'body', v_b.body, 'broadcast_id', v_b.id)
      from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by, v_b.is_marketing) t
      where t.is_partner = false;
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

CREATE OR REPLACE FUNCTION private.handle_bp_reading_red_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_level     text;
  v_alert_lvl public.alert_level;
  v_esc       smallint;
  v_sla       interval;
  v_title     text;
  v_detail    text;
  v_existing  public.clinician_alerts%rowtype;
  v_t_sys     smallint;
  v_t_dia     smallint;
  v_pregnant  boolean;
  v_alert_id  uuid;
  v_should_page boolean := false;
  v_level_label text;
  r           public.profiles%rowtype;
  v_has_escalation_access boolean;
begin
  if new.vital_type <> 'blood_pressure' then
    return new;
  end if;

  update public.clinician_alerts
    set status = 'resolved', updated_at = now()
  where patient_id = new.patient_id
    and status = 'open'
    and title = 'Missing expected blood-pressure readings';

  v_level := private.classify_bp_level(new.systolic, new.diastolic);

  if v_level = 'green' and new.systolic is not null and new.diastolic is not null then
    select systolic, diastolic into v_t_sys, v_t_dia
    from private.patient_home_bp_target(new.patient_id);
    if new.systolic >= v_t_sys or new.diastolic >= v_t_dia then
      v_level := 'amber';
    end if;
  end if;

  select coalesce(p.is_pregnant, false) into v_pregnant from public.profiles p where p.id = new.patient_id;
  if v_pregnant and new.systolic is not null and new.diastolic is not null then
    if new.systolic >= 160 or new.diastolic >= 110 then
      v_level := 'emergency';
    elsif new.systolic >= 140 or new.diastolic >= 90 then
      if v_level not in ('emergency','red') then v_level := 'red'; end if;
    end if;
  end if;

  if v_level in ('unknown', 'green') then
    return new;
  end if;

  v_detail := format('Home BP reading %s/%s mmHg logged %s.',
                     new.systolic, new.diastolic, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));
  if v_pregnant then
    v_detail := v_detail || ' PREGNANT — obstetric red route (§18.1); do not manage routinely on-platform.';
  end if;

  if v_level = 'emergency' then
    if not exists (
      select 1 from public.emergency_events e
      where e.patient_id = new.patient_id and e.source = 'bp_reading'
        and e.status = 'active' and e.created_at > now() - interval '6 hours'
    ) then
      insert into public.emergency_events
        (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
      values (new.organisation_id, new.patient_id, 'bp_reading',
        v_detail || case when v_pregnant then ' Possible pre-eclampsia — urgent obstetric care.' else ' This is in the hypertensive-crisis range.' end,
        'active', new.id);
    end if;
    return new;
  end if;

  v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');

  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3;
    v_sla := private.escalation_sla_minutes('bp_vitals_red_flag', 'urgent_escalation') * interval '1 minute';
    v_title := case when v_pregnant then 'Priority 1: raised BP in pregnancy' else 'Priority 1: high blood pressure reading' end;
    v_detail := v_detail || ' Please ask the patient to rest 5 minutes and re-check, then review same day.';
    v_level_label := 'Priority 1';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2;
    v_sla := private.escalation_sla_minutes('bp_vitals_red_flag', 'clinician_review') * interval '1 minute';
    v_title := 'Blood pressure above target';
    v_detail := v_detail || ' Above target — review adherence, technique, lifestyle and titration.';
    v_level_label := 'Review needed';
  end if;

  if v_has_escalation_access then
    -- Scoped by vital_type (join back to vitals_readings), matching the
    -- SpO2/temperature triggers -- previously unscoped, so a patient's most
    -- recent open alert of ANY vital type could be silently overwritten with
    -- BP content.
    select ca.* into v_existing
    from public.clinician_alerts ca
    join public.vitals_readings vr on vr.id = ca.vital_reading_id
    where ca.patient_id = new.patient_id
      and vr.vital_type = 'blood_pressure'
      and ca.status = 'open'
    order by ca.created_at desc
    limit 1;

    if v_existing.id is not null then
      if v_esc >= coalesce(v_existing.escalation_level, 0) then
        update public.clinician_alerts
          set level = v_alert_lvl, escalation_level = v_esc, title = v_title,
              detail = v_detail, sla_due_at = now() + v_sla, vital_reading_id = new.id, updated_at = now()
        where id = v_existing.id;
        v_alert_id := v_existing.id;
        if v_esc > coalesce(v_existing.escalation_level, 0) then
          v_should_page := true;
        end if;
      end if;
    else
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level, vital_reading_id)
      values (new.organisation_id, new.patient_id, v_alert_lvl, 'open', v_title, v_detail,
        now() + v_sla, v_esc, new.id)
      returning id into v_alert_id;
      v_should_page := true;
    end if;
  else
    perform private.raise_dangerous_reading_ai_suggestion(
      new.organisation_id, new.patient_id, 'blood pressure', v_level_label,
      'Sit down and rest quietly for 5 minutes, then recheck your blood pressure. Avoid caffeine and salty food for the rest of the day. If it stays this high, or you get a headache, chest pain, or blurred vision, seek care promptly.'
    );
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (new.organisation_id, new.patient_id, 'bp_red_flag.raised', 'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'systolic', new.systolic, 'diastolic', new.diastolic, 'pregnant', v_pregnant,
                       'escalation_gated_by_plan', not v_has_escalation_access));

  if v_should_page then
    -- No `and phone is not null`. The first channel for this pathway is push,
    -- which needs no phone; an sms hop that does is failed per-hop by
    -- send-pending-notifications with "recipient has no phone number on file".
    for r in
      select * from public.profiles
      where organisation_id = new.organisation_id and role = 'clinician'
    loop
      perform private.enqueue_critical_notification(
        new.organisation_id, r.id, 'vitals_red_flag_clinician_alert',
        jsonb_build_object(
          'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
          'vital_label', 'blood pressure',
          'level_label', v_level_label
        ),
        'bp_vitals_red_flag', v_alert_lvl, 'clinician_alerts', v_alert_id
      );
    end loop;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.handle_ecg_report_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_alert_id uuid;
begin
  if (select auth.uid()) is not null then
    new.uploaded_by := (select auth.uid());
  end if;

  -- A freshly uploaded document is never pre-reviewed.
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;

  -- Flag for a clinician to review. escalation_level 2 = routine review, NOT
  -- an emergency Priority-1 — nothing about an upload alone is ever treated as
  -- clinically urgent; only a clinician's own read of it can be.
  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    'clinician_review',
    'open',
    '12-lead ECG uploaded — review needed',
    format(
      'A 12-lead ECG was uploaded (%s)%s. Review the tracing, confirm or correct the extracted parameters, and record a result. (Uploading a file does not itself create a screening result.)',
      new.source,
      case when new.note is not null and length(btrim(new.note)) > 0
        then format(' — %s', new.note) else '' end
    ),
    2
  )
  returning id into v_alert_id;

  new.clinician_alert_id := v_alert_id;

  -- Tell the patient their ECG is on file — but only when someone ELSE
  -- uploaded it. Notification layer only; never gates anything. Reuses the
  -- existing 'result_document_available' template rather than registering a
  -- new one.
  if new.source <> 'patient' then
    insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
    values
      (new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id, false), 'result_document_available',
        jsonb_build_object('source', new.source::text)),
      (new.organisation_id, new.patient_id, 'email', 'result_document_available',
        jsonb_build_object('source', new.source::text));
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    new.uploaded_by,
    'ecg_report_document.uploaded',
    'ecg_report_documents',
    new.id,
    jsonb_build_object('source', new.source::text, 'clinician_alert_id', v_alert_id)
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.handle_imaging_report_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_alert_id uuid;
begin
  if (select auth.uid()) is not null then
    new.uploaded_by := (select auth.uid());
  end if;

  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, category, type_code, escalation_level)
  values (
    new.organisation_id, new.patient_id, 'clinician_review', 'open',
    'Imaging report uploaded — review needed',
    format(
      'An imaging report was uploaded (%s)%s. Review the report, confirm findings, and file a structured result. (Uploading a file does not itself create an imaging_reports record.)',
      new.source,
      case when new.note is not null and length(btrim(new.note)) > 0
        then format(' — %s', new.note) else '' end
    ),
    'clinical', 'abnormal_result', 2
  )
  returning id into v_alert_id;

  new.clinician_alert_id := v_alert_id;

  if new.source <> 'patient' then
    insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
    values
      (new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id, false), 'result_document_available', jsonb_build_object('source', new.source::text)),
      (new.organisation_id, new.patient_id, 'email', 'result_document_available', jsonb_build_object('source', new.source::text));
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.uploaded_by, 'imaging_report_document.uploaded', 'imaging_report_documents', new.id,
    jsonb_build_object('source', new.source::text, 'clinician_alert_id', v_alert_id)
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.handle_imaging_report_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_alert_id uuid;
begin
  if (select auth.uid()) is not null then
    new.uploaded_by := (select auth.uid());
  end if;
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.findings_summary := null;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    'clinician_review',
    'open',
    'Imaging report uploaded — review needed',
    format(
      '%s imaging report uploaded (%s)%s. Review and record any clinical finding.',
      new.modality, new.source,
      case when new.note is not null and length(btrim(new.note)) > 0
        then format(' — %s', new.note) else '' end
    ),
    2
  )
  returning id into v_alert_id;

  new.clinician_alert_id := v_alert_id;

  if new.source <> 'patient' then
    insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
    values
      (new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id, false), 'imaging_report_available',
        jsonb_build_object('modality', new.modality::text)),
      (new.organisation_id, new.patient_id, 'email', 'imaging_report_available',
        jsonb_build_object('modality', new.modality::text));
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    new.uploaded_by,
    'imaging_report.uploaded',
    'imaging_reports',
    new.id,
    jsonb_build_object('modality', new.modality::text, 'source', new.source::text, 'clinician_alert_id', v_alert_id)
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.handle_lab_order_sample_rejected()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_bundle_name text;
  v_reopened boolean := false;
  v_reopened_count integer;
  v_alert_detail text;
begin
  if not (new.status = 'sample_rejected' and old.status is distinct from 'sample_rejected') then
    return new;
  end if;

  select name into v_bundle_name from public.panel_bundles where id = new.panel_bundle_id;

  -- 2a. A due-screening self-service booking: reopen it so the patient's
  -- existing "book this due screening" flow offers the test again. Only
  -- when it is still in the 'booked' state this order itself put it in —
  -- never claw back a schedule some other event has already moved on from.
  if new.screening_schedule_id is not null then
    update public.screening_schedules
    set status = case when due_date <= current_date then 'overdue' else 'pending' end
    where id = new.screening_schedule_id
      and status = 'booked';
    get diagnostics v_reopened_count = row_count;
    v_reopened := v_reopened_count > 0;
  end if;

  -- 2b. Notify the patient — confirmation-only, never the transactional
  -- interface (CLAUDE.md "What Claude Must Never Do").
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values
    (new.organisation_id, new.patient_id, 'in_app', 'pending', 'lab_sample_rejected',
      jsonb_build_object('order_number', new.order_number, 'test_name', coalesce(v_bundle_name, 'your test'),
        'reason', new.rejection_reason, 'schedule_reopened', v_reopened)),
    (new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id), 'pending', 'lab_sample_rejected',
      jsonb_build_object('order_number', new.order_number, 'test_name', coalesce(v_bundle_name, 'your test'),
        'reason', new.rejection_reason, 'schedule_reopened', v_reopened));

  -- 2c. Operational escalation — "a new action", per spec §14.15's own
  -- diagram wording, for whoever needs to arrange the repeat.
  v_alert_detail := format(
    'Lab order %s (%s) had its sample rejected: %s.',
    coalesce(new.order_number, new.id::text), coalesce(v_bundle_name, 'lab test'), new.rejection_reason
  );
  v_alert_detail := v_alert_detail || case
    when v_reopened then ' The linked screening has been reopened so the patient can rebook it themselves.'
    when new.fulfilment = 'partner' then ' A repeat sample needs arranging with the lab.'
    else ' The patient needs to arrange a repeat sample.'
  end;

  perform private.raise_clinician_alert(
    new.organisation_id, new.patient_id, 'clinician_review',
    'Lab sample rejected — repeat needed', v_alert_detail,
    'operational', 'laboratory_failure'
  );

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.rejected_by, 'lab_order.sample_rejected',
    'lab_orders', new.id,
    jsonb_build_object('reason', new.rejection_reason, 'schedule_reopened', v_reopened, 'fulfilment', new.fulfilment::text)
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.handle_lab_result_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_alert_id uuid;
  v_has_review_access boolean;
  v_order_status public.lab_order_status;
begin
  if (select auth.uid()) is not null then
    new.uploaded_by := (select auth.uid());
  end if;

  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;

  if new.lab_order_id is not null then
    select status into v_order_status from public.lab_orders where id = new.lab_order_id;
    v_has_review_access := v_order_status is not null and v_order_status not in ('pending_payment', 'cancelled');
  else
    v_has_review_access := exists (
      select 1 from public.programme_purchases pp
      where pp.patient_id = new.patient_id
        and pp.status = 'active'
        and pp.ends_at >= current_date
    );
  end if;

  if v_has_review_access then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, escalation_level)
    values (
      new.organisation_id,
      new.patient_id,
      'clinician_review',
      'open',
      'Lab result document uploaded — review needed',
      format(
        'A lab result document was uploaded (%s)%s. Review and record any clinical finding. (Uploading a file does not itself create a screening result.)',
        new.source,
        case when new.note is not null and length(btrim(new.note)) > 0
          then format(' — %s', new.note) else '' end
      ),
      2
    )
    returning id into v_alert_id;

    new.clinician_alert_id := v_alert_id;
  else
    new.clinician_alert_id := null;
  end if;

  if new.source <> 'patient' then
    insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
    values
      (new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id, false), 'result_document_available',
        jsonb_build_object('source', new.source::text)),
      (new.organisation_id, new.patient_id, 'email', 'result_document_available',
        jsonb_build_object('source', new.source::text));
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    new.uploaded_by,
    'lab_result_document.uploaded',
    'lab_result_documents',
    new.id,
    jsonb_build_object(
      'source', new.source::text,
      'clinician_alert_id', v_alert_id,
      'review_gated_by_purchase', not v_has_review_access
    )
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.notify_clinician_alert(p_alert_id uuid, p_recipient_id uuid, p_template text, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_alert record;
  v_rule jsonb;
  v_extra_channels public.notification_channel[];
  v_notif_id uuid;
  v_ch public.notification_channel;
begin
  select organisation_id, severity, type_code into v_alert
  from public.clinician_alerts where id = p_alert_id;

  if v_alert.organisation_id is null then
    raise exception 'clinician_alerts row % not found', p_alert_id;
  end if;

  insert into public.notifications
    (organisation_id, recipient_id, channel, template, payload, content_class,
     priority, source_table, source_id)
  values
    (v_alert.organisation_id, p_recipient_id, 'in_app', p_template, p_payload, 'clinical',
     (case when v_alert.severity >= 3 then 'critical' else 'routine' end)::public.notification_priority,
     'clinician_alerts', p_alert_id)
  returning id into v_notif_id;

  insert into public.alert_deliveries (clinician_alert_id, notification_id, channel, recipient_id)
  values (p_alert_id, v_notif_id, 'in_app', p_recipient_id);

  if v_alert.severity >= 3 then
    v_rule := private.alert_rule_config(v_alert.type_code);
    -- Read the configured tokens through the same normaliser the escalation ladder uses: a retired token
    -- is read as email (OQ-29) and an unknown token is skipped, never cast blindly to the enum.
    v_extra_channels := array(
      select distinct c
      from unnest(private.normalize_escalation_channels(
             array(select jsonb_array_elements_text(coalesce(v_rule->'channel_sequence', '[]'::jsonb))))) as n(c)
      where c <> 'in_app'
    );

    foreach v_ch in array coalesce(v_extra_channels, array[]::public.notification_channel[])
    loop
      insert into public.notifications
        (organisation_id, recipient_id, channel, template, payload, content_class, priority,
         source_table, source_id)
      values
        (v_alert.organisation_id, p_recipient_id, v_ch, p_template,
         jsonb_build_object('message', 'You have a new urgent alert on Tarragon Health -- please check your dashboard.'),
         'non_clinical', 'critical', 'clinician_alerts', p_alert_id)
      returning id into v_notif_id;

      insert into public.alert_deliveries (clinician_alert_id, notification_id, channel, recipient_id)
      values (p_alert_id, v_notif_id, v_ch, p_recipient_id);
    end loop;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.notify_emergency_followups()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event   public.emergency_events%rowtype;
  v_patient public.profiles%rowtype;
begin
  for v_event in
    select * from public.emergency_events e
    where e.follow_up_notified_at is null
      and e.followed_up_at is null
      and e.follow_up_due_at < now()
      and e.status <> 'resolved'
  loop
    select * into v_patient from public.profiles where id = v_event.patient_id;
    -- The in-app row below always lands. Also nudge on the patient's own push or email when they have one.
    if private.patient_reminder_channel(v_event.patient_id) <> 'in_app' then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      values (
        v_event.organisation_id, v_event.patient_id, private.patient_reminder_channel(v_event.patient_id), 'pending',
        'emergency_followup',
        jsonb_build_object('patient_name', coalesce(v_patient.full_name, 'there'))
      );
    end if;
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      v_event.organisation_id, v_event.patient_id, 'in_app', 'pending',
      'emergency_followup',
      jsonb_build_object('patient_name', coalesce(v_patient.full_name, 'there'))
    );
    update public.emergency_events
      set follow_up_notified_at = now()
      where id = v_event.id;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION private.notify_region_waitlist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row record;
  v_requester       public.profiles%rowtype;
  v_requester_email text;
  v_recipient_name  text;
begin
  for v_row in
    select
      w.requester_id,
      coalesce(w.care_recipient_id, w.requester_id) as care_recipient_key,
      max(w.care_recipient_id::text)::uuid          as care_recipient_id,
      string_agg(distinct w.service_type, ', ')      as services,
      max(w.to_email)                                as to_email,
      max(w.to_phone)                                as to_phone
    from public.region_waitlist w
    where w.state = new.state and w.notified_at is null
    group by w.requester_id, coalesce(w.care_recipient_id, w.requester_id)
  loop
    select * into v_requester from public.profiles where id = v_row.requester_id;
    if v_requester.id is null then
      continue;
    end if;

    select email into v_requester_email from auth.users where id = v_row.requester_id;

    v_recipient_name := null;
    if v_row.care_recipient_id is not null and v_row.care_recipient_id <> v_row.requester_id then
      select full_name into v_recipient_name from public.profiles where id = v_row.care_recipient_id;
    end if;

    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      v_requester.organisation_id, v_row.requester_id, private.patient_reminder_channel(v_row.requester_id, false), 'pending',
      'region_now_available',
      jsonb_build_object(
        'state',            new.state,
        'display_name',     new.display_name,
        'services',         v_row.services,
        'requester_name',   coalesce(v_requester.full_name, 'there'),
        'care_recipient',   v_recipient_name,
        'to_phone',         v_row.to_phone
      )
    );

    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      v_requester.organisation_id, v_row.requester_id, 'in_app', 'pending',
      'region_now_available',
      jsonb_build_object(
        'state',            new.state,
        'display_name',     new.display_name,
        'services',         v_row.services,
        'requester_name',   coalesce(v_requester.full_name, 'there'),
        'care_recipient',   v_recipient_name
      )
    );

    if coalesce(v_row.to_email, v_requester_email) is not null then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      values (
        v_requester.organisation_id, v_row.requester_id, 'email', 'pending',
        'region_now_available',
        jsonb_build_object(
          'to_email',         coalesce(v_row.to_email, v_requester_email),
          'state',            new.state,
          'display_name',     new.display_name,
          'services',         v_row.services,
          'requester_name',   coalesce(v_requester.full_name, 'there'),
          'care_recipient',   v_recipient_name
        )
      );
    end if;
  end loop;

  update public.region_waitlist
  set notified_at = now()
  where state = new.state and notified_at is null;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.notify_unacknowledged_emergencies()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event   public.emergency_events%rowtype;
  v_patient public.profiles%rowtype;
begin
  for v_event in
    select * from public.emergency_events e
    where e.status = 'active'
      and e.acknowledged_at is null
      and e.contact_notified_at is null
      and e.suppress_contact_notify = false
      and e.created_at < now() - interval '10 minutes'
      and e.created_at > now() - interval '1 day'
  loop
    select * into v_patient from public.profiles where id = v_event.patient_id;
    if v_patient.emergency_contact_phone is not null and v_patient.emergency_contact_consent then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      values
        (v_event.organisation_id, v_event.patient_id, 'sms', 'pending',
         'emergency_contact_alert',
         jsonb_build_object(
           'to_phone', v_patient.emergency_contact_phone,
           'contact_name', coalesce(v_patient.emergency_contact_name, 'there'),
           'contact_relationship', v_patient.emergency_contact_relationship,
           'patient_name', coalesce(v_patient.full_name, 'someone who lists you as their emergency contact')));

      update public.emergency_events
        set contact_notified_at = now()
        where id = v_event.id;
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION private.offer_next_waiting_list_candidate(p_organisation_id uuid, p_clinician_id uuid, p_appointment_type appointment_type, p_consultation_method appointment_consultation_method, p_location text, p_scheduled_for timestamp with time zone, p_ends_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_candidate public.appointment_waiting_list;
  v_offer_minutes constant integer := 30;
  v_new_appointment_id uuid;
begin
  if p_scheduled_for <= now() or p_clinician_id is null then
    return;
  end if;

  select * into v_candidate
  from public.appointment_waiting_list
  where organisation_id = p_organisation_id
    and appointment_type = p_appointment_type
    and status = 'waiting'
    and (clinician_id is null or clinician_id = p_clinician_id)
    and preferred_from <= p_scheduled_for
    and preferred_until >= p_ends_at
  order by created_at
  limit 1
  for update skip locked;

  if v_candidate.id is null then
    return;
  end if;

  begin
    insert into public.appointments (
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      scheduled_for, ends_at, status, location, hold_expires_at
    ) values (
      p_organisation_id, v_candidate.patient_id, p_clinician_id, p_appointment_type,
      coalesce(v_candidate.consultation_method, p_consultation_method),
      p_scheduled_for, p_ends_at, 'held', p_location, now() + (v_offer_minutes * interval '1 minute')
    )
    returning id into v_new_appointment_id;
  exception
    when exclusion_violation then
      return; -- slot was taken by a direct booking in the meantime; candidate stays waiting
  end;

  update public.appointment_waiting_list
    set status = 'offered', offered_appointment_id = v_new_appointment_id,
        offer_expires_at = now() + (v_offer_minutes * interval '1 minute')
    where id = v_candidate.id;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (
    p_organisation_id, v_candidate.patient_id, private.patient_reminder_channel(v_candidate.patient_id), 'pending', 'appointment_waiting_list_offer',
    jsonb_build_object(
      'waiting_list_id', v_candidate.id, 'scheduled_for', p_scheduled_for,
      'offer_expires_minutes', v_offer_minutes
    ),
    'non_clinical'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_exception_queue(p_domain text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  if not private.can_view_ops_console() then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(q) order by q.severity_rank, q.age_hours desc)
    from (
      select * from (
        -- ---------------------------------------------------------------
        -- ALERTS (30.12) — unacknowledged clinical alerts, worst first.
        -- ---------------------------------------------------------------
        select
          'alerts'::text                                        as domain,
          a.id                                                  as entity_id,
          'clinician_alert'::text                               as entity_type,
          case
            when a.level = 'emergency' then 'critical'
            when a.sla_due_at is not null and a.sla_due_at < now() then 'urgent'
            when a.level = 'urgent_escalation' then 'urgent'
            else 'high'
          end                                                   as severity,
          case
            when a.level = 'emergency' then 1
            when a.sla_due_at is not null and a.sla_due_at < now() then 2
            when a.level = 'urgent_escalation' then 2
            else 3
          end                                                   as severity_rank,
          a.title                                               as headline,
          case
            when a.sla_due_at is not null and a.sla_due_at < now()
              then 'Past its contact SLA and still unacknowledged.'
            else 'Awaiting clinician acknowledgement.'
          end                                                   as detail,
          p.full_name                                           as subject_name,
          a.patient_id                                          as subject_id,
          a.created_at                                          as opened_at,
          round(extract(epoch from (now() - a.created_at)) / 3600.0, 1) as age_hours,
          a.sla_due_at                                          as due_at,
          '/clinician'::text                             as href
        from public.clinician_alerts a
        left join public.profiles p on p.id = a.patient_id
        where a.status = 'open'
          and (a.level <> 'routine' or a.created_at < now() - interval '24 hours')

        union all

        -- ---------------------------------------------------------------
        -- APPOINTMENTS (30.8) — booking requests nobody has answered, and
        -- scheduled appointments whose time has passed with no outcome
        -- recorded (the no-show / never-happened gap).
        -- ---------------------------------------------------------------
        select
          'appointments', b.id, 'booking_request',
          case when b.created_at < now() - interval '48 hours' then 'urgent' else 'high' end,
          case when b.created_at < now() - interval '48 hours' then 2 else 3 end,
          'Booking request unanswered',
          'Requested ' || b.service_type || ' for ' || to_char(b.requested_date, 'DD Mon') || '.',
          p.full_name, b.profile_id, b.created_at,
          round(extract(epoch from (now() - b.created_at)) / 3600.0, 1),
          b.created_at + interval '24 hours',
          '/admin/bookings'
        from public.booking_requests b
        left join public.profiles p on p.id = b.profile_id
        where b.status = 'requested'
          and b.created_at < now() - interval '12 hours'

        union all

        select
          'appointments', ap.id, 'appointment',
          'high', 3,
          'Appointment outcome not recorded',
          'Scheduled time has passed and it is still marked scheduled — complete it or mark the no-show.',
          p.full_name, ap.patient_id, ap.scheduled_for,
          round(extract(epoch from (now() - ap.scheduled_for)) / 3600.0, 1),
          ap.scheduled_for + interval '24 hours',
          '/clinician/appointments'
        from public.appointments ap
        left join public.profiles p on p.id = ap.patient_id
        where ap.status = 'scheduled'
          and ap.scheduled_for < now() - interval '12 hours'

        union all

        -- ---------------------------------------------------------------
        -- REFERRALS (30.9) — raised but never booked, or booked with the
        -- appointment date behind us and no completion.
        -- ---------------------------------------------------------------
        select
          'referrals', r.id, 'specialist_referral',
          case when r.created_at < now() - interval '7 days' then 'urgent' else 'high' end,
          case when r.created_at < now() - interval '7 days' then 2 else 3 end,
          'Referral awaiting booking',
          r.specialist_type::text || ' referral has had no booking confirmed.',
          p.full_name, r.patient_id, r.created_at,
          round(extract(epoch from (now() - r.created_at)) / 3600.0, 1),
          r.created_at + interval '72 hours',
          '/clinician/referrals'
        from public.specialist_referrals r
        left join public.profiles p on p.id = r.patient_id
        where r.status = 'pending'
          and r.created_at < now() - interval '48 hours'

        union all

        select
          'referrals', r.id, 'specialist_referral',
          'high', 3,
          'Specialist report overdue',
          'The appointment date has passed and the referral has not been completed.',
          p.full_name, r.patient_id, r.appointment_date,
          round(extract(epoch from (now() - r.appointment_date)) / 3600.0, 1),
          r.appointment_date + interval '7 days',
          '/clinician/referrals'
        from public.specialist_referrals r
        left join public.profiles p on p.id = r.patient_id
        where r.status in ('booked', 'confirmed')
          and r.appointment_date is not null
          and r.appointment_date < now() - interval '7 days'

        union all

        -- ---------------------------------------------------------------
        -- LABORATORY (30.10) — orders stuck before a result.
        -- ---------------------------------------------------------------
        select
          'laboratory', lo.id, 'lab_order',
          case when lo.ordered_at < now() - interval '7 days' then 'urgent' else 'high' end,
          case when lo.ordered_at < now() - interval '7 days' then 2 else 3 end,
          case lo.status
            when 'ordered' then 'Sample not collected'
            when 'sample_collected' then 'Sample collected, no result'
            else 'Result delayed'
          end,
          'Lab order has been open since ' || to_char(lo.ordered_at at time zone 'Africa/Lagos', 'DD Mon') || '.',
          p.full_name, lo.patient_id, lo.ordered_at,
          round(extract(epoch from (now() - lo.ordered_at)) / 3600.0, 1),
          lo.ordered_at + interval '72 hours',
          '/clinician/orders'
        from public.lab_orders lo
        left join public.profiles p on p.id = lo.patient_id
        where lo.status in ('ordered', 'sample_collected', 'processing')
          and lo.ordered_at < now() - interval '3 days'

        union all

        -- ---------------------------------------------------------------
        -- PHARMACY (30.11) — orders that have not reached the patient.
        -- ---------------------------------------------------------------
        select
          'pharmacy', po.id, 'pharmacy_order',
          case when po.requested_at < now() - interval '5 days' then 'urgent' else 'high' end,
          case when po.requested_at < now() - interval '5 days' then 2 else 3 end,
          case po.status
            when 'requested' then 'Prescription not confirmed by pharmacy'
            when 'confirmed' then 'Confirmed but not dispensed'
            when 'dispensed' then 'Dispensed but not delivered'
            else 'Delivery in progress too long'
          end,
          'Medication order has not reached the patient.',
          p.full_name, po.patient_id, po.requested_at,
          round(extract(epoch from (now() - po.requested_at)) / 3600.0, 1),
          po.requested_at + interval '48 hours',
          '/admin/settings/partners/pharmacies'
        from public.pharmacy_orders po
        left join public.profiles p on p.id = po.patient_id
        where po.status in ('requested', 'confirmed', 'dispensed', 'out_for_delivery')
          and po.requested_at < now() - interval '2 days'

        union all

        -- ---------------------------------------------------------------
        -- PAYMENTS (30.14) — reconciliation exceptions and webhook errors.
        -- ---------------------------------------------------------------
        select
          'payments', f.id, 'payment_reconciliation_flag',
          case when f.flag_type = 'amount_mismatch' then 'urgent' else 'high' end,
          case when f.flag_type = 'amount_mismatch' then 2 else 3 end,
          'Reconciliation exception: ' || replace(f.flag_type, '_', ' '),
          'Provider reference ' || f.provider_reference || ' does not match our ledger.',
          null, null, f.detected_at,
          round(extract(epoch from (now() - f.detected_at)) / 3600.0, 1),
          f.detected_at + interval '72 hours',
          '/finance/reconciliation'
        from public.payment_reconciliation_flags f
        where f.status = 'open'

        union all

        select
          'payments', pt.id, 'payment_transaction',
          'high', 3,
          'Payment webhook failed',
          'Paystack/Stripe event could not be processed: ' || left(pt.error, 120),
          null, null, pt.created_at,
          round(extract(epoch from (now() - pt.created_at)) / 3600.0, 1),
          pt.created_at + interval '24 hours',
          '/finance'
        from public.payment_transactions pt
        where pt.error is not null
          and pt.processed_at is null
          and pt.created_at > now() - interval '30 days'

        union all

        -- ---------------------------------------------------------------
        -- INCIDENTS (30.18) — anything past its own SLA.
        -- ---------------------------------------------------------------
        select
          'incidents', i.id, 'ops_incident',
          case when i.severity = 'sev1' then 'critical' else 'urgent' end,
          case when i.severity = 'sev1' then 1 else 2 end,
          i.reference || ' — ' || i.title,
          case
            when i.acknowledged_at is null then 'Not acknowledged and past its acknowledgement SLA.'
            else 'Past its resolution SLA.'
          end,
          null, null, i.detected_at,
          round(extract(epoch from (now() - i.detected_at)) / 3600.0, 1),
          case when i.acknowledged_at is null then i.ack_due_at else i.resolve_due_at end,
          '/admin/ops/incidents/' || i.id::text
        from public.ops_incidents i
        where i.status <> 'closed'
          and (
            (i.acknowledged_at is null and i.ack_due_at < now())
            or (i.resolved_at is null and i.resolve_due_at < now())
          )

        union all

        -- ---------------------------------------------------------------
        -- PROVIDERS (30.5) — clinical staff who can be routed work but whose
        -- licence has never been verified. A governance exception, and one
        -- that belongs on the same queue as everything else precisely
        -- because it is nobody's daily habit to go looking for it.
        -- ---------------------------------------------------------------
        select
          'providers', cs.id, 'clinical_staff',
          'urgent', 2,
          'Clinical staff licence unverified',
          'This staff record is active but has never had its licence verified.',
          pr.full_name, cs.profile_id, cs.created_at,
          round(extract(epoch from (now() - cs.created_at)) / 3600.0, 1),
          cs.created_at + interval '7 days',
          '/admin/settings/clinical-staff'
        from public.clinical_staff cs
        left join public.profiles pr on pr.id = cs.profile_id
        where cs.active
          and cs.license_verified_at is null
      ) src
      where p_domain is null or p_domain = 'all' or src.domain = p_domain
      order by src.severity_rank, src.age_hours desc
      limit v_limit
    ) q
  ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.ops_today_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today_start timestamptz := date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  v_today_end   timestamptz := v_today_start + interval '1 day';
begin
  if not private.can_view_ops_console() then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'generated_at', now(),

    -- Scale
    'patients', (select count(*) from public.profiles where role = 'patient' and is_active),
    'active_care_programmes', (
      select count(*) from public.chronic_programme_enrolments where status = 'enrolled'
    ) + (
      select count(*) from public.preventive_programme_enrolments where status = 'enrolled'
    ),
    -- Paid services a patient can still call on today: a bought credit that
    -- has not expired, plus a running 12-week programme.
    'active_paid_services', (
      select count(*) from public.service_purchases
      where status = 'active' and (expires_at is null or expires_at > now())
    ) + (
      select count(*) from public.programme_purchases
      where status = 'active' and ends_at >= current_date
    ),

    -- Today
    'appointments_today', (
      select count(*) from public.appointments
      where scheduled_for >= v_today_start and scheduled_for < v_today_end
        and status = 'scheduled'
    ),
    'consults_today', (
      select count(*) from public.video_consultations
      where scheduled_at >= v_today_start and scheduled_at < v_today_end
        and status = 'scheduled'
    ),

    -- Clinical work in hand
    'pending_clinical_reviews', (
      select count(*) from public.clinician_alerts where status = 'open'
    ),
    'critical_alerts', (
      select count(*) from public.clinician_alerts
      where status = 'open' and level = 'emergency'
    ),
    'alerts_past_sla', (
      select count(*) from public.clinician_alerts
      where status = 'open' and sla_due_at is not null and sla_due_at < now()
    ),
    'open_escalations', (
      select count(*) from public.escalations where status in ('open', 'under_review')
    ),

    -- Coordination
    'unresolved_referrals', (
      select count(*) from public.specialist_referrals
      where status in ('pending', 'waitlisted', 'booked')
    ),
    'laboratory_delays', (
      select count(*) from public.lab_orders
      where status in ('ordered', 'sample_collected', 'processing')
        and ordered_at < now() - interval '3 days'
    ),
    'pharmacy_issues', (
      select count(*) from public.pharmacy_orders
      where status in ('requested', 'confirmed', 'dispensed', 'out_for_delivery')
        and requested_at < now() - interval '2 days'
    ),
    'pending_bookings', (
      select count(*) from public.booking_requests where status = 'requested'
    ),

    -- Money
    'failed_payments', (
      select count(*) from public.payment_transactions
      where error is not null and created_at > now() - interval '30 days'
    ),
    'reconciliation_exceptions', (
      select count(*) from public.payment_reconciliation_flags where status = 'open'
    ),

    -- Governance
    'open_incidents', (
      select count(*) from public.ops_incidents where status <> 'closed'
    ),
    'incidents_past_sla', (
      select count(*) from public.ops_incidents
      where status <> 'closed'
        and (
          (acknowledged_at is null and ack_due_at < now())
          or (resolved_at is null and resolve_due_at < now())
        )
    ),
    'clinician_verifications_pending', (
      select count(*) from public.clinical_staff where license_verified_at is null
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.queue_annual_reviews()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_year integer := extract(year from current_date);
  r record;
  v_review_id uuid;
begin
  for r in
    select p.id as patient_id, p.organisation_id
    from public.profiles p
    where p.role = 'patient'
      and private.patient_has_feature_access(p.id, 'annual_review')
  loop
    if exists (
      select 1 from public.annual_reviews ar
      where ar.patient_id = r.patient_id
        and (
          ar.status in ('pending', 'in_progress')
          or ar.due_date > current_date - interval '11 months'
        )
    ) then
      continue;
    end if;

    insert into public.annual_reviews (organisation_id, patient_id, cycle_year, due_date)
    values (r.organisation_id, r.patient_id, v_year, current_date)
    on conflict (patient_id, cycle_year) do nothing
    returning id into v_review_id;

    if v_review_id is null then
      continue;
    end if;

    insert into public.annual_review_workup_items
      (annual_review_id, organisation_id, code, label)
    select v_review_id, r.organisation_id, c.code, c.label
    from public.annual_review_workup_catalogue c
    where c.default_applicable
    on conflict (annual_review_id, code) do nothing;

    perform public.apply_full_panel_to_review(v_review_id);

    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (
      r.organisation_id, r.patient_id, private.patient_reminder_channel(r.patient_id), 'pending', 'annual_review_due',
      jsonb_build_object('cycle_year', v_year)
    );
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION private.queue_appointment_reminders()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with milestones(milestone, hours_before, high_priority_only) as (
    values
      ('72h', 72.0, true),
      ('24h', 24.0, false),
      ('2h', 2.0, false),
      ('shortly_before', 0.25, false)
  ),
  due as (
    select
      a.id as appointment_id,
      a.organisation_id,
      a.patient_id,
      a.appointment_type,
      a.scheduled_for,
      m.milestone
    from public.appointments a
    cross join milestones m
    where a.status in ('booked', 'confirmed')
      and a.scheduled_for > now()
      and (not m.high_priority_only or a.is_high_priority)
      and a.scheduled_for - now() <= (m.hours_before * interval '1 hour')
  ),
  inserted_state as (
    insert into public.appointment_reminder_sends (appointment_id, milestone)
    select appointment_id, milestone from due
    on conflict (appointment_id, milestone) do nothing
    returning appointment_id, milestone
  ),
  patient_notified as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, response_options)
    select
      d.organisation_id, d.patient_id, private.patient_reminder_channel(d.patient_id), 'pending', 'appointment_reminder',
      jsonb_build_object(
        'appointment_id', d.appointment_id, 'scheduled_for', d.scheduled_for,
        'appointment_type', d.appointment_type, 'milestone', d.milestone
      ),
      jsonb_build_array(
        jsonb_build_object('label', 'Yes, I''ll be there', 'value', 'confirm'),
        jsonb_build_object('label', 'Reschedule', 'value', 'reschedule'),
        jsonb_build_object('label', 'Cancel', 'value', 'cancel'),
        jsonb_build_object('label', 'Need help', 'value', 'need_help')
      )
    from due d
    join inserted_state s on s.appointment_id = d.appointment_id and s.milestone = d.milestone
    returning 1
  ),
  grantee_due as (
    select d.*, pa.grantee_user_id
    from due d
    join inserted_state s on s.appointment_id = d.appointment_id and s.milestone = d.milestone
    join public.profile_access pa
      on pa.profile_id = d.patient_id and pa.permission_level = 'manage'
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  select
    gd.organisation_id, gd.grantee_user_id, 'in_app', 'pending', 'appointment_reminder_for_dependent',
    jsonb_build_object(
      'appointment_id', gd.appointment_id, 'scheduled_for', gd.scheduled_for,
      'appointment_type', gd.appointment_type, 'milestone', gd.milestone, 'patient_id', gd.patient_id
    ),
    'non_clinical'
  from grantee_due gd;
$function$;

CREATE OR REPLACE FUNCTION private.queue_booking_reminders()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with milestones(days) as (values (30), (7), (3), (1)),
  due as (
    select
      br.id as booking_request_id,
      br.organisation_id,
      br.profile_id,
      br.service_type,
      br.requested_date,
      m.days as milestone_days,
      f.name as facility_name
    from public.booking_requests br
    join public.facilities f on f.id = br.facility_id
    cross join milestones m
    where br.status in ('requested', 'confirmed')
      and br.requested_date - current_date = m.days
  ),
  inserted_state as (
    insert into public.booking_reminder_sends (booking_request_id, milestone_days)
    select booking_request_id, milestone_days from due
    on conflict (booking_request_id, milestone_days) do nothing
    returning booking_request_id, milestone_days
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      d.organisation_id,
      d.profile_id,
      private.patient_reminder_channel(d.profile_id),
      'pending',
      'booking_reminder',
      jsonb_build_object(
        'facility_name', d.facility_name,
        'service_type', d.service_type,
        'requested_date', d.requested_date,
        'days_before', d.milestone_days
      )
    from due d
    join inserted_state s
      on s.booking_request_id = d.booking_request_id
     and s.milestone_days = d.milestone_days
    returning recipient_id
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select
    d.organisation_id,
    d.profile_id,
    'in_app',
    'pending',
    'booking_reminder',
    jsonb_build_object(
      'facility_name', d.facility_name,
      'service_type', d.service_type,
      'requested_date', d.requested_date,
      'days_before', d.milestone_days
    )
  from due d
  join inserted_state s
    on s.booking_request_id = d.booking_request_id
   and s.milestone_days = d.milestone_days;
$function$;

CREATE OR REPLACE FUNCTION private.queue_care_outreach()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with latest_risk as (
    select distinct on (prs.patient_id)
      prs.patient_id, prs.organisation_id, prs.risk_level, prs.score_type,
      prs.id as score_id, prs.computed_at
    from public.patient_risk_scores prs
    where prs.computed_at >= now() - interval '120 days'
    order by prs.patient_id, prs.computed_at desc
  ),
  candidates as (
    select
      lr.organisation_id,
      lr.patient_id,
      'high_risk_score'::public.outreach_trigger_type as trigger_type,
      jsonb_build_object(
        'risk_level', lr.risk_level,
        'score_type', lr.score_type,
        'score_id', lr.score_id,
        'computed_at', lr.computed_at
      ) as trigger_detail,
      case when lr.risk_level = 'very_high' then 1 else 2 end as priority
    from latest_risk lr
    where lr.risk_level in ('high', 'very_high')

    union all

    select
      g.organisation_id,
      g.patient_id,
      case g.gap_type
        when 'unactioned_abnormal' then 'unactioned_abnormal'
        when 'overdue_screening' then 'overdue_screening'
        when 'awaiting_result' then 'awaiting_result'
        when 'repeated_no_show' then 'repeated_no_show'
        when 'overdue_referral' then 'overdue_referral'
        when 'overdue_medication_review' then 'overdue_medication_review'
        when 'overdue_lab_monitoring' then 'overdue_lab_monitoring'
        else 'stale_monitoring'
      end::public.outreach_trigger_type,
      g.detail || jsonb_build_object('condition_or_type', g.condition_or_type, 'opened_at', g.opened_at),
      case g.gap_type
        when 'unactioned_abnormal' then 1
        when 'overdue_screening' then 2
        when 'awaiting_result' then 2
        when 'repeated_no_show' then 2
        when 'overdue_referral' then 2
        when 'overdue_medication_review' then 3
        when 'overdue_lab_monitoring' then 3
        else 3
      end
    from public.patient_care_gaps g

    union all

    select
      ct.organisation_id,
      ct.patient_id,
      'missed_care_task'::public.outreach_trigger_type,
      jsonb_build_object('task_id', ct.id, 'title', ct.title, 'status', ct.status, 'due_at', ct.due_at),
      case when ct.priority = 1 then 1 else 2 end
    from public.care_tasks ct
    where ct.status in ('missed', 'expired', 'unable_to_complete')

    union all

    select
      a.organisation_id,
      a.patient_id,
      'missed_appointment'::public.outreach_trigger_type,
      jsonb_build_object(
        'appointment_id', a.id, 'scheduled_for', a.scheduled_for, 'reason', a.reason
      ),
      2
    from public.appointments a
    where a.status = 'no_show'
      and a.updated_at >= now() - interval '14 days'

    union all

    select
      sr.organisation_id,
      sr.patient_id,
      'failed_referral'::public.outreach_trigger_type,
      jsonb_build_object(
        'referral_id', sr.id, 'specialist_type', sr.specialist_type, 'reason', sr.referral_reason
      ),
      2
    from public.specialist_referrals sr
    where sr.status = 'declined'
      and sr.updated_at >= now() - interval '30 days'
  ),
  inserted as (
    insert into public.care_outreach_tasks
      (organisation_id, patient_id, trigger_type, trigger_detail, priority, nudge_sent_at)
    select organisation_id, patient_id, trigger_type, trigger_detail, priority, now()
    from candidates
    on conflict (patient_id, trigger_type)
      where status in ('open', 'in_progress', 'contacted')
      do nothing
    returning id, organisation_id, patient_id, trigger_type
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      i.organisation_id,
      i.patient_id,
      private.patient_reminder_channel(i.patient_id),
      'pending',
      'care_outreach_checkin',
      jsonb_build_object('reasons', array_agg(distinct i.trigger_type::text))
    from inserted i
    group by i.organisation_id, i.patient_id
    returning recipient_id
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select
    i.organisation_id,
    i.patient_id,
    'in_app',
    'pending',
    'care_outreach_checkin',
    jsonb_build_object('reasons', array_agg(distinct i.trigger_type::text))
  from inserted i
  group by i.organisation_id, i.patient_id;
$function$;

CREATE OR REPLACE FUNCTION private.queue_diabetes_complication_reminders()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with dm as (
    select distinct patient_id, organisation_id
    from public.care_plans
    where condition = 'diabetes' and status = 'active'
  ),
  latest as (
    select dm.patient_id, dm.organisation_id, ct.check_type,
           max(c.next_due_at) as due
    from dm
    cross join (
      values ('retinal'::public.complication_check_type), ('renal'::public.complication_check_type)
    ) as ct (check_type)
    left join public.diabetes_complication_checks c
      on c.patient_id = dm.patient_id and c.check_type = ct.check_type
    group by dm.patient_id, dm.organisation_id, ct.check_type
  ),
  due as (
    select * from latest where due is null or due <= current_date
  ),
  not_recently_reminded as (
    select due.*
    from due
    where not exists (
      select 1 from public.notifications n
      where n.recipient_id = due.patient_id
        and n.template = 'diabetes_complication_check_due'
        and (n.payload ->> 'check_type') = due.check_type::text
        and n.created_at >= now() - interval '30 days'
    )
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'diabetes_complication_check_due',
      jsonb_build_object('check_type', check_type, 'due_date', coalesce(due, current_date))
    from not_recently_reminded
    returning recipient_id
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select
    organisation_id, patient_id, 'in_app', 'pending', 'diabetes_complication_check_due',
    jsonb_build_object('check_type', check_type, 'due_date', coalesce(due, current_date))
  from not_recently_reminded;
$function$;

CREATE OR REPLACE FUNCTION private.queue_engagement_interventions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := now();
begin
  create temporary table tmp_engagement_candidates on commit drop as
  with latest as (
    select distinct on (ces.patient_id)
      ces.patient_id, ces.organisation_id, ces.engagement_level,
      ces.monitoring_adherence_score, ces.appointment_attendance_score, ces.medication_adherence_score,
      ces.lifestyle_score, ces.prevention_score, ces.app_usage_score, ces.message_responsiveness_score,
      ces.care_plan_completion_score
    from public.care_engagement_scores ces
    order by ces.patient_id, ces.computed_at desc
  ),
  repeat_counts as (
    select ces.patient_id,
      count(*) filter (where ces.engagement_level in ('at_risk', 'disengaged', 'unreachable')) as low_engagement_runs
    from public.care_engagement_scores ces
    where ces.computed_at >= v_now - interval '14 days'
    group by ces.patient_id
  ),
  risk as (
    select distinct on (prs.patient_id) prs.patient_id, prs.risk_level
    from public.patient_risk_scores prs
    where prs.computed_at >= v_now - interval '120 days'
    order by prs.patient_id, prs.computed_at desc
  ),
  preferred as (
    select p.id as patient_id, p.notification_channel_preference as preferred_channel
    from public.profiles p
  )
  select
    l.patient_id, l.organisation_id, l.engagement_level,
    coalesce(rc.low_engagement_runs, 1) as low_engagement_runs,
    r.risk_level,
    coalesce(p.preferred_channel, 'in_app'::public.notification_channel) as preferred_channel,
    (
      select dim.dimension_name
      from (values
        ('monitoring', l.monitoring_adherence_score),
        ('appointments', l.appointment_attendance_score),
        ('medication', l.medication_adherence_score),
        ('lifestyle', l.lifestyle_score),
        ('prevention', l.prevention_score),
        ('app_usage', l.app_usage_score),
        ('messages', l.message_responsiveness_score),
        ('care_plan', l.care_plan_completion_score)
      ) as dim(dimension_name, dimension_score)
      where dim.dimension_score is not null
      order by dim.dimension_score asc
      limit 1
    ) as lowest_dimension
  from latest l
  left join repeat_counts rc on rc.patient_id = l.patient_id
  left join risk r on r.patient_id = l.patient_id
  left join preferred p on p.patient_id = l.patient_id
  where l.engagement_level in ('at_risk', 'disengaged', 'unreachable');

  -- 1. First low-engagement reading -> personalized reminder. Covers both at_risk
  -- and disengaged: a patient can drop straight to disengaged on their very first
  -- low reading (a data-sparse composite, a bad week), and gating this purely on
  -- 'at_risk' would leave them waiting for rule 2's repeat-count threshold before
  -- hearing anything at all — the worse case getting a slower response than the
  -- milder one.
  with sent as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    select c.organisation_id, c.patient_id, 'in_app', 'pending', 'engagement_reminder_personalized',
      jsonb_build_object('lowest_dimension', c.lowest_dimension), 'non_clinical'
    from tmp_engagement_candidates c
    where c.engagement_level in ('at_risk', 'disengaged') and c.low_engagement_runs = 1
      and not exists (
        select 1 from public.patient_engagement_interventions pei
        where pei.patient_id = c.patient_id and pei.intervention_type = 'reminder'
          and pei.created_at >= v_now - interval '3 days'
      )
    returning id as notification_id, recipient_id as patient_id, organisation_id
  )
  insert into public.patient_engagement_interventions
    (organisation_id, patient_id, trigger_reason, intervention_type, engagement_level_at_trigger, notification_id)
  select s.organisation_id, s.patient_id, 'missed_task', 'reminder', c.engagement_level, s.notification_id
  from sent s
  join tmp_engagement_candidates c on c.patient_id = s.patient_id;

  -- 2. Repeated low engagement (3+ low readings in the trailing 14 days) -> support
  -- message offering help rather than another bare reminder.
  with sent as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    select c.organisation_id, c.patient_id, 'in_app', 'pending', 'engagement_support_offer',
      jsonb_build_object('lowest_dimension', c.lowest_dimension), 'non_clinical'
    from tmp_engagement_candidates c
    where c.engagement_level in ('at_risk', 'disengaged') and c.low_engagement_runs >= 3
      and not exists (
        select 1 from public.patient_engagement_interventions pei
        where pei.patient_id = c.patient_id and pei.intervention_type = 'support_message'
          and pei.created_at >= v_now - interval '7 days'
      )
    returning id as notification_id, recipient_id as patient_id, organisation_id
  )
  insert into public.patient_engagement_interventions
    (organisation_id, patient_id, trigger_reason, intervention_type, engagement_level_at_trigger, notification_id)
  select s.organisation_id, s.patient_id, 'repeated_missed_task', 'support_message', c.engagement_level, s.notification_id
  from sent s
  join tmp_engagement_candidates c on c.patient_id = s.patient_id;

  -- 3. Persistent non-engagement (5+ low readings, disengaged) or unreachable ->
  -- the existing care-coordinator worklist, priority pulled to 1 when clinical risk
  -- is also high.
  with sent as (
    insert into public.care_outreach_tasks
      (organisation_id, patient_id, trigger_type, trigger_detail, priority, nudge_sent_at)
    select c.organisation_id, c.patient_id, 'disengagement_risk'::public.outreach_trigger_type,
      jsonb_build_object('engagement_level', c.engagement_level, 'low_engagement_runs', c.low_engagement_runs),
      case when c.risk_level in ('high', 'very_high') then 1 else 2 end,
      v_now
    from tmp_engagement_candidates c
    where (c.engagement_level = 'disengaged' and c.low_engagement_runs >= 5) or c.engagement_level = 'unreachable'
    on conflict (patient_id, trigger_type) where status in ('open', 'in_progress', 'contacted') do nothing
    returning id as outreach_task_id, patient_id, organisation_id
  )
  insert into public.patient_engagement_interventions
    (organisation_id, patient_id, trigger_reason, intervention_type, engagement_level_at_trigger, outreach_task_id)
  select s.organisation_id, s.patient_id, 'persistent_non_engagement', 'care_coordinator_outreach',
    c.engagement_level, s.outreach_task_id
  from sent s
  join tmp_engagement_candidates c on c.patient_id = s.patient_id;

  -- 4. Unreachable -> try a channel other than the patient's stated preference
  -- before assuming the whole recovery ladder has to run its full course.
  with sent as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    select c.organisation_id, c.patient_id,
      case when c.preferred_channel = 'in_app' then 'push' else 'in_app' end::public.notification_channel,
      'pending', 'engagement_alternative_channel_checkin',
      jsonb_build_object('reason', 'unreachable_on_preferred_channel'), 'non_clinical'
    from tmp_engagement_candidates c
    where c.engagement_level = 'unreachable'
      and not exists (
        select 1 from public.patient_engagement_interventions pei
        where pei.patient_id = c.patient_id and pei.intervention_type = 'alternative_channel'
          and pei.created_at >= v_now - interval '7 days'
      )
    returning id as notification_id, recipient_id as patient_id, organisation_id
  )
  insert into public.patient_engagement_interventions
    (organisation_id, patient_id, trigger_reason, intervention_type, engagement_level_at_trigger, notification_id)
  select organisation_id, patient_id, 'unreachable_on_preferred_channel', 'alternative_channel', 'unreachable', notification_id
  from sent;

  -- 5. High clinical risk + non-engagement -> explicit clinical-review flag (a log
  -- entry, not an automated clinician alert — see the prior migration's header).
  insert into public.patient_engagement_interventions
    (organisation_id, patient_id, trigger_reason, intervention_type, engagement_level_at_trigger)
  select c.organisation_id, c.patient_id, 'high_risk_non_engagement', 'clinical_review_flag', c.engagement_level
  from tmp_engagement_candidates c
  where c.engagement_level in ('disengaged', 'unreachable') and c.risk_level in ('high', 'very_high')
    and not exists (
      select 1 from public.patient_engagement_interventions pei
      where pei.patient_id = c.patient_id and pei.intervention_type = 'clinical_review_flag'
        and pei.created_at >= v_now - interval '7 days'
    );
end;
$function$;

CREATE OR REPLACE FUNCTION private.queue_health_check_due_reminders()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with last_result as (
    select distinct on (lo.patient_id)
      lo.patient_id, lo.organisation_id, lo.resulted_at, pb.name as bundle_name
    from public.lab_orders lo
    join public.panel_bundles pb on pb.id = lo.panel_bundle_id
    where lo.status = 'resulted'
      and lo.resulted_at is not null
      and (pb.code like 'screen_%' or pb.code like 'health_check%')
    order by lo.patient_id, lo.resulted_at desc
  ),
  due as (
    select lr.*
    from last_result lr
    where (lr.resulted_at + interval '11 months')::date = current_date
      and not exists (
        select 1
        from public.lab_orders lo2
        join public.panel_bundles pb2 on pb2.id = lo2.panel_bundle_id
        where lo2.patient_id = lr.patient_id
          and (pb2.code like 'screen_%' or pb2.code like 'health_check%')
          and lo2.status in ('pending_payment', 'payment_confirmed', 'ordered', 'sample_collected', 'processing')
      )
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id,
      patient_id,
      private.patient_reminder_channel(patient_id),
      'pending',
      'health_check_due_soon',
      jsonb_build_object(
        'bundle_name', bundle_name,
        'due_date', to_char((resulted_at + interval '12 months')::date, 'DD Mon YYYY')
      )
    from due
    returning recipient_id
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select
    organisation_id,
    patient_id,
    'in_app',
    'pending',
    'health_check_due_soon',
    jsonb_build_object(
      'bundle_name', bundle_name,
      'due_date', to_char((resulted_at + interval '12 months')::date, 'DD Mon YYYY')
    )
  from due;
$function$;

CREATE OR REPLACE FUNCTION private.queue_health_check_rebook_reminders()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with due as (
    select latest.*
    from (
      select distinct on (o.patient_id)
        o.patient_id, o.organisation_id, pb.name as bundle_name, o.created_at::date as resulted_on
      from public.lab_orders o
      join public.panel_bundles pb on pb.id = o.panel_bundle_id
      where pb.self_bookable and o.status = 'resulted' and o.origin = 'patient_initiated'
      order by o.patient_id, o.created_at desc
    ) latest
    where latest.resulted_on < (current_date - interval '11 months')
      and not exists (
        select 1
        from public.lab_orders o2
        join public.panel_bundles b2 on b2.id = o2.panel_bundle_id
        where o2.patient_id = latest.patient_id
          and b2.self_bookable
          and o2.created_at::date > latest.resulted_on
          and o2.status <> 'cancelled'
      )
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = latest.patient_id
          and n.template = 'health_check_rebook_due'
          and n.created_at > now() - interval '60 days'
      )
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id,
      patient_id,
      private.patient_reminder_channel(patient_id),
      'pending',
      'health_check_rebook_due',
      jsonb_build_object('bundle_name', bundle_name, 'last_check_date', resulted_on)
    from due
    returning recipient_id
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select
    organisation_id,
    patient_id,
    'in_app',
    'pending',
    'health_check_rebook_due',
    jsonb_build_object('bundle_name', bundle_name, 'last_check_date', resulted_on)
  from due;
$function$;

CREATE OR REPLACE FUNCTION private.queue_lpe_review_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
  select r.organisation_id, r.patient_id, private.patient_reminder_channel(r.patient_id), 'lifestyle_review_due',
         jsonb_build_object('review_id', r.id, 'due_date', r.due_date)
  from public.lpe_reviews r
  where r.status = 'pending'
    and r.reminder_sent_at is null
    and r.due_date <= current_date + 3;

  insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
  select r.organisation_id, r.patient_id, 'in_app', 'lifestyle_review_due',
         jsonb_build_object('review_id', r.id, 'due_date', r.due_date)
  from public.lpe_reviews r
  where r.status = 'pending'
    and r.reminder_sent_at is null
    and r.due_date <= current_date + 3;

  update public.lpe_reviews
    set reminder_sent_at = now()
    where status = 'pending' and reminder_sent_at is null and due_date <= current_date + 3;
end;
$function$;

CREATE OR REPLACE FUNCTION private.queue_medication_checkin_reminders()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with due as (
    select c.id, c.organisation_id, c.patient_id, c.checkin_type, m.drug_name, pr.preferred_reminder_hour
    from public.medication_adherence_checkins c
    join public.medications m on m.id = c.medication_id
    join public.profiles pr on pr.id = c.patient_id
    where c.status = 'pending'
      and c.reminder_sent_at is null
      and c.due_date <= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, send_after)
    select
      organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'medication_adherence_checkin',
      jsonb_build_object('checkin_type', checkin_type, 'drug_name', drug_name),
      private.next_send_after_for_hour(preferred_reminder_hour)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, send_after)
    select
      organisation_id, patient_id, 'in_app', 'pending', 'medication_adherence_checkin',
      jsonb_build_object('checkin_type', checkin_type, 'drug_name', drug_name),
      private.next_send_after_for_hour(preferred_reminder_hour)
    from due
    returning id
  )
  update public.medication_adherence_checkins c
    set reminder_sent_at = now()
  from due
  where c.id = due.id;
$function$;

CREATE OR REPLACE FUNCTION private.queue_medication_dose_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now_lagos      timestamp := (now() at time zone 'Africa/Lagos');
  v_today_lagos    date := v_now_lagos::date;
  v_current_time   time := v_now_lagos::time;
begin
  with candidates as (
    select
      m.id as medication_id,
      m.organisation_id,
      m.patient_id,
      m.drug_name,
      t.schedule_time
    from public.medications m
    cross join lateral jsonb_array_elements_text(m.schedule_times) as t (schedule_time)
    where m.is_active
  ),
  due as (
    select c.*
    from candidates c
    where c.schedule_time ~ '^([01]\d|2[0-3]):[0-5]\d$'
      and c.schedule_time::time <= v_current_time
      and c.schedule_time::time > v_current_time - interval '15 minutes'
      -- Already responded (took it early, or any other logged state) for
      -- this exact slot -- nagging after the patient has already acted is
      -- exactly the noise a reminder system must not add.
      and not exists (
        select 1 from public.medication_logs l
        where l.medication_id = c.medication_id
          and l.scheduled_for_date = v_today_lagos
          and l.scheduled_time = c.schedule_time
      )
      -- Already reminded for this exact slot (the dedup this table exists for).
      and not exists (
        select 1 from public.medication_dose_reminders r
        where r.medication_id = c.medication_id
          and r.scheduled_for_date = v_today_lagos
          and r.scheduled_time = c.schedule_time
      )
  ),
  inserted_state as (
    insert into public.medication_dose_reminders
      (organisation_id, patient_id, medication_id, scheduled_for_date, scheduled_time)
    select organisation_id, patient_id, medication_id, v_today_lagos, schedule_time
    from due
    on conflict (medication_id, scheduled_for_date, scheduled_time) do nothing
    returning medication_id, scheduled_time
  ),
  confirmed as (
    select d.* from due d
    join inserted_state s on s.medication_id = d.medication_id and s.scheduled_time = d.schedule_time
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'medication_dose_reminder',
      jsonb_build_object('medication_id', medication_id, 'drug_name', drug_name, 'scheduled_time', schedule_time)
    from confirmed
    returning id
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select organisation_id, patient_id, 'in_app', 'pending', 'medication_dose_reminder',
    jsonb_build_object('medication_id', medication_id, 'drug_name', drug_name, 'scheduled_time', schedule_time)
  from confirmed;
end;
$function$;

CREATE OR REPLACE FUNCTION private.queue_medication_lab_monitoring_reminders()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with due as (
    select m.id, m.organisation_id, m.patient_id, m.monitoring_label, m.due_date, med.drug_name
    from public.medication_lab_monitoring m
    join public.medications med on med.id = m.medication_id
    where m.status = 'pending'
      and m.reminder_sent_at is null
      and m.due_date is not null
      and m.due_date - interval '7 days' <= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'medication_lab_monitoring_due',
      jsonb_build_object('monitoring_label', monitoring_label, 'due_date', due_date, 'drug_name', drug_name)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'in_app', 'pending', 'medication_lab_monitoring_due',
      jsonb_build_object('monitoring_label', monitoring_label, 'due_date', due_date, 'drug_name', drug_name)
    from due
    returning id
  )
  update public.medication_lab_monitoring m
    set reminder_sent_at = now()
  from due
  where m.id = due.id;
$function$;

CREATE OR REPLACE FUNCTION private.queue_medication_refill_reminders()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with lead as (
    select
      m.id as medication_id,
      m.patient_id,
      m.organisation_id,
      m.drug_name,
      m.refill_date,
      coalesce(
        (select r.lead_days from public.medication_refill_reminder_rules r
           where r.patient_id = m.patient_id),
        (select r.lead_days from public.medication_refill_reminder_rules r
           where r.patient_id is null and r.organisation_id = m.organisation_id),
        7
      ) as lead_days
    from public.medications m
    where m.is_active and m.refill_date is not null
  ),
  due as (
    select l.* from lead l
    where l.refill_date - (l.lead_days || ' days')::interval <= current_date
      and l.refill_date >= current_date
      and not exists (
        select 1 from public.medication_refill_state s
        where s.medication_id = l.medication_id
          and s.reminded_for_refill_date = l.refill_date
      )
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id,
      patient_id,
      private.patient_reminder_channel(patient_id),
      'pending',
      'medication_refill_reminder',
      jsonb_build_object('medication_id', medication_id, 'drug_name', drug_name, 'refill_date', refill_date)
    from due
    returning recipient_id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id,
      patient_id,
      'in_app',
      'pending',
      'medication_refill_reminder',
      jsonb_build_object('medication_id', medication_id, 'drug_name', drug_name, 'refill_date', refill_date)
    from due
    returning recipient_id
  )
  insert into public.medication_refill_state (medication_id, patient_id, organisation_id, reminded_for_refill_date, reminder_sent_at)
  select medication_id, patient_id, organisation_id, refill_date, now()
  from due
  on conflict (medication_id) do update
    set reminded_for_refill_date = excluded.reminded_for_refill_date,
        reminder_sent_at = excluded.reminder_sent_at,
        updated_at = now();
$function$;

CREATE OR REPLACE FUNCTION private.queue_medication_review_reminders()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with due as (
    select r.*
    from public.medication_reviews r
    where r.status = 'pending'
      and r.reminder_sent_at is null
      and r.due_date - interval '7 days' <= current_date
      and r.due_date >= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'medication_review_due',
      jsonb_build_object('due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'in_app', 'pending', 'medication_review_due',
      jsonb_build_object('due_date', due_date)
    from due
    returning id
  )
  update public.medication_reviews r
    set reminder_sent_at = now()
  from due
  where r.id = due.id;
$function$;

CREATE OR REPLACE FUNCTION private.queue_preventive_review_reminders()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with due as (
    select r.*
    from public.preventive_reviews r
    where r.status = 'pending'
      and r.reminder_sent_at is null
      and r.due_date - interval '7 days' <= current_date
      and r.due_date >= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'preventive_review_due',
      jsonb_build_object('due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'in_app', 'pending', 'preventive_review_due',
      jsonb_build_object('due_date', due_date)
    from due
    returning id
  )
  update public.preventive_reviews r
    set reminder_sent_at = now()
  from due
  where r.id = due.id;
$function$;

CREATE OR REPLACE FUNCTION private.queue_screening_reminders()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with due as (
    select s.*, st.name as screen_type_name
    from public.screening_schedules s
    join public.screen_types st on st.id = s.screen_type_id
    where s.status in ('pending', 'booked', 'overdue')
      and s.reminder_stage is null
      and s.due_date > current_date
      and s.due_date <= current_date + 7
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'screening_upcoming',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'in_app', 'pending', 'screening_upcoming',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.screening_schedules s
    set reminder_stage = 'upcoming', reminder_sent_at = now()
  from due
  where s.id = due.id;

  with due as (
    select s.*, st.name as screen_type_name
    from public.screening_schedules s
    join public.screen_types st on st.id = s.screen_type_id
    where s.status in ('pending', 'booked', 'overdue')
      and (s.reminder_stage is null or s.reminder_stage = 'upcoming')
      and s.due_date <= current_date
      and s.due_date >= current_date - 6
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'screening_due',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'in_app', 'pending', 'screening_due',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.screening_schedules s
    set reminder_stage = 'due', reminder_sent_at = now()
  from due
  where s.id = due.id;

  with due as (
    select s.*, st.name as screen_type_name
    from public.screening_schedules s
    join public.screen_types st on st.id = s.screen_type_id
    where s.status in ('pending', 'booked', 'overdue')
      and (s.reminder_stage is null or s.reminder_stage in ('upcoming', 'due'))
      and s.due_date < current_date - 6
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'screening_overdue',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'in_app', 'pending', 'screening_overdue',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.screening_schedules s
    set reminder_stage = 'overdue', reminder_sent_at = now()
  from due
  where s.id = due.id;

  with due as (
    select s.*, st.name as screen_type_name
    from public.screening_schedules s
    join public.screen_types st on st.id = s.screen_type_id
    where s.status in ('pending', 'booked', 'overdue')
      and s.reminder_stage = 'overdue'
      and s.due_date < current_date - 20
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'screening_escalated',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'in_app', 'pending', 'screening_escalated',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_push as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'push', 'pending', 'screening_escalated',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.screening_schedules s
    set reminder_stage = 'escalated', reminder_sent_at = now()
  from due
  where s.id = due.id;
$function$;

CREATE OR REPLACE FUNCTION private.queue_vaccination_reminders()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with due as (
    select s.*, c.name as vaccine_name
    from public.vaccination_schedules s
    join public.vaccination_catalog c on c.id = s.vaccination_catalog_id
    where s.status in ('pending', 'booked', 'overdue')
      and s.reminder_stage is null
      and s.due_date > current_date
      and s.due_date <= current_date + 7
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'vaccination_upcoming',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'in_app', 'pending', 'vaccination_upcoming',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.vaccination_schedules s
    set reminder_stage = 'upcoming', reminder_sent_at = now()
  from due
  where s.id = due.id;

  with due as (
    select s.*, c.name as vaccine_name
    from public.vaccination_schedules s
    join public.vaccination_catalog c on c.id = s.vaccination_catalog_id
    where s.status in ('pending', 'booked', 'overdue')
      and (s.reminder_stage is null or s.reminder_stage = 'upcoming')
      and s.due_date <= current_date
      and s.due_date >= current_date - 6
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'vaccination_due',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'in_app', 'pending', 'vaccination_due',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.vaccination_schedules s
    set reminder_stage = 'due', reminder_sent_at = now()
  from due
  where s.id = due.id;

  with due as (
    select s.*, c.name as vaccine_name
    from public.vaccination_schedules s
    join public.vaccination_catalog c on c.id = s.vaccination_catalog_id
    where s.status in ('pending', 'booked', 'overdue')
      and (s.reminder_stage is null or s.reminder_stage in ('upcoming', 'due'))
      and s.due_date < current_date - 6
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'vaccination_overdue',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'in_app', 'pending', 'vaccination_overdue',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.vaccination_schedules s
    set reminder_stage = 'overdue', reminder_sent_at = now()
  from due
  where s.id = due.id;

  with due as (
    select s.*, c.name as vaccine_name
    from public.vaccination_schedules s
    join public.vaccination_catalog c on c.id = s.vaccination_catalog_id
    where s.status in ('pending', 'booked', 'overdue')
      and s.reminder_stage = 'overdue'
      and s.due_date < current_date - 20
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'vaccination_escalated',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'in_app', 'pending', 'vaccination_escalated',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_push as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'push', 'pending', 'vaccination_escalated',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.vaccination_schedules s
    set reminder_stage = 'escalated', reminder_sent_at = now()
  from due
  where s.id = due.id;
$function$;

CREATE OR REPLACE FUNCTION private.queue_vitals_reminders()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with freq as (
    select
      p.id as patient_id,
      p.organisation_id,
      p.created_at,
      coalesce(
        (select r.frequency_days from public.vitals_reminder_rules r
           where r.patient_id = p.id),
        (select min(r.frequency_days) from public.vitals_reminder_rules r
           join public.patient_reminder_group_members m
             on m.group_id = r.group_id
            and m.patient_id = p.id
           where r.patient_id is null
             and r.group_id is not null
             and r.organisation_id = p.organisation_id),
        (select min(r.frequency_days) from public.vitals_reminder_rules r
           join public.care_plans cp
             on cp.condition = r.condition
            and cp.patient_id = p.id
            and cp.status = 'active'
           where r.patient_id is null
             and r.condition is not null
             and r.organisation_id = p.organisation_id),
        (select r.frequency_days from public.vitals_reminder_rules r
           where r.patient_id is null
             and r.condition is null
             and r.group_id is null
             and r.organisation_id = p.organisation_id),
        case when exists (
          select 1 from public.care_plans cp
          where cp.patient_id = p.id
            and cp.status = 'active'
            and cp.condition in ('hypertension', 'diabetes')
        ) then 7 else 30 end
      ) as frequency_days
    from public.profiles p
    where p.role = 'patient' and p.organisation_id is not null
  ),
  candidates as (
    select
      f.patient_id,
      f.organisation_id,
      f.frequency_days,
      greatest(
        coalesce(
          (select max(v.taken_at)::date from public.vitals_readings v where v.patient_id = f.patient_id),
          f.created_at::date
        ) + (f.frequency_days || ' days')::interval,
        coalesce(
          (select s.next_due_at from public.vitals_reminder_state s where s.patient_id = f.patient_id),
          '-infinity'::date
        )
      ) as effective_due
    from freq f
  ),
  due as (
    select * from candidates where effective_due <= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id,
      patient_id,
      private.patient_reminder_channel(patient_id),
      'pending',
      'vitals_reminder',
      jsonb_build_object('frequency_days', frequency_days, 'due_date', effective_due)
    from due
    returning recipient_id
  )
  insert into public.vitals_reminder_state (patient_id, organisation_id, next_due_at, reminder_sent_at)
  select patient_id, organisation_id, current_date + frequency_days, now()
  from due
  on conflict (patient_id) do update
    set next_due_at = excluded.next_due_at,
        reminder_sent_at = excluded.reminder_sent_at,
        updated_at = now();
$function$;

CREATE OR REPLACE FUNCTION private.queue_wellness_challenge_ending_nudges()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with candidates as (
    select
      e.id,
      e.organisation_id,
      e.patient_id,
      c.title,
      c.target_count,
      private.wellness_challenge_metric_count(
        e.patient_id, c.metric, e.started_at, least(now(), e.target_end_at)
      ) as progress
    from public.patient_challenge_enrolments e
    join public.wellness_challenges c on c.id = e.challenge_id
    where e.status = 'active'
      and e.reminder_sent_at is null
      and e.target_end_at > now()
      and e.target_end_at <= now() + interval '24 hours'
  ),
  due as (
    select * from candidates where progress < target_count
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, private.patient_reminder_channel(patient_id), 'pending', 'wellness_challenge_ending',
      jsonb_build_object('challenge_title', title, 'progress', progress, 'target', target_count)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'in_app', 'pending', 'wellness_challenge_ending',
      jsonb_build_object('challenge_title', title, 'progress', progress, 'target', target_count)
    from due
    returning id
  )
  update public.patient_challenge_enrolments e
    set reminder_sent_at = now()
  from due
  where e.id = due.id;
$function$;

CREATE OR REPLACE FUNCTION private.raise_imaging_report_abnormal_pathway()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_alert_id  uuid;
  v_level     public.alert_level;
  v_esc_level smallint;
  v_sla       interval;
begin
  if not new.is_abnormal then
    v_level := 'routine'; v_esc_level := 1; v_sla := null;
  elsif new.urgency = 'critical' then
    v_level := 'emergency'; v_esc_level := 4; v_sla := interval '2 hours';
  elsif new.urgency = 'urgent' then
    v_level := 'urgent_escalation'; v_esc_level := 3; v_sla := interval '24 hours';
  else
    v_level := 'clinician_review'; v_esc_level := 2; v_sla := null;
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, category, type_code,
     escalation_level, sla_due_at, imaging_report_id)
  values (
    new.organisation_id, new.patient_id, v_level, 'open',
    case when new.is_abnormal
      then format('Abnormal imaging finding — %s %s', new.modality::text, new.body_region)
      else format('Imaging report filed — %s %s (review needed)', new.modality::text, new.body_region)
    end,
    format('%s%s', new.impression, case when new.is_abnormal then ' Requires clinician review and patient follow-up per the abnormal-imaging pathway.' else '' end),
    'clinical', 'abnormal_result', v_esc_level,
    case when v_sla is not null then now() + v_sla else null end,
    new.id
  )
  returning id into v_alert_id;

  update public.imaging_reports
  set clinician_alert_id = v_alert_id
  where id = new.id;

  update public.imaging_orders
  set status = 'reported'
  where id = new.imaging_order_id and status not in ('reported', 'result_returned', 'reviewed', 'cancelled');

  insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
  values
    (new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id, false), 'result_document_available', jsonb_build_object('source', 'imaging_report')),
    (new.organisation_id, new.patient_id, 'email', 'result_document_available', jsonb_build_object('source', 'imaging_report'));

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.uploaded_by, 'imaging_report.filed', 'imaging_reports', new.id,
    jsonb_build_object('is_abnormal', new.is_abnormal, 'urgency', new.urgency::text, 'clinician_alert_id', v_alert_id)
  );

  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_appointment(p_appointment_id uuid, p_new_scheduled_for timestamp with time zone, p_new_ends_at timestamp with time zone)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_old public.appointments;
  v_new public.appointments;
begin
  select * into v_old from public.appointments where id = p_appointment_id for update;
  if v_old.id is null then
    raise exception 'appointment not found';
  end if;
  if v_old.patient_id <> v_uid
     and not private.is_org_staff(v_old.organisation_id)
     and not private.can_act_for(v_old.patient_id, 'book_appointments'::public.caregiver_permission) then
    raise exception 'not authorized';
  end if;
  if v_old.status not in ('held', 'booked', 'confirmed') then
    raise exception 'cannot reschedule an appointment that is %', v_old.status;
  end if;
  if p_new_ends_at <= p_new_scheduled_for or p_new_scheduled_for <= now() then
    raise exception 'invalid new time';
  end if;

  begin
    insert into public.appointments (
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      scheduled_for, ends_at, status, reason, service, location, payment_status,
      specialist_referral_id, care_plan_id, booked_by, is_high_priority, rescheduled_from_id
    )
    select
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      p_new_scheduled_for, p_new_ends_at, 'booked', reason, service, location, payment_status,
      specialist_referral_id, care_plan_id, v_uid, is_high_priority, id
    from public.appointments where id = p_appointment_id
    returning * into v_new;
  exception
    when exclusion_violation then
      raise exception 'that new time was just taken — pick another slot';
  end;

  update public.appointments set status = 'rescheduled' where id = p_appointment_id;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (
    v_new.organisation_id, v_new.patient_id, private.patient_reminder_channel(v_new.patient_id), 'pending', 'appointment_rescheduled',
    jsonb_build_object('old_appointment_id', v_old.id, 'new_appointment_id', v_new.id, 'scheduled_for', v_new.scheduled_for),
    'non_clinical'
  );

  if v_new.patient_id <> v_uid then
    perform private.log_care_access(v_new.patient_id, 'acted_for', 'booking', jsonb_build_object('appointment_id', v_new.id, 'stage', 'rescheduled'));
  end if;

  return v_new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.route_missed_dose_reason()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_week_start date := date_trunc('week', (now() at time zone 'Africa/Lagos'))::date;
  v_per_day    int;
  v_total_wk   int;
  v_taken_wk   int;
  v_remaining  int;
  v_drug_name  text;
begin
  if new.status <> 'missed' or new.missed_reason is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status = new.status
     and old.missed_reason is not distinct from new.missed_reason then
    return new;
  end if;

  select drug_name, coalesce(jsonb_array_length(schedule_times), 0)
    into v_drug_name, v_per_day
  from public.medications
  where id = new.medication_id;

  v_total_wk := coalesce(v_per_day, 0) * 7;

  select count(*) into v_taken_wk
  from public.medication_logs
  where medication_id = new.medication_id
    and status = 'taken'
    and scheduled_for_date between v_week_start and v_week_start + 6;

  v_remaining := greatest(v_total_wk - v_taken_wk, 0);

  if new.missed_reason in ('forgot', 'feels_well') then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id,
      new.patient_id,
      private.patient_reminder_channel(new.patient_id),
      'pending',
      'missed_dose_behavioural_nudge',
      jsonb_build_object(
        'reason', new.missed_reason,
        'drug_name', coalesce(v_drug_name, 'your medication'),
        'taken_this_week', v_taken_wk,
        'total_this_week', v_total_wk,
        'remaining_this_week', v_remaining
      )
    );
  else
    insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, trigger_detail, priority)
    values (
      new.organisation_id,
      new.patient_id,
      'medication_engagement_barrier',
      jsonb_build_object(
        'medication_id', new.medication_id,
        'drug_name', coalesce(v_drug_name, 'medication'),
        'missed_reason', new.missed_reason,
        'log_id', new.id,
        'condition_or_type', coalesce(v_drug_name, 'Medication')
      ),
      3
    )
    on conflict (patient_id, trigger_type) where status in ('open', 'in_progress', 'contacted') do nothing;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_population_outreach(p_population_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid;
  v_name text;
  v_queued integer;
begin
  select organisation_id, name into v_org, v_name
  from public.population_definitions where id = p_population_id;

  if v_org is null then
    raise exception 'population % not found', p_population_id;
  end if;
  if not private.is_org_staff(v_org) then
    raise exception 'not authorized for this population''s organisation';
  end if;

  with candidates as (
    select m.patient_id, gap_type
    from public.get_population_members(p_population_id) m,
         unnest(m.open_care_gap_types) as gap_type
  ),
  inserted as (
    insert into public.care_outreach_tasks
      (organisation_id, patient_id, trigger_type, trigger_detail, priority, nudge_sent_at)
    select
      v_org,
      c.patient_id,
      c.gap_type::public.outreach_trigger_type,
      jsonb_build_object(
        'source', 'population_outreach',
        'population_id', p_population_id,
        'population_name', v_name
      ),
      case c.gap_type
        when 'unactioned_abnormal' then 1
        when 'overdue_screening' then 2
        when 'awaiting_result' then 2
        when 'repeated_no_show' then 2
        else 3
      end,
      now()
    from candidates c
    on conflict (patient_id, trigger_type)
      where status in ('open', 'in_progress', 'contacted')
      do nothing
    returning organisation_id, patient_id
  ),
  distinct_patients as (
    select distinct organisation_id, patient_id from inserted
  ),
  nudge_notified as (
    -- The in-app row below always lands; also nudge on the patient's own push or email when they have one.
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select i.organisation_id, i.patient_id, private.patient_reminder_channel(i.patient_id), 'pending', 'care_outreach_checkin',
           jsonb_build_object('reasons', array['population_health_campaign'], 'population_name', v_name)
    from distinct_patients i
    where private.patient_reminder_channel(i.patient_id) <> 'in_app'
    returning recipient_id
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select i.organisation_id, i.patient_id, 'in_app', 'pending', 'care_outreach_checkin',
         jsonb_build_object('reasons', array['population_health_campaign'], 'population_name', v_name)
  from distinct_patients i;

  select count(distinct patient_id) into v_queued
  from public.get_population_members(p_population_id) m, unnest(m.open_care_gap_types) as gap_type;

  return coalesce(v_queued, 0);
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 7. Drop the WhatsApp inbox and preference column (their readers were rewritten above)
-- ---------------------------------------------------------------------------------------------
drop table public.support_messages;
alter table public.patient_notification_preferences drop column whatsapp_enabled;

-- Patient-visible copy that promised the retired channel (config text, not legal text; consent and terms versions
-- are immutable legal documents and are NOT edited here, see OQ-31).
update public.add_ons set description = replace(description, 'WhatsApp reminders', 'in-app reminders')
 where description ilike '%whatsapp%';
update public.notification_template_locales set body = replace(body, 'Reply on WhatsApp or open the app.', 'Open the app to reply.')
 where body ilike '%whatsapp%';

comment on column public.profiles.preferred_reminder_channel is
  'Vestigial. Only ''voice'' is valid and nothing consumes it now (S01c removed the WhatsApp-to-call remap). NULL = default.';
comment on column public.notifications.content_class is
  'Structural backstop for the Non-Negotiable Business Rule that sms/email carry reminders/alerts/confirmations only, never clinical content. The CHECK notifications_no_clinical_on_open_rail rejects any clinical-content row on those channels; in_app and push are the rails for clinical content.';
comment on column public.notifications.response_options is
  'Optional array of {"label": "...", "value": "..."} quick-reply choices for the in-app notification UI to render as buttons. Null for a plain one-way notification. Never used to parse an inbound message into an action.';
comment on column public.profiles.notification_channel_preference is
  'Preferred channel for ROUTINE (non-critical) notifications only. NULL = platform default (push if subscribed, otherwise in-app). Never consulted for a critical-priority or clinical-content notification; those always follow the governed escalation ladder regardless of this setting.';
comment on column public.notification_escalation_failures.escalation_pathway is
  'The escalation_slas pathway the exhausted notification carried, or null when it carried none, e.g. a clinician page raised by private.notify_clinician_alert, which sets no pathway and is escalated on the engine''s default push/email/sms ladder.';
comment on table public.notification_template_locales is
  'Per-locale, per-channel body text for a notification_templates row. Only locale=''en'' rows are seeded today (17.6: architecture supports localisation from day one; actual non-English copy is a future, explicitly-asked-for product decision, not implied by this table existing). Backs sms/email/push/in_app bodies.';

-- ---------------------------------------------------------------------------------------------
-- 8. Prove removal, and prove the clinician ladder still has its hops
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_n integer;
  v_seq public.notification_channel[];
begin
  -- the label is gone from all four enums, and the enums still have their other values
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
             where t.typnamespace = 'public'::regnamespace and e.enumlabel ilike '%whatsapp%') then
    raise exception 'an enum still has a whatsapp label';
  end if;
  if (select count(*) from pg_enum where enumtypid = 'public.notification_channel'::regtype) <> 5
     or not exists (select 1 from pg_enum where enumtypid = 'public.notification_channel'::regtype and enumlabel = 'push')
     or not exists (select 1 from pg_enum where enumtypid = 'public.notification_channel'::regtype and enumlabel = 'in_app') then
    raise exception 'notification_channel lost a label it should keep';
  end if;
  if exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname like '%\_old' escape '\') then
    raise exception 'an old enum type was not dropped';
  end if;

  -- no column, table, trigger or default still refers to it
  select count(*) into v_n from information_schema.columns
    where table_schema in ('public', 'private', 'analytics') and (column_name ilike '%whatsapp%' or column_default ilike '%whatsapp%');
  if v_n <> 0 then raise exception '% column(s) still mention whatsapp', v_n; end if;
  if to_regclass('public.support_messages') is not null then raise exception 'support_messages still exists'; end if;
  if exists (select 1 from pg_trigger where tgname = 'notifications_remap_channel') then raise exception 'remap trigger still exists'; end if;
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'channel')
     is distinct from '''in_app''::notification_channel' then
    raise exception 'notifications.channel default is not in_app';
  end if;
  if exists (select 1 from pg_constraint where contype = 'c' and pg_get_constraintdef(oid) ilike '%whatsapp%') then
    raise exception 'a CHECK constraint still mentions whatsapp';
  end if;

  if exists (select 1 from public.add_ons where description ilike '%whatsapp%')
     or exists (select 1 from public.notification_template_locales where body ilike '%whatsapp%') then
    raise exception 'patient-facing config copy still mentions whatsapp';
  end if;

  -- (plpgsql resolves references at execution, so this scan is what catches a missed caller.)
  -- The one deliberate exception is the shim that reads a legacy ladder token.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private', 'analytics')
    and (p.prosrc ilike '%whatsapp%' or p.prosrc ilike '%support_messages%')
    and not (n.nspname = 'private' and p.proname = 'normalize_escalation_channels');
  if v_n <> 0 then raise exception '% function(s) still reference whatsapp or support_messages', v_n; end if;

  -- CLINICIAN LADDER: a legacy token becomes email, so no hop is lost and order is kept
  v_seq := private.normalize_escalation_channels(array['push', 'whatsapp_nudge']);
  if v_seq is distinct from array['push', 'email']::public.notification_channel[] then
    raise exception 'urgent ladder is % (expected push, email)', v_seq;
  end if;
  v_seq := private.normalize_escalation_channels(array['push', 'whatsapp', 'sms', 'next_of_kin_call_if_unacknowledged']);
  if v_seq is distinct from array['push', 'email', 'sms']::public.notification_channel[] then
    raise exception 'emergency ladder is % (expected push, email, sms)', v_seq;
  end if;
  v_seq := private.normalize_escalation_channels(array['push, batched']);
  if v_seq is distinct from array['push']::public.notification_channel[] then
    raise exception 'batched push ladder is % (expected push)', v_seq;
  end if;

  -- a patient with nothing configured gets the in-app inbox, never a dead channel
  if private.patient_reminder_channel(gen_random_uuid()) is distinct from 'in_app'::public.notification_channel then
    raise exception 'reminder channel for an unknown recipient is not in_app';
  end if;

  -- anon can execute neither recreated routing function
  if has_function_privilege('anon', 'private.normalize_escalation_channels(text[])', 'EXECUTE')
     or has_function_privilege('anon', 'private.patient_reminder_channel(uuid,boolean)', 'EXECUTE') then
    raise exception 'anon can EXECUTE a recreated routing function';
  end if;
end $$;
