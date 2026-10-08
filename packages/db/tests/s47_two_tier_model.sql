-- S47e proof: the two-tier model (migration *_s47e_two_tier_model_bundles_and_membership_price.sql). One rolled-back transaction.
-- FREE = technology only. MEMBER = 120,000 naira a year: one annual blood test + a doctor about monthly. BOTH get preventive alerts.
-- Proves:
--   1. The screening tiers and annual-health-check bundles are legacy: guidance_only, not self-bookable, and a trigger refuses to make one purchasable again.
--      No sellable bundle (active, not guidance_only, bookable) is legacy; every sellable bundle has a price above zero and a non-empty, known test list.
--   2. No bundle contents and no bundle description promise imaging (ultrasound, breast imaging, mammography); the Comprehensive screen lost its imaging tests.
--   3. The Membership price is a new catalogue version at 12,000,000 kobo, the 10,000,000 version is CLOSED not edited, and exactly one version is open.
--   4. The annual panel (membership_annual, S27g) is reported as it is: it contains HIV, HBsAg and hepatitis C antibody. That is a documented mismatch with the CMO's
--      risk-based decision, recorded as OQ-S47-14 for the CMO, not changed here.
--   5. PREVENTIVE ALERTS ARE NOT GATED: the screening and immunisation reminder and calendar functions consult no plan, entitlement, membership or purchase; a patient
--      with no membership at all gets a due-screening reminder.
--   6. SABOTAGE: the legacy trigger dropped, a plan check slipped into the reminder function, and the old price put back as the open version.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.sqlstate_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.as_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.state_as_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_sex text default 'female', p_age integer default 45) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's46-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex, is_test)
  values (v, p_org, p_role::public.user_role, 'S46 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - make_interval(years => p_age, days => 30))::date, p_sex::public.sex, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone,
     date_of_birth = excluded.date_of_birth, sex = excluded.sex;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician', 'male', 40);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S46 ' || p_label, 'MDCN', 'S46-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true)
  returning id into s;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
  values (p_org, s, 'result_review', p_admin, true);
  return v;
end $f$;
create function pg_temp.go_real(p_uid uuid) returns void language sql as $$ update public.profiles set is_test = false where id = p_uid $$;
create function pg_temp.guards_on(p_keys text[]) returns void language plpgsql as
$f$ begin
  execute format($q$create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
    as $b$select p_key = any (%L::text[])$b$$q$, p_keys);
end $f$;
create function pg_temp.mkpatient(p_label text, p_with_doc boolean default true) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  v := pg_temp.mkuser(pg_temp.f('org'), p_label, 'patient', 'female', 45);
  if p_with_doc then
    insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id) values (pg_temp.f('org'), v, pg_temp.f('doc'), pg_temp.f('doc'));
  end if;
  return v;
end $f$;
create function pg_temp.sresult(p_pat uuid, p_code text, p_status text, p_age interval) returns void language sql as
$$ insert into public.screening_results (organisation_id, patient_id, screen_type_code, result_status, created_at)
   values (pg_temp.f('org'), p_pat, p_code, p_status::public.result_status, now() - p_age) $$;
create function pg_temp.scomp(p_pat uuid, p_code text, p_age interval) returns void language sql as
$$ insert into public.screening_completions (organisation_id, patient_id, screen_type_id, performed_date)
   values (pg_temp.f('org'), p_pat, (select id from public.screen_types where code = p_code), (now() - p_age)::date) $$;
create function pg_temp.excl(p_pat uuid, p_code text) returns text language sql as
$$ select coalesce((select e ->> 'reason' from jsonb_array_elements(private.compute_screening_order_exclusions(p_pat, pg_temp.f('org'), array[p_code])) e limit 1), 'none') $$;
-- one released lab result, items as jsonb [{code,num|text,unit,low,high,flag,sens}]
create function pg_temp.mkresult(p_pat uuid, p_released_at timestamptz, p_items jsonb) returns uuid language plpgsql as
$f$ declare v uuid; i jsonb; v_sens boolean;
begin
  v_sens := exists (select 1 from jsonb_array_elements(p_items) x where coalesce((x ->> 'sens')::boolean, false));
  insert into public.lab_results (organisation_id, patient_id, panel_code, panel_version_id, source, submitted_by_kind, release_state, received_at, is_test)
  values (pg_temp.f('org'), p_pat, 'membership_annual', (select id from public.lab_panel_versions where panel_code = 'membership_annual' and is_active),
          'portal_entry', 'partner', case when v_sens then 'clinician_disclosure_required' else 'awaiting_review' end, p_released_at - interval '1 day', true)
  returning id into v;
  for i in select * from jsonb_array_elements(p_items) loop
    insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, value_text, unit, ref_low, ref_high, flag, sensitive_positive, is_test)
    values (v, pg_temp.f('org'), p_pat, i ->> 'code', (i ->> 'num')::numeric, i ->> 'text', coalesce(i ->> 'unit', 'mg/dL'),
            (i ->> 'low')::numeric, (i ->> 'high')::numeric, i ->> 'flag', coalesce((i ->> 'sens')::boolean, false), true);
  end loop;
  update public.lab_results set release_state = 'released', released_at = p_released_at, reviewed_by = pg_temp.f('doc'),
         disclosure_attested = v_sens, disclosure_method = case when v_sens then 'in_person' end
   where id = v;
  return v;
end $f$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', 'male', 40);
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin));
  -- S46c: the sign-off task is offered to an employed named doctor first; a contracted one pulls from the pool with an availability block
  update public.clinical_staff set employment_type = 'employed', indemnity_exempt = false, indemnity_exempt_by = null where profile_id = pg_temp.f('doc');
  perform pg_temp.setf('stranger', pg_temp.mkdoc(v_org, 'stranger', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('cc', pg_temp.mkdoc(v_org, 'cc', 'care_coordinator', v_admin));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id, care_coordinator_id)
    select v_org, pg_temp.mkuser(v_org, 'ccpat', 'patient', 'female', 45), pg_temp.f('doc'), pg_temp.f('doc'), pg_temp.f('cc');
  perform pg_temp.setf('pat', pg_temp.mkpatient('pat'));
  perform pg_temp.setf('other', pg_temp.mkpatient('other'));
end $$;


create function pg_temp.sqlstate_as_owner(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
do $$
declare p uuid := pg_temp.mkpatient('free_user', false); v_org uuid := pg_temp.f('org'); n integer; st uuid; f text; v_item uuid;
  v_fns text[] := array['private.queue_screening_reminders()', 'private.queue_vaccination_reminders()', 'private.queue_vaccination_reminders_when_signed()',
                        'private.queue_preventive_review_reminders()', 'private.queue_preventive_care_plan_email_reminders()', 'private.run_screening_scheduler(uuid)',
                        'private.screening_due(uuid,uuid)', 'private.auto_enrol_preventive_programmes()'];
begin
  -- 1. legacy bundles
  perform pg_temp.ck('the seven legacy bundles are flagged, guidance only and not self-bookable', '7,0,0',
    (select count(*)::text from public.panel_bundles where legacy_tier) || ',' || (select count(*)::text from public.panel_bundles where legacy_tier and self_bookable) || ',' || (select count(*)::text from public.panel_bundles where legacy_tier and not guidance_only));
  perform pg_temp.ck('they include the four screens and the annual health check bundles', '7',
    (select count(*)::text from public.panel_bundles where legacy_tier and code in ('screen_essential', 'screen_core', 'screen_advanced', 'screen_comprehensive', 'annual_health_check', 'health_check_basic', 'health_check_comprehensive')));
  perform pg_temp.ck('a legacy bundle cannot be made bookable again', '23514', pg_temp.sqlstate_as_owner($q$update public.panel_bundles set self_bookable = true where code = 'screen_core'$q$));
  perform pg_temp.ck('...nor sellable (billable) again', '23514', pg_temp.sqlstate_as_owner($q$update public.panel_bundles set guidance_only = false where code = 'screen_core'$q$));
  perform pg_temp.ck('...nor can a new legacy bundle be created purchasable', '23514', pg_temp.sqlstate_as_owner($q$insert into public.panel_bundles (code, name, price_kobo, test_codes, legacy_tier, self_bookable, guidance_only) values ('x_legacy', 'x', 100, '{hba1c}', true, true, true)$q$));
  perform pg_temp.ck('no sellable bundle is legacy, and every sellable bundle has a price above zero and a non-empty test list', '0,0',
    (select count(*)::text from public.panel_bundles where is_active and not guidance_only and legacy_tier) || ',' ||
    (select count(*)::text from public.panel_bundles where is_active and not guidance_only and self_bookable and (price_kobo <= 0 or cardinality(test_codes) = 0)));
  perform pg_temp.ck('the S45 packages over the legacy bundles are switched off', '0',
    (select count(*)::text from public.screening_packages where code in ('essential', 'preventive', 'full_screen', 'annual_health_check') and is_active));
  -- 2. imaging
  perform pg_temp.ck('no bundle contains an imaging test', '0', (select count(*)::text from public.panel_bundles where test_codes && array['abdominal_ultrasound', 'breast_imaging', 'prostate_ultrasound', 'mammography']));
  perform pg_temp.ck('no bundle description promises imaging', '0', (select count(*)::text from public.panel_bundles where description ~* '(ultrasound|imaging|mammogra|sonograph)'));
  perform pg_temp.ck('the legacy descriptions say the annual blood test is part of Membership', '7',
    (select count(*)::text from public.panel_bundles where legacy_tier and description like '%annual blood test is part of Tarragon Membership%'));
  -- 3. the price
  select id into v_item from public.catalog_items where code = 'membership_annual' limit 1;
  perform pg_temp.ck('Membership: one open price version, 12,000,000 kobo', '1,12000000', (select count(*)::text || ',' || min(amount_kobo)::text from public.prices where catalog_item_id = v_item and valid_to is null));
  perform pg_temp.ck('...the 10,000,000 version is closed, not edited or deleted', '1,true',
    (select count(*)::text || ',' || bool_and(valid_to is not null)::text from public.prices where catalog_item_id = v_item and amount_kobo = 10000000));
  perform pg_temp.ck('...and the version history is intact (two versions, nothing deleted)', '2', (select count(*)::text from public.prices where catalog_item_id = v_item));
  perform pg_temp.ck('...a price cannot be edited in place (the immutability trigger)', 'P0001', pg_temp.sqlstate_as_owner(format('update public.prices set amount_kobo = 1 where catalog_item_id = %L and valid_to is null', v_item)));
  -- 4. the annual panel, reported as it is
  perform pg_temp.ck('REPORT (OQ-S47-14): the annual panel contains HIV, HBsAg and hepatitis C antibody (3 analytes)', '3',
    (select count(*)::text from public.lab_panel_versions v, jsonb_array_elements(v.analytes) a where v.panel_code = 'membership_annual' and v.is_active and (a ->> 'code') in ('hiv_screen', 'hbsag', 'hcv_ab')));
  -- 5. preventive alerts are not gated
  foreach f in array v_fns loop
    perform pg_temp.ck('not gated by a plan, entitlement or membership: ' || f, 'false',
      (pg_get_functiondef(f::regprocedure) ~* '(patient_has_feature_access|entitlement|patient_memberships|subscription_plan|service_purchases|has_membership|is_member|current_plan)')::text);
  end loop;
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date)
    select v_org, p, st.id, 'pending', current_date + 2 from public.screen_types st where st.code = 'cervical_smear' limit 1;
  perform private.queue_screening_reminders();
  perform pg_temp.ck('a patient with NO membership and no plan gets a due-screening reminder', 'true',
    (exists (select 1 from public.notifications n where n.recipient_id = p and n.template ~ '^screening_')) :: text);
  perform pg_temp.setf('free', p);
end $$;

-- Sabotage ------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  drop trigger panel_bundles_legacy_never_purchasable on public.panel_bundles;
  update public.panel_bundles set self_bookable = true where code = 'screen_core';
  insert into results values ('sabotaged', 'they include the four screens and the annual health check bundles', '7', (select count(*)::text from public.panel_bundles where legacy_tier and self_bookable));
  insert into results values ('sabotaged', 'the seven legacy bundles are flagged, guidance only and not self-bookable', '7,0,0',
    (select count(*)::text from public.panel_bundles where legacy_tier) || ',' || (select count(*)::text from public.panel_bundles where legacy_tier and self_bookable) || ',' || (select count(*)::text from public.panel_bundles where legacy_tier and not guidance_only));
end $$;
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('private.queue_screening_reminders()'::regprocedure);
  v_def := replace(v_def, chr(10) || '$function$', chr(10) || '-- a plan check slipped in: patient_memberships' || chr(10) || '$function$');
  execute v_def;
  insert into results values ('sabotaged', 'not gated by a plan, entitlement or membership: private.queue_screening_reminders()', 'false',
    (pg_get_functiondef('private.queue_screening_reminders()'::regprocedure) ~* '(patient_has_feature_access|entitlement|patient_memberships|subscription_plan|service_purchases|has_membership|is_member|current_plan)')::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S47e proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
