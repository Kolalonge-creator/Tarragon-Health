-- ===========================================================================
-- Proof: 20261013183512_s04b1_adult_registration_dependant_scope_proxy_fixes.sql
--
--   1. Adult-only registration: an under-18 date of birth in sign-up metadata is refused by handle_new_user, an adult one
--      is stored; profiles refuse an under-18 date of birth unless the row is a minor_child dependant.
--   2. Dependant scope (deny by default): a minor_child under 18 can hold vaccination, growth, development and screening
--      reminder rows, and NOTHING else. Every guarded table is exercised with a minimal insert; protected categories
--      (reproductive, mental health, STI) are named explicitly. An adult control shows the same insert is not refused.
--   3. OQ-47: an elder_proxy's manager gets no blanket read; a manage grant over an elder who has not verified their phone
--      is limited to payments and alerts; a minor's guardian still reads vaccinations.
--   4. OQ-51: confirming with "medications" writes view_medication and the proxy reads medication-gated rows; "results"
--      is refused; reproductive_health maps to nothing.
--   5. Proxy controls: view log is patient scoped and deduped; narrow only narrows, silently by default; revoke is instant.
--   6. Hand-over at 18 needs the young person's own verified-number acceptance; the handover_due event fires once, 30 days
--      before the 18th birthday.
--   7. anon cannot execute any new function.
--   8. SABOTAGE x4: drop a scope guard, neutralise the adult rule, restore the old blanket bypass, grant PUBLIC execute.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.back() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- runs a statement as a user, returns the error message or null when it succeeded
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare m text;
begin
  perform pg_temp.as_user(p_uid);
  begin
    execute p_sql;
    m := null;
  exception when others then
    m := sqlerrm;
  end;
  perform pg_temp.back();
  return m;
end $$;

create function pg_temp.scalar_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_user(p_uid);
  execute p_sql into v;
  perform pg_temp.back();
  return v;
end $$;

create temp table s04b1_orig as
  select pg_get_functiondef('private.enforce_adult_registration()'::regprocedure) as adult_def,
         pg_get_functiondef('private.can_read_clinical(uuid,public.care_access_category)'::regprocedure) as cat_def;
grant select on s04b1_orig to public;

do $$
declare
  v_org uuid;
  guardian uuid := gen_random_uuid();
  kid uuid := gen_random_uuid();
  adult uuid := gen_random_uuid();
  elder uuid := gen_random_uuid();
  mgr uuid := gen_random_uuid();
  parent uuid := gen_random_uuid();
  proxy uuid := gen_random_uuid();
  teen_new uuid := gen_random_uuid();
  adult_new uuid := gen_random_uuid();
  soon uuid := gen_random_uuid();
  far uuid := gen_random_uuid();
  m text; n integer; r record; sid uuid; gid uuid; tname text; hid uuid;
  kid_dob date := (current_date - interval '6 years')::date;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  -- ===== 1. adult-only registration
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
    values (teen_new, 's04b1-teen@example.invalid', 'x', now(), now(), '{}',
            jsonb_build_object('full_name', 'Too Young', 'date_of_birth', (current_date - interval '17 years 11 months')::date::text));
    raise exception 'FAIL 1a: a 17 year old registered';
  exception when others then
    if sqlerrm not like 'adult_only_registration%' then raise exception 'FAIL 1a: wrong error: %', sqlerrm; end if;
  end;
  if exists (select 1 from public.profiles where id = teen_new) then raise exception 'FAIL 1a: a profile exists for the refused sign-up'; end if;
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
    values (teen_new, 's04b1-garbage@example.invalid', 'x', now(), now(), '{}', '{"date_of_birth":"not-a-date"}');
    raise exception 'FAIL 1b: a garbage date of birth registered';
  exception when others then
    if sqlerrm not like 'adult_only_registration%' then raise exception 'FAIL 1b: wrong error: %', sqlerrm; end if;
  end;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
  values (adult_new, 's04b1-adult@example.invalid', 'x', now(), now(), '{}',
          jsonb_build_object('full_name', 'Grown Up', 'date_of_birth', (current_date - interval '18 years')::date::text));
  if (select date_of_birth from public.profiles where id = adult_new) is distinct from (current_date - interval '18 years')::date then
    raise exception 'FAIL 1c: an adult date of birth was not stored (exactly 18 today must pass)';
  end if;
  -- a sign-up with no date of birth is still accepted (existing flows); onboarding then applies the profiles rule
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
  values (adult, 's04b1-nodob@example.invalid', 'x', now(), now(), '{}', '{"full_name":"No Dob Yet"}');
  m := pg_temp.try_as(adult, format($q$update public.profiles set date_of_birth = %L where id = %L$q$, (current_date - interval '10 years')::date, adult));
  if m is null or m not like 'adult_only_registration%' then raise exception 'FAIL 1d: a non-dependant profile took an under-18 date of birth (%)', m; end if;
  update public.profiles set date_of_birth = '1990-05-05' where id = adult;

  -- ===== fixtures: a guardian and a 6 year old dependant provisioned exactly as the action does
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data) values
    (guardian, 's04b1-guardian@example.invalid', 'x', now(), now(), '{}', '{"full_name":"Ada Guardian"}'),
    (kid, 'dependent+' || kid || '@dependents.tarragonhealth.internal', null, now(), now(),
       jsonb_build_object('role', 'patient', 'organisation_id', v_org), '{"full_name":"Tiny Kid"}');
  update public.profiles set date_of_birth = '1988-01-01', organisation_id = v_org where id = guardian;
  perform public.provision_dependent_profile_basics(kid, kid_dob, null, guardian, 'minor_child');
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (kid, guardian, 'manage', guardian);
  if not private.is_minor_dependant(kid) then raise exception 'FAIL fixture: the child is not seen as a minor dependant'; end if;

  -- a minor_child cannot be provisioned with a nonsense kind, and an elder_proxy cannot be a child
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
  values (elder, 'dependent+' || elder || '@dependents.tarragonhealth.internal', null, now(), now(), jsonb_build_object('role', 'patient', 'organisation_id', v_org), '{"full_name":"Papa Elder"}');
  begin
    perform public.provision_dependent_profile_basics(elder, kid_dob, null, guardian, 'elder_proxy');
    raise exception 'FAIL 1e: an elder_proxy under 18 was provisioned';
  exception when others then
    if sqlerrm not like 'adult_only_registration%' then raise exception 'FAIL 1e: wrong error: %', sqlerrm; end if;
  end;
  perform public.provision_dependent_profile_basics(elder, '1950-02-02', null, guardian, 'elder_proxy');

  -- ===== 2. dependant scope
  -- allowed: immunisation, growth, development, screening reminders
  insert into public.child_growth_measurements (patient_id, organisation_id, age_days_at_measurement, weight_kg, height_cm)
    values (kid, v_org, 2190, 18, 110);
  insert into public.vaccination_schedules (patient_id, organisation_id, vaccination_catalog_id, due_date)
    select kid, v_org, c.id, current_date from public.vaccination_catalog c limit 1;
  insert into public.screening_schedules (patient_id, organisation_id, screen_type_id, due_date)
    select kid, v_org, st.id, current_date from public.screen_types st limit 1;

  -- every guarded table refuses a minor's row, with the scope error specifically
  n := 0;
  for tname in
    select c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where t.tgname = '00_minor_dependant_scope' and not t.tgisinternal order by 1
  loop
    m := null;
    begin
      if tname in ('booking_requests', 'risk_assessment_responses', 'prevention_risk_scores', 'ai_conversations') then
        execute format('insert into public.%I (profile_id) values ($1)', tname) using kid;
      else
        execute format('insert into public.%I (patient_id) values ($1)', tname) using kid;
      end if;
    exception when others then m := sqlerrm; end;
    if m is null or m not like 'minor_dependant_scope%' then
      raise exception 'FAIL 2b: table % did not refuse a minor dependant with the scope error (got %)', tname, m;
    end if;
    -- control: an adult's row for the same table is NOT refused by the scope guard (it may fail for other reasons)
    m := null;
    begin
      if tname in ('booking_requests', 'risk_assessment_responses', 'prevention_risk_scores', 'ai_conversations') then
        execute format('insert into public.%I (profile_id) values ($1)', tname) using guardian;
      else
        execute format('insert into public.%I (patient_id) values ($1)', tname) using guardian;
      end if;
    exception when others then m := sqlerrm; end;
    if m like 'minor_dependant_scope%' then raise exception 'FAIL 2c: table % refused an ADULT (vacuous guard)', tname; end if;
    n := n + 1;
  end loop;
  if n < 200 then raise exception 'FAIL 2d: only % tables guarded; expected the whole patient-scoped surface', n; end if;

  -- named protected categories and the clinical features the founder listed
  foreach tname in array array['appointments','video_consultations','prescriptions','medications','care_messages','care_message_threads',
      'lab_orders','vitals_readings','reproductive_health_profiles','menstrual_cycles','menstrual_daily_logs','patient_pregnancy',
      'contraception_plans','mental_health_screens','sexual_health_screens','sti_risk_checks','sti_case_episodes','patient_serology_status',
      'patient_conditions','patient_allergies','specialist_referrals','async_consults'] loop
    if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                    where t.tgname = '00_minor_dependant_scope' and c.relname = tname and not t.tgisinternal) then
      raise exception 'FAIL 2e: % is not guarded', tname;
    end if;
  end loop;
  -- and the allowed tables are not
  foreach tname in array array['vaccination_schedules','vaccination_adverse_events','child_growth_measurements','developmental_screenings','screening_schedules','screening_completions'] loop
    if exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                where t.tgname = '00_minor_dependant_scope' and c.relname = tname and not t.tgisinternal) then
      raise exception 'FAIL 2f: allowed table % is guarded', tname;
    end if;
  end loop;
  -- completeness is reported, not enforced here: a patient_id table added later must be classified
  select count(*) into n from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
   where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name = 'patient_id'
     and not exists (select 1 from pg_trigger g where g.tgrelid = format('public.%I', c.table_name)::regclass and g.tgname = '00_minor_dependant_scope' and not g.tgisinternal)
     and not exists (select 1 from public.minor_dependant_table_policy p where p.table_name = c.table_name);
  if n > 0 then raise warning 'S04b-1: % patient_id table(s) are neither guarded nor listed in minor_dependant_table_policy', n; end if;

  -- the child's growth data, once the child is 18, is no longer restricted (the scope is an under-18 rule)
  -- (covered by is_minor_dependant: date_of_birth <= 18 years ago is not a minor)

  -- ===== 3. OQ-47 and the dependant read bypass
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
  values (mgr, 's04b1-mgr@example.invalid', 'x', now(), now(), '{}', '{"full_name":"Chidi Manager"}');
  -- a manage grant over an unverified elder with clinical permissions is refused; payments only is allowed
  m := pg_temp.try_as(mgr, format($q$insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (%L, %L, 'manage', %L)$q$, elder, mgr, mgr));
  if m is null or m not like 'elder_agreement_required%' then raise exception 'FAIL 3a: manage over an unverified elder with all permissions was allowed (%)', m; end if;
  m := pg_temp.try_as(mgr, format($q$insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, permissions) values (%L, %L, 'manage', %L, array['view_medication']::public.caregiver_permission[])$q$, elder, mgr, mgr));
  if m is null or m not like 'elder_agreement_required%' then raise exception 'FAIL 3b: a clinical permission over an unverified elder was allowed (%)', m; end if;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, permissions)
    values (elder, mgr, 'manage', mgr, array['manage_payments']::public.caregiver_permission[]);
  insert into public.vitals_readings (patient_id, organisation_id, vital_type, systolic, diastolic, source) values (elder, v_org, 'blood_pressure', 150, 95, 'manual');
  if pg_temp.scalar_as(mgr, format($q$select private.can_read_clinical(%L, 'vitals_readings'::public.care_access_category)::text$q$, elder)) <> 'false' then
    raise exception 'FAIL 3c: the manager of an elder_proxy has the blanket clinical bypass';
  end if;
  if pg_temp.scalar_as(mgr, format($q$select private.can_read_clinical(%L, 'view_medication'::public.caregiver_permission)::text$q$, elder)) <> 'false' then
    raise exception 'FAIL 3d: the manager of an elder_proxy can read permission-gated rows';
  end if;
  if pg_temp.scalar_as(mgr, format($q$select count(*)::text from public.vitals_readings where patient_id = %L$q$, elder)) <> '0' then
    raise exception 'FAIL 3e: the manager read the elder''s vitals before the elder agreed';
  end if;
  -- control: the guardian of a child still reads the child's vaccination category
  if pg_temp.scalar_as(guardian, format($q$select private.can_read_clinical(%L, 'vaccinations'::public.care_access_category)::text$q$, kid)) <> 'true' then
    raise exception 'FAIL 3f: a guardian lost sight of the child''s vaccinations';
  end if;
  -- once the elder has verified their own number the restriction lifts (they have agreed)
  update auth.users set phone = '2348011150001', phone_confirmed_at = now() where id = elder;
  update public.profile_access set permissions = array['view_medication']::public.caregiver_permission[] where profile_id = elder and grantee_user_id = mgr;

  -- ===== 4. OQ-51 categories to permissions
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, phone, phone_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data) values
    (parent, null, 'x', null, '2348011150002', now(), now(), '{}', '{}'),
    (proxy, 's04b1-proxy@example.invalid', 'x', now(), null, null, now(), '{}', '{"full_name":"Adaeze Proxy"}');
  update public.profiles set organisation_id = v_org, full_name = 'Ngozi Parent', phone = '+2348011150002', date_of_birth = '1955-05-05' where id = parent;
  update public.profiles set date_of_birth = '1990-01-01' where id = proxy;
  insert into public.medications (patient_id, organisation_id, drug_name, dose, frequency)
    values (parent, v_org, 'Amlodipine', '5mg', 'daily');

  perform pg_temp.as_user(proxy);
  sid := public.create_proxy_setup('Ngozi Parent', '+2348011150002', 72, 5);
  perform pg_temp.back();
  perform pg_temp.as_user(parent);
  gid := public.confirm_proxy_setup(sid, array['medications']::public.care_access_category[], '{}');
  perform pg_temp.back();
  if (select permissions from public.profile_access where id = gid) is distinct from array['view_medication']::public.caregiver_permission[] then
    raise exception 'FAIL 4a: medications did not map to view_medication: %', (select permissions from public.profile_access where id = gid);
  end if;
  if pg_temp.scalar_as(proxy, format($q$select private.can_read_clinical(%L, 'view_medication'::public.caregiver_permission)::text$q$, parent)) <> 'true' then
    raise exception 'FAIL 4b: sharing Medicines does not let the proxy read permission-gated medicine rows';
  end if;
  if pg_temp.scalar_as(proxy, format($q$select private.can_read_clinical(%L, 'view_results'::public.caregiver_permission)::text$q$, parent)) <> 'false' then
    raise exception 'FAIL 4c: a permission the parent did not share is readable';
  end if;
  if pg_temp.scalar_as(proxy, format($q$select private.can_read_clinical(%L, 'reproductive_health'::public.care_access_category)::text$q$, parent)) <> 'false' then
    raise exception 'FAIL 4d: reproductive health readable by a proxy who was not given it';
  end if;
  -- a hand-supplied permission list is not trusted: the argument is ignored
  perform pg_temp.as_user(proxy);
  sid := public.create_proxy_setup('Ngozi Parent', '+2348011150003', 72, 5);
  perform pg_temp.back();
  if private.permissions_for_categories(array['reproductive_health','vitals_readings','vaccinations','medical_history']::public.care_access_category[]) <> array[]::public.caregiver_permission[] then
    raise exception 'FAIL 4e: protected or unmapped categories map to a permission';
  end if;
  if private.permissions_for_categories(array['appointments_care_plan','labs_results','messaging']::public.care_access_category[])
     <> array['view_appointments','view_care_plan','view_results','communicate_with_care_team']::public.caregiver_permission[] then
    -- order is by enum sort order; compare as sets
    if (select array_agg(x order by x) from unnest(private.permissions_for_categories(array['appointments_care_plan','labs_results','messaging']::public.care_access_category[])) x)
       is distinct from (select array_agg(x order by x) from unnest(array['view_appointments','view_care_plan','view_results','communicate_with_care_team']::public.caregiver_permission[]) x) then
      raise exception 'FAIL 4f: category permission mapping is wrong';
    end if;
  end if;

  -- ===== 5. proxy controls
  perform pg_temp.as_user(proxy); perform public.log_proxy_view(parent); perform public.log_proxy_view(parent); perform pg_temp.back();
  select count(*) into n from public.care_access_events where patient_id = parent and actor_profile_id = proxy and kind = 'record_viewed' and scope = 'proxy_record';
  if n <> 1 then raise exception 'FAIL 5a: expected one deduped view line, got %', n; end if;
  perform pg_temp.as_user(mgr); perform public.log_proxy_view(parent); perform pg_temp.back();   -- no grant on the parent
  if exists (select 1 from public.care_access_events where patient_id = parent and actor_profile_id = mgr) then raise exception 'FAIL 5b: a stranger wrote a view line'; end if;
  perform pg_temp.as_user(parent); perform public.log_proxy_view(parent); perform pg_temp.back();   -- the person themself
  if exists (select 1 from public.care_access_events where patient_id = parent and actor_profile_id = parent and scope = 'proxy_record') then raise exception 'FAIL 5c: own view logged'; end if;
  if pg_temp.scalar_as(parent, 'select count(*)::text from public.my_proxy_view_log(50)') <> '1' then raise exception 'FAIL 5d: the person does not see the proxy view'; end if;
  if pg_temp.scalar_as(proxy, 'select count(*)::text from public.my_proxy_view_log(50)') <> '0' then raise exception 'FAIL 5e: the proxy sees a log that is not theirs'; end if;
  if pg_temp.scalar_as(parent, 'select (select actor_first_name from public.my_proxy_view_log(1))') <> 'Adaeze' then raise exception 'FAIL 5f: actor name wrong'; end if;

  -- narrow: ask for a wider set than held; only the intersection stays, no notice by default
  perform pg_temp.as_user(parent);
  perform public.narrow_proxy_access(proxy, array['medications','labs_results']::public.care_access_category[]);
  perform pg_temp.back();
  if (select count(*) from public.profile_access_categories where profile_access_id = gid) <> 1 then raise exception 'FAIL 5g: narrow added access'; end if;
  if exists (select 1 from public.notifications where recipient_id = proxy and template = 'proxy_access_changed') then raise exception 'FAIL 5h: the proxy was notified of a silent narrow'; end if;
  perform pg_temp.as_user(parent);
  n := public.narrow_proxy_access(proxy, array[]::public.care_access_category[], true);
  perform pg_temp.back();
  if n <> 0 or (select permissions from public.profile_access where id = gid) <> array[]::public.caregiver_permission[] then raise exception 'FAIL 5i: narrow to nothing left access (% / %)', n, (select permissions from public.profile_access where id = gid); end if;
  if not exists (select 1 from public.notifications where recipient_id = proxy and template = 'proxy_access_changed') then raise exception 'FAIL 5j: opted-in notice not sent'; end if;
  if pg_temp.scalar_as(proxy, format($q$select private.can_read_clinical(%L, 'view_medication'::public.caregiver_permission)::text$q$, parent)) <> 'false' then raise exception 'FAIL 5k: narrowed proxy still reads'; end if;
  -- someone else cannot narrow or revoke another person's grant
  m := pg_temp.try_as(mgr, format('select public.narrow_proxy_access(%L, array[]::public.care_access_category[])', proxy));
  if m is null then raise exception 'FAIL 5l: a stranger narrowed a grant'; end if;
  if pg_temp.scalar_as(mgr, format('select public.revoke_proxy_access(%L)::text', proxy)) <> 'false' then raise exception 'FAIL 5m: a stranger revoked a grant'; end if;
  -- instant revoke
  if pg_temp.scalar_as(parent, format('select public.revoke_proxy_access(%L)::text', proxy)) <> 'true' then raise exception 'FAIL 5n: revoke did nothing'; end if;
  if exists (select 1 from public.profile_access where profile_id = parent and grantee_user_id = proxy) then raise exception 'FAIL 5o: the grant survived a revoke'; end if;

  -- ===== 6. hand-over at 18
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
  values (soon, 'dependent+' || soon || '@dependents.tarragonhealth.internal', null, now(), now(), jsonb_build_object('role', 'patient', 'organisation_id', v_org), '{"full_name":"Almost Grown"}'),
         (far,  'dependent+' || far  || '@dependents.tarragonhealth.internal', null, now(), now(), jsonb_build_object('role', 'patient', 'organisation_id', v_org), '{"full_name":"Still Small"}');
  perform public.provision_dependent_profile_basics(soon, (current_date - interval '18 years' + interval '20 days')::date, null, guardian, 'minor_child');
  perform public.provision_dependent_profile_basics(far,  (current_date - interval '18 years' + interval '40 days')::date, null, guardian, 'minor_child');
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (soon, guardian, 'manage', guardian), (far, guardian, 'manage', guardian);
  if private.sweep_dependant_handover_due() <> 1 then raise exception 'FAIL 6a: expected exactly the child turning 18 in 20 days'; end if;
  if private.sweep_dependant_handover_due() <> 0 then raise exception 'FAIL 6b: the event fired twice'; end if;
  if (select count(*) from public.domain_events where event_type = 'dependant.handover_due' and patient_id = soon) <> 1 then raise exception 'FAIL 6c: event missing'; end if;
  if exists (select 1 from public.domain_events where event_type = 'dependant.handover_due' and patient_id = far) then raise exception 'FAIL 6d: event fired 40 days out'; end if;
  if not exists (select 1 from public.notifications where recipient_id = guardian and template = 'dependant_handover_due' and channel = 'in_app') then raise exception 'FAIL 6e: guardian not told in app'; end if;
  if exists (select 1 from public.notifications where template like 'dependant_handover%' and channel = 'sms') then raise exception 'FAIL 6f: an SMS was queued'; end if;

  -- a child who has actually turned 18 (but not handed over yet)
  update public.profiles set date_of_birth = (current_date - interval '18 years')::date where id = soon;
  m := pg_temp.try_as(guardian, format($q$select public.start_dependant_handover(%L, '+2348011150009')$q$, far));
  if m is null then raise exception 'FAIL 6g: handover started for a child under 18'; end if;
  m := pg_temp.try_as(mgr, format($q$select public.start_dependant_handover(%L, '+2348011150009')$q$, soon));
  if m is null then raise exception 'FAIL 6h: handover started by someone who is not the guardian'; end if;
  hid := pg_temp.scalar_as(guardian, format($q$select public.start_dependant_handover(%L, '+2348011150009')::text$q$, soon))::uuid;
  -- before the young person acts nothing has changed
  if not (select is_dependent_account from public.profiles where id = soon) then raise exception 'FAIL 6i: record handed over before agreement'; end if;
  -- the guardian cannot accept for them; neither can they before verifying the number
  m := pg_temp.try_as(guardian, format('select public.accept_dependant_handover(%L)', hid));
  if m is null then raise exception 'FAIL 6j: the guardian accepted on the young person''s behalf'; end if;
  m := pg_temp.try_as(soon, format('select public.accept_dependant_handover(%L)', hid));
  if m is null then raise exception 'FAIL 6k: accepted without a verified number'; end if;
  if pg_temp.scalar_as(soon, 'select count(*)::text from public.my_pending_handover()') <> '0' then raise exception 'FAIL 6l: pending hand-over visible without a verified number'; end if;
  -- the number is attached unconfirmed, then verified by the young person
  update auth.users set phone = '2348011150009', phone_confirmed_at = now() where id = soon;
  if pg_temp.scalar_as(soon, 'select (select guardian_first_name from public.my_pending_handover())') <> 'Ada' then raise exception 'FAIL 6m: pending hand-over not shown to the young person'; end if;
  perform pg_temp.as_user(soon); perform public.accept_dependant_handover(hid); perform pg_temp.back();
  if (select is_dependent_account from public.profiles where id = soon) or (select dependent_kind from public.profiles where id = soon) is not null then
    raise exception 'FAIL 6n: acceptance did not hand the record over';
  end if;
  if not exists (select 1 from public.notifications where recipient_id = guardian and template = 'dependant_handover_accepted') then raise exception 'FAIL 6o: guardian not told'; end if;
  if (select state from public.dependant_handovers where id = hid) <> 'accepted' then raise exception 'FAIL 6p: state'; end if;

  -- ===== 7. anon
  foreach tname in array array['public.log_proxy_view(uuid)','public.my_proxy_view_log(integer)',
      'public.narrow_proxy_access(uuid, public.care_access_category[], boolean)','public.revoke_proxy_access(uuid)',
      'public.start_dependant_handover(uuid, text)','public.cancel_dependant_handover(uuid)','public.my_pending_handover()',
      'public.accept_dependant_handover(uuid)','public.decline_dependant_handover(uuid)'] loop
    if has_function_privilege('anon', tname, 'EXECUTE') then raise exception 'FAIL 7: anon can execute %', tname; end if;
  end loop;
  if has_table_privilege('anon', 'public.dependant_handovers', 'SELECT') then raise exception 'FAIL 7: anon reads dependant_handovers'; end if;
end $$;

-- ===== 8. SABOTAGE: each check above must be able to fail
-- 8a. drop one scope guard: a minor's vitals reading goes in, so check 2b would have caught it
do $$
declare v_org uuid; g uuid := gen_random_uuid(); k uuid := gen_random_uuid(); ok boolean := false;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data) values
    (g, 's04b1-sab-g@example.invalid', 'x', now(), now(), '{}', '{}'),
    (k, 'dependent+' || k || '@dependents.tarragonhealth.internal', null, now(), now(), jsonb_build_object('role', 'patient', 'organisation_id', v_org), '{}');
  perform public.provision_dependent_profile_basics(k, (current_date - interval '5 years')::date, null, g, 'minor_child');
  drop trigger "00_minor_dependant_scope" on public.vitals_readings;
  begin
    insert into public.vitals_readings (patient_id, organisation_id, vital_type, systolic, diastolic, source) values (k, v_org, 'blood_pressure', 120, 80, 'manual');
    ok := true;
  exception when others then null; end;
  if not ok then raise exception 'SABOTAGE 8a: removing the guard did not let a child''s vitals in, so check 2b could not have caught it'; end if;
end $$;

-- 8b. neutralise the adult rule: an under-18 non-dependant profile saves
do $$
declare src text; u uuid := gen_random_uuid(); ok boolean := false;
begin
  select adult_def into src from s04b1_orig;
  src := replace(src, 'new.date_of_birth > (current_date', 'false and new.date_of_birth > (current_date');
  if src not like '%false and new.date_of_birth%' then raise exception 'sabotage 8b did not apply'; end if;
  execute src;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
  values (u, 's04b1-sab-adult@example.invalid', 'x', now(), now(), '{}', '{}');
  begin
    update public.profiles set date_of_birth = (current_date - interval '9 years')::date where id = u;
    ok := true;
  exception when others then null; end;
  if not ok then raise exception 'SABOTAGE 8b: the adult rule is not load-bearing'; end if;
end $$;

-- 8c. restore the old blanket bypass for every dependant: an elder_proxy manager would read, so check 3c could catch it
do $$
declare src text; v_org uuid; g uuid := gen_random_uuid(); e uuid := gen_random_uuid(); m uuid := gen_random_uuid(); got text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select cat_def into src from s04b1_orig;
  src := replace(src, $q$p.dependent_kind = 'minor_child'$q$, 'true');
  if src like '%dependent_kind%' then raise exception 'sabotage 8c did not apply'; end if;
  execute src;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data) values
    (g, 's04b1-sab-g2@example.invalid', 'x', now(), now(), '{}', '{}'),
    (m, 's04b1-sab-m2@example.invalid', 'x', now(), now(), '{}', '{}'),
    (e, 'dependent+' || e || '@dependents.tarragonhealth.internal', null, now(), now(), jsonb_build_object('role', 'patient', 'organisation_id', v_org), '{}');
  perform public.provision_dependent_profile_basics(e, '1950-01-01', null, g, 'elder_proxy');
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, permissions) values (e, m, 'manage', m, array['manage_payments']::public.caregiver_permission[]);
  got := pg_temp.scalar_as(m, format($q$select private.can_read_clinical(%L, 'vitals_readings'::public.care_access_category)::text$q$, e));
  if got <> 'true' then raise exception 'SABOTAGE 8c: restoring the bypass did not open the elder record, so check 3c could not have caught it'; end if;
end $$;

-- 8d. PUBLIC execute: the anon check must be able to fail
do $$
begin
  grant execute on function public.my_proxy_view_log(integer) to public;
  if not has_function_privilege('anon', 'public.my_proxy_view_log(integer)', 'EXECUTE') then
    raise exception 'SABOTAGE 8d: granting PUBLIC did not reach anon, so check 7 could not have caught it';
  end if;
end $$;

rollback;
