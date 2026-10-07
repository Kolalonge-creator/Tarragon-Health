-- S46 proof: pathway suppression override, hepatitis B immunity logic, INV-04 explainer guard, yearly Health Report
-- (migrations *_s46_results_serology_health_report.sql and *_s46b_*). One rolled-back transaction.
-- Proves:
--   1. 3.12 Serology rules: version 2 (spec rule) is the single active one, version 1 documents the old once-ever behaviour; HIV and hepatitis C stay
--      annual (a result inside the year is not due, one older than a year is); HBsAg is annual until immunity is recorded ONCE (a lab-flagged positive
--      anti-HBs, or a doctor with a stated basis), then it stops; a numeric titre alone never sets immunity while the CMO has not confirmed the threshold;
--      chronic HBV is never overwritten; the calendar (screening_due) and the order exclusions agree; pricing treats a not-due repeat as settled.
--   2. 3.11 Pathway coverage: every coverage row suppresses its item for a patient on that pathway; a tied doctor can override with a reason (audited,
--      expiring, revocable); a stranger, a care coordinator, an item no pathway owns and a patient are refused; an override never lifts a terminal state.
--   3. INV-04: no AI explanation row can exist for HIV or hepatitis B or C; explain_allowed is false for a released result holding a sensitive positive;
--      a sensitive positive from a package order is never auto-released and the patient cannot read it.
--   4. 3.15 Health Report: hidden until signed (RLS), only the service role builds a draft, only while its guard is on (a test patient passes), the honesty
--      guard refuses "on target" without data, a fourth priority, "optimal" or an age claim, and any HIV or hepatitis word; the collector never reads a
--      sensitive result or screening item; an AI draft lives only on an unsigned row and is wiped on signature (INV-11); a signed row cannot be changed;
--      a correction is a new version with a visible note; the queue and the read are tied to the care team and audited (INV-10, INV-12).
--   5. SABOTAGE: the active rule put back to version 1, the INV-04 trigger dropped, the patient policy opened to unsigned rows and the honesty guard
--      removed; the matching checks must flip.
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

-- 1. 3.12 Serology rules --------------------------------------------------------------------------------------------------------
do $$
declare p uuid; hbv uuid; ser text; docs uuid := pg_temp.f('doc'); v_item uuid;
begin
  perform pg_temp.ck('exactly one serology rule version is active', '1', (select count(*)::text from public.serology_rule_versions where status = 'active'));
  -- S47 (decision 8): version 3 (risk-based HIV and hepatitis C) replaced version 2 as the active rule; version 2 is kept as legacy
  perform pg_temp.ck('the active one is the S47 risk-based rule (version 3)', '3', (select version::text from public.serology_rule_versions where status = 'active'));
  perform pg_temp.ck('version 2 (annual for everyone) is kept as legacy', 'legacy', (select status from public.serology_rule_versions where version = 2));
  perform pg_temp.ck('version 1 documents the old once-ever behaviour and is kept', 'legacy',
    (select status from public.serology_rule_versions where version = 1 and config -> 'hep_b' ->> 'oncePerLifetime' = 'true' and config -> 'hep_c' ->> 'oncePerLifetime' = 'true'));
  perform pg_temp.ck('the anti-HBs threshold starts unconfirmed by the CMO', 'false', private.anti_hbs_threshold_confirmed()::text);

  -- HIV and hepatitis C stay annual (ACCEPTANCE, spec 3.12)
  p := pg_temp.mkpatient('hcv');
  perform pg_temp.ck('a fresh patient has nothing excluded for hiv, hep_b, hep_c', 'none,none,none',
    pg_temp.excl(p, 'hiv') || ',' || pg_temp.excl(p, 'hep_b') || ',' || pg_temp.excl(p, 'hep_c'));
  perform pg_temp.setf('rec_hcv', p);
  perform pg_temp.sresult(p, 'hep_c', 'normal', interval '2 months');
  perform pg_temp.sresult(p, 'hiv', 'normal', interval '2 months');
  perform pg_temp.ck('ACCEPTANCE: hepatitis C done 2 months ago is not due yet (annual interval)', 'repeat_not_due', split_part(pg_temp.excl(p, 'hep_c'), ':', 1));
  perform pg_temp.ck('ACCEPTANCE: HIV is unchanged by the new rule (no interval suppression)', 'none', pg_temp.excl(p, 'hiv'));
  p := pg_temp.mkpatient('hcv_old');
  perform pg_temp.sresult(p, 'hep_c', 'normal', interval '14 months');
  perform pg_temp.ck('ACCEPTANCE: hepatitis C older than a year is due again (it stays annual, no longer once-ever)', 'none', pg_temp.excl(p, 'hep_c'));
  perform pg_temp.ck('pricing: a not-due repeat is settled (not billed), a due one is billed', 'hep_c,hiv',
    (select array_to_string(private.patient_delivered_test_codes(p, pg_temp.f('org'), array['hep_c', 'hiv']), ',')));
  perform pg_temp.ck('pricing: the recent hepatitis C patient is not billed for it again', 'hiv',
    (select array_to_string(private.patient_delivered_test_codes(pg_temp.f('rec_hcv'), pg_temp.f('org'), array['hep_c', 'hiv']), ',')));
end $$;

-- 1b. Hepatitis B immunity ---------------------------------------------------------------------------------------------------------
do $$
declare p uuid; pc uuid; p3 uuid; p4 uuid; r text; v_cmo_staff uuid; v_doc uuid := pg_temp.f('doc');
begin
  p := pg_temp.mkpatient('hbv');
  perform pg_temp.setf('hbv', p);
  perform pg_temp.sresult(p, 'hep_b', 'normal', interval '14 months');
  perform pg_temp.ck('HBsAg older than a year is due again while no immunity is recorded', 'none', pg_temp.excl(p, 'hep_b'));
  perform pg_temp.mkresult(p, now() - interval '1 day', '[{"code":"anti_hbs","num":50,"unit":"mIU/mL","flag":"normal"}]'::jsonb);
  perform pg_temp.ck('a numeric anti-HBs titre alone never sets immunity while the CMO has not confirmed the threshold', 'hbv_negative',
    (select hbv_status::text from public.patient_serology_status where patient_id = p));
  perform pg_temp.mkresult(p, now(), '[{"code":"anti_hbs","text":"positive","unit":"none","flag":"positive"}]'::jsonb);
  perform pg_temp.ck('ACCEPTANCE: a positive anti-HBs records immunity once', 'immune',
    (select hbv_status::text from public.patient_serology_status where patient_id = p));
  perform pg_temp.ck('...with its basis and the lab item on the transition log', 'anti_hbs_positive',
    (select basis from public.serology_status_transitions where patient_id = p and to_status = 'immune'));
  perform pg_temp.ck('ACCEPTANCE: after immunity annual HBsAg stops (order exclusion)', 'terminal_serology_state', pg_temp.excl(p, 'hep_b'));
  perform pg_temp.ck('...and the calendar no longer lists hep_b as due', '0',
    (select count(*)::text from private.screening_due(p, (select id from public.screening_rule_sets where version = 2)) d where d.screen_type_code = 'hep_b'));
  perform pg_temp.ck('...while hepatitis C and HIV stay on the calendar for the same patient', '2',
    (select count(*)::text from private.screening_due(p, (select id from public.screening_rule_sets where version = 2)) d where d.screen_type_code in ('hep_c', 'hiv')));
  perform pg_temp.mkresult(p, now(), '[{"code":"anti_hbs","text":"positive","unit":"none","flag":"positive"}]'::jsonb);
  perform pg_temp.ck('immunity is recorded once: a second positive adds no second transition', '1',
    (select count(*)::text from public.serology_status_transitions where patient_id = p and to_status = 'immune'));
  perform pg_temp.ck('v1 rule set (S45) would still schedule hep_b only once; v2 carries the stop rule', 'true',
    ((select config from public.screening_rule_sets where version = 2) -> 'rules' @> '[{"code":"hep_b","oncePerLifetime":false,"frequencyMonths":12}]'::jsonb)::text);

  -- calendar for a patient with no immunity and an old result: hep_c and hep_b recur under v2, not under v1
  pc := pg_temp.mkpatient('cal');
  perform pg_temp.sresult(pc, 'hep_c', 'normal', interval '14 months');
  perform pg_temp.scomp(pc, 'hep_c', interval '14 months');
  perform pg_temp.ck('(control) the calendar sees the completion: nothing is first_due for hep_c', 'recurrence',
    (select d.reason from private.screening_due(pc, (select id from public.screening_rule_sets where version = 2)) d where d.screen_type_code = 'hep_c'));
  perform pg_temp.ck('calendar v2: hepatitis C done 14 months ago is due again', '1',
    (select count(*)::text from private.screening_due(pc, (select id from public.screening_rule_sets where version = 2)) d where d.screen_type_code = 'hep_c'));
  perform pg_temp.ck('calendar v1 (S45, once-ever copy): it is not', '0',
    (select count(*)::text from private.screening_due(pc, (select id from public.screening_rule_sets where version = 1)) d where d.screen_type_code = 'hep_c'));

  -- chronic HBV is never overwritten by an immune reading
  pc := pg_temp.mkpatient('chronic');
  perform pg_temp.sresult(pc, 'hep_b', 'abnormal', interval '1 month');
  perform pg_temp.mkresult(pc, now(), '[{"code":"anti_hbs","text":"positive","unit":"none","flag":"positive"}]'::jsonb);
  perform pg_temp.ck('a chronic HBV state is never overwritten by an anti-HBs positive', 'chronic_hbv',
    (select hbv_status::text from public.patient_serology_status where patient_id = pc));

  -- threshold confirmed by the CMO: only then does a numeric titre at or above it count
  p3 := pg_temp.mkpatient('thr');
  perform pg_temp.sresult(p3, 'hep_b', 'normal', interval '14 months');
  select cs.id into v_cmo_staff from public.clinical_staff cs where cs.profile_id = pg_temp.f('cmo');
  update public.serology_rule_versions set threshold_approved_by = v_cmo_staff, threshold_approved_at = now() where status = 'active';
  perform pg_temp.ck('(control) once the CMO confirms the threshold it reads as confirmed', 'true', private.anti_hbs_threshold_confirmed()::text);
  perform pg_temp.mkresult(p3, now(), '[{"code":"anti_hbs","num":50,"unit":"mIU/mL","flag":"normal"}]'::jsonb);
  -- S47 (decision 7): even a CMO-confirmed threshold does not let a numeric titre set immunity on its own. Only a laboratory flag or a doctor does.
  perform pg_temp.ck('S47: a titre above a CONFIRMED threshold still never sets immunity on its own', 'hbv_negative',
    (select hbv_status::text from public.patient_serology_status where patient_id = p3));
  perform pg_temp.mkresult(p3, now(), '[{"code":"anti_hbs","text":"positive","unit":"none","flag":"positive"}]'::jsonb);
  perform pg_temp.ck('(control) a laboratory-flagged positive does record immunity', 'immune',
    (select hbv_status::text from public.patient_serology_status where patient_id = p3));
  update public.serology_rule_versions set threshold_approved_by = null, threshold_approved_at = null where status = 'active';

  -- clinician records and clears immunity
  p4 := pg_temp.mkpatient('doc_imm');
  perform pg_temp.ck('a tied doctor records immunity with a basis', 'true',
    (pg_temp.q_as(v_doc, format('select (public.clinician_record_hbv_immunity(%L, ''vaccination_with_titre'', ''titre on card'') ->> ''changed'')', p4))));
  perform pg_temp.ck('...and the stored state is immune', 'immune', (select hbv_status::text from public.patient_serology_status where patient_id = p4));
  perform pg_temp.ck('...a second record changes nothing', 'false',
    (pg_temp.q_as(v_doc, format('select (public.clinician_record_hbv_immunity(%L, ''other'', ''again'') ->> ''changed'')', p4))));
  perform pg_temp.ck('...and it is audited', '1', (select count(*)::text from public.audit_log where action = 'serology.hbv_immunity_recorded' and entity_id = p4 and (event ->> 'changed') = 'true'));
  perform pg_temp.ck('a doctor with no tie to the patient is refused', '42501',
    pg_temp.sqlstate_as(pg_temp.f('stranger'), format('select public.clinician_record_hbv_immunity(%L, ''other'', ''x'')', p4)));
  perform pg_temp.ck('the care coordinator is refused', '42501',
    pg_temp.sqlstate_as(pg_temp.f('cc'), format('select public.clinician_record_hbv_immunity(%L, ''other'', ''x'')', (select patient_id from public.care_team_assignment where care_coordinator_id = pg_temp.f('cc') limit 1))));
  perform pg_temp.ck('the patient cannot record their own immunity', '42501',
    pg_temp.sqlstate_as(p4, format('select public.clinician_record_hbv_immunity(%L, ''other'', ''x'')', p4)));
  perform pg_temp.ck('a note is required', '22023', pg_temp.sqlstate_as(v_doc, format('select public.clinician_record_hbv_immunity(%L, ''other'', '' '')', pg_temp.mkpatient('n1'))));
  perform pg_temp.ck('an unknown basis is refused', '22023', pg_temp.sqlstate_as(v_doc, format('select public.clinician_record_hbv_immunity(%L, ''guess'', ''x'')', pg_temp.mkpatient('n2'))));
  perform pg_temp.ck('a tied doctor can clear a wrongly recorded immunity', 'true', pg_temp.q_as(v_doc, format('select public.clinician_clear_hbv_immunity(%L, ''recorded in error'')::text', p4)));
  perform pg_temp.ck('...back to negative', 'hbv_negative', (select hbv_status::text from public.patient_serology_status where patient_id = p4));
  perform pg_temp.ck('anon cannot call the immunity RPC', '42501', pg_temp.try_anon(format('select public.clinician_record_hbv_immunity(%L, ''other'', ''x'')', p4)));
end $$;

-- 2. 3.11 Pathway suppression and the override ---------------------------------------------------------------------------------
do $$
declare r record; p uuid; v_doc uuid := pg_temp.f('doc'); v_bad text := ''; v_ov uuid; pd uuid; ph uuid;
begin
  -- coverage: every row of screening_pathway_coverage suppresses its item for a patient on that pathway with a recent result
  for r in select condition, item_code from public.screening_pathway_coverage loop
    p := pg_temp.mkpatient('cov_' || r.condition || '_' || r.item_code);
    insert into public.care_plans (organisation_id, patient_id, condition, status) values (pg_temp.f('org'), p, r.condition, 'active');
    perform pg_temp.sresult(p, r.item_code, 'normal', interval '1 day');
    if pg_temp.excl(p, r.item_code) <> 'owned_by_pathway:' || r.condition then v_bad := v_bad || r.condition || '/' || r.item_code || ' '; end if;
  end loop;
  perform pg_temp.ck('every pathway coverage row suppresses its item (none missing)', '', v_bad);
  perform pg_temp.ck('the coverage table is not empty', 'true', ((select count(*) from public.screening_pathway_coverage) >= 10)::text);
  p := pg_temp.mkpatient('cov_not_recent');
  insert into public.care_plans (organisation_id, patient_id, condition, status) values (pg_temp.f('org'), p, 'diabetes', 'active');
  perform pg_temp.ck('an item the pathway has not covered recently is not suppressed', 'none', pg_temp.excl(p, 'hba1c'));

  -- override
  pd := pg_temp.mkpatient('ovr');
  insert into public.care_plans (organisation_id, patient_id, condition, status) values (pg_temp.f('org'), pd, 'diabetes', 'active');
  perform pg_temp.sresult(pd, 'hba1c', 'normal', interval '1 day');
  perform pg_temp.setf('ovr', pd);
  perform pg_temp.ck('(before) a diabetes patient with a recent HbA1c has it suppressed', 'owned_by_pathway:diabetes', pg_temp.excl(pd, 'hba1c'));
  perform pg_temp.ck('a stranger doctor cannot override', '42501', pg_temp.sqlstate_as(pg_temp.f('stranger'), format('select public.override_pathway_suppression(%L, ''hba1c'', ''clinical_change'', ''x'')', pd)));
  perform pg_temp.ck('the care coordinator cannot override', '42501',
    pg_temp.sqlstate_as(pg_temp.f('cc'), format('select public.override_pathway_suppression(%L, ''hba1c'', ''clinical_change'', ''x'')', (select patient_id from public.care_team_assignment where care_coordinator_id = pg_temp.f('cc') limit 1))));
  perform pg_temp.ck('the patient cannot override', '42501', pg_temp.sqlstate_as(pd, format('select public.override_pathway_suppression(%L, ''hba1c'', ''clinical_change'', ''x'')', pd)));
  perform pg_temp.ck('an item no pathway owns cannot be overridden', '22023', pg_temp.sqlstate_as(v_doc, format('select public.override_pathway_suppression(%L, ''fit'', ''clinical_change'', ''x'')', pd)));
  perform pg_temp.ck('a reason code and note are required', '23514', pg_temp.sqlstate_as(v_doc, format('select public.override_pathway_suppression(%L, ''hba1c'', ''because'', ''x'')', pd)));
  v_ov := (pg_temp.q_as(v_doc, format('select public.override_pathway_suppression(%L, ''hba1c'', ''clinical_change'', ''new medicine started, repeat needed'')::text', pd)))::uuid;
  perform pg_temp.ck('ACCEPTANCE: a tied doctor override lifts the suppression', 'none', pg_temp.excl(pd, 'hba1c'));
  perform pg_temp.ck('...and is audited with its reason', '1', (select count(*)::text from public.audit_log where action = 'screening.pathway_override' and entity_id = pd));
  perform pg_temp.ck('...the override belongs to the patient and the doctor who made it', 'true',
    (select (patient_id = pd and overridden_by = v_doc and source = 'clinician')::text from public.screening_pathway_overrides where id = v_ov));
  perform pg_temp.ck('the patient can see their own override', '1', pg_temp.q_as(pd, 'select count(*)::text from public.screening_pathway_overrides'));
  perform pg_temp.ck('another patient sees none', '0', pg_temp.q_as(pg_temp.f('other'), 'select count(*)::text from public.screening_pathway_overrides'));
  perform pg_temp.ck('staff do not read the table directly (only through the audited function)', '0', pg_temp.q_as(v_doc, 'select count(*)::text from public.screening_pathway_overrides'));
  perform pg_temp.ck('the audited list works for the tied doctor', '1', pg_temp.q_as(v_doc, format('select count(*)::text from public.clinician_list_pathway_overrides(%L)', pd)));
  perform pg_temp.ck('anon is refused', '42501', pg_temp.try_anon('select count(*) from public.screening_pathway_overrides'));
  update public.screening_pathway_overrides set expires_at = now() - interval '1 day' where id = v_ov;
  perform pg_temp.ck('an expired override no longer lifts the suppression', 'owned_by_pathway:diabetes', pg_temp.excl(pd, 'hba1c'));
  update public.screening_pathway_overrides set expires_at = now() + interval '1 day' where id = v_ov;
  perform pg_temp.ck('a stranger cannot revoke it', '42501', pg_temp.sqlstate_as(pg_temp.f('stranger'), format('select public.revoke_pathway_override(%L)', v_ov)));
  perform pg_temp.ck('the tied doctor revokes it', 'true', pg_temp.q_as(v_doc, format('select public.revoke_pathway_override(%L)::text', v_ov)));
  perform pg_temp.ck('...and the suppression is back', 'owned_by_pathway:diabetes', pg_temp.excl(pd, 'hba1c'));

  -- an override never lifts a terminal state: immunity still stops hep_b even with an override row forced in
  ph := pg_temp.f('hbv');
  insert into public.screening_pathway_overrides (organisation_id, patient_id, item_code, reason_code, note, overridden_by)
    values (pg_temp.f('org'), ph, 'hep_b', 'other', 'forced', v_doc);
  perform pg_temp.ck('an override never lifts a terminal serology state', 'terminal_serology_state', pg_temp.excl(ph, 'hep_b'));
end $$;

-- 3. INV-04: explainers and package orders ------------------------------------------------------------------------------------
create function pg_temp.items(p_creatinine numeric, p_extra text default '') returns text language sql as
$$ select '[{"analyte_code":"fasting_glucose","value_numeric":88},{"analyte_code":"hba1c","value_numeric":5.2},{"analyte_code":"creatinine","value_numeric":'
  || p_creatinine || '},{"analyte_code":"potassium","value_numeric":4.1},{"analyte_code":"sodium","value_numeric":140},{"analyte_code":"total_cholesterol","value_numeric":170},{"analyte_code":"ldl_cholesterol","value_numeric":100},{"analyte_code":"hdl_cholesterol","value_numeric":55},{"analyte_code":"triglycerides","value_numeric":110},{"analyte_code":"alt","value_numeric":24}'
  || p_extra || ']' $$;
create function pg_temp.expl(p_pat uuid, p_key text) returns text language sql as
$$ select pg_temp.try_sql(format($q$insert into public.patient_result_explanations (organisation_id, patient_id, kind, subject_key, language, status)
      values (%L, %L, 'lab_analyte', %L, 'en', 'failed')$q$, pg_temp.f('org'), p_pat, p_key)) $$;
do $$
declare v_pat uuid := pg_temp.f('pat'); v_ok uuid; v_sens uuid; o uuid; r text; rid uuid; v_lab uuid; v_labuser uuid; v_real uuid;
begin
  perform pg_temp.ck('INV-04: no AI explanation row for hiv_screen', '42501', pg_temp.expl(v_pat, 'hiv_screen'));
  perform pg_temp.ck('INV-04: ...nor for hbsag (any case)', '42501', pg_temp.expl(v_pat, 'HbsAg'));
  perform pg_temp.ck('INV-04: ...nor for hcv_ab', '42501', pg_temp.expl(v_pat, 'hcv_ab'));
  perform pg_temp.ck('INV-04: ...nor for the screening codes hiv, hep_b, hep_c', '42501,42501,42501', pg_temp.expl(v_pat, 'hiv') || ',' || pg_temp.expl(v_pat, 'hep_b') || ',' || pg_temp.expl(v_pat, 'hep_c'));
  perform pg_temp.ck('(control) an ordinary analyte can still be explained', 'ok', pg_temp.expl(v_pat, 'hba1c'));
  perform pg_temp.ck('INV-04: an existing explanation row cannot be re-pointed at a sensitive code', '42501',
    pg_temp.try_sql(format($q$update public.patient_result_explanations set subject_key = 'hbsag' where patient_id = %L and subject_key = 'hba1c'$q$, v_pat)));
  perform pg_temp.ck('the sensitive code list covers all three viruses', '3', (select count(distinct virus)::text from public.sensitive_result_codes));

  v_ok := pg_temp.mkresult(v_pat, now(), '[{"code":"hba1c","num":5.2,"unit":"%","low":4,"high":5.6,"flag":"normal"}]'::jsonb);
  v_sens := pg_temp.mkresult(pg_temp.f('other'), now(), '[{"code":"hbsag","text":"positive","unit":"none","flag":"positive","sens":true}]'::jsonb);
  perform pg_temp.ck('a released normal result may be explained', 'true',
    pg_temp.q_as(v_pat, format($q$select x ->> 'explain_allowed' from jsonb_array_elements(public.my_lab_results()) x where x ->> 'lab_result_id' = %L$q$, v_ok)));
  perform pg_temp.ck('INV-04: a released result that holds a sensitive positive is never explainable (no audio, no AI)', 'false',
    pg_temp.q_as(pg_temp.f('other'), format($q$select x ->> 'explain_allowed' from jsonb_array_elements(public.my_lab_results()) x where x ->> 'lab_result_id' = %L$q$, v_sens)));
  perform pg_temp.ck('...and the DB gate agrees', 'false', pg_temp.q_as(pg_temp.f('other'), format('select public.lab_result_explain_allowed(%L)::text', v_sens)));

  -- a sensitive positive from a package order is never auto-released (ACCEPTANCE)
  v_real := pg_temp.mkuser(pg_temp.f('org'), 'real', 'patient', 'female', 45);
  perform pg_temp.go_real(v_real);
  insert into public.lab_providers (name, is_active) values ('S46 Lab', false) returning id into v_lab;
  v_labuser := pg_temp.mkuser(pg_temp.f('org'), 'lab', 'lab_partner', 'male', 40);
  update public.profiles set lab_provider_id = v_lab where id = v_labuser;
  update public.panel_bundles set guidance_only = false where code in ('screen_essential');
  insert into public.lab_orders (organisation_id, patient_id, provider_id, fulfilment, status, origin, ordered_by, clinical_indication, payment_confirmed_at, panel_bundle_id, excluded_test_codes)
  values (pg_temp.f('org'), v_real, v_lab, 'partner', 'pending_payment', 'clinically_triggered', (select id from public.clinical_staff where profile_id = pg_temp.f('doc')), 'S46 proof order',
          now() - interval '1 hour', (select id from public.panel_bundles where code = 'screen_essential'), '[]'::jsonb)
  returning id into o;
  update public.lab_orders set status = 'payment_confirmed' where id = o;
  update public.lab_orders set status = 'sample_collected' where id = o;
  r := pg_temp.q_as(v_labuser, format($q$select public.lab_partner_submit_result(%L, 'membership_annual', %L::jsonb)::text$q$, o,
        pg_temp.items(0.9, ',{"analyte_code":"ast","value_numeric":20},{"analyte_code":"haemoglobin","value_numeric":14},{"analyte_code":"wbc","value_numeric":6},{"analyte_code":"platelets","value_numeric":250},{"analyte_code":"tsh","value_numeric":2},{"analyte_code":"hbsag","value_text":"positive"}')));
  perform pg_temp.ck('ACCEPTANCE (INV-04): the package order submit worked', 'false', (r like 'ERR:%')::text);
  rid := (r::jsonb ->> 'lab_result_id')::uuid;
  perform pg_temp.ck('ACCEPTANCE (INV-04): a sensitive positive in a package is never auto-released', 'clinician_disclosure_required', (select release_state from public.lab_results where id = rid));
  perform pg_temp.ck('...and the patient cannot read it', '0', pg_temp.q_as(v_real, format('select count(*)::text from public.lab_results where id = %L', rid)));
  perform pg_temp.ck('...and it never reaches a report: the collector returns no sensitive code for that patient', 'false',
    (pg_temp.as_service(format('select (public.health_report_collect(%L, %s)::text ~* ''hbsag|hiv|hepatitis'')::text', v_real, extract(year from now())::integer))));
end $$;

-- 4. 3.15 Yearly Health Report -------------------------------------------------------------------------------------------------
-- S46c: a draft is routed as a clinical task, and signing needs the doctor to hold the live claim. This does what queue_next does after it picks the task
-- (the real queue_next, hand-back and expiry are proven in s46c_report_signoff_task.sql).
create function pg_temp.claim_for(p_report uuid, p_doc uuid) returns void language plpgsql as
$f$ declare t public.clinical_tasks%rowtype;
begin
  select ct.* into t from public.clinical_tasks ct join public.health_reports hr on hr.signoff_task_id = ct.id where hr.id = p_report;
  perform private.apply_task_transition(t.id, 'claimed', 'clinician', p_doc, 'claimed', p_doc, now() + interval '1 hour');
  insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, is_test) values (t.organisation_id, t.id, p_doc, now() + interval '1 hour', true);
end $f$;
create function pg_temp.draft(p_pat uuid, p_year integer, p_composed text, p_pri text, p_ai text default null) returns text language sql as
$$ select pg_temp.as_service(format('select public.record_health_report_draft(%L, %s, %L::jsonb, %L::jsonb, %L::jsonb, %L)::text',
      p_pat, p_year, '{"year":0,"risk":{"state":"not_assessed"}}', p_composed, p_pri, p_ai)) $$;
create function pg_temp.draft_state(p_pat uuid, p_year integer, p_composed text, p_pri text) returns text language sql as
$$ select pg_temp.state_as_service(format('select public.record_health_report_draft(%L, %s, %L::jsonb, %L::jsonb, %L::jsonb, null)',
      p_pat, p_year, '{"year":0,"risk":{"state":"not_assessed"}}', p_composed, p_pri)) $$;
do $$
declare
  yr integer := extract(year from now())::integer;
  pat uuid := pg_temp.f('pat'); other uuid := pg_temp.f('other'); doc uuid := pg_temp.f('doc'); stranger uuid := pg_temp.f('stranger'); cc uuid := pg_temp.f('cc'); cmo uuid := pg_temp.f('cmo');
  v_id uuid; v_id2 uuid; v_id3 uuid; v_real uuid; coll text; ok_c text; ok_p text; i integer; v_reg text; v_cfg uuid; pat2 uuid;
begin
  ok_c := '{"items":[{"id":"bp","state":"on_target","value":122,"readingCount":4},{"id":"lab:alt","state":"needs_attention","value":70,"readingCount":1}],"summary":{"key":"report.summary.default"}}';
  ok_p := '[{"id":"lab:alt","action":"report.priority.lab.action","why":"report.priority.lab.why","whoHelps":"report.who.care_team","when":"within 4 weeks"}]';

  -- data for the collector
  for i in 1..4 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (pg_temp.f('org'), pat, 'blood_pressure', 122, 78, 'manual', now());
  end loop;
  perform pg_temp.mkresult(pat, now(), '[{"code":"alt","num":70,"unit":"U/L","low":7,"high":56,"flag":"high"}]'::jsonb);
  perform pg_temp.mkresult(pat, make_timestamptz(yr - 1, 6, 1, 9, 0, 0, 'Africa/Lagos'), '[{"code":"alt","num":90,"unit":"U/L","low":7,"high":56,"flag":"high"}]'::jsonb);
  perform pg_temp.mkresult(pat, now(), '[{"code":"hiv_screen","text":"positive","unit":"none","flag":"positive","sens":true},{"code":"hbsag","text":"positive","unit":"none","flag":"positive","sens":true}]'::jsonb);
  perform pg_temp.mkresult(pat, now(), '[{"code":"hbv_dna","num":3,"unit":"IU/mL","low":0,"high":1,"flag":"high"}]'::jsonb);
  perform pg_temp.scomp(pat, 'fit', interval '2 months');
  perform pg_temp.scomp(pat, 'hiv', interval '2 months');
  perform pg_temp.scomp(pat, 'hep_c', interval '2 months');
  coll := pg_temp.as_service(format('select public.health_report_collect(%L, %s)::text', pat, yr));
  perform pg_temp.ck('collector: blood pressure count and an alt with last year''s value', '4,70,90',
    (coll::jsonb -> 'bp' ->> 'count') || ',' || (select (x -> 'latest' ->> 'value')::numeric::text from jsonb_array_elements(coll::jsonb -> 'labs') x where x ->> 'code' = 'alt')
    || ',' || (select (x -> 'previous' ->> 'value')::numeric::text from jsonb_array_elements(coll::jsonb -> 'labs') x where x ->> 'code' = 'alt'));
  perform pg_temp.ck('INV-04: the collector never carries an HIV or hepatitis result or screening item', 'false', (coll ~* 'hiv|hbsag|hbs_ag|hcv|hbv|hepatitis|hep_b|hep_c')::text);
  perform pg_temp.ck('...but keeps an ordinary screening item (fit)', 'true', (coll::jsonb -> 'screening' -> 'done' @> '[{"code":"fit"}]'::jsonb)::text);
  perform pg_temp.ck('the risk band is "not assessed" while the instrument is unsigned and its guard off', 'not_assessed', coll::jsonb -> 'risk' ->> 'state');
  perform pg_temp.ck('only the service role can collect', '42501', pg_temp.sqlstate_as(pat, format('select public.health_report_collect(%L, %s)', pat, yr)));

  perform pg_temp.ck('the yearly build considers a patient with data and no report, and not one without data', 'true,false',
    (pg_temp.as_service(format('select (count(*) > 0)::text from public.health_report_candidates(%s, 100) c where c.patient_id = %L', yr, pat))) || ',' ||
    (pg_temp.as_service(format('select (count(*) > 0)::text from public.health_report_candidates(%s, 100) c where c.patient_id = %L', yr, pg_temp.mkpatient('nodata')))));
  perform pg_temp.ck('only the service role can list candidates', '42501', pg_temp.sqlstate_as(doc, format('select * from public.health_report_candidates(%s, 5)', yr)));

  -- building a draft
  v_real := pg_temp.mkuser(pg_temp.f('org'), 'realhr', 'patient', 'female', 45);
  perform pg_temp.go_real(v_real);
  perform pg_temp.ck('a real patient cannot be built while the guard is off (go-live guard, INV-14)', 'P0001', pg_temp.draft_state(v_real, yr, ok_c, ok_p));
  perform pg_temp.ck('a patient cannot call the draft writer', '42501', pg_temp.sqlstate_as(pat, format('select public.record_health_report_draft(%L, %s, ''{}''::jsonb, ''{"items":[]}''::jsonb, ''[]''::jsonb, null)', pat, yr)));
  perform pg_temp.ck('a doctor cannot call the draft writer', '42501', pg_temp.sqlstate_as(doc, format('select public.record_health_report_draft(%L, %s, ''{}''::jsonb, ''{"items":[]}''::jsonb, ''[]''::jsonb, null)', pat, yr)));
  perform pg_temp.ck('anon cannot call the draft writer', '42501', pg_temp.try_anon(format('select public.record_health_report_draft(%L, %s, ''{}''::jsonb, ''{"items":[]}''::jsonb, ''[]''::jsonb, null)', pat, yr)));
  v_id := (pg_temp.draft(pat, yr, ok_c, ok_p, 'AI WROTE THIS PARAGRAPH'))::uuid;
  perform pg_temp.setf('report', v_id);
  perform pg_temp.ck('a draft for a test patient is built and waits for signature', 'pending_signature', (select status from public.health_reports where id = v_id));
  perform pg_temp.ck('...routed as a sign-off task offered to the care team doctor (S46c) and tied to a settings version (INV-16)', 'true',
    (select (ct.lead_clinician_id = doc and ct.state = 'offered_to_lead' and hr.assigned_clinician_id is null and hr.config_version_id is not null)::text
       from public.health_reports hr join public.clinical_tasks ct on ct.id = hr.signoff_task_id where hr.id = v_id));
  perform pg_temp.ck('...and once a draft exists the patient is no longer a candidate', 'false',
    (pg_temp.as_service(format('select (count(*) > 0)::text from public.health_report_candidates(%s, 100) c where c.patient_id = %L', yr, pat))));
  perform pg_temp.ck('the event carries ids only (INV-07)', 'health_report_id',
    (select string_agg(k, ',') from (select jsonb_object_keys(payload) k from public.domain_events where event_type = 'health_report.generated' and aggregate_id = v_id) x));
  perform pg_temp.ck('a second draft for the same year is refused while one is waiting', '23505', pg_temp.draft_state(pat, yr, ok_c, ok_p));

  -- ACCEPTANCE: not visible until signed
  perform pg_temp.ck('ACCEPTANCE: the Health Report is not visible to the patient until signed', '0', pg_temp.q_as(pat, 'select count(*)::text from public.health_reports'));
  perform pg_temp.ck('...nor to another patient', '0', pg_temp.q_as(other, 'select count(*)::text from public.health_reports'));
  perform pg_temp.ck('...nor to a doctor reading the table directly', '0', pg_temp.q_as(doc, 'select count(*)::text from public.health_reports'));
  perform pg_temp.ck('...anon is refused', '42501', pg_temp.try_anon('select count(*) from public.health_reports'));
  -- queue and read
  perform pg_temp.ck('the tied doctor sees it in the queue', '1', pg_temp.q_as(doc, format('select count(*)::text from public.clinician_health_report_queue() where id = %L', v_id)));
  perform pg_temp.ck('a doctor with no tie does not see it', '0', pg_temp.q_as(stranger, format('select count(*)::text from public.clinician_health_report_queue() where id = %L', v_id)));
  perform pg_temp.ck('the care coordinator cannot open the queue', '42501', pg_temp.sqlstate_as(cc, 'select * from public.clinician_health_report_queue()'));
  perform pg_temp.ck('the patient cannot open the queue', '42501', pg_temp.sqlstate_as(pat, 'select * from public.clinician_health_report_queue()'));
  perform pg_temp.ck('a stranger cannot read the draft', '42501', pg_temp.sqlstate_as(stranger, format('select * from public.clinician_get_health_report(%L)', v_id)));
  perform pg_temp.ck('the tied doctor reads the draft and sees the AI draft (INV-11 draft state)', 'AI WROTE THIS PARAGRAPH', pg_temp.q_as(doc, format('select (public.clinician_get_health_report(%L)).ai_draft', v_id)));
  perform pg_temp.ck('...and the read is audited (INV-10)', '1', (select count(*)::text from public.audit_log where action = 'health_report.read' and entity_id = pat));

  -- signing (the tied doctor first takes the sign-off task; the refusals below hold with or without a claim)
  perform pg_temp.claim_for(v_id, doc);
  perform pg_temp.ck('a stranger doctor cannot sign', '42501', pg_temp.sqlstate_as(stranger, format('select public.sign_health_report(%L, ''Your year.'', ''clinician'')', v_id)));
  perform pg_temp.ck('the care coordinator cannot sign', '42501', pg_temp.sqlstate_as(cc, format('select public.sign_health_report(%L, ''Your year.'', ''clinician'')', v_id)));
  perform pg_temp.ck('the patient cannot sign their own report', '42501', pg_temp.sqlstate_as(pat, format('select public.sign_health_report(%L, ''Your year.'', ''clinician'')', v_id)));
  perform pg_temp.ck('a summary naming an HIV or hepatitis result is refused', '23514', pg_temp.sqlstate_as(doc, format('select public.sign_health_report(%L, ''Your HIV result is fine.'', ''clinician'')', v_id)));
  perform pg_temp.ck('an empty summary is refused', '22023', pg_temp.sqlstate_as(doc, format('select public.sign_health_report(%L, '' '', ''clinician'')', v_id)));
  perform pg_temp.ck('an unknown summary source is refused', '22023', pg_temp.sqlstate_as(doc, format('select public.sign_health_report(%L, ''Your year.'', ''ai'')', v_id)));
  perform pg_temp.ck('the tied doctor signs', v_id::text, pg_temp.q_as(doc, format('select public.sign_health_report(%L, ''Your blood pressure held steady this year.'', ''clinician_edited_ai_draft'')::text', v_id)));
  select credential_number into v_reg from public.clinical_staff where profile_id = doc;
  perform pg_temp.ck('...the row names the signer and the registration number', 'true',
    (select (status = 'signed' and signer_registration = v_reg and signed_by is not null and signed_at is not null and signer_name = 'S46 doc')::text from public.health_reports where id = v_id));
  perform pg_temp.ck('INV-11: the AI draft is wiped on signature and only the clinician text is kept', 'true',
    (select (ai_draft is null and summary_text = 'Your blood pressure held steady this year.')::text from public.health_reports where id = v_id));
  perform pg_temp.ck('a signed report cannot be signed again', '22023', pg_temp.sqlstate_as(doc, format('select public.sign_health_report(%L, ''Again.'', ''clinician'')', v_id)));
  perform pg_temp.ck('signing is audited and emits health_report.signed (ids only)', '1,health_report_id',
    (select count(*)::text from public.audit_log where action = 'health_report.signed' and entity_id = pat) || ',' ||
    (select string_agg(k, ',') from (select jsonb_object_keys(payload) k from public.domain_events where event_type = 'health_report.signed' and aggregate_id = v_id) x));
  perform pg_temp.ck('ACCEPTANCE: once signed the patient sees it', '1', pg_temp.q_as(pat, 'select count(*)::text from public.health_reports'));
  perform pg_temp.ck('...another patient still does not', '0', pg_temp.q_as(other, 'select count(*)::text from public.health_reports'));
  perform pg_temp.ck('a signed report is immutable (summary)', '55000', pg_temp.try_sql(format($q$update public.health_reports set summary_text = 'changed' where id = %L$q$, v_id)));
  perform pg_temp.ck('...a signed report cannot go back to waiting', '55000', pg_temp.try_sql(format($q$update public.health_reports set status = 'pending_signature' where id = %L$q$, v_id)));
  perform pg_temp.ck('...nor be deleted', '55000', pg_temp.try_sql(format('delete from public.health_reports where id = %L', v_id)));

  -- corrections
  perform pg_temp.ck('a correction needs a real note', '22023', pg_temp.sqlstate_as(doc, format('select public.correct_health_report(%L, ''fix'')', v_id)));
  perform pg_temp.ck('a stranger cannot open a correction', '42501', pg_temp.sqlstate_as(stranger, format('select public.correct_health_report(%L, ''A result was corrected by the lab'')', v_id)));
  v_id2 := (pg_temp.q_as(doc, format('select public.correct_health_report(%L, ''A laboratory corrected an ALT value.'')::text', v_id)))::uuid;
  perform pg_temp.ck('a correction is a new version (2) that points at the old one with its note', '2,true',
    (select version::text || ',' || (supersedes_id = v_id and correction_note = 'A laboratory corrected an ALT value.' and status = 'pending_signature')::text from public.health_reports where id = v_id2));
  perform pg_temp.ck('until the new version is signed the patient still sees the old signed one only', '1,1',
    pg_temp.q_as(pat, 'select count(*)::text from public.health_reports') || ',' || pg_temp.q_as(pat, 'select min(version)::text from public.health_reports'));
  perform pg_temp.ck('a second correction is refused while one is waiting', '23505', pg_temp.sqlstate_as(doc, format('select public.correct_health_report(%L, ''Another note about this.'')', v_id)));
  perform pg_temp.ck('the draft can be refreshed by the service role while unsigned', 'true',
    pg_temp.as_service(format('select public.refresh_health_report_draft(%L, ''{"year":0}''::jsonb, %L::jsonb, %L::jsonb, null)::text', v_id2, ok_c, ok_p)));
  perform pg_temp.ck('...but never once signed', 'false',
    pg_temp.as_service(format('select public.refresh_health_report_draft(%L, ''{"year":0}''::jsonb, %L::jsonb, %L::jsonb, null)::text', v_id, ok_c, ok_p)));
  perform pg_temp.claim_for(v_id2, doc);
  perform pg_temp.q_as(doc, format('select public.sign_health_report(%L, ''Your blood pressure held steady this year. One lab value was corrected.'', ''clinician'')::text', v_id2));
  perform pg_temp.ck('after signing the correction the patient sees one report, version 2, with the visible correction note', '1,2,A laboratory corrected an ALT value.',
    pg_temp.q_as(pat, 'select count(*)::text from public.health_reports') || ',' || pg_temp.q_as(pat, 'select max(version)::text from public.health_reports') || ',' ||
    pg_temp.q_as(pat, 'select correction_note from public.health_reports'));
  perform pg_temp.ck('the old version is marked superseded and still exists', 'superseded', (select status from public.health_reports where id = v_id));

  -- honesty guard (each attempt is for last year, so a refused insert leaves nothing behind)
  perform pg_temp.ck('honesty: "on target" without a recorded value is refused', '23514',
    pg_temp.draft_state(pat, yr - 1, '{"items":[{"id":"x","state":"on_target","readingCount":3}]}', '[]'));
  perform pg_temp.ck('honesty: "on target" with too few readings is refused', '23514',
    pg_temp.draft_state(pat, yr - 1, '{"items":[{"id":"x","state":"on_target","value":120,"readingCount":2,"tooFewReadings":true}]}', '[]'));
  perform pg_temp.ck('honesty: a borderline value is never "on target"', '23514',
    pg_temp.draft_state(pat, yr - 1, '{"items":[{"id":"x","state":"on_target","value":139,"readingCount":5,"borderline":true}]}', '[]'));
  perform pg_temp.ck('honesty: an unknown state word is refused', '23514', pg_temp.draft_state(pat, yr - 1, '{"items":[{"id":"x","state":"optimal","value":1,"readingCount":3}]}', '[]'));
  perform pg_temp.ck('honesty: a fourth priority is refused', '23514',
    pg_temp.draft_state(pat, yr - 1, '{"items":[]}', (select jsonb_agg(jsonb_build_object('id', n, 'action', 'a', 'why', 'b', 'whoHelps', 'c', 'when', 'd'))::text from generate_series(1, 4) n)));
  perform pg_temp.ck('honesty: a priority without who helps or when is refused', '23514',
    pg_temp.draft_state(pat, yr - 1, '{"items":[]}', '[{"id":"a","action":"a","why":"b"}]'));
  perform pg_temp.ck('honesty: no "optimal" range', '23514', pg_temp.draft_state(pat, yr - 1, '{"items":[],"note":"your optimal range"}', '[]'));
  perform pg_temp.ck('honesty: no biological age', '23514', pg_temp.draft_state(pat, yr - 1, '{"items":[],"note":"biological age 34"}', '[]'));
  perform pg_temp.ck('honesty: no percentile of other people', '23514', pg_temp.draft_state(pat, yr - 1, '{"items":[],"note":"85th percentile"}', '[]'));
  perform pg_temp.ck('honesty (INV-04): no HIV word', '23514', pg_temp.draft_state(pat, yr - 1, '{"items":[],"note":"HIV negative"}', '[]'));
  perform pg_temp.ck('honesty (INV-04): no hepatitis word in a priority', '23514',
    pg_temp.draft_state(pat, yr - 1, '{"items":[]}', '[{"id":"a","action":"Hepatitis B check","why":"b","whoHelps":"c","when":"d"}]'));
  perform pg_temp.ck('(control) a clean report with the word archive is accepted', 'ok',
    pg_temp.draft_state(pat, yr - 1, '{"items":[{"id":"archive","state":"not_measured","readingCount":0}]}', ok_p));

  -- settings: only the CMO signs them, and the guard still decides
  perform pg_temp.ck('report settings start unsigned', '0', (select count(*)::text from public.health_report_config_versions where approved_by is not null));
  perform pg_temp.ck('a doctor cannot sign the report settings', 'true', (pg_temp.q_as(doc, format('select public.sign_health_report_config(%L)::text', (select id from public.health_report_config_versions where version = 1))) like 'ERR:not authorised%')::text);
  select id into v_cfg from public.health_report_config_versions where version = 1;
  perform pg_temp.ck('the CMO signs the report settings', v_cfg::text, pg_temp.q_as(cmo, format('select public.sign_health_report_config(%L)::text', v_cfg)));
  perform pg_temp.ck('...and it is audited', '1', (select count(*)::text from public.audit_log where action = 'health_report_config.signed' and entity_id = v_cfg));
  perform pg_temp.ck('with signed settings a real patient is still refused while the guard is off', 'P0001', pg_temp.draft_state(v_real, yr, ok_c, ok_p));
  perform pg_temp.guards_on(array['health_report_generation_enabled']);
  perform pg_temp.ck('(control) with the guard on and signed settings a real patient is built', 'ok', pg_temp.draft_state(v_real, yr, ok_c, ok_p));
  perform pg_temp.ck('...against the signed settings version', 'true', (select (config_version_id = v_cfg)::text from public.health_reports where patient_id = v_real));
  perform pg_temp.guards_on(array[]::text[]);
  perform pg_temp.ck('ACL: no S46 function is executable by anon, and the service-only ones are not executable by authenticated', '',
    coalesce((select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where ((n.nspname = 'public' and p.proname in ('health_report_collect','record_health_report_draft','refresh_health_report_draft','health_report_candidates','clinician_health_report_queue',
               'clinician_get_health_report','sign_health_report','correct_health_report','sign_health_report_config','clinician_record_hbv_immunity','clinician_clear_hbv_immunity',
               'override_pathway_suppression','revoke_pathway_override','clinician_list_pathway_overrides'))
           or (n.nspname = 'private' and p.proname in ('serology_rule','anti_hbs_threshold_confirmed','set_hbv_immune','is_sensitive_result_code','report_excluded_code','is_signing_clinician','hr_biomarker_points','health_report_collect','health_report_assert_honest')))
         and (has_function_privilege('anon', p.oid, 'EXECUTE')
              or (p.proname in ('health_report_collect','record_health_report_draft','refresh_health_report_draft','health_report_candidates') and has_function_privilege('authenticated', p.oid, 'EXECUTE')))), ''));
  perform pg_temp.ck('the report guard starts off', 'false', (select is_on::text from public.go_live_guards where key = 'health_report_generation_enabled'));
  perform pg_temp.ck('no grants for anon or a direct write for authenticated', 'false,false',
    has_table_privilege('anon', 'public.health_reports', 'SELECT')::text || ',' || has_table_privilege('authenticated', 'public.health_reports', 'INSERT')::text);
end $$;

-- 5. Sabotage ------------------------------------------------------------------------------------------------------------------------------
-- A: the old once-ever rule made active again. Hepatitis C older than a year must then NOT be due (the real check flips).
do $$
declare p uuid;
begin
  p := pg_temp.mkpatient('sabA');
  perform pg_temp.sresult(p, 'hep_c', 'normal', interval '14 months');
  update public.serology_rule_versions set status = 'legacy' where version = 3;
  update public.serology_rule_versions set status = 'active' where version = 1;
  insert into results values ('sabotaged', 'ACCEPTANCE: hepatitis C older than a year is due again (it stays annual, no longer once-ever)', 'none', pg_temp.excl(p, 'hep_c'));
  update public.serology_rule_versions set status = 'legacy' where version = 1;
  update public.serology_rule_versions set status = 'active' where version = 3;
end $$;
-- B: the INV-04 trigger dropped. An AI explanation row for HIV must then be accepted.
do $$
begin
  drop trigger patient_result_explanations_inv04 on public.patient_result_explanations;
  insert into results values ('sabotaged', 'INV-04: no AI explanation row for hiv_screen', '42501', pg_temp.expl(pg_temp.f('pat'), 'hiv_screen'));
end $$;
-- C: the patient policy opened to every row. The patient must then see an unsigned draft.
do $$
declare v_other uuid := pg_temp.f('other'); yr integer := extract(year from now())::integer; r text;
begin
  r := pg_temp.draft(v_other, yr, '{"items":[]}', '[]');
  perform pg_temp.ck('(setup) a draft waits for the other patient', 'pending_signature', (select status from public.health_reports where id = r::uuid));
  perform pg_temp.ck('the patient does not see their unsigned draft', '0', pg_temp.q_as(v_other, 'select count(*)::text from public.health_reports'));
  drop policy health_reports_patient_read on public.health_reports;
  create policy health_reports_patient_read on public.health_reports for select to authenticated using (patient_id = (select auth.uid()));
  insert into results values ('sabotaged', 'the patient does not see their unsigned draft', '0', pg_temp.q_as(v_other, 'select count(*)::text from public.health_reports'));
end $$;
-- D: the honesty guard emptied. Four priorities must then be accepted.
do $$
declare p uuid := pg_temp.mkpatient('sabD'); yr integer := extract(year from now())::integer;
begin
  create or replace function private.health_report_assert_honest(p_inputs jsonb, p_composed jsonb, p_priorities jsonb) returns void
    language plpgsql immutable set search_path = '' as $f$ begin return; end $f$;
  insert into results values ('sabotaged', 'honesty: a fourth priority is refused', '23514',
    pg_temp.draft_state(p, yr, '{"items":[]}', (select jsonb_agg(jsonb_build_object('id', n, 'action', 'a', 'why', 'b', 'whoHelps', 'c', 'when', 'd'))::text from generate_series(1, 4) n)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S46 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
