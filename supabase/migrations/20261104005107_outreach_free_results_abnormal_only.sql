-- Free outreach attendees: an uploaded result goes to a doctor only when it is abnormal or cannot be shown to be normal
-- (CMO decision OD-05, 2026-11-04, given in chat by the founder acting as CMO; recorded in docs/DECISIONS.md).
--
-- BEFORE. private.handle_lab_result_document raised a "review needed" clinician alert for every upload linked to an open lab
-- order. A free outreach attendee's lab form is such an order, so every free upload became doctor work, which CLAUDE.md says the
-- free tier does not get.
--
-- AFTER, for a patient's OWN upload against a FREE outreach lab form only (not a paid outreach place, not a Member, not a
-- document someone else supplied):
--   * no alert at upload; the document waits in outreach_result_screenings ('awaiting_confirmation');
--   * the report is read as before (the existing automatic reading), and the patient confirms the numbers as before
--     (confirm_my_lab_report). Nothing is decided by the AI reading alone: the patient-confirmed numbers are checked by the
--     database against the CMO-signed yearly-panel ranges (private.classify_lab_result on the active membership_annual version);
--   * it is screened NORMAL only if every one of these holds, otherwise it goes to a doctor at once:
--       - the reading did not suspect a critical value;
--       - the report holds no HIV, hepatitis or other sensitive test (those ALWAYS go to a doctor, whatever they say);
--       - every row the reader found was read cleanly, has a known code, is a number (no unjudged text result), and was
--         confirmed by the patient (an omitted row is not assumed normal);
--       - every confirmed number is a yearly-panel test, in the panel's own unit, and classifies 'normal';
--   * a suspected critical value found by the reading sends it to a doctor immediately, before the patient confirms anything;
--   * SAFETY NET: anything still waiting after 7 days (never confirmed, or the report could not be read) goes to a doctor.
--     A pg_cron job checks every hour.
-- Sending to a doctor creates the same clinician alert the upload would have raised, and links it to the document.

create table public.outreach_result_screenings (
  document_id    uuid primary key references public.lab_result_documents (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id     uuid not null references public.profiles (id) on delete restrict,
  lab_order_id   uuid not null references public.lab_orders (id) on delete cascade,
  state          text not null default 'awaiting_confirmation'
                 check (state in ('awaiting_confirmation', 'screened_normal', 'sent_to_doctor')),
  reason         text,
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  constraint outreach_result_screenings_decided check ((state = 'awaiting_confirmation') = (decided_at is null))
);
create index outreach_result_screenings_waiting on public.outreach_result_screenings (created_at) where state = 'awaiting_confirmation';

alter table public.outreach_result_screenings enable row level security;
create policy outreach_result_screenings_select on public.outreach_result_screenings
  for select to authenticated
  using (patient_id = (select auth.uid())
         or private.staff_may_read(patient_id, organisation_id, 'labs_results'::public.care_access_category));
grant select on public.outreach_result_screenings to authenticated;

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('outreach_result_screenings', 'patient_id', 'clinical_record', 'review', true, false,
        'Whether a free outreach attendee''s uploaded result was screened normal or sent to a doctor (OD-05). Class assigned by the migration author, not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason)
values ('outreach_result_screenings', 'tied', 'patient_id', 'labs_results', null)
on conflict (table_name) do nothing;
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('outreach_enrolments', 'patient_id', 'clinical_record', 'review', true, false,
        'An outreach attendee''s care links: lab form, consultation credit, readings (OD-01..OD-04). Class assigned by the migration author, not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason)
values ('outreach_enrolments', 'org', 'patient_id', 'labs_results',
        'Staff running an outreach day enrol attendees and record their readings for that day''s list, which spans patients with no care tie yet. It holds links only (lab order, credit, reading ids), never a value; the payer cannot read it (I9).')
on conflict (table_name) do nothing;

-- Is this lab order a FREE outreach lab form, with nothing else entitling the patient to a doctor's review?
create function private.is_free_outreach_order(p_order uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.outreach_enrolments e where e.lab_order_id = p_order and e.kind = 'outreach_free')
     and not exists (select 1 from public.outreach_enrolments e where e.lab_order_id = p_order and e.kind = 'outreach_paid')
     and private.patient_membership_tier((select o.patient_id from public.lab_orders o where o.id = p_order)) is null;
$$;
revoke all on function private.is_free_outreach_order(uuid) from public, anon, authenticated;

-- 1. Hold at upload: handle_lab_result_document, rewritten from its LIVE body by one counted replacement.
do $$
declare
  v_def text := pg_get_functiondef('private.handle_lab_result_document()'::regprocedure);
  v_old constant text := $o$    v_has_review_access := v_order_status is not null and v_order_status not in ('pending_payment', 'cancelled');$o$;
  v_new constant text := $n$    v_has_review_access := v_order_status is not null and v_order_status not in ('pending_payment', 'cancelled');
    -- OD-05: a free outreach attendee's own upload is held for the abnormal-only screen (outreach_result_screenings).
    if v_has_review_access and new.source = 'patient' and private.is_free_outreach_order(new.lab_order_id) then
      v_has_review_access := false;
    end if;$n$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'OD-05: handle_lab_result_document expected exactly 1 match';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

create function private.outreach_hold_upload() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.source = 'patient' and new.lab_order_id is not null and new.clinician_alert_id is null
     and private.is_free_outreach_order(new.lab_order_id) then
    insert into public.outreach_result_screenings (document_id, organisation_id, patient_id, lab_order_id)
    values (new.id, new.organisation_id, new.patient_id, new.lab_order_id)
    on conflict (document_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function private.outreach_hold_upload() from public, anon, authenticated;
create trigger lab_result_documents_outreach_hold after insert on public.lab_result_documents
  for each row execute function private.outreach_hold_upload();

-- 2. Send to a doctor: the same alert the upload would have raised, linked to the document. Idempotent.
create function private.outreach_send_result_to_doctor(p_document uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.outreach_result_screenings%rowtype;
  d public.lab_result_documents%rowtype;
  v_alert uuid;
begin
  select * into s from public.outreach_result_screenings where document_id = p_document for update;
  if not found or s.state <> 'awaiting_confirmation' then return; end if;
  select * into d from public.lab_result_documents where id = p_document;

  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, detail, escalation_level)
  values (d.organisation_id, d.patient_id,
          (case when p_reason = 'critical_suspected' then 'urgent_escalation' else 'clinician_review' end)::public.alert_level, 'open',
          'Lab result document uploaded — review needed',
          format('A lab result document was uploaded (%s) from a free outreach health check and was not screened normal (%s). Review and record any clinical finding.',
                 d.source, p_reason), 2)
  returning id into v_alert;

  perform set_config('app.route_prior_uploads', 'on', true);
  update public.lab_result_documents set clinician_alert_id = v_alert where id = p_document;
  perform set_config('app.route_prior_uploads', 'off', true);

  update public.outreach_result_screenings set state = 'sent_to_doctor', reason = p_reason, decided_at = now()
   where document_id = p_document;
  perform private.log_audit('outreach.result_sent_to_doctor', 'lab_result_documents', p_document,
    jsonb_build_object('reason', p_reason, 'clinician_alert_id', v_alert));
end $$;
revoke all on function private.outreach_send_result_to_doctor(uuid, text) from public, anon, authenticated;

-- 3. The screen itself, run on the patient's confirmed numbers.
create function private.outreach_screen_result(p_document uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  s public.outreach_result_screenings%rowtype;
  e public.lab_report_extractions%rowtype;
  v_panel uuid;
  v_panel_units jsonb;
  x jsonb;
  c record;
  v_unit text;
  v_flag text;
begin
  select * into s from public.outreach_result_screenings where document_id = p_document for update;
  if not found or s.state <> 'awaiting_confirmation' then return null; end if;

  select * into e from public.lab_report_extractions where document_id = p_document order by created_at desc limit 1;
  -- nothing confirmed yet: keep waiting (the 7-day net covers it)
  if e.id is null or not exists (select 1 from public.patient_reported_lab_values v where v.extraction_id = e.id) then
    return null;
  end if;

  if coalesce(e.critical_suspected, false) then
    perform private.outreach_send_result_to_doctor(p_document, 'critical_suspected'); return 'sent_to_doctor';
  end if;

  -- every row the reader found: clean, coded, numeric, not sensitive, and confirmed
  for x in select * from jsonb_array_elements(coalesce(e.rows, '[]'::jsonb)) loop
    if private.is_sensitive_analyte_code(x ->> 'code') then
      perform private.outreach_send_result_to_doctor(p_document, 'sensitive_test_on_report'); return 'sent_to_doctor';
    end if;
    if coalesce(x ->> 'status', '') <> 'ready' or nullif(x ->> 'value', '') is null then
      perform private.outreach_send_result_to_doctor(p_document, 'row_not_read_as_a_number'); return 'sent_to_doctor';
    end if;
    if not exists (select 1 from public.patient_reported_lab_values v
                    where v.extraction_id = e.id and lower(v.code) = lower(x ->> 'code')) then
      perform private.outreach_send_result_to_doctor(p_document, 'row_not_confirmed'); return 'sent_to_doctor';
    end if;
  end loop;

  select id, (select jsonb_object_agg(a ->> 'code', jsonb_build_object('unit', a ->> 'unit', 'kind', a ->> 'kind'))
                from jsonb_array_elements(analytes) a)
    into v_panel, v_panel_units
    from public.lab_panel_versions where panel_code = 'membership_annual' and is_active;
  if v_panel is null then
    perform private.outreach_send_result_to_doctor(p_document, 'no_active_panel'); return 'sent_to_doctor';
  end if;

  for c in select v.code, v.value, v.unit,
                  (select x2 ->> 'unit' from jsonb_array_elements(e.rows) x2 where lower(x2 ->> 'code') = lower(v.code) limit 1) as read_unit
             from public.patient_reported_lab_values v where v.extraction_id = e.id loop
    if not (v_panel_units ? lower(c.code)) or (v_panel_units -> lower(c.code) ->> 'kind') <> 'numeric' then
      perform private.outreach_send_result_to_doctor(p_document, 'test_not_on_panel'); return 'sent_to_doctor';
    end if;
    v_unit := coalesce(nullif(btrim(c.unit), ''), nullif(btrim(c.read_unit), ''));
    if lower(v_unit) = 'percent' then v_unit := '%'; end if;
    if v_unit is null or v_unit <> (v_panel_units -> lower(c.code) ->> 'unit') then
      perform private.outreach_send_result_to_doctor(p_document, 'unit_not_checkable'); return 'sent_to_doctor';
    end if;
    begin
      v_flag := private.classify_lab_result(v_panel,
        jsonb_build_array(jsonb_build_object('analyte_code', lower(c.code), 'value_numeric', c.value, 'unit', v_unit)),
        s.patient_id) #>> '{items,0,flag}';
    exception when others then
      v_flag := null;
    end;
    if v_flag is distinct from 'normal' then
      perform private.outreach_send_result_to_doctor(p_document, coalesce('out_of_range_' || v_flag, 'not_checkable')); return 'sent_to_doctor';
    end if;
  end loop;

  update public.outreach_result_screenings set state = 'screened_normal', reason = 'all_confirmed_numbers_in_range', decided_at = now()
   where document_id = p_document;
  perform private.log_audit('outreach.result_screened_normal', 'lab_result_documents', p_document, '{}'::jsonb);
  return 'screened_normal';
end $$;
revoke all on function private.outreach_screen_result(uuid) from public, anon, authenticated;

-- Fires at COMMIT (deferred), once all of a confirmation's numbers are in: confirm_my_lab_report inserts them one by one.
create function private.outreach_screen_on_confirm() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.outreach_screen_result(new.document_id);
  return null;
end $$;
revoke all on function private.outreach_screen_on_confirm() from public, anon, authenticated;
create constraint trigger patient_reported_lab_values_outreach_screen
  after insert on public.patient_reported_lab_values
  deferrable initially deferred
  for each row execute function private.outreach_screen_on_confirm();

-- A suspected critical value found by the reading goes to a doctor at once, before any confirmation.
create function private.outreach_critical_on_read() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.critical_suspected and not coalesce(old.critical_suspected, false) then
    perform private.outreach_send_result_to_doctor(new.document_id, 'critical_suspected');
  end if;
  return new;
end $$;
revoke all on function private.outreach_critical_on_read() from public, anon, authenticated;
create trigger lab_report_extractions_outreach_critical after update of critical_suspected on public.lab_report_extractions
  for each row execute function private.outreach_critical_on_read();

-- 4. The 7-day safety net.
create function private.outreach_result_screening_sweep() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in select document_id from public.outreach_result_screenings
            where state = 'awaiting_confirmation' and created_at < now() - interval '7 days' loop
    perform private.outreach_send_result_to_doctor(r.document_id, 'not_screened_within_7_days');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.outreach_result_screening_sweep() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'outreach-result-screening-sweep') then
    perform cron.unschedule('outreach-result-screening-sweep');
  end if;
  perform cron.schedule('outreach-result-screening-sweep', '17 * * * *', $c$ select private.outreach_result_screening_sweep(); $c$);
  if not exists (select 1 from cron.job where jobname = 'outreach-result-screening-sweep' and active) then
    raise exception 'FAIL: outreach-result-screening-sweep job not scheduled';
  end if;
  if pg_get_functiondef('private.handle_lab_result_document()'::regprocedure) not like '%is_free_outreach_order%' then
    raise exception 'handle_lab_result_document did not gain the outreach hold';
  end if;
  if has_table_privilege('anon', 'public.outreach_result_screenings', 'SELECT') then
    raise exception 'anon must not read outreach_result_screenings';
  end if;
end $$;
