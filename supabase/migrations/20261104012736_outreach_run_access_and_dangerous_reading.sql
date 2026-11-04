-- Outreach: on-site staff can run a day without blanket staff access, and the screen is told when a saved reading was an
-- emergency so it can show the CMO-signed on-site wording (OUT-001, packages/i18n/src/clinical-wording.json, signed 2026-11-04).
--
-- 1. RUN ACCESS. The outreach partner holds screening_days.run (granted from /admin/settings/members). Until now they could
--    call the enrol and readings functions but could not READ the day, its attendee list or who was enrolled: those tables
--    admitted only the requester, the payer and private.is_org_staff, and is_org_staff would also open roughly 110
--    patient-scoped tables. A holder of screening_days.run or screening_days.manage, in the day's own organisation, now reads
--    outreach days only (never a bundle day), their attendee list, and the enrolment links. Nothing else widens.
-- 2. DANGEROUS READING. record_outreach_vitals also returns `emergency`: true when any reading it just saved raised an
--    emergency_events row, i.e. crossed the signed emergency thresholds that already apply to every reading. The screen shows
--    OUT-001 to the staff member; the attendee's app shows EMG-001 as before. No threshold is added or restated here.

create function private.is_outreach_runner_for_org(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select (private.is_admin() or private.has_permission('screening_days.manage') or private.has_permission('screening_days.run'))
     and p_org = (select organisation_id from public.profiles where id = (select auth.uid()));
$$;
-- Read by RLS policies as the caller, so it is executable by authenticated; it answers only about the caller.
revoke all on function private.is_outreach_runner_for_org(uuid) from public, anon;
grant execute on function private.is_outreach_runner_for_org(uuid) to authenticated;

create policy screening_days_select_outreach_runner on public.screening_days
  for select to authenticated
  using (kind <> 'bundle' and private.is_outreach_runner_for_org(organisation_id));

create policy screening_day_slots_select_outreach_runner on public.screening_day_slots
  for select to authenticated
  using (exists (select 1 from public.screening_days sd
                  where sd.id = screening_day_slots.screening_day_id
                    and sd.kind <> 'bundle' and private.is_outreach_runner_for_org(sd.organisation_id)));

create policy outreach_enrolments_select_outreach_runner on public.outreach_enrolments
  for select to authenticated
  using (private.is_outreach_runner_for_org(organisation_id));

update public.staff_read_scope
   set reason = 'Staff running an outreach day, and holders of screening_days.run in the day''s organisation, enrol attendees and record their readings for that day''s list, which spans patients with no care tie yet. It holds links only (lab order, credit, reading ids), never a value; the payer cannot read it (I9).'
 where table_name = 'outreach_enrolments';

-- 3. GOVERNED ENTRY PATH. private.assisted_entry_guard lets care-team staff enter a reading for someone else ("a testing-day
--    nurse ... has their own governed path") and refuses anyone else who has no assisted-entry basis for that patient. An
--    outreach runner who is not care-team staff was therefore refused. record_outreach_vitals is the outreach governed path:
--    it already checks the caller may run the day and that the attendee was enrolled, so it raises a transaction-local flag
--    for its own inserts, and the guard accepts that flag. Only definer code can set it; no client path reaches set_config.

-- record_outreach_vitals: counted replacements of its own lines (flag on around the inserts, emergency flag in the result).
do $$
declare
  v_def text := pg_get_functiondef('public.record_outreach_vitals(uuid,jsonb)'::regprocedure);
  r record;
begin
  for r in select * from (values
    (1, $o$  for r in select * from jsonb_array_elements(v_bp) loop$o$,
        $n$  perform set_config('tarragon.outreach_vitals', e.patient_id::text, true);
  for r in select * from jsonb_array_elements(v_bp) loop$n$),
    (2, $o$  if coalesce(array_length(v_ids, 1), 0) = 0 then$o$,
        $n$  perform set_config('tarragon.outreach_vitals', '', true);
  if coalesce(array_length(v_ids, 1), 0) = 0 then$n$),
    -- review: a runner acts only on a day of their own organisation (can_run_outreach_day is not organisation-scoped)
    (4, $o$  if e.vitals_recorded_at is not null then raise exception 'vitals_already_recorded' using errcode = '22023'; end if;$o$,
        $n$  if not (private.is_admin() or private.is_outreach_runner_for_org(e.organisation_id)) then
    raise exception 'not authorised for this outreach check' using errcode = '42501';
  end if;
  if e.vitals_recorded_at is not null then raise exception 'vitals_already_recorded' using errcode = '22023'; end if;$n$),
    (3, $o$  return jsonb_build_object('vitals_rows', array_length(v_ids, 1));$o$,
        $n$  -- OUT-001: did any reading just saved cross the signed emergency thresholds?
  return jsonb_build_object('vitals_rows', array_length(v_ids, 1),
    'emergency', exists (select 1 from public.emergency_events ee where ee.vital_reading_id = any(v_ids)));$n$)
  ) as t(n, old_text, new_text) loop
    if (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text) <> 1 then
      raise exception 'OUT-001: record_outreach_vitals replacement % expected exactly 1 match', r.n;
    end if;
    v_def := replace(v_def, r.old_text, r.new_text);
  end loop;
  execute v_def;
end $$;

-- assisted_entry_guard: accept the outreach governed path, right after the staff path (one counted replacement of its live body).
do $$
declare
  v_def text := pg_get_functiondef('private.assisted_entry_guard()'::regprocedure);
  v_old constant text := $o$  if private.is_org_staff(new.organisation_id) then
    return new;
  end if;$o$;
  v_new constant text := $n$  if private.is_org_staff(new.organisation_id) then
    return new;
  end if;
  -- Outreach health check readings, entered through record_outreach_vitals only (it checks the runner and the enrolment).
  -- The flag names the one enrolled patient, so it admits that patient's readings and nobody else's.
  if coalesce(current_setting('tarragon.outreach_vitals', true), '') = new.patient_id::text then
    return new;
  end if;$n$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'OUT-001: assisted_entry_guard expected exactly 1 match';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- 4. ORGANISATION SCOPE for the other two on-site writes (found in review): a holder of screening_days.run in one organisation
--    must not register or enrol attendees on another organisation's outreach day.
do $$
declare
  v_def text;
  r record;
begin
  for r in select * from (values
    ('public.add_screening_day_slot(uuid,text,text)',
     $o$     and not (v_day.kind <> 'bundle' and private.can_run_outreach_day()) then$o$,
     $n$     and not (v_day.kind <> 'bundle' and (private.is_admin() or private.is_outreach_runner_for_org(v_day.organisation_id))) then$n$),
    ('public.enrol_outreach_attendee(uuid,uuid)',
     $o$  if v_day.kind not in ('outreach_free', 'outreach_paid') then$o$,
     $n$  if not (private.is_admin() or private.is_outreach_runner_for_org(v_day.organisation_id)) then
    raise exception 'not authorised for this outreach check' using errcode = '42501';
  end if;
  if v_day.kind not in ('outreach_free', 'outreach_paid') then$n$),
    ('public.enrol_outreach_attendee(uuid,uuid)',
     $o$  if v_slot.phone is not null and v_phone is distinct from v_slot.phone then$o$,
     $n$  if v_org is distinct from v_day.organisation_id then
    raise exception 'that person is registered with another organisation' using errcode = '22023';
  end if;
  if v_slot.phone is not null and v_phone is distinct from v_slot.phone then$n$)
  ) as t(fn, old_text, new_text) loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text) <> 1 then
      raise exception 'outreach org scope: % expected exactly 1 match', r.fn;
    end if;
    execute replace(v_def, r.old_text, r.new_text);
  end loop;
end $$;

do $$
begin
  if has_function_privilege('anon', 'private.is_outreach_runner_for_org(uuid)', 'EXECUTE') then
    raise exception 'anon must not execute is_outreach_runner_for_org';
  end if;
  if pg_get_functiondef('public.record_outreach_vitals(uuid,jsonb)'::regprocedure) not like '%''emergency''%' then
    raise exception 'record_outreach_vitals did not gain the emergency flag';
  end if;
end $$;
