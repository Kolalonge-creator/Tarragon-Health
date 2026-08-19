-- Guaranteed in-app companion, platform-wide sweep.
--
-- The codebase already fixed this exact class of gap piecemeal for several
-- templates (health_education_unlock, care_access_requests,
-- health_reset_complete, new_care_message, medication_refill_reminder,
-- medication_adherence_checkin — see 20260730224249_medication_reminders_
-- guaranteed_in_app.sql's own header for the reasoning). Live audit of every
-- private.* function that inserts into public.notifications (2026-08-11)
-- found 21 more that still only ever queue 'whatsapp' (sometimes + 'sms'/
-- 'email' to an external party) with no 'in_app' companion at all. Since
-- Meta WABA template approval and Termii sender-ID approval are both still
-- pending platform-wide, every one of these can currently reach a patient
-- with NO push subscription through zero channels whatsoever — the
-- notification just sits 'pending' on a blocked template forever, with no
-- patient-visible signal. Fixed the same way, same pattern: also queue a
-- companion 'in_app' row from the same source set, rendered directly by
-- NotificationBell, which needs no external provider approval of any kind.
--
-- Deliberately NOT touched by this migration:
--   * private.notify_unacknowledged_emergencies -- recipient_id is stamped
--     as the patient for RLS/audit bookkeeping, but the message content
--     (to_phone/contact_name in payload) is addressed to the patient's
--     EMERGENCY CONTACT, an external person who is very likely not a
--     Tarragon account at all. An in_app row would show the wrong content
--     in the PATIENT's own bell.
--   * The partner-facing halves of private.enqueue_lab_order_lab_
--     notifications / enqueue_pharmacy_order_notifications /
--     enqueue_referral_notifications -- same shape: recipient_id is the
--     patient for bookkeeping, but the sms/email payload (to_phone/
--     to_email/lab_name/pharmacy_name/specialist_name) is addressed to an
--     external lab/pharmacy/specialist contact, not the patient. Only the
--     PATIENT-facing confirmation insert in each of these three functions
--     gets an in_app companion here.
--   * private.enqueue_critical_notification and the escalation_slas config
--     it reads (bp_vitals_red_flag, screening_abnormal_result,
--     emergency_event, etc.) -- this is a deliberately data-driven,
--     per-pathway/tier channel ladder (CLAUDE.md: "the escalation SLA as
--     data not code"), and every active row today uses only push/whatsapp/
--     sms, never in_app, even though private.normalize_escalation_channels
--     already accepts it as a valid token. That ladder already has its own
--     independent safety net -- the clinician_alerts row + worklist page
--     the escalation writes to is not itself channel-dependent, and
--     private.escalate_unconfirmed_critical_notifications (which DOES
--     queue in_app) already covers full-ladder exhaustion. Whether to also
--     put in_app earlier in specific pathway/tier sequences is a config
--     change to escalation_slas.config, not a code fix, and affects the
--     clinical escalation system -- left as a deliberate decision, not
--     bundled into this sweep.

-- ---------------------------------------------------------------------------
-- 1. Trigger functions -- one extra insert alongside the existing one(s).
-- ---------------------------------------------------------------------------

create or replace function private.enqueue_lab_order_lab_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
  values (new.organisation_id, new.patient_id, 'whatsapp', 'pending', 'lab_order_patient_confirmation',
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
$$;

create or replace function private.enqueue_lab_order_requested_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient       public.profiles%rowtype;
  v_patient_email text;
  v_test_name     text;
  v_order_ref     text;
  v_self_booked   boolean;
begin
  v_self_booked := (new.origin = 'patient_initiated' and new.ordered_by is null);

  select * into v_patient from public.profiles where id = new.patient_id;
  select email into v_patient_email from auth.users where id = new.patient_id;

  select name into v_test_name from public.panel_bundles where id = new.panel_bundle_id;
  v_test_name := coalesce(v_test_name, 'a lab test');
  v_order_ref := coalesce(new.order_number, 'your order');

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
        'self_booked',  v_self_booked
      )
    );
  end if;

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  values (
    new.organisation_id, new.patient_id, 'whatsapp', 'pending',
    'lab_order_requested_patient',
    jsonb_build_object(
      'patient_name', coalesce(v_patient.full_name, 'there'),
      'order_number', v_order_ref,
      'test_name',    v_test_name,
      'self_booked',  v_self_booked
    )
  );

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  values (
    new.organisation_id, new.patient_id, 'in_app', 'pending',
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
$$;

create or replace function private.enqueue_medication_prescribed_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    new.organisation_id, new.patient_id, 'whatsapp', 'pending',
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
$$;

create or replace function private.enqueue_pharmacy_order_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    new.organisation_id, new.patient_id, 'whatsapp', 'pending',
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
$$;

create or replace function private.enqueue_referral_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
  values (new.organisation_id, new.patient_id, 'whatsapp', 'pending', 'referral_patient_confirmation',
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
$$;

create or replace function private.handle_lab_result_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_has_review_access boolean;
begin
  if (select auth.uid()) is not null then
    new.uploaded_by := (select auth.uid());
  end if;

  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;

  v_has_review_access := private.patient_has_feature_access(new.patient_id, 'result_document_review');

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
      (new.organisation_id, new.patient_id, 'whatsapp', 'result_document_available',
        jsonb_build_object('source', new.source::text)),
      (new.organisation_id, new.patient_id, 'in_app', 'result_document_available',
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
      'review_gated_by_plan', not v_has_review_access
    )
  );

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Loop-based cron functions.
-- ---------------------------------------------------------------------------

create or replace function private.notify_emergency_followups()
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      v_event.organisation_id, v_event.patient_id, 'whatsapp', 'pending',
      'emergency_followup',
      jsonb_build_object('patient_name', coalesce(v_patient.full_name, 'there'))
    );
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
$$;

create or replace function private.notify_region_waitlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
      v_requester.organisation_id, v_row.requester_id, 'whatsapp', 'pending',
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
$$;

create or replace function private.queue_annual_reviews()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_year integer := extract(year from current_date); r record; v_review_id uuid;
begin
  for r in
    select distinct s.subscriber_id as patient_id, p.organisation_id
    from public.subscriptions s
    join public.profiles p on p.id = s.subscriber_id
    left join public.subscription_plans pl on pl.id = s.plan_id
    where s.status in ('active', 'trialing') and p.role = 'patient'
      and ((pl.features is not null and 'annual_review' = any(pl.features))
        or exists (select 1 from public.subscription_add_ons sao
          join public.add_ons a on a.id = sao.add_on_id
          where sao.subscription_id = s.id and sao.status in ('active', 'trialing')
            and 'annual_review' = any(a.features)))
  loop
    if exists (select 1 from public.annual_reviews ar where ar.patient_id = r.patient_id
      and (ar.status in ('pending', 'in_progress') or ar.due_date > current_date - interval '11 months')) then
      continue;
    end if;

    v_review_id := private.open_annual_review(r.patient_id, r.organisation_id, v_year);
    if v_review_id is null then continue; end if;

    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (r.organisation_id, r.patient_id, 'whatsapp', 'pending', 'annual_review_due',
      jsonb_build_object('cycle_year', v_year));

    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (r.organisation_id, r.patient_id, 'in_app', 'pending', 'annual_review_due',
      jsonb_build_object('cycle_year', v_year));
  end loop;
end; $$;

create or replace function private.queue_lpe_review_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
  select r.organisation_id, r.patient_id, 'whatsapp', 'lifestyle_review_due',
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
$$;

-- ---------------------------------------------------------------------------
-- 3. Single-statement SQL cron functions -- add a sibling "queued_in_app"
--    CTE reading from the same `due` set, same shape as
--    queue_medication_refill_reminders/queue_medication_checkin_reminders.
-- ---------------------------------------------------------------------------

create or replace function private.queue_booking_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
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
      'whatsapp',
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
$$;

create or replace function private.queue_care_outreach()
returns void
language sql
security definer
set search_path = ''
as $$
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
        else 'stale_monitoring'
      end::public.outreach_trigger_type,
      g.detail || jsonb_build_object('condition_or_type', g.condition_or_type, 'opened_at', g.opened_at),
      case g.gap_type
        when 'unactioned_abnormal' then 1
        when 'overdue_screening' then 2
        when 'awaiting_result' then 2
        else 3
      end
    from public.patient_care_gaps g
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
      'whatsapp',
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
$$;

create or replace function private.queue_diabetes_complication_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
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
      organisation_id, patient_id, 'whatsapp', 'pending', 'diabetes_complication_check_due',
      jsonb_build_object('check_type', check_type, 'due_date', coalesce(due, current_date))
    from not_recently_reminded
    returning recipient_id
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select
    organisation_id, patient_id, 'in_app', 'pending', 'diabetes_complication_check_due',
    jsonb_build_object('check_type', check_type, 'due_date', coalesce(due, current_date))
  from not_recently_reminded;
$$;

create or replace function private.queue_health_check_due_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
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
      'whatsapp',
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
$$;

create or replace function private.queue_health_check_rebook_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
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
      'whatsapp',
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
$$;

create or replace function private.queue_medication_review_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
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
      organisation_id, patient_id, 'whatsapp', 'pending', 'medication_review_due',
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
$$;

create or replace function private.queue_preventive_review_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
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
      organisation_id, patient_id, 'whatsapp', 'pending', 'preventive_review_due',
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
$$;

create or replace function private.queue_screening_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with due as (
    select s.*, st.name as screen_type_name
    from public.screening_schedules s
    join public.screen_types st on st.id = s.screen_type_id
    where s.status = 'pending'
      and s.reminder_sent_at is null
      and s.due_date <= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'whatsapp', 'pending', 'screening_due',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'in_app', 'pending', 'screening_due',
      jsonb_build_object('screen_type_name', screen_type_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.screening_schedules s
    set reminder_sent_at = now()
  from due
  where s.id = due.id;
$$;

create or replace function private.queue_vaccination_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with due as (
    select s.*, c.name as vaccine_name
    from public.vaccination_schedules s
    join public.vaccination_catalog c on c.id = s.vaccination_catalog_id
    where s.status = 'pending'
      and s.reminder_sent_at is null
      and s.due_date <= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'whatsapp', 'pending', 'vaccination_due',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'in_app', 'pending', 'vaccination_due',
      jsonb_build_object('vaccine_name', vaccine_name, 'due_date', due_date)
    from due
    returning id
  )
  update public.vaccination_schedules s
    set reminder_sent_at = now()
  from due
  where s.id = due.id;
$$;

create or replace function private.queue_vitals_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with freq as (
    select
      p.id as patient_id,
      p.organisation_id,
      p.created_at,
      coalesce(
        (select r.frequency_days from public.vitals_reminder_rules r
           where r.patient_id = p.id),
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
             and r.organisation_id = p.organisation_id),
        case when exists (
          select 1 from public.care_plans cp
          where cp.patient_id = p.id
            and cp.status = 'active'
            and cp.condition in ('hypertension', 'diabetes')
        ) then 3 else 30 end
      ) as frequency_days,
      (
        select case
          when bool_or(cp.condition = 'diabetes') then 'glucose'
          when bool_or(cp.condition in ('hypertension', 'cardiovascular')) then 'blood_pressure'
          when bool_or(cp.condition = 'obesity') then 'weight'
          else null
        end
        from public.care_plans cp
        where cp.patient_id = p.id and cp.status = 'active'
      ) as suggested_vital_type
    from public.profiles p
    where p.role = 'patient' and p.organisation_id is not null
  ),
  candidates as (
    select
      f.patient_id,
      f.organisation_id,
      f.frequency_days,
      f.suggested_vital_type,
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
      'whatsapp',
      'pending',
      'vitals_reminder',
      jsonb_build_object(
        'frequency_days', frequency_days,
        'due_date', effective_due,
        'suggested_vital_type', suggested_vital_type
      )
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
      'vitals_reminder',
      jsonb_build_object(
        'frequency_days', frequency_days,
        'due_date', effective_due,
        'suggested_vital_type', suggested_vital_type
      )
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
$$;

create or replace function private.queue_wellness_challenge_ending_nudges()
returns void
language sql
security definer
set search_path = ''
as $$
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
      organisation_id, patient_id, 'whatsapp', 'pending', 'wellness_challenge_ending',
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
$$;

-- ---------------------------------------------------------------------------
-- 4. Assertions -- every touched function must now reference 'in_app'.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
  v_def text;
  v_fns text[] := array[
    'enqueue_lab_order_lab_notifications()',
    'enqueue_lab_order_requested_notifications()',
    'enqueue_medication_prescribed_notifications()',
    'enqueue_pharmacy_order_notifications()',
    'enqueue_referral_notifications()',
    'handle_lab_result_document()',
    'notify_emergency_followups()',
    'notify_region_waitlist()',
    'queue_annual_reviews()',
    'queue_booking_reminders()',
    'queue_care_outreach()',
    'queue_diabetes_complication_reminders()',
    'queue_health_check_due_reminders()',
    'queue_health_check_rebook_reminders()',
    'queue_lpe_review_reminders()',
    'queue_medication_review_reminders()',
    'queue_preventive_review_reminders()',
    'queue_screening_reminders()',
    'queue_vaccination_reminders()',
    'queue_vitals_reminders()',
    'queue_wellness_challenge_ending_nudges()'
  ];
begin
  foreach v_fn in array v_fns loop
    select pg_get_functiondef(('private.' || v_fn)::regprocedure) into v_def;
    if v_def not like '%''in_app''%' then
      raise exception 'private.% is missing its in_app companion insert', v_fn;
    end if;
  end loop;
  raise notice 'PASS: all 21 functions now queue an in_app companion notification';
end $$;
