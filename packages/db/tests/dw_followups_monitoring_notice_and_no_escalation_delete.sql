-- ===========================================================================
-- Proof: dw_followups_monitoring_notice_and_no_escalation_delete (2026-11-07).
--
--  1  a due monitoring case held by a doctor returns and that doctor gets one in-app 'escalation_monitoring_returned' notice,
--     carrying only the escalation id (no patient, nothing clinical)
--  2  a due monitoring case nobody holds notifies the organisation's active CMO instead
--  3  a not-yet-due monitoring case is left alone and nobody is notified about it
--  3b a due case held by a doctor on leave notifies the CMO instead of the absent doctor
--  3c with no doctor and no active CMO to tell, an ops incident is raised (never silent)
--  4  a staff account (the assigned doctor) cannot delete an escalation; a care coordinator cannot either
--  SABOTAGE: restoring the old org-staff delete policy and grant lets the coordinator delete, so check 4 can fail.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures in a fresh organisation.
-- ===========================================================================

begin;

create temp table ids (k text primary key, v uuid) on commit drop;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_id uuid;
  r record;
begin
  insert into public.organisations (id, name, type) values (v_org, 'DW follow-ups Test Org', 'clinic');
  insert into ids values ('org', v_org);
  for r in select * from (values
      ('patient', 'patient', null), ('doc', 'clinician', 'senior_medical_officer'),
      ('cmo', 'clinician', 'chief_medical_officer'), ('coord', 'care_coordinator', 'care_coordinator')
    ) as t(key_name, account_role, tier)
  loop
    v_id := gen_random_uuid();
    insert into ids values (r.key_name, v_id);
    insert into auth.users (id, email) values (v_id, format('dwfu-%s@example.invalid', r.key_name));
    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, v_org, r.account_role::public.user_role, format('DWFU %s', r.key_name))
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
    if r.tier is not null then
      insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier, employment_type,
                                         indemnity_insurer, indemnity_policy_number, indemnity_expires_at)
      values (v_org, v_id, format('DWFU %s', r.key_name), true, now(), r.tier::public.doctor_tier, 'employed',
              'Probe Indemnity Ltd', format('PROBE-DWFU-%s', r.key_name), now() + interval '1 year');
    end if;
  end loop;
end $$;

do $$
declare
  v_org uuid := (select v from ids where k = 'org');
  v_pat uuid := (select v from ids where k = 'patient');
  v_doc uuid := (select v from ids where k = 'doc');
  v_cmo uuid := (select v from ids where k = 'cmo');
  v_held uuid; v_unheld uuid; v_future uuid; v_leave uuid; v_orphan uuid;
  v_n integer;
  v_payload jsonb;
  v_failed boolean;
begin
  insert into public.escalations (organisation_id, patient_id, reason, assigned_doctor_id, status)
  values (v_org, v_pat, 'DWFU held', v_doc, 'open') returning id into v_held;
  insert into public.escalations (organisation_id, patient_id, reason, assigned_doctor_id, status)
  values (v_org, v_pat, 'DWFU future', v_doc, 'open') returning id into v_future;
  insert into public.escalations (organisation_id, patient_id, reason, assigned_doctor_id, status)
  values (v_org, v_pat, 'DWFU unheld', v_doc, 'open') returning id into v_unheld;

  -- Put all three into monitoring directly (the rules are proved in dw03_escalation_working_states.sql; here only the return matters).
  alter table public.escalations disable trigger escalations_enforce_state_rules;
  alter table public.escalations disable trigger escalations_enforce_reassignment_authority;
  update public.escalations set status = 'monitoring', status_note = 'Watching readings', monitor_until = now() - interval '1 minute' where id = v_held;
  update public.escalations set status = 'monitoring', status_note = 'Watching readings', monitor_until = now() - interval '1 minute', assigned_doctor_id = null where id = v_unheld;
  update public.escalations set status = 'monitoring', status_note = 'Watching readings', monitor_until = now() + interval '2 days' where id = v_future;
  alter table public.escalations enable trigger escalations_enforce_reassignment_authority;
  alter table public.escalations enable trigger escalations_enforce_state_rules;

  v_n := private.return_due_escalation_monitoring();
  if v_n <> 2 then raise exception 'FAIL setup: % cases returned, expected 2', v_n; end if;

  -- 1. the holding doctor is told, once, with only the id
  select count(*), max(payload::text)::jsonb into v_n, v_payload
    from public.notifications where source_id = v_held and template = 'escalation_monitoring_returned' and recipient_id = v_doc and channel = 'in_app';
  if v_n <> 1 then raise exception 'FAIL 1a: the holding doctor got % notices, expected 1', v_n; end if;
  if v_payload <> jsonb_build_object('escalation_id', v_held) then raise exception 'FAIL 1b: payload carries more than the id: %', v_payload; end if;
  if exists (select 1 from public.notifications where source_id = v_held and recipient_id <> v_doc) then
    raise exception 'FAIL 1c: someone other than the holding doctor was told about a held case';
  end if;

  -- 2. nobody holds it: the CMO is told
  select count(*) into v_n from public.notifications where source_id = v_unheld and template = 'escalation_monitoring_returned' and recipient_id = v_cmo;
  if v_n <> 1 then raise exception 'FAIL 2: the CMO got % notices for an unheld case, expected 1', v_n; end if;

  -- 3. not yet due: untouched, nobody told
  if (select status from public.escalations where id = v_future) <> 'monitoring' then raise exception 'FAIL 3a: a not-yet-due case returned'; end if;
  if exists (select 1 from public.notifications where source_id = v_future) then raise exception 'FAIL 3b: a not-yet-due case raised a notice'; end if;

  -- 3b. the holding doctor is on leave: the CMO is told, not the absent doctor
  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason, created_by)
  values (v_org, v_doc, 'leave', now() - interval '1 day', now() + interval '1 day', 'DWFU proof', v_cmo);
  insert into public.escalations (organisation_id, patient_id, reason, assigned_doctor_id, status)
  values (v_org, v_pat, 'DWFU leave', v_doc, 'open') returning id into v_leave;
  alter table public.escalations disable trigger escalations_enforce_state_rules;
  update public.escalations set status = 'monitoring', status_note = 'Watching readings', monitor_until = now() - interval '1 minute' where id = v_leave;
  alter table public.escalations enable trigger escalations_enforce_state_rules;
  perform private.return_due_escalation_monitoring();
  if exists (select 1 from public.notifications where source_id = v_leave and recipient_id = v_doc) then raise exception 'FAIL 3b: the doctor on leave was told'; end if;
  if not exists (select 1 from public.notifications where source_id = v_leave and recipient_id = v_cmo) then raise exception 'FAIL 3b: the CMO was not told about a case whose doctor is on leave'; end if;

  -- 3c. nobody to tell: an ops incident, not silence
  update public.clinical_staff set active = false where profile_id = v_cmo;
  delete from public.ops_incidents where external_reference = 'escalation_monitoring_return_notify_failed';
  insert into public.escalations (organisation_id, patient_id, reason, assigned_doctor_id, status)
  values (v_org, v_pat, 'DWFU orphan', v_doc, 'open') returning id into v_orphan;
  alter table public.escalations disable trigger escalations_enforce_state_rules;
  alter table public.escalations disable trigger escalations_enforce_reassignment_authority;
  update public.escalations set status = 'monitoring', status_note = 'Watching readings', monitor_until = now() - interval '1 minute', assigned_doctor_id = null where id = v_orphan;
  alter table public.escalations enable trigger escalations_enforce_reassignment_authority;
  alter table public.escalations enable trigger escalations_enforce_state_rules;
  perform private.return_due_escalation_monitoring();
  if (select status from public.escalations where id = v_orphan) <> 'under_review' then raise exception 'FAIL 3c: the orphan case did not return'; end if;
  if not exists (select 1 from public.ops_incidents where external_reference = 'escalation_monitoring_return_notify_failed' and status not in ('resolved', 'closed')) then
    raise exception 'FAIL 3c: nobody could be told and no incident was raised';
  end if;
  update public.clinical_staff set active = true where profile_id = v_cmo;

  -- 4. no staff delete
  insert into ids values ('held', v_held);
  foreach v_payload in array array[jsonb_build_object('k', 'doc'), jsonb_build_object('k', 'coord')] loop
    perform set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k = v_payload ->> 'k'), 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_failed := false;
    begin
      delete from public.escalations where id = v_held;
      get diagnostics v_n = row_count;
      v_failed := v_n = 0;
    exception when insufficient_privilege then v_failed := true; end;
    execute 'reset role';
    if not v_failed then raise exception 'FAIL 4: % deleted an escalation', v_payload ->> 'k'; end if;
  end loop;
  if not exists (select 1 from public.escalations where id = v_held) then raise exception 'FAIL 4b: the escalation is gone'; end if;

  -- SABOTAGE: the old policy and grant let a coordinator delete, so check 4 discriminates
  grant delete on public.escalations to authenticated;
  create policy dwfu_sabotage_delete on public.escalations for delete to authenticated using (private.is_org_staff(organisation_id));
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k = 'coord'), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from public.escalations where id = v_held;
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n <> 1 then raise exception 'FAIL SABOTAGE: with the old policy restored the coordinator still could not delete (% rows), so check 4 proves nothing', v_n; end if;

  raise notice 'dw follow-ups: all checks and the sabotage passed';
end $$;

rollback;
