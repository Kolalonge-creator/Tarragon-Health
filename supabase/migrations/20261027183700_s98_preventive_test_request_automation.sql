-- S98: the preventive engine issues the self-arranged test request by itself.
--
-- Founder requirement (2026-10-27): the screening panel is approved but delivery is self-arranged, so when a patient is due a specific test they are
-- alerted, can download the PDF test request and take it to any lab, and later upload the result. Issuing the request must be AUTOMATED.
--
-- Audit of the live chain before this migration (see docs/design/S98.md):
--   due detection (S45 nightly scheduler)        OFF-BY-GUARD + UNSIGNED-CONFIG (screening_scheduler_enabled off, screening_rule_sets v1-v3 unsigned)
--   alert (queue_screening_reminders)            WORKS (upcoming / due / overdue / escalated, patient_reminder_channel plus in-app)
--   request created without a click              MISSING (a lab order for a due screening only existed after the patient pressed "Get & print")
--   PDF from the alert                           PARTLY (an order insert already emails the PDF; the reminder had no link to the request)
--   upload tied to the request                   WORKS (lab_result_documents.lab_order_id; the open-request card uploads against the order)
--   "result received" state                      MISSING (the schedule stayed "booked"; reminders kept chasing a patient who had already uploaded)
--   doctor can see it                            WORKS (staff_may_read, tied; results inbox) but nothing said "patient-uploaded, unverified"
--   care-gap closure                             WORKS after a clinician records the result (refresh_screening_schedule_on_result closes the schedule)
--
-- What this adds (nothing is signed, nothing is switched on, no new table):
--   1. Go-live guard screening_request_automation_enabled (OFF).
--   2. private.run_screening_request_automation(): nightly, for each DUE schedule that came from a SIGNED rule set (or belongs to a test patient),
--      is a non-sensitive test with an active single-test bundle, and has no request yet, insert ONE self-arranged lab order through the existing
--      patient-initiated, due-screening path of private.enforce_lab_order_origin (no doctor click, total 0, never billed). Sensitive tests (HIV,
--      hepatitis, STI, anything screen_types.sensitive) are NEVER auto-issued: the patient keeps the normal due alert and the existing manual
--      "Get & print" path. Idempotent: one request per schedule row, ever (a cancelled one is not re-created).
--      The insert fires the existing lab_orders triggers: schedule -> booked, the "your request is ready" email with the PDF attached, the
--      best-effort notice on the patient's own channel.
--   3. The screening reminders now carry schedule_id and lab_order_id, and stop chasing a patient whose result is already uploaded.
--   4. public.my_screening_requests(): what the patient may know about each request (no document content, which stays hidden until reviewed, INV-03).
--
-- Rollback: drop the two functions, unschedule the cron job, restore queue_screening_reminders() from 20260930094618_remove_whatsapp.sql, delete the guard row.

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('screening_request_automation_enabled', 'Automatic self-arranged test requests for due screenings',
   'The nightly job that issues the printable test request for a due, non-sensitive screening',
   'CMO has signed the screening rule set and switched the screening scheduler on; sensitive tests stay manual', 'cmo',
   array['run_screening_request_automation'],
   'The patient "Get & print this test" button and the annual bundle are unchanged. Sensitive tests are never auto-issued, with the guard on or off.');

-- the newest request for a schedule that is not cancelled
create function private.open_screening_request_id(p_schedule uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select o.id from public.lab_orders o
   where o.screening_schedule_id = p_schedule and o.status <> 'cancelled'
   order by o.created_at desc limit 1
$$;
revoke all on function private.open_screening_request_id(uuid) from public, anon, authenticated;

-- has the patient already uploaded a result against a request for this schedule
create function private.screening_result_uploaded(p_schedule uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.lab_orders o
      join public.lab_result_documents d on d.lab_order_id = o.id
     where o.screening_schedule_id = p_schedule and o.status <> 'cancelled')
$$;
revoke all on function private.screening_result_uploaded(uuid) from public, anon, authenticated;

create function private.run_screening_request_automation(p_patient uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record; v_order uuid; v_issued integer := 0; v_sensitive integer := 0; v_no_bundle integer := 0; v_failed integer := 0;
begin
  if p_patient is null then
    if not private.go_live_guard_on('screening_request_automation_enabled') then return jsonb_build_object('ran', false, 'reason', 'guard_off'); end if;
  else
    if not private.go_live_open_patient('screening_request_automation_enabled', p_patient) then return jsonb_build_object('ran', false, 'reason', 'guard_off'); end if;
  end if;

  for r in
    select s.id as schedule_id, s.organisation_id, s.patient_id, st.code, st.sensitive,
           (select b.id from public.panel_bundles b where b.is_active and b.test_codes = array[st.code] order by b.self_bookable desc, b.code limit 1) as bundle_id
      from public.screening_schedules s
      join public.profiles p on p.id = s.patient_id
      join public.screen_types st on st.id = s.screen_type_id and st.is_active
     where s.status in ('pending', 'overdue')
       and s.due_date <= current_date
       and p.role = 'patient' and p.is_active and p.organisation_id is not null
       and (p_patient is null or s.patient_id = p_patient)
       -- only calendar items the CMO's signed rule set produced (a test patient is exempt so the path can be proven before signing)
       and (coalesce(p.is_test, false)
            or exists (select 1 from public.screening_rule_sets rs where rs.id = s.rule_set_id and rs.is_active and rs.approved_by is not null))
       -- one request per schedule row, ever: any earlier order (even a cancelled one) means a human or the patient already acted
       and not exists (select 1 from public.lab_orders o where o.screening_schedule_id = s.id)
     order by s.due_date, s.id
     limit 1000
  loop
    -- sensitive tests are never issued by a job (INV-04): HIV, hepatitis, STI and everything marked sensitive stay a patient action
    if r.sensitive or r.code = any (array['hiv', 'hep_b', 'hep_c', 'syphilis', 'chlamydia_gonorrhoea']) then
      v_sensitive := v_sensitive + 1; continue;
    end if;
    if r.bundle_id is null then v_no_bundle := v_no_bundle + 1; continue; end if;
    begin
      perform pg_advisory_xact_lock(hashtextextended('screening_request:' || r.schedule_id::text, 0));
      if exists (select 1 from public.lab_orders o where o.screening_schedule_id = r.schedule_id) then continue; end if;
      insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, screening_schedule_id, status, origin, fulfilment, total_kobo)
      values (r.organisation_id, r.patient_id, r.bundle_id, r.schedule_id, 'ordered', 'patient_initiated', 'self_arranged', 0)
      returning id into v_order;
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (r.organisation_id, null, 'screening_request.auto_issued', 'lab_orders', v_order,
              jsonb_build_object('screening_schedule_id', r.schedule_id, 'screen_type', r.code));
      v_issued := v_issued + 1;
    exception when others then
      -- one patient's failure never stops the rest, and never reaches the patient
      v_failed := v_failed + 1;
      raise warning 'screening request automation failed for schedule %: %', r.schedule_id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('ran', true, 'issued', v_issued, 'skipped_sensitive', v_sensitive, 'skipped_no_bundle', v_no_bundle, 'failed', v_failed);
end $$;
revoke all on function private.run_screening_request_automation(uuid) from public, anon, authenticated;

-- 02:45 UTC, after the 02:15 scheduler and before the 06:35 reminders, so the due reminder can point at the request
select cron.schedule('screening-request-automation', '45 2 * * *', $$select private.run_screening_request_automation()$$);

-- What the patient (or someone allowed to see their results) may know about each request. No document content: an uploaded result stays hidden
-- from the patient until a clinician has reviewed it (INV-03).
create function public.my_screening_requests(p_patient uuid default null)
returns table (schedule_id uuid, lab_order_id uuid, order_status text, requested_at timestamptz, upload_count integer,
               last_uploaded_at timestamptz, doctor_reviewed boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_patient uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  v_patient := coalesce(p_patient, v_uid);
  if v_patient <> v_uid and not private.can_read_clinical(v_patient, 'view_results'::public.caregiver_permission) then
    raise exception 'not allowed to see this patient' using errcode = '42501';
  end if;
  return query
  select o.screening_schedule_id, o.id, o.status::text, o.created_at,
         coalesce(d.n, 0)::integer, d.last_at, coalesce(d.reviewed, false)
    from public.lab_orders o
    left join lateral (
      select count(*) as n, max(x.created_at) as last_at, bool_or(x.reviewed_at is not null) as reviewed
        from public.lab_result_documents x where x.lab_order_id = o.id) d on true
   where o.patient_id = v_patient and o.screening_schedule_id is not null and o.status <> 'cancelled'
   order by o.created_at desc;
end $$;
revoke all on function public.my_screening_requests(uuid) from public, anon;
grant execute on function public.my_screening_requests(uuid) to authenticated;

-- Reminders: carry the request, and stop once the result is uploaded. Patched from the live definition by exact anchors.
do $$
declare v_def text; v_new text; v_anchor text; v_payload text;
begin
  v_def := pg_get_functiondef('private.queue_screening_reminders()'::regprocedure);
  v_anchor := E'where s.status in (''pending'', ''booked'', ''overdue'')';
  v_payload := 'jsonb_build_object(''screen_type_name'', screen_type_name, ''due_date'', due_date)';
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 4 then
    raise exception 'S98: expected the status anchor 4 times in queue_screening_reminders';
  end if;
  if (length(v_def) - length(replace(v_def, v_payload, ''))) / length(v_payload) < 8 then
    raise exception 'S98: expected the payload anchor at least 8 times in queue_screening_reminders';
  end if;
  v_new := replace(v_def, v_anchor, v_anchor || E'\n      and not private.screening_result_uploaded(s.id)');
  v_new := replace(v_new, v_payload,
    'jsonb_build_object(''screen_type_name'', screen_type_name, ''due_date'', due_date, ''schedule_id'', id, ''lab_order_id'', private.open_screening_request_id(id))');
  execute v_new;
end $$;

do $$
begin
  if exists (select 1 from public.go_live_guards where key = 'screening_request_automation_enabled' and is_on) then raise exception 'S98 self-check: the guard must start off'; end if;
  if has_function_privilege('anon', 'public.my_screening_requests(uuid)', 'EXECUTE') then raise exception 'S98 self-check: anon can run my_screening_requests'; end if;
  if has_function_privilege('authenticated', 'private.run_screening_request_automation(uuid)', 'EXECUTE') then raise exception 'S98 self-check: the job is callable by a user'; end if;
  if position('screening_result_uploaded' in pg_get_functiondef('private.queue_screening_reminders()'::regprocedure)) = 0 then raise exception 'S98 self-check: reminders not patched'; end if;
  if not exists (select 1 from cron.job where jobname = 'screening-request-automation') then raise exception 'S98 self-check: cron job missing'; end if;
end $$;
