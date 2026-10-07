-- S56 step 2 of 4: every mental-health table moves to per-patient access (INV-12) with audited reads (INV-10).
-- Founder decision 2026-10-07 (docs/design/S55-S60-build-plan.md section 9, point 4) and OQ-02 option (b), mental health first.
--
-- NEW: mental_health_handoffs (patient-sent hand-off to a consultation, created by request_mental_health_handoff in step 3).
-- TABLES MOVED (row counts are recorded by the dry run; locally 0): mental_health_screens, mental_health_screening_schedules,
-- wellbeing_checkins, wellbeing_checkin_preferences, therapy_sessions. Not moved, and why: mental_health_screening_cadences (governed
-- clinical config, no patient data), therapy_directory (a provider catalogue). Risk stratification for mental health is the band and
-- concern classification computed on mental_health_screens itself (20260829125323); there is no separate table. obesity_ed_screens
-- (eating-disorder screens) is a neighbouring table recorded as a follow-up in OPEN-QUESTIONS, not changed here.
--
-- BEFORE: select policies read `patient_id = me OR private.is_org_staff(org)`, so every org staff account (coordinators, ops, any
-- clinician) read every patient's screens, check-ins and therapy bookings straight from the table, unlogged.
-- AFTER:  a table read is the patient (or a Care Circle supporter holding the explicit, revocable, owner-only 'mental_health'
-- category) and nobody else. Staff read only through public.read_patient_mental_health_audited and the therapy queue functions below:
-- an active clinician (not a care coordinator) with a tie to the patient (private.clinician_has_patient_access: task, assignment,
-- on-call page acknowledged, appointment...) or an active break-glass grant for the 'mental_health' category. Admin, ops, finance,
-- support-view sessions and the CMO WITHOUT a tie are refused (a support-view session is deliberately NOT admitted: viewing a
-- patient's screen does not need to reveal their mental health). Every staff read, and every refusal, writes an audit_log row.
--
-- INVENTORY OF READERS (grep of web, mobile, edge functions, cron, SQL), each handled here or in the same PR:
--   * 4 DEFINER SQL functions (enforce_therapy_session_rules, raise_crisis_follow_up, schedule_next_mental_health_screen,
--     approve_therapy_session): unaffected by RLS; approve_therapy_session is rewritten below (it admitted ANY org staff).
--   * no view, no INVOKER function, no other policy reads these tables (checked in pg_proc, pg_views, pg_policies).
--   * web: clinician chart MentalHealthSummary and PreVisitSummary (audited read), therapy approvals queue and its worklist count
--     (audited functions), corporate wellbeing cohort metric (aggregate function, service role), patient self reads (unchanged).
--   * mobile: patient self reads only (unchanged). Edge functions and cron: none read these tables.
--   * service-role writers (mental-health-screen route and action) bypass RLS and are unchanged.
--
-- ALSO CLOSED HERE (found while inventorying):
--   * clinician_alerts and emergency_events carried the screen's band, score and the words "thoughts of self-harm" in their text, and
--     clinician_alerts is readable by org staff and by a Care Circle supporter holding only 'medical_history'. The text is now neutral
--     and a one-off function rewrites existing rows (count in the dry run).
--   * private.handle_emergency_event copied trigger_detail and the source name into the alert; the source name is masked for the
--     mental-health sources.
--   * public.sponsor_care_report counted a mental-health alert as "last clinical review"; it no longer does.
--   * the hazardous-alcohol alert (apps/web/src/lib/alcohol/escalate.ts) named AUDIT-C and the score in clinician_alerts; it is now
--     neutral too (new title 'A wellbeing support conversation is waiting') and existing rows are rewritten.
--   * approve_therapy_session let any org staff approve a psychiatry booking; it now needs prescribing authority AND the tie.
--   * approve_therapy_session never set scheduled_for, so confirming always hit the table constraint therapy_confirmed_needs_a_time; it
--     now takes the proposed time (third argument, required to confirm) and a decided request cannot be decided again.
--   * a patient could UPDATE any column of their therapy booking (including approved_by); they can now only cancel.
--   * a psychiatry request created no task, so under tie-gated access nobody could see it; it now creates an admin_clinical task.

-- 1. Gates ------------------------------------------------------------------------------------------------------------------
create or replace function private.is_mental_health_clinician()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clinical_staff cs
                  where cs.profile_id = (select auth.uid()) and cs.active
                    and cs.doctor_tier is not null and cs.doctor_tier <> 'care_coordinator');
$$;
revoke all on function private.is_mental_health_clinician() from public, anon, authenticated;

create or replace function private.can_staff_read_mental_health(p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and p_patient is not null
     and ((private.is_mental_health_clinician() and private.clinician_has_patient_access(p_patient))
          or private.has_emergency_access(p_patient, 'mental_health'::public.care_access_category));
$$;
revoke all on function private.can_staff_read_mental_health(uuid) from public, anon, authenticated;

-- The Care Circle consent hook. Explicit grant only: NO dependent-account bypass (unlike can_read_clinical), no sponsor flag, no
-- profile_access.clinical_access. S29's care_circle_members must call this before showing a supporter anything from these tables.
create or replace function private.supporter_has_mental_health_consent(p_patient uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profile_access pa
      join public.profile_access_categories pac on pac.profile_access_id = pa.id
     where pa.profile_id = p_patient and pa.grantee_user_id = p_user
       and pac.category = 'mental_health'::public.care_access_category
       and (pa.expires_at is null or pa.expires_at > now()));
$$;
revoke all on function private.supporter_has_mental_health_consent(uuid, uuid) from public, anon, authenticated;

create or replace function private.can_supporter_read_mental_health(p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (select auth.uid()) <> p_patient
     and private.supporter_has_mental_health_consent(p_patient, (select auth.uid()));
$$;
revoke all on function private.can_supporter_read_mental_health(uuid) from public, anon, authenticated;
grant execute on function private.can_supporter_read_mental_health(uuid) to authenticated;
grant execute on function private.supporter_has_mental_health_consent(uuid, uuid) to authenticated;

-- 2. Policies ---------------------------------------------------------------------------------------------------------------
drop policy if exists mental_health_screens_select on public.mental_health_screens;
create policy mental_health_screens_select on public.mental_health_screens for select to authenticated
  using (patient_id = (select auth.uid()) or private.can_supporter_read_mental_health(patient_id));

drop policy if exists mental_health_screening_schedules_select on public.mental_health_screening_schedules;
create policy mental_health_screening_schedules_select on public.mental_health_screening_schedules for select to authenticated
  using (patient_id = (select auth.uid()) or private.can_supporter_read_mental_health(patient_id));

drop policy if exists wellbeing_checkins_select on public.wellbeing_checkins;
create policy wellbeing_checkins_select on public.wellbeing_checkins for select to authenticated
  using (patient_id = (select auth.uid()) or private.can_supporter_read_mental_health(patient_id));

drop policy if exists wellbeing_checkin_preferences_select on public.wellbeing_checkin_preferences;
create policy wellbeing_checkin_preferences_select on public.wellbeing_checkin_preferences for select to authenticated
  using (patient_id = (select auth.uid()) or private.can_supporter_read_mental_health(patient_id));

drop policy if exists therapy_sessions_select on public.therapy_sessions;
create policy therapy_sessions_select on public.therapy_sessions for select to authenticated
  using (patient_id = (select auth.uid()) or private.can_supporter_read_mental_health(patient_id));

-- A patient may only cancel their own booking (it used to be any column, including approved_by); staff change a booking only through
-- approve_therapy_session. The staff UPDATE branch is gone.
drop policy if exists therapy_sessions_update on public.therapy_sessions;
create policy therapy_sessions_update on public.therapy_sessions for update to authenticated
  using (patient_id = (select auth.uid()) and status in ('requested', 'awaiting_clinician_approval', 'confirmed'))
  with check (patient_id = (select auth.uid()) and status = 'cancelled');

-- Existing tables predate the default-privilege migration: anon held full table grants locally (RLS stopped it; the grant should
-- not exist). Authenticated keeps only what a policy uses.
revoke all on public.mental_health_screens, public.mental_health_screening_schedules, public.wellbeing_checkins,
  public.wellbeing_checkin_preferences, public.therapy_sessions from anon;
revoke insert, update, delete, truncate on public.mental_health_screens, public.mental_health_screening_schedules from authenticated;

-- 2b. Hand-off from a positive screen to a consultation (function 10.13). The patient sends it; the summary is what the patient chose
-- to attach. Module 15 (onward referral) is not built: it will read rows with state = 'open' (documented seam, see docs/design/S56.md).
create table if not exists public.mental_health_handoffs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  screen_id       uuid references public.mental_health_screens (id) on delete set null,
  summary         jsonb not null default '{}'::jsonb,
  patient_note    text check (patient_note is null or char_length(patient_note) <= 500),
  state           text not null default 'open' check (state in ('open', 'seen', 'closed')),
  task_id         uuid,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists mental_health_handoffs_patient_idx on public.mental_health_handoffs (patient_id, created_at desc);
create index if not exists mental_health_handoffs_org_idx on public.mental_health_handoffs (organisation_id);
create index if not exists mental_health_handoffs_screen_idx on public.mental_health_handoffs (screen_id) where screen_id is not null;
alter table public.mental_health_handoffs enable row level security;
drop policy if exists mental_health_handoffs_select on public.mental_health_handoffs;
create policy mental_health_handoffs_select on public.mental_health_handoffs for select to authenticated
  using (patient_id = (select auth.uid()) or private.can_supporter_read_mental_health(patient_id));
revoke all on public.mental_health_handoffs from anon;
grant select on public.mental_health_handoffs to authenticated;

-- 3. The audited read -------------------------------------------------------------------------------------------------------
create or replace function private.audit_mental_health_read(p_patient uuid, p_sections text[], p_reason text, p_result text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result, subject_patient_id, ip)
  select pr.organisation_id, (select auth.uid()), 'staff.mental_health_read', 'mental_health', pr.id,
         jsonb_build_object('reason', btrim(p_reason), 'sections', to_jsonb(p_sections)), btrim(p_reason), p_result, pr.id, private.request_ip()
    from public.profiles pr where pr.id = p_patient;
end $$;
revoke all on function private.audit_mental_health_read(uuid, text[], text, text) from public, anon, authenticated;

create or replace function public.read_patient_mental_health_audited(
  p_patient uuid, p_reason text default null, p_sections text[] default array['screens'], p_limit integer default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c_known constant text[] := array['screens', 'checkins', 'therapy_sessions', 'schedules', 'handoffs'];
  v_uid uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.role()), '') = 'service_role';
  v_own boolean;
  v_lim integer := least(greatest(coalesce(p_limit, 200), 1), 1000);   -- technical page size, not a clinical value
  v_out jsonb := '{}'::jsonb;
begin
  if v_uid is null and not v_service then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_sections is null or cardinality(p_sections) = 0 or exists (select 1 from unnest(p_sections) s where s is null or s <> all (c_known)) then
    raise exception 'unknown section' using errcode = '22023';
  end if;
  v_own := v_service or p_patient = v_uid or private.can_supporter_read_mental_health(p_patient);
  if not v_own then
    if exists (select 1 from public.profiles where id = v_uid and role = 'patient') then raise exception 'not authorised' using errcode = '42501'; end if;
    if p_reason is null or char_length(btrim(p_reason)) < 10 then raise exception 'a reason of at least 10 characters is required' using errcode = '22023'; end if;
    if not private.can_staff_read_mental_health(p_patient) then
      perform private.audit_mental_health_read(p_patient, p_sections, p_reason, 'denied');
      return jsonb_build_object('status', 'denied');
    end if;
    perform private.audit_mental_health_read(p_patient, p_sections, p_reason, 'success');
  end if;

  if 'screens' = any (p_sections) then
    v_out := v_out || jsonb_build_object('screens', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id, patient_id, instrument, total_score, severity_band, hazardous, crisis_flagged, item_responses, created_at
        from public.mental_health_screens where patient_id = p_patient order by created_at desc limit v_lim) x), '[]'::jsonb));
  end if;
  if 'checkins' = any (p_sections) then
    v_out := v_out || jsonb_build_object('checkins', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select * from public.wellbeing_checkins where patient_id = p_patient order by checked_in_at desc limit v_lim) x), '[]'::jsonb));
  end if;
  if 'therapy_sessions' = any (p_sections) then
    v_out := v_out || jsonb_build_object('therapy_sessions', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id, patient_id, provider_id, status, modality, requested_at, scheduled_for, completed_at, cancelled_at, patient_note, approved_by, approved_at
        from public.therapy_sessions where patient_id = p_patient order by requested_at desc limit v_lim) x), '[]'::jsonb));
  end if;
  if 'schedules' = any (p_sections) then
    v_out := v_out || jsonb_build_object('schedules', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id, patient_id, instrument, due_date from public.mental_health_screening_schedules where patient_id = p_patient order by due_date limit v_lim) x), '[]'::jsonb));
  end if;
  if 'handoffs' = any (p_sections) then
    v_out := v_out || jsonb_build_object('handoffs', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id, patient_id, screen_id, summary, patient_note, state, task_id, created_at
        from public.mental_health_handoffs where patient_id = p_patient order by created_at desc limit v_lim) x), '[]'::jsonb));
  end if;
  return jsonb_build_object('status', 'ok') || v_out;
end $$;
revoke all on function public.read_patient_mental_health_audited(uuid, text, text[], integer) from public, anon;
grant execute on function public.read_patient_mental_health_audited(uuid, text, text[], integer) to authenticated, service_role;

-- 4. Therapy approvals: queue, count, approve ---------------------------------------------------------------------------------
create or replace function public.list_therapy_approvals_audited()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_rows jsonb; v_untied integer; v_pid uuid;
begin
  if v_uid is null or not private.is_mental_health_clinician() then raise exception 'not authorised' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'organisation_id', t.organisation_id, 'patient_id', t.patient_id,
           'provider_id', t.provider_id, 'status', t.status, 'modality', t.modality, 'requested_at', t.requested_at,
           'fee_kobo', t.fee_kobo, 'patient_note', t.patient_note,
           'patient', jsonb_build_object('full_name', p.full_name, 'patient_number', p.patient_number),
           'provider', jsonb_build_object('name', sp.name, 'specialist_type', sp.specialist_type)) order by t.requested_at), '[]'::jsonb)
    into v_rows
    from public.therapy_sessions t join public.profiles p on p.id = t.patient_id join public.specialist_providers sp on sp.id = t.provider_id
   where t.status = 'awaiting_clinician_approval' and private.can_staff_read_mental_health(t.patient_id);
  select count(*) into v_untied from public.therapy_sessions t
   where t.status = 'awaiting_clinician_approval' and t.organisation_id = (select pr.organisation_id from public.profiles pr where pr.id = v_uid)
     and not private.can_staff_read_mental_health(t.patient_id);
  -- one audit row per patient whose name, fee or note was served (INV-10): the read is a read of each patient's record, so each
  -- patient's own audit trail shows it (subject_patient_id), not just a count against the clinician.
  for v_pid in select (x ->> 'patient_id')::uuid from jsonb_array_elements(v_rows) x loop
    perform private.audit_mental_health_read(v_pid, array['therapy_sessions'], 'therapy approval queue', 'success');
  end loop;
  return jsonb_build_object('status', 'ok', 'rows', v_rows, 'not_yet_yours', v_untied);
end $$;
revoke all on function public.list_therapy_approvals_audited() from public, anon;
grant execute on function public.list_therapy_approvals_audited() to authenticated;

create or replace function public.count_therapy_approvals_waiting()
returns integer language sql stable security definer set search_path = '' as $$
  select case when private.is_mental_health_clinician() then
    (select count(*)::integer from public.therapy_sessions t
      where t.status = 'awaiting_clinician_approval' and private.can_staff_read_mental_health(t.patient_id)) else 0 end;
$$;
revoke all on function public.count_therapy_approvals_waiting() from public, anon;
grant execute on function public.count_therapy_approvals_waiting() to authenticated;

-- Approving needs a time (the table constraint therapy_confirmed_needs_a_time refuses a confirmed session without one, and the
-- earlier two-argument function never set it, so a confirm always failed): the approving doctor proposes the time. The old
-- two-argument signature is dropped so a call cannot be ambiguous between the two. A refusal for lack of authority RETURNS NULL (the
-- caller treats a null row as "not authorised") instead of raising, because a raise would roll back the audit row that records the
-- attempt; every other failure still raises.
drop function if exists public.approve_therapy_session(uuid, boolean);
create or replace function public.approve_therapy_session(p_session_id uuid, p_confirm boolean default true, p_scheduled_for timestamptz default null)
returns public.therapy_sessions language plpgsql security definer set search_path = '' as $$
declare v_caller uuid := auth.uid(); v_row public.therapy_sessions;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.therapy_sessions where id = p_session_id;
  if v_row.id is null then raise exception 'That request no longer exists.' using errcode = 'P0001'; end if;
  if not (private.is_mental_health_clinician() and private.has_prescribing_authority(v_row.organisation_id)
          and private.can_staff_read_mental_health(v_row.patient_id)) then
    perform private.audit_mental_health_read(v_row.patient_id, array['therapy_sessions'], 'attempted therapy approval', 'denied');
    return null;
  end if;
  if v_row.status <> 'awaiting_clinician_approval' then
    raise exception 'That request has already been decided.' using errcode = 'P0001';
  end if;
  if p_confirm and (p_scheduled_for is null or p_scheduled_for <= now()) then
    raise exception 'Choose a time in the future before confirming.' using errcode = '22023';
  end if;
  update public.therapy_sessions
     set approved_by = v_caller, approved_at = now(),
         status = case when p_confirm then 'confirmed'::public.therapy_session_status else 'cancelled'::public.therapy_session_status end,
         scheduled_for = case when p_confirm then p_scheduled_for else scheduled_for end,
         cancelled_at = case when p_confirm then null else now() end,
         cancelled_reason = case when p_confirm then null else 'Not approved by the care team' end
   where id = p_session_id returning * into v_row;
  perform private.audit_mental_health_read(v_row.patient_id, array['therapy_sessions'], 'therapy approval decision', 'success');
  return v_row;
end $$;
revoke all on function public.approve_therapy_session(uuid, boolean, timestamptz) from public, anon;
grant execute on function public.approve_therapy_session(uuid, boolean, timestamptz) to authenticated;

-- A psychiatry request waits for a doctor, so it must reach one: a task (existing type admin_clinical, referral review) that a
-- clinician claims, which is what creates the tie. The task names no patient detail. A failure is audited and opens an incident,
-- and never undoes the patient's request.
create or replace function private.therapy_request_task()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'awaiting_clinician_approval' then
    begin
      perform private.create_clinical_task(new.patient_id, 'admin_clinical', null, 'therapy_approval:' || new.id);
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (new.organisation_id, 'therapy_task.error', 'therapy_session', new.id, jsonb_build_object('error', sqlerrm));
      perform private.page_incident(new.organisation_id, 'therapy_task_failed:' || new.id, 'A request waiting for a doctor has no task',
        'A request that needs a doctor could not be turned into a task; see audit_log action therapy_task.error.');
    end;
  end if;
  return new;
end $$;
revoke all on function private.therapy_request_task() from public, anon, authenticated;
drop trigger if exists therapy_sessions_request_task on public.therapy_sessions;
create trigger therapy_sessions_request_task after insert on public.therapy_sessions
  for each row execute function private.therapy_request_task();

-- 5. Neutral text where mental-health facts used to be copied into other tables -----------------------------------------------
do $$
declare v_def text; v_new text;
begin
  -- the screen-concern alert: no instrument, score or band in the title or detail
  v_def := pg_get_functiondef('private.handle_mental_health_screen_concern()'::regprocedure);
  if v_def not like '%A wellbeing review is waiting%' then
  v_new := replace(v_def, E'format(''Wellbeing check-in: reported thoughts of self-harm (%s)'', v_instrument_item)', '''A check-in needs urgent follow-up''');
  v_new := replace(v_new, E'format(''Mental-health screen: %s concern — %s'', v_concern, upper(new.instrument))', '''A wellbeing review is waiting''');
  v_new := regexp_replace(v_new, 'format\(''Screen %s scored.*?end\s*\)', '''Open the review from your task list. No score is shown here on purpose.''', 'ns');
  if v_new = v_def or v_new like '%reported thoughts of self-harm%' or v_new like '%scored %s%' then
    raise exception 'S56: handle_mental_health_screen_concern could not be made neutral (definition drifted)';
  end if;
  execute v_new;
  end if;

  -- the generic emergency alert copies the source name and trigger_detail
  v_def := pg_get_functiondef('private.handle_emergency_event()'::regprocedure);
  if v_def not like '%a check-in%' then
  v_new := replace(v_def, E'format(''Emergency event (source: %s).%s%s%s'',\n               new.source,',
    E'format(''Emergency event (source: %s).%s%s%s'',\n               case when new.source::text in (''mental_health_screen'', ''intake_screen'') then ''a check-in'' else new.source::text end,');
  if v_new = v_def then raise exception 'S56: handle_emergency_event marker not found (definition drifted)'; end if;
  -- the same event is paged to EVERY clinician in the organisation; the payload (stored on each notification row, readable by that
  -- clinician) carried the patient's name and the raw source name. For the two mental-health sources both are masked (INV-07, INV-12):
  -- the page says a patient needs attention and nothing else. The paging itself is unchanged: the F1 crisis route pages the on-call
  -- clinician with a neutral notice, and this older broadcast stays as a safety net for the emergency, now carrying no label.
  v_def := v_new;
  v_new := replace(v_def, E'\'source_label\', new.source::text',
    E'\'source_label\', case when new.source::text in (\'mental_health_screen\', \'intake_screen\') then \'a check-in\' else new.source::text end');
  if v_new = v_def then raise exception 'S56: handle_emergency_event source_label marker not found (definition drifted)'; end if;
  v_def := v_new;
  v_new := replace(v_def, E'\'patient_name\', coalesce((select full_name from public.profiles where id = new.patient_id), \'A patient\')',
    E'\'patient_name\', case when new.source::text in (\'mental_health_screen\', \'intake_screen\') then \'A patient\' else coalesce((select full_name from public.profiles where id = new.patient_id), \'A patient\') end');
  if v_new = v_def then raise exception 'S56: handle_emergency_event patient_name marker not found (definition drifted)'; end if;
  execute v_new;
  end if;

  -- the sponsor activity report: a mental-health alert must not read as "last clinical review"
  v_def := pg_get_functiondef('public.sponsor_care_report(uuid,date)'::regprocedure);
  if v_def not like '%A wellbeing review is waiting%' then
  v_new := replace(v_def, E'and a.status in (''acknowledged'', ''resolved'', ''closed'')\n     and a.updated_at >= v_since;',
    E'and a.status in (''acknowledged'', ''resolved'', ''closed'')\n     and a.updated_at >= v_since\n     and a.title not in (''A wellbeing review is waiting'', ''A check-in needs urgent follow-up'', ''A wellbeing support conversation is waiting'', ''AUDIT-C: hazardous alcohol use flagged'')\n     and a.title not like ''Mental-health screen:%''\n     and not exists (select 1 from public.emergency_events ee where ee.clinician_alert_id = a.id and ee.source::text in (''mental_health_screen'', ''intake_screen''));');
  if v_new = v_def then raise exception 'S56: sponsor_care_report marker not found (definition drifted)'; end if;
  execute v_new;
  end if;
end $$;

-- One-off rewrite of existing alert and emergency text (rows counted by the dry run; 0 on a fresh replay). A function so the proof
-- can run it on a fixture.
create or replace function private.s56_neutralise_mental_health_text()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer := 0; m integer;
begin
  update public.clinician_alerts set title = 'A wellbeing review is waiting', detail = 'Open the review from your task list. No score is shown here on purpose.'
   where title like 'Mental-health screen:%';
  get diagnostics m = row_count; n := n + m;
  -- the hazardous-alcohol alert (AUDIT-C) named the instrument and score; same treatment, with its own title (it is a de-duplication key)
  update public.clinician_alerts set title = 'A wellbeing support conversation is waiting', detail = 'Open the review from your task list. No score is shown here on purpose.'
   where title = 'AUDIT-C: hazardous alcohol use flagged';
  get diagnostics m = row_count; n := n + m;
  -- existing emergency events (written by the old trigger and the old application code) carried the instrument item and the words
  update public.emergency_events set trigger_detail = 'A check-in needs urgent follow-up'
   where source::text in ('mental_health_screen', 'intake_screen') and trigger_detail ~* '(self-harm|PHQ|EPDS|item)';
  get diagnostics m = row_count; n := n + m;
  update public.clinician_alerts a set detail = 'Emergency event (source: a check-in). A check-in needs urgent follow-up.'
   where exists (select 1 from public.emergency_events e where e.clinician_alert_id = a.id and e.source::text = 'mental_health_screen')
     and a.detail like '%thoughts of self-harm%';
  get diagnostics m = row_count; n := n + m;
  return n;
end $$;
revoke all on function private.s56_neutralise_mental_health_text() from public, anon, authenticated;
do $$ declare n integer; begin n := private.s56_neutralise_mental_health_text(); raise notice 'S56: % existing alert rows made neutral', n; end $$;

-- 6. Corporate wellbeing cohort: aggregate only, minimum cohort enforced in the database --------------------------------------
create or replace function public.corporate_wellbeing_cohort(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_min integer; v_total integer; v_resp integer; v_out jsonb := '{}'::jsonb; i text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'not authorised' using errcode = '42501'; end if;
  select greatest(coalesce(min_cohort_size, 10), 5) into v_min from public.organisations where id = p_org;
  select count(*) into v_total from public.profiles where organisation_id = p_org and role = 'patient' and not coalesce(is_test, false);
  with latest as (
    select distinct on (s.patient_id, s.instrument) s.patient_id, s.instrument, s.severity_band
      from public.mental_health_screens s join public.profiles p on p.id = s.patient_id
     where p.organisation_id = p_org and p.role = 'patient' and not coalesce(p.is_test, false) and s.instrument in ('phq9', 'gad7')
     order by s.patient_id, s.instrument, s.created_at desc)
  select count(distinct patient_id) into v_resp from latest;
  if v_resp is null or v_resp < v_min then
    return jsonb_build_object('suppressed', true, 'min_cohort_size', v_min);
  end if;
  foreach i in array array['phq9', 'gad7'] loop
    v_out := v_out || jsonb_build_object(i, coalesce((
      with latest as (
        select distinct on (s.patient_id) s.severity_band from public.mental_health_screens s join public.profiles p on p.id = s.patient_id
         where p.organisation_id = p_org and p.role = 'patient' and not coalesce(p.is_test, false) and s.instrument = i
         order by s.patient_id, s.created_at desc),
      c as (select severity_band, count(*) n from latest group by 1), t as (select sum(n) total from c)
      select case when (select total from t) < v_min then '{}'::jsonb
        else jsonb_object_agg(severity_band, round(n * 100.0 / (select total from t))) end from c), '{}'::jsonb));
  end loop;
  return jsonb_build_object('suppressed', false, 'responded', v_resp, 'total', v_total, 'phq9', v_out -> 'phq9', 'gad7', v_out -> 'gad7');
end $$;
revoke all on function public.corporate_wellbeing_cohort(uuid) from public, anon, authenticated;
grant execute on function public.corporate_wellbeing_cohort(uuid) to service_role;

-- 7. Self-checks ----------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['mental_health_screens', 'mental_health_screening_schedules', 'wellbeing_checkins', 'wellbeing_checkin_preferences', 'therapy_sessions', 'mental_health_handoffs'] loop
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and (qual ~ 'is_org_staff' or with_check ~ 'is_org_staff')) then
      raise exception 'S56 assertion: % still admits org staff', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then raise exception 'S56 assertion: anon can read %', t; end if;
  end loop;
  if has_function_privilege('anon', 'public.read_patient_mental_health_audited(uuid,text,text[],integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.approve_therapy_session(uuid,boolean,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.corporate_wellbeing_cohort(uuid)', 'EXECUTE') then
    raise exception 'S56 assertion: a mental-health function is executable by the wrong role';
  end if;
end $$;
