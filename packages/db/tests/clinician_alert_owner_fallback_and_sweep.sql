-- Tarragon Health: an alert always gets an owner, and an unowned one is picked up later (2026-10-31)
--
--   1  fallback    an overdue_task alert (owner tier care_coordinator) in an organisation with no coordinator goes to the senior medical
--                  officer, not to nobody
--   2  last resort an abnormal_result alert in an organisation whose only doctor is the Chief Medical Officer goes to the CMO
--   3  load        with two senior medical officers the alerts are still spread across both (least-loaded)
--   4  sweep       an alert raised in an organisation with no staff stays unowned; once a doctor is added the sweep assigns it, a second
--                  run assigns nothing, and an alert that already had an owner is not moved
--   5  guard       a signed-in clinician who is not the CMO still cannot assign an alert to someone else (the system exemption did not
--                  open the rule)
--
-- Fixtures built here, wrapped in BEGIN/ROLLBACK, raises on failure.
-- Run: psql "$DATABASE_URL" -f packages/db/tests/clinician_alert_owner_fallback_and_sweep.sql

begin;

create temp table fx (k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'own-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'OWN ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_label text, p_tier text, p_verifier uuid) returns uuid
language plpgsql as $f$
declare v_profile uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v_profile, 'OWN ' || p_label, 'MDCN', 'OWN-' || substr(v_profile::text, 1, 8), true, 'active', now(), p_verifier,
      p_tier::public.doctor_tier, (case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end)::public.staff_employment_type,
      2, p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_verifier end, true)
  returning id into v_staff;
  insert into fx values (p_label || '_profile', v_profile);
  return v_staff;
end $f$;
create function pg_temp.mkalert(p_org uuid, p_patient uuid, p_type text) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.clinician_alerts (organisation_id, patient_id, level, title, type_code, status)
  values (p_org, p_patient, 'clinician_review', 'OWN test alert', p_type::public.alert_type_code, 'open') returning id into v;
  return v;
end $f$;
create function pg_temp.owner(p_alert uuid) returns uuid language sql as $$ select responsible_clinician_id from public.clinician_alerts where id = p_alert $$;

do $$
declare v_org uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists, the core migrations did not run'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  insert into fx values ('admin', v_admin);
  -- A: one senior medical officer, no coordinator.  B: only a CMO.  C: nobody (a doctor arrives later).  D: two senior medical officers.
  insert into public.organisations (name, type) values ('OWN org A', 'direct_consumer') returning id into v_a;
  insert into public.organisations (name, type) values ('OWN org B', 'direct_consumer') returning id into v_b;
  insert into public.organisations (name, type) values ('OWN org C', 'direct_consumer') returning id into v_c;
  insert into public.organisations (name, type) values ('OWN org D', 'direct_consumer') returning id into v_d;
  insert into fx values ('orgA', v_a), ('orgB', v_b), ('orgC', v_c), ('orgD', v_d);
  insert into fx values ('smoA', pg_temp.mkstaff(v_a, 'smoA', 'senior_medical_officer', v_admin));
  insert into fx values ('cmoB', pg_temp.mkstaff(v_b, 'cmoB', 'chief_medical_officer', v_admin));
  insert into fx values ('smoD1', pg_temp.mkstaff(v_d, 'smoD1', 'senior_medical_officer', v_admin));
  insert into fx values ('smoD2', pg_temp.mkstaff(v_d, 'smoD2', 'senior_medical_officer', v_admin));
  insert into fx values ('patA', pg_temp.mkuser(v_a, 'patA', 'patient')), ('patB', pg_temp.mkuser(v_b, 'patB', 'patient')),
                        ('patC', pg_temp.mkuser(v_c, 'patC', 'patient')), ('patD', pg_temp.mkuser(v_d, 'patD', 'patient'));
end $$;

-- ================================================================ 1 fallback
do $$
declare v uuid := pg_temp.mkalert(pg_temp.f('orgA'), pg_temp.f('patA'), 'overdue_task');
begin
  if pg_temp.owner(v) is distinct from pg_temp.f('smoA') then
    raise exception 'FAIL 1: an overdue_task alert with no coordinator in the organisation was not given to the senior medical officer (owner %)', pg_temp.owner(v);
  end if;
end $$;

-- ================================================================ 2 last resort: the CMO
do $$
declare v uuid := pg_temp.mkalert(pg_temp.f('orgB'), pg_temp.f('patB'), 'abnormal_result');
begin
  if pg_temp.owner(v) is distinct from pg_temp.f('cmoB') then
    raise exception 'FAIL 2: with only a CMO in the organisation the alert was not given to the CMO (owner %)', pg_temp.owner(v);
  end if;
end $$;

-- ================================================================ 3 still least-loaded
do $$
declare v1 uuid; v2 uuid;
begin
  v1 := pg_temp.mkalert(pg_temp.f('orgD'), pg_temp.f('patD'), 'abnormal_result');
  v2 := pg_temp.mkalert(pg_temp.f('orgD'), pg_temp.f('patD'), 'symptom_escalation');
  if pg_temp.owner(v1) is null or pg_temp.owner(v2) is null then
    raise exception 'FAIL 3: an alert in an organisation with two senior doctors got no owner';
  end if;
  if pg_temp.owner(v1) = pg_temp.owner(v2) then
    raise exception 'FAIL 3: two alerts in a row went to the same one of two equally free senior doctors';
  end if;
end $$;

-- ================================================================ 4 the sweep
do $$
declare v_unowned uuid; v_owned uuid; v_before uuid; n integer;
begin
  -- C has no staff, so this alert starts without an owner
  v_unowned := pg_temp.mkalert(pg_temp.f('orgC'), pg_temp.f('patC'), 'abnormal_result');
  if pg_temp.owner(v_unowned) is not null then raise exception 'FAIL 4: setup, the alert in the empty organisation already has an owner'; end if;
  insert into fx values ('unowned', v_unowned);

  perform private.assign_unowned_clinician_alerts();
  if pg_temp.owner(v_unowned) is not null then raise exception 'FAIL 4: the sweep invented an owner where nobody exists'; end if;

  -- a doctor arrives in C
  insert into fx values ('smoC', pg_temp.mkstaff(pg_temp.f('orgC'), 'smoC', 'senior_medical_officer', pg_temp.f('admin')));
  -- an alert that already has an owner, to prove the sweep leaves it alone
  v_owned := pg_temp.mkalert(pg_temp.f('orgA'), pg_temp.f('patA'), 'abnormal_result');
  v_before := pg_temp.owner(v_owned);
  if v_before is null then raise exception 'FAIL 4: setup, the control alert has no owner'; end if;

  n := private.assign_unowned_clinician_alerts();
  if pg_temp.owner(v_unowned) is distinct from pg_temp.f('smoC') then
    raise exception 'FAIL 4: after a doctor was added the sweep did not assign the waiting alert (owner %)', pg_temp.owner(v_unowned);
  end if;
  if (select assigned_at from public.clinician_alerts where id = v_unowned) is null then raise exception 'FAIL 4: the sweep did not stamp assigned_at'; end if;
  if pg_temp.owner(v_owned) is distinct from v_before then raise exception 'FAIL 4: the sweep moved an alert that already had an owner'; end if;
  if n < 1 then raise exception 'FAIL 4: the sweep reported % assigned, expected at least 1', n; end if;
  if exists (select 1 from public.clinician_alerts where id = v_unowned and status <> 'open') then raise exception 'FAIL 4: the sweep changed the status'; end if;

  if private.assign_unowned_clinician_alerts() <> 0 then raise exception 'FAIL 4: a second sweep assigned something again'; end if;
end $$;

-- ================================================================ 5 the guard still holds for a signed-in person
do $$
declare v uuid := pg_temp.mkalert(pg_temp.f('orgD'), pg_temp.f('patD'), 'abnormal_result'); v_other uuid; v_refused boolean := false;
begin
  -- hand the alert to the OTHER D doctor while signed in as D1, a senior doctor who is not the CMO
  v_other := case when pg_temp.owner(v) = pg_temp.f('smoD1') then pg_temp.f('smoD2') else pg_temp.f('smoD1') end;
  perform set_config('request.jwt.claim.sub', pg_temp.f('smoD1_profile')::text, true);
  -- if D1 already owns it, move it to D2; otherwise the target is D1 himself, which is allowed, so use D2 explicitly
  v_other := pg_temp.f('smoD2');
  begin
    update public.clinician_alerts set responsible_clinician_id = v_other where id = v and responsible_clinician_id is distinct from v_other;
    if not found then
      -- already owned by D2: move it to D1 while signed in as D2 instead, which is again someone else
      perform set_config('request.jwt.claim.sub', pg_temp.f('smoD2_profile')::text, true);
      update public.clinician_alerts set responsible_clinician_id = pg_temp.f('smoD1') where id = v;
    end if;
  exception when sqlstate '42501' then
    v_refused := true;
  end;
  perform set_config('request.jwt.claim.sub', '', true);
  if not v_refused then
    raise exception 'FAIL 5: a senior doctor who is not the CMO assigned an alert to someone else';
  end if;
end $$;

rollback;

select 'clinician_alert_owner_fallback_and_sweep: ok' as result;
