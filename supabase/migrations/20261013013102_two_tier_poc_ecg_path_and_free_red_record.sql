-- Two-tier review findings 5 and 6.
--
-- 5. record_poc_ecg trusted p_file_path. The path must be this booking's own folder in the poc-ecg bucket (the app writes
--    <booking id>/<uuid>.<pdf|png|jpg|xml>), with no '..', at most 200 characters, an allowed mime type and a size inside the cap,
--    all checked on the server; and the table now carries the same rules as a CHECK so no other writer can break them.
--    LIVE COUNT BEFORE (read-only 2026-10-12 pattern, table is new in this release): poc_ecg_recordings 0 rows, so the CHECK is
--    added validated.
-- 6. record_free_red_event: the Free record is made by a trigger on the emergency-event insert. If the person's membership flips
--    between that insert and the look-up, the record could be missing and the Free person would get no guidance or check-in. If it
--    is missing after the insert it is now opened explicitly (private.open_free_red_event, idempotent), so a Free red event never
--    ends with no guidance. Fail toward giving guidance.
-- ROLLBACK: restore the 20261013004659 / 20261013004008 bodies; alter table public.poc_ecg_recordings drop constraint poc_ecg_recordings_path_in_booking_folder.

alter table public.poc_ecg_recordings add constraint poc_ecg_recordings_path_in_booking_folder check (
  char_length(file_path) <= 200
  and file_path !~ '\.\.'
  and file_path ~ ('^' || booking_id::text || '/[0-9A-Za-z._-]+$')
);

create or replace function public.record_poc_ecg(p_booking uuid, p_file_path text, p_mime_type text, p_size bigint, p_device_label text default null, p_machine_statement text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v uuid := (select auth.uid()); b public.testing_event_bookings%rowtype; v_id uuid;
begin
  b := private.poc_booking_for_entry(p_booking);
  if p_file_path is null or char_length(p_file_path) > 200 or p_file_path ~ '\.\.'
     or p_file_path !~ ('^' || p_booking::text || '/[0-9A-Za-z._-]+$') then
    raise exception 'ecg_file_path_not_allowed' using errcode = '22023';
  end if;
  if p_mime_type is null or p_mime_type not in ('application/pdf', 'image/png', 'image/jpeg', 'application/xml', 'text/xml') then
    raise exception 'ecg_file_type_not_allowed' using errcode = '22023';
  end if;
  if p_size is null or p_size <= 0 or p_size > 20971520 then
    raise exception 'ecg_file_size_not_allowed' using errcode = '22023';
  end if;
  if exists (select 1 from public.poc_ecg_recordings where booking_id = p_booking) then raise exception 'ecg_already_recorded' using errcode = '22023'; end if;
  insert into public.poc_ecg_recordings (organisation_id, patient_id, booking_id, file_path, mime_type, file_size_bytes, device_label,
      machine_statement, recorded_by, is_test)
  values (b.organisation_id, b.patient_id, p_booking, p_file_path, p_mime_type, p_size, nullif(btrim(p_device_label), ''),
      nullif(btrim(p_machine_statement), ''), v, b.is_test) returning id into v_id;
  perform private.create_clinical_task(b.patient_id, 'ecg_interpretation', null, 'poc_ecg:' || v_id);
  perform private.log_audit('poc.ecg_recorded', 'poc_ecg_recordings', v_id, '{}'::jsonb);
  return v_id;
end $$;

create or replace function private.record_free_red_event(p_triage uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare te public.triage_events%rowtype; v_ee uuid; v_fre uuid;
begin
  select * into te from public.triage_events where id = p_triage;
  if not found then raise exception 'unknown triage event' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('freered:' || p_triage));
  select id into v_fre from public.free_red_events where triage_event_id = p_triage;
  if found then return v_fre; end if;
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
  values (te.organisation_id, te.patient_id, 'triage_red', 'Your latest reading or answers need prompt attention.', 'active')
  returning id into v_ee;
  update public.free_red_events set triage_event_id = te.id, is_test = te.is_test where emergency_event_id = v_ee returning id into v_fre;
  if v_fre is null then
    -- membership flipped between the insert and the look-up: the trigger saw a Member and made no Free record. Make it now.
    v_fre := private.open_free_red_event(v_ee);
    update public.free_red_events set triage_event_id = te.id, is_test = te.is_test where id = v_fre;
  end if;
  return v_fre;
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.record_poc_ecg(uuid, text, text, bigint, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'private.record_free_red_event(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.record_free_red_event(uuid)', 'EXECUTE') then
    raise exception 'two-tier: a function is callable by the wrong role';
  end if;
end $$;
