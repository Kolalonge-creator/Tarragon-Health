-- S18 proof: lead clinician assignment, declared availability, on-call rota, conflicts of interest
-- (migration *_s18_lead_clinician_availability_rota.sql).
--
-- Proves in one rolled-back transaction:
--   1. Shape: five tables, RLS on, authenticated can only SELECT, anon nothing, the owner cannot write directly (guard).
--   2. Availability: auto-confirm for queue blocks, on-call needs the competency and a reviewer's confirmation, minimum
--      length, overlap, past start, leave, cancel, the minimum-guarantee flag is stored for contracted clinicians only.
--   3. Rota: reviewer only, primary and backup differ and are on-call competent and eligible, a contracted clinician
--      needs a confirmed on-call block, overlap refused, fatigue warning needs a written override, gap detection on
--      write and an incident for uncovered hours, swaps change nothing until accepted AND approved.
--   4. Conflicts: a clinician's declaration, no existence oracle, a hand-back for conflict of interest records one,
--      a conflicted lead is replaced and never chosen, lifting needs a reason.
--   5. Lead assignment: continuity first, then language, fewest leads, reliability; tier and competency gate; cap
--      from config and per clinician; test patients never use capacity; idempotent; care_team_assignment moves in the
--      same transaction (INV-12); nobody eligible means unassigned plus an incident, then a retry assigns.
--   6. SAFETY CASE 16: licence expires, the nightly sweep suspends, the removal handler moves every lead, releases
--      work, cancels hours and strips the rota; a missed event is caught by the nightly reconcile.
--   7. Task routing: a contracted lead with declared hours is offered the task, without hours it goes to the pool, a
--      clinician in post-call rest is skipped, an offered task follows a lead change, and with nobody left it opens.
--   8. Access: patient, other clinician, lead, chief medical officer, anon; execute grants; neutral notices (INV-07).
--   9. SABOTAGE: drop the write guard, then make has_conflict return false; the matching checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(label text primary key, id uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_lang text default 'en') returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's18-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S18 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, p_lang)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, language = excluded.language;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text, p_emp text, p_langs text[], p_rel numeric, p_comps text[], p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid; c text;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, languages, reliability_score,
      indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S18 ' || p_label, 'MDCN', 'S18-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type, 2, p_langs, p_rel,
      (p_emp = 'contracted' or p_tier = 'chief_medical_officer'), case when p_emp = 'contracted' or p_tier = 'chief_medical_officer' then p_admin end, p_test)
  returning id into v_staff;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, v_staff, c, p_admin, true);
  end loop;
  insert into public.on_call_readiness (clinician_id, checklist_version, organisation_id, items, is_test) values (v, private.readiness_version(), p_org, private.readiness_items(), true);
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_mo uuid; v_nc uuid; v_e uuid; r1 uuid; r2 uuid; r3 uuid; v_staff_r3 uuid; p7 uuid;
  v_txt text;
  v_staff_a uuid; v_staff_b uuid; v_staff_c uuid; v_staff_e uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; p9 uuid;
  pn1 uuid; pn2 uuid; pn3 uuid; pn4 uuid;
  t0 timestamptz := date_trunc('hour', now()) + interval '3 hours';
  t1 timestamptz := date_trunc('hour', now()) + interval '6 hours';
  v_blk uuid; v_blk_b_oncall uuid; v_r1 jsonb; v_r2 jsonb; v_r1_id uuid; v_r2_id uuid; v_swap uuid;
  v_cf uuid; v_x uuid; v_task uuid; v_task2 uuid; v_task3 uuid; v_n integer;
  v_forbidden text := 'blood|pressure|hypertens|diabet|result|reading|glucose|medicine|dose|symptom';
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  -- only the fixture clinicians may be picked (live rows would make the choice depend on production data)
  update public.clinical_staff set active = false where is_test is not true;

  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer', 'contracted', '{en}', null, '{}');
  v_a  := pg_temp.mkdoc(v_org, v_admin, 'lead-a', 'senior_medical_officer', 'employed',   '{en}',     90, '{lead_clinician,hypertension,on_call}');
  v_b  := pg_temp.mkdoc(v_org, v_admin, 'lead-b', 'senior_medical_officer', 'contracted', '{fr,en}',  80, '{lead_clinician,hypertension,on_call}');
  v_c  := pg_temp.mkdoc(v_org, v_admin, 'lead-c', 'senior_medical_officer', 'employed',   '{en}',     70, '{lead_clinician,hypertension,on_call}');
  v_d  := pg_temp.mkdoc(v_org, v_admin, 'oncall-d', 'senior_medical_officer', 'employed', '{en}',     60, '{hypertension,on_call}');
  v_mo := pg_temp.mkdoc(v_org, v_admin, 'mo', 'senior_medical_officer', 'employed', '{en}',                   99, '{lead_clinician,hypertension}');
  v_nc := pg_temp.mkdoc(v_org, v_admin, 'no-comp', 'senior_medical_officer', 'employed', '{en}',       99, '{hypertension}');
  v_e := pg_temp.mkdoc(v_org, v_admin, 'oncall-e', 'senior_medical_officer', 'employed', '{en}', 50, '{on_call}');
  -- real (not test) clinicians for the real patients: test and real never mix (INV-13)
  r1 := pg_temp.mkdoc(v_org, v_admin, 'real-lead-1', 'senior_medical_officer', 'employed', '{en}',    90, '{lead_clinician,hypertension,on_call}', false);
  r2 := pg_temp.mkdoc(v_org, v_admin, 'real-lead-2', 'senior_medical_officer', 'employed', '{fr,en}', 80, '{lead_clinician,hypertension,on_call}', false);
  r3 := pg_temp.mkdoc(v_org, v_admin, 'real-lead-3', 'senior_medical_officer', 'employed', '{en}',    70, '{lead_clinician,hypertension,on_call}', false);
  select id into v_staff_a from public.clinical_staff where profile_id = v_a;
  select id into v_staff_b from public.clinical_staff where profile_id = v_b;
  select id into v_staff_c from public.clinical_staff where profile_id = v_c;
  select id into v_staff_r3 from public.clinical_staff where profile_id = r3;

  p1 := pg_temp.mkuser(v_org, 'patient-1', 'patient', 'en');
  p2 := pg_temp.mkuser(v_org, 'patient-2', 'patient', 'en');
  p3 := pg_temp.mkuser(v_org, 'patient-3', 'patient', 'en');
  p4 := pg_temp.mkuser(v_org, 'patient-4', 'patient', 'en');
  p5 := pg_temp.mkuser(v_org, 'patient-5', 'patient', 'en');
  p6 := pg_temp.mkuser(v_org, 'patient-6', 'patient', 'en');
  p9 := pg_temp.mkuser(v_org, 'patient-9', 'patient', 'en');
  p7 := pg_temp.mkuser(v_org, 'patient-7', 'patient', 'en');
  pn1 := pg_temp.mkuser(v_org, 'real-1', 'patient', 'en');
  pn2 := pg_temp.mkuser(v_org, 'real-2', 'patient', 'en');
  pn3 := pg_temp.mkuser(v_org, 'real-3', 'patient', 'en');
  pn4 := pg_temp.mkuser(v_org, 'real-4', 'patient', 'en');
  insert into fx values ('admin', v_admin), ('cmo', v_cmo), ('lead-a', v_a), ('lead-b', v_b), ('lead-c', v_c), ('oncall-d', v_d),
    ('patient-1', p1), ('patient-2', p2), ('patient-4', p4), ('real-1', pn1), ('real-2', pn2), ('real-3', pn3), ('real-4', pn4),
    ('real-lead-1', r1), ('real-lead-2', r2), ('real-lead-3', r3), ('patient-5', p5), ('patient-6', p6), ('patient-7', p7);
  -- "real" patients count against capacity; fixture patients (is_test) never do (INV-13)
  update public.profiles set is_test = false where id in (pn1, pn2, pn3, pn4);

  -- 1. Shape ------------------------------------------------------------------------------------------------
  perform pg_temp.rec('the five tables S18 relies on have RLS on', '5',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('availability_blocks', 'clinician_conflicts', 'on_call_rota', 'rota_swaps', 'lead_assignments') and c.relrowsecurity));
  perform pg_temp.rec('authenticated holds only SELECT on S18 tables', '0',
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public'
       and table_name in ('availability_blocks', 'clinician_conflicts', 'on_call_rota', 'rota_swaps', 'lead_assignments', 'lead_config')
       and grantee = 'authenticated' and privilege_type <> 'SELECT'));
  perform pg_temp.rec('anon holds nothing on S18 tables', '0',
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public'
       and table_name in ('availability_blocks', 'clinician_conflicts', 'on_call_rota', 'rota_swaps', 'lead_assignments', 'lead_config') and grantee in ('anon', 'PUBLIC')));
  perform pg_temp.rec('one active lead_config version', '1', (select count(*)::text from public.lead_config where is_active));
  perform pg_temp.rec('the owner cannot insert a lead row directly (guard)', '42501',
    pg_temp.try(format('insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, config_version) values (%L, %L, %L, ''active'', ''admin'', 1)', v_org, p1, v_a)));
  perform pg_temp.rec('the owner cannot insert a rota row directly (guard)', '42501',
    pg_temp.try(format('insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id) values (%L, now(), now() + interval ''2 hours'', %L)', v_org, v_a)));

  -- 2. Availability ---------------------------------------------------------------------------------------------
  perform pg_temp.act(v_b);
  v_blk := public.declare_availability('queue', t0, t0 + interval '4 hours');
  perform pg_temp.back();
  perform pg_temp.rec('a declared queue block is stored (S17: a declared block counts)', 'declared', (select state::text from public.availability_blocks where id = v_blk));
  perform pg_temp.rec('contracted clinician: minimum guarantee flag stored', 'true', (select minimum_guarantee_eligible::text from public.availability_blocks where id = v_blk));
  perform pg_temp.act(v_a);
  v_x := public.declare_availability('queue', t0, t0 + interval '4 hours');
  perform pg_temp.back();
  perform pg_temp.rec('employed clinician: minimum guarantee flag not set', 'false', (select minimum_guarantee_eligible::text from public.availability_blocks where id = v_x));
  perform pg_temp.act(v_nc);
  perform pg_temp.rec('on-call hours need the on-call competency', '42501', pg_temp.try(format('select public.declare_availability(''on_call'', %L, %L)', t0 + interval '30 hours', t0 + interval '34 hours')));
  perform pg_temp.back();
  perform pg_temp.act(v_b);
  perform pg_temp.rec('a block under two hours is refused (S18 rule)', '22023', pg_temp.try(format('select public.declare_availability(''queue'', %L, %L)', t0 + interval '20 hours', t0 + interval '21 hours')));
  perform pg_temp.rec('an overlapping block is refused', '23P01', pg_temp.try(format('select public.declare_availability(''queue'', %L, %L)', t0 + interval '1 hour', t0 + interval '5 hours')));
  perform pg_temp.rec('a block in the past is refused (S17)', '22023', pg_temp.try(format('select public.declare_availability(''queue'', %L, %L)', now() - interval '5 hours', now() - interval '2 hours')));
  -- on-call block for the rota section: covers the shift that lead-b will hold (t1+12h to t1+24h)
  v_blk_b_oncall := public.declare_availability('on_call', t1 + interval '12 hours', t1 + interval '24 hours');
  perform pg_temp.back();
  perform pg_temp.rec('an on-call block waits for a reviewer', 'declared', (select state::text from public.availability_blocks where id = v_blk_b_oncall));
  perform pg_temp.act(v_a);
  perform pg_temp.rec('a clinician cannot confirm a block', '42501', pg_temp.try(format('select public.confirm_availability_block(%L)', v_blk_b_oncall)));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform public.confirm_availability_block(v_blk_b_oncall);
  perform pg_temp.back();
  perform pg_temp.rec('the chief medical officer confirms', 'confirmed', (select state::text from public.availability_blocks where id = v_blk_b_oncall));
  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at) values (v_org, v_c, 'leave', t0 + interval '40 hours', t0 + interval '50 hours');
  perform pg_temp.act(v_c);
  perform pg_temp.rec('a block during leave is refused', '22023', pg_temp.try(format('select public.declare_availability(''queue'', %L, %L)', t0 + interval '42 hours', t0 + interval '46 hours')));
  perform pg_temp.back();
  perform pg_temp.act(v_d);
  v_x := public.declare_availability('queue', t0 + interval '60 hours', t0 + interval '64 hours');
  perform public.cancel_availability(v_x);
  perform pg_temp.back();
  perform pg_temp.rec('a clinician cancels their own block', 'cancelled', (select state::text from public.availability_blocks where id = v_x));

  -- 3. Rota ---------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_a);
  perform pg_temp.rec('a clinician cannot build the rota', '42501', pg_temp.try(format('select public.set_on_call_rota(%L, %L, %L, %L)', t1, t1 + interval '12 hours', v_a, v_c)));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('primary and backup must differ', '22023', pg_temp.try(format('select public.set_on_call_rota(%L, %L, %L, %L)', t1, t1 + interval '12 hours', v_a, v_a)));
  perform pg_temp.rec('a backup without the on-call competency is refused', '22023', pg_temp.try(format('select public.set_on_call_rota(%L, %L, %L, %L)', t1, t1 + interval '12 hours', v_a, v_nc)));
  perform pg_temp.rec('a contracted clinician without a confirmed on-call block is refused', '22023', pg_temp.try(format('select public.set_on_call_rota(%L, %L, %L, %L)', t1, t1 + interval '12 hours', v_b, v_a)));
  v_r1 := public.set_on_call_rota(t1, t1 + interval '12 hours', v_a, v_c);
  v_r1_id := (v_r1 ->> 'id')::uuid;
  perform pg_temp.back();
  perform pg_temp.rec('a valid shift is stored with no warnings', '0', (jsonb_array_length(v_r1 -> 'warnings'))::text);
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('an overlapping shift is refused', '23P01', pg_temp.try(format('select public.set_on_call_rota(%L, %L, %L, %L)', t1 + interval '6 hours', t1 + interval '18 hours', v_d, v_a)));
  -- lead-c is the backup in shift one and again right after: less than 11 hours of rest
  perform pg_temp.rec('less than 11 hours of rest needs a written override', '23514', pg_temp.try(format('select public.set_on_call_rota(%L, %L, %L, %L)', t1 + interval '12 hours', t1 + interval '24 hours', v_b, v_c)));
  v_r2 := public.set_on_call_rota(t1 + interval '12 hours', t1 + interval '24 hours', v_b, v_c, 'cover agreed with both doctors');
  v_r2_id := (v_r2 ->> 'id')::uuid;
  perform pg_temp.back();
  perform pg_temp.rec('the override is stored with the warning', 'true',
    (select (cardinality(warnings) > 0 and override_reason = 'cover agreed with both doctors')::text from public.on_call_rota where id = v_r2_id));
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('no gap inside the covered 24 hours', '0', (select count(*)::text from public.rota_coverage_gaps(v_org, t1, t1 + interval '24 hours')));
  perform pg_temp.rec('uncovered hours after the rota show as one gap', '1', (select count(*)::text from public.rota_coverage_gaps(v_org, t1 + interval '24 hours', t1 + interval '48 hours') where kind = 'uncovered'));
  perform pg_temp.back();
  perform pg_temp.rec('uncovered hours inside 48 hours open one incident', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'rota_gap:' || v_org and status not in ('resolved', 'closed')));
  perform pg_temp.act(v_cmo);
  perform public.cancel_on_call_rota(v_r2_id, 'test cancel');
  perform pg_temp.rec('cancelling a shift opens a gap straight away', '1', (select count(*)::text from public.rota_coverage_gaps(v_org, t1 + interval '12 hours', t1 + interval '24 hours') where kind = 'uncovered'));
  v_r2 := public.set_on_call_rota(t1 + interval '12 hours', t1 + interval '24 hours', v_b, v_c, 'cover agreed with both doctors');
  v_r2_id := (v_r2 ->> 'id')::uuid;
  perform pg_temp.back();
  -- swaps: nothing changes until accepted AND approved
  perform pg_temp.act(v_c);
  perform pg_temp.rec('a clinician who does not hold the slot cannot ask for a swap', '42501', pg_temp.try(format('select public.request_rota_swap(%L, ''primary'', %L, ''tired'')', v_r1_id, v_d)));
  perform pg_temp.back();
  perform pg_temp.act(v_a);
  v_swap := public.request_rota_swap(v_r1_id, 'primary', v_d, 'family event');
  perform pg_temp.back();
  perform pg_temp.act(v_a);
  perform pg_temp.rec('the requester sees the swap as outgoing', '1', (select count(*)::text from public.my_rota_swaps() where direction = 'outgoing'));
  perform pg_temp.back();
  perform pg_temp.act(v_d);
  perform pg_temp.rec('the colleague sees it as incoming', '1', (select count(*)::text from public.my_rota_swaps() where direction = 'incoming'));
  perform pg_temp.back();
  perform pg_temp.act(v_nc);
  perform pg_temp.rec('an uninvolved clinician sees no swaps', '0', (select count(*)::text from public.my_rota_swaps()));
  perform pg_temp.back();
  perform pg_temp.rec('a requested swap changes nothing', v_a::text, (select primary_clinician_id::text from public.on_call_rota where id = v_r1_id));
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('an unaccepted swap cannot be approved', '22023', pg_temp.try(format('select public.approve_rota_swap(%L)', v_swap)));
  perform pg_temp.back();
  perform pg_temp.act(v_d);
  perform public.respond_rota_swap(v_swap, true);
  perform pg_temp.back();
  perform pg_temp.rec('an accepted swap still changes nothing', v_a::text, (select primary_clinician_id::text from public.on_call_rota where id = v_r1_id));
  perform pg_temp.act(v_cmo);
  perform public.approve_rota_swap(v_swap);
  perform pg_temp.back();
  perform pg_temp.rec('an approved swap changes the primary', v_d::text, (select primary_clinician_id::text from public.on_call_rota where id = v_r1_id));
  -- urgent cover: a swap on a shift that starts within the urgent window applies on acceptance when it is clean
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, is_test)
    values (v_org, now() - interval '10 minutes', now() + interval '3 hours', v_a, v_c, true) returning id into v_r2_id;
  perform set_config('tarragon.lead_write', 'off', true);
  perform pg_temp.act(v_a); v_swap := public.request_rota_swap(v_r2_id, 'primary', v_e, 'urgent: called away'); perform pg_temp.back();
  perform pg_temp.act(v_e); perform public.respond_rota_swap(v_swap, true); perform pg_temp.back();
  perform pg_temp.rec('urgent cover applies on acceptance without waiting for a reviewer', v_e::text || ',approved', (select r.primary_clinician_id::text || ',' || s.state::text from public.on_call_rota r join public.rota_swaps s on s.rota_id = r.id where s.id = v_swap));
  perform pg_temp.rec('an urgent swap is audited', '1', (select count(*)::text from public.audit_log where action = 'rota.swap_urgent' and entity_id = v_swap));
  perform pg_temp.rec('the reviewers are told straight away', 'true', (select (count(*) >= 1)::text from public.notifications where recipient_id = v_cmo and template = 'credential_notice' and payload ->> 'audience' = 'rota_review' and payload ->> 'subject' = 'Urgent rota cover taken'));
  -- S15's four argument calls keep the credentialing audience, and a notice only reaches the organisation it names
  perform private.credential_notify_reviewers(v_org, 'Default audience probe', 'probe', '{}'::jsonb);
  perform pg_temp.rec('a four argument reviewer call still carries the reviewer audience', 'true', (select (count(*) >= 1)::text from public.notifications where recipient_id = v_cmo and payload ->> 'subject' = 'Default audience probe' and payload ->> 'audience' = 'reviewer'));
  perform private.credential_notify_reviewers(gen_random_uuid(), 'Other org probe', 'probe', '{}'::jsonb, 'rota_review');
  perform pg_temp.rec('a reviewer notice for another organisation does not reach this one', '0', (select count(*)::text from public.notifications where payload ->> 'subject' = 'Other org probe'));
  perform pg_temp.rec('the clinician who handed it over is told', '1', (select count(*)::text from public.notifications where recipient_id = v_a and payload ->> 'subject' = 'Your shift is covered' and channel = 'in_app'));
  -- an urgent swap that would break a fatigue limit (v_d is primary on a shift within 11 hours) is not waved through
  perform set_config('tarragon.lead_write', 'on', true);
  update public.on_call_rota set primary_clinician_id = v_c, backup_clinician_id = v_a where id = v_r2_id;
  perform set_config('tarragon.lead_write', 'off', true);
  perform pg_temp.act(v_c); v_swap := public.request_rota_swap(v_r2_id, 'primary', v_d, 'urgent: second case'); perform pg_temp.back();
  perform pg_temp.act(v_d); perform public.respond_rota_swap(v_swap, true); perform pg_temp.back();
  perform pg_temp.rec('an urgent swap with a fatigue warning waits for a reviewer', v_c::text || ',accepted', (select r.primary_clinician_id::text || ',' || s.state::text from public.on_call_rota r join public.rota_swaps s on s.rota_id = r.id where s.id = v_swap));
  -- the slot changes hands under a pending urgent request: the acceptance must not overwrite the new holder
  perform pg_temp.act(v_a); v_swap := public.request_rota_swap(v_r2_id, 'backup', v_e, 'urgent: third case'); perform pg_temp.back();
  perform set_config('tarragon.lead_write', 'on', true);
  update public.on_call_rota set backup_clinician_id = v_nc where id = v_r2_id;
  perform set_config('tarragon.lead_write', 'off', true);
  perform pg_temp.act(v_e); perform public.respond_rota_swap(v_swap, true); perform pg_temp.back();
  perform pg_temp.rec('an urgent acceptance does not overwrite a slot that changed hands since the request', v_nc::text || ',accepted', (select r.backup_clinician_id::text || ',' || s.state::text from public.on_call_rota r join public.rota_swaps s on s.rota_id = r.id where s.id = v_swap));
  perform set_config('tarragon.lead_write', 'on', true);
  delete from public.rota_swaps where rota_id = v_r2_id;
  delete from public.on_call_rota where id = v_r2_id;
  perform set_config('tarragon.lead_write', 'off', true);
  perform pg_temp.act(v_b);
  perform pg_temp.rec('lead-b is primary in a live shift: cancelling the on-call hours is refused (S18 rule)', '22023', pg_temp.try(format('select public.cancel_availability(%L)', v_blk_b_oncall)));
  perform pg_temp.back();

  -- 4. Conflicts (S17 owns the table and the writers; S18 reacts) ------------------------------------------------
  perform pg_temp.act(v_nc);
  perform pg_temp.rec('declaring a conflict for an unknown patient is refused (S17)', '22023', pg_temp.try(format('select public.declare_conflict(%L, ''a patient who does not exist'')', gen_random_uuid())));
  perform public.declare_conflict(p5, 'my cousin');
  perform pg_temp.back();
  perform pg_temp.rec('a clinician declares their own conflict (pending until the CMO decides)', '1', (select count(*)::text from public.clinician_conflicts where clinician_id = v_nc and patient_id = p5 and status = 'pending_review' and source = 'self_declared'));
  perform pg_temp.rec('a pending conflict already bars the clinician', 'true', private.has_conflict(v_nc, p5)::text);
  perform pg_temp.act(v_nc);
  perform pg_temp.rec('a clinician cannot lift a conflict', '42501', pg_temp.try(format('select public.lift_conflict((select id from public.clinician_conflicts where clinician_id = %L limit 1), ''no longer applies at all'')', v_nc)));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('lifting needs a written reason', '22023', pg_temp.try(format('select public.lift_conflict((select id from public.clinician_conflicts where clinician_id = %L limit 1), ''no'')', v_nc)));
  perform public.lift_conflict((select id from public.clinician_conflicts where clinician_id = v_nc and patient_id = p5), 'relationship confirmed as ended');
  perform pg_temp.back();
  perform pg_temp.rec('a lifted conflict no longer bars', 'false', private.has_conflict(v_nc, p5)::text);

  -- 5. Lead assignment ----------------------------------------------------------------------------------------
  perform pg_temp.act(v_nc);
  perform pg_temp.rec('a clinician without the capability cannot assign a lead', '42501', pg_temp.try(format('select public.assign_lead_clinician(%L)', p6)));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform public.assign_lead_clinician(p1);
  perform pg_temp.back();
  perform pg_temp.rec('p1 (English): highest reliability among equals is lead-a', v_a::text, (select clinician_id::text from public.lead_assignments where patient_id = p1 and state = 'active'));
  perform pg_temp.rec('care_team_assignment moved in the same transaction', v_a::text, (select clinician_id::text from public.care_team_assignment where patient_id = p1));
  perform pg_temp.rec('the assignment records the config version', private.lead_config_version()::text, (select config_version::text from public.lead_assignments where patient_id = p1 and state = 'active'));
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('assigning again keeps the same lead', v_a::text, public.assign_lead_clinician(p1)::text);
  perform pg_temp.back();
  perform pg_temp.rec('only one live lead row per patient', '1', (select count(*)::text from public.lead_assignments where patient_id = p1 and state in ('active', 'unassigned')));
  perform pg_temp.rec('lead.assigned event emitted', '1', (select count(*)::text from public.domain_events where event_type = 'lead.assigned' and patient_id = p1));
  perform pg_temp.rec('the lead is told', '1', (select count(*)::text from public.notifications where recipient_id = v_a and channel = 'in_app' and template = 'credential_notice' and payload ->> 'audience' = 'lead'));
  perform pg_temp.rec('the patient gets a care team notice', '1', (select count(*)::text from public.notifications where recipient_id = p1 and channel = 'in_app' and template = 'care_team_notice' and payload ->> 'kind' = 'assigned'));
  perform pg_temp.act(v_cmo); perform public.assign_lead_clinician(p2); perform pg_temp.back();
  perform pg_temp.rec('p2 (English): test assignments use no capacity, so highest reliability is lead-a', v_a::text, (select clinician_id::text from public.lead_assignments where patient_id = p2 and state = 'active'));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, p3, v_c);
  perform pg_temp.act(v_cmo); perform public.assign_lead_clinician(p3); perform pg_temp.back();
  perform pg_temp.rec('p3: the clinician who already treats the patient is preferred', v_c::text, (select clinician_id::text from public.lead_assignments where patient_id = p3 and state = 'active'));
  perform pg_temp.act(v_cmo); perform public.record_conflict(v_a, p4, 'family member of lead-a'); perform public.assign_lead_clinician(p4); perform pg_temp.back();
  perform pg_temp.rec('a conflicted clinician is never chosen', v_b::text, (select clinician_id::text from public.lead_assignments where patient_id = p4 and state = 'active'));
  perform pg_temp.rec('a medical officer, a doctor without the competency and a non-lead are never chosen', '0',
    (select count(*)::text from public.lead_assignments where clinician_id in (v_mo, v_nc, v_d)));
  -- a lead declares a conflict with their own patient: replaced at once
  perform pg_temp.act(v_a); perform public.declare_conflict(p1, 'turns out she is my neighbour'); perform pg_temp.back();
  perform pg_temp.rec('a lead who declares a conflict with their patient is replaced at once', 'conflict', (select end_reason::text from public.lead_assignments where patient_id = p1 and clinician_id = v_a));
  perform pg_temp.rec('p1 has a new lead who is not lead-a', 'true', (select (clinician_id is not null and clinician_id <> v_a)::text from public.lead_assignments where patient_id = p1 and state = 'active'));
  perform pg_temp.act(v_a);
  perform pg_temp.rec('INV-12: the replaced lead loses access to the chart', 'false', private.clinician_has_patient_access(p1)::text);
  perform pg_temp.back();
  perform pg_temp.act((select clinician_id from public.lead_assignments where patient_id = p1 and state = 'active'));
  perform pg_temp.rec('INV-12: the new lead has access', 'true', private.clinician_has_patient_access(p1)::text);
  perform pg_temp.back();
  perform pg_temp.rec('the patient is told the lead changed', '1', (select count(*)::text from public.notifications where recipient_id = p1 and template = 'care_team_notice' and channel = 'in_app' and payload ->> 'kind' = 'changed'));

  -- capacity: real patients count, fixture patients never do; every lead capped at one
  update public.clinical_staff set max_lead_patients = 1 where profile_id in (r1, r2, r3);
  perform pg_temp.act(v_cmo);
  perform public.assign_lead_clinician(pn1); perform public.assign_lead_clinician(pn2); perform public.assign_lead_clinician(pn3);
  perform pg_temp.back();
  perform pg_temp.rec('real patients only ever get real clinicians', '0', (select count(*)::text from public.lead_assignments la join public.clinical_staff cs on cs.profile_id = la.clinician_id where la.patient_id in (pn1, pn2, pn3) and cs.is_test));
  perform pg_temp.rec('test patients only ever get test clinicians', '0', (select count(*)::text from public.lead_assignments la join public.clinical_staff cs on cs.profile_id = la.clinician_id where la.patient_id in (p1, p2, p3, p4) and not cs.is_test));
  perform pg_temp.rec('three real patients go to three different leads at cap one', '3', (select count(distinct clinician_id)::text from public.lead_assignments where patient_id in (pn1, pn2, pn3) and state = 'active'));
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('fixture patients do not use up capacity: only the three real patients count', '3', (public.lead_capacity_status(v_org) ->> 'in_use'));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo); perform public.assign_lead_clinician(pn4); perform pg_temp.back();
  perform pg_temp.rec('everyone at the cap: the patient is unassigned', 'unassigned', (select state::text from public.lead_assignments where patient_id = pn4 and state in ('active', 'unassigned')));
  perform pg_temp.rec('an incident is open for patients without a lead', '1', (select count(*)::text from public.ops_incidents where external_reference = 'lead_unassigned:' || v_org and status not in ('resolved', 'closed')));
  perform pg_temp.rec('the patient is told their team is being arranged', '1', (select count(*)::text from public.notifications where recipient_id = pn4 and template = 'care_team_notice' and payload ->> 'kind' = 'arranging' and channel = 'in_app'));
  perform pg_temp.rec('unassigned leaves no lead in care_team_assignment', 'true', (select (count(*) = 0 or bool_and(clinician_id is null))::text from public.care_team_assignment where patient_id = pn4));
  update public.clinical_staff set max_lead_patients = 10 where profile_id in (r1, r2, r3);
  perform private.retry_unassigned_leads();
  perform pg_temp.rec('the retry raised no error', 'none', coalesce((select event ->> 'error' from public.audit_log where action = 'lead_retry.error' order by created_at desc limit 1), 'none'));
  perform pg_temp.rec('capacity freed: the retry assigns the waiting patient', 'active', (select state::text from public.lead_assignments where patient_id = pn4 and state in ('active', 'unassigned')));

  -- 6a. A lead on leave keeps their patients (only offers pause); a lead who loses the competency does not
  perform pg_temp.act(v_cmo); perform public.assign_lead_clinician(p5); perform pg_temp.back();
  perform pg_temp.rec('p5 is led by lead-a (highest reliability)', v_a::text, (select clinician_id::text from public.lead_assignments where patient_id = p5 and state = 'active'));
  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason) values (v_org, v_a, 'leave', now() - interval '1 hour', now() + interval '2 days', 's18 leave test');
  perform private.lead_reconcile();
  perform pg_temp.rec('a lead on leave keeps their patients (the nightly check does not move them)', v_a::text, (select clinician_id::text from public.lead_assignments where patient_id = p5 and state = 'active'));
  perform pg_temp.rec('a lead on leave is not offered a new patient', 'true', (select (not exists (select 1 from private.lead_candidates(p7, '{}', true) where cand = v_a))::text));
  delete from public.provider_time_off where clinician_id = v_a and reason = 's18 leave test';
  -- manual edits of care_team_assignment cannot split chart access from the lead record
  perform pg_temp.rec('a hand edit of the clinician is refused while a lead record is live', '23514', pg_temp.try(format('update public.care_team_assignment set clinician_id = %L where patient_id = %L', v_nc, p5)));
  begin
    update public.care_team_assignment set clinician_id = null where patient_id = p5;
    v_txt := 'ok';
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then v_txt := sqlstate; end if;
  end;
  perform pg_temp.rec('clearing the clinician is always allowed (it only removes access)', 'ok', v_txt);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, p7, v_d);
  perform pg_temp.rec('a patient with no lead record can still be edited by hand', 'ok', pg_temp.try(format('update public.care_team_assignment set clinician_id = %L where patient_id = %L', v_c, p7)));
  delete from public.care_team_assignment where patient_id = p7;
  -- reconcile catches a missed event: lead-c and real-lead-3 lose the lead competency by a direct change
  update public.clinician_competencies set revoked_at = now(), revoked_by = v_admin
   where competency_code = 'lead_clinician' and revoked_at is null and clinical_staff_id in (v_staff_c, v_staff_r3);
  perform private.lead_reconcile();
  perform pg_temp.rec('reconcile moves every patient off a lead without the competency', '0', (select count(*)::text from public.lead_assignments where clinician_id in (v_c, r3) and state = 'active'));
  perform pg_temp.rec('the history says why', 'competency_revoked', (select end_reason::text from public.lead_assignments where patient_id = p3 and clinician_id = v_c));
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (v_org, v_staff_c, 'lead_clinician', v_admin, true);
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (v_org, v_staff_r3, 'lead_clinician', v_admin, false);

  -- a staff change of lead needs a written reason
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('changing a lead needs a written reason', '22023', pg_temp.try(format('select public.change_lead_clinician(%L, ''patient_request'', ''no'')', p4)));
  perform pg_temp.rec('a lead can be changed on request with a reason', 'ok', pg_temp.try(format('select public.change_lead_clinician(%L, ''patient_request'', ''the patient asked for a different clinician'')', p4)));
  perform pg_temp.back();
  perform pg_temp.rec('the change is recorded with its reason', 'patient_request', (select end_reason::text from public.lead_assignments where patient_id = p4 and state = 'ended' order by ended_at desc limit 1));

  -- 8. Access --------------------------------------------------------------------------------------------------
  perform pg_temp.act(p1);
  perform pg_temp.rec('a patient reads no lead assignments directly', '0', (select count(*)::text from public.lead_assignments));
  perform pg_temp.rec('a patient reads no conflicts', '0', (select count(*)::text from public.clinician_conflicts));
  perform pg_temp.rec('a patient reads no rota', '0', (select count(*)::text from public.on_call_rota));
  perform pg_temp.rec('a patient reads no availability', '0', (select count(*)::text from public.availability_blocks));
  perform pg_temp.rec('a patient sees their lead through the function only', '1', (select count(*)::text from public.my_care_team_lead() where status = 'assigned'));
  perform pg_temp.rec('a patient cannot read capacity', '42501', pg_temp.try('select public.lead_capacity_status()'));
  perform pg_temp.rec('a patient cannot call the bus entry point', '42501', pg_temp.try(format('select public.lead_on_clinician_event(%L, ''clinician.suspended'')', v_staff_a)));
  perform pg_temp.back();
  perform pg_temp.act(v_nc);
  perform pg_temp.rec('another clinician reads no lead assignments', '0', (select count(*)::text from public.lead_assignments));
  perform pg_temp.rec('another clinician reads no one else''s conflicts', '0', (select count(*)::text from public.clinician_conflicts where clinician_id <> v_nc));
  perform pg_temp.rec('a working clinician reads the rota', 'true', (select (count(*) > 0)::text from public.on_call_rota));
  perform pg_temp.rec('a clinician cannot insert a lead row', '42501', pg_temp.try(format('insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, config_version) values (%L, %L, %L, ''active'', ''admin'', 1)', v_org, p6, v_nc)));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the chief medical officer reads every lead assignment', 'true', (select (count(*) >= 8)::text from public.lead_assignments));
  perform pg_temp.rec('cover status: enough clinicians for the rota', 'true', (select (public.on_call_cover_status(v_org) ->> 'enough_clinicians')::text));
  perform pg_temp.rec('lead overview lists the lead-capable clinicians with their load', 'true', (select (jsonb_array_length(public.lead_overview() -> 'leads') >= 3)::text from (select 1) x));
  perform pg_temp.rec('rota overview lists the live shifts for a reviewer', 'true', (select (jsonb_array_length(public.rota_overview() -> 'shifts') >= 2)::text from (select 1) x));
  perform pg_temp.rec('rota overview lists the on-call capable clinicians', 'true', (select (jsonb_array_length(public.rota_overview() -> 'clinicians') >= 4)::text from (select 1) x));
  perform pg_temp.back();
  perform pg_temp.act(v_a);
  perform pg_temp.rec('a lead sees their own count against the cap', 'true', (select ((public.my_lead_summary() ->> 'cap')::int = 60 and (public.my_lead_summary() ->> 'lead_capable')::boolean)::text from (select 1) x));
  perform pg_temp.back();
  perform pg_temp.act(v_nc);
  perform pg_temp.rec('a clinician cannot read the reviewer overview', '42501', pg_temp.try('select public.rota_overview()'));
  perform pg_temp.rec('a clinician lists colleagues who may cover, not themselves', 'true', (select (count(*) >= 3 and bool_and(clinician_id <> v_nc))::text from public.on_call_colleagues()));
  perform pg_temp.back();
  perform pg_temp.act(p1);
  perform pg_temp.rec('a patient cannot list colleagues', '0', (select count(*)::text from public.on_call_colleagues()));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon reads no lead assignments', '42501', pg_temp.try('select count(*) from public.lead_assignments'));
  perform pg_temp.rec('anon cannot call the rota function', '42501', pg_temp.try(format('select public.set_on_call_rota(now(), now() + interval ''3 hours'', %L, %L)', v_a, v_c)));
  perform pg_temp.back();
  perform pg_temp.rec('anon has no execute on any S18 public function', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('confirm_availability_block', 'set_on_call_rota', 'cancel_on_call_rota', 'rota_coverage_gaps', 'on_call_cover_status', 'my_rota', 'request_rota_swap',
        'respond_rota_swap', 'cancel_rota_swap', 'approve_rota_swap', 'assign_lead_clinician', 'change_lead_clinician', 'my_care_team_lead', 'my_lead_summary',
        'lead_capacity_status', 'lead_overview', 'lead_on_clinician_event', 'assign_lead_for_event', 'my_availability_blocks', 'on_call_colleagues', 'rota_overview', 'my_rota_swaps')
        and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.rec('authenticated cannot execute the service-role entry points', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('lead_on_clinician_event', 'assign_lead_for_event') and has_function_privilege('authenticated', p.oid, 'EXECUTE')));
  perform pg_temp.rec('authenticated cannot execute the private lead functions', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname in ('lead_candidates', 'choose_lead', 'assign_lead_internal', 'replace_lead_internal', 'lead_reconcile', 'retry_unassigned_leads', 'rota_gap_alert', 'has_conflict')
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')));
  -- weekly hours and long shifts (NHS 2016 contract limits as configurable warnings)
  perform pg_temp.rec('a 60 hour stretch on top of the primary hours already rostered breaks the 72 hours in 7 days warning', 'true',
    (select (array_to_string(private.rota_fatigue_warnings(v_d, v_org, t1 + interval '24 hours', t1 + interval '94 hours'), '; ') like '%hours inside 7 days%')::text));
  perform pg_temp.rec('backup-only shifts do not count as hours worked', 'true',
    (select (array_to_string(private.rota_fatigue_warnings(v_c, v_org, t1 + interval '24 hours', t1 + interval '94 hours'), '; ') not like '%hours inside 7 days%')::text));
  perform pg_temp.rec('a short shift well clear of other shifts raises no hours warning', 'true',
    (select (array_to_string(private.rota_fatigue_warnings(v_c, v_org, t1 + interval '30 days', t1 + interval '30 days 8 hours'), '; ') not like '%hours inside 7 days%')::text));
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, is_test)
    select v_org, t1 + interval '40 days' + make_interval(days => g), t1 + interval '40 days 12 hours' + make_interval(days => g), v_c, v_d, true from generate_series(0, 3) g;
  perform set_config('tarragon.lead_write', 'off', true);
  perform pg_temp.rec('a fifth long shift in 7 days is warned', 'true',
    (select (array_to_string(private.rota_fatigue_warnings(v_c, v_org, t1 + interval '44 days', t1 + interval '44 days 12 hours'), '; ') like '%long shifts%')::text));
  perform pg_temp.rec('a long shift well clear of that cluster is not warned', 'true',
    (select (array_to_string(private.rota_fatigue_warnings(v_c, v_org, t1 + interval '33 days 13 hours', t1 + interval '33 days 23 hours 30 minutes'), '; ') not like '%long shifts%')::text));
  perform set_config('tarragon.lead_write', 'on', true);
  delete from public.on_call_rota where starts_at >= t1 + interval '40 days';
  perform set_config('tarragon.lead_write', 'off', true);
  perform pg_temp.rec('INV-07: no S18 notice carries a clinical word', '0',
    (select count(*)::text from public.notifications n where n.template in ('care_team_notice', 'credential_notice') and n.created_at >= now() - interval '1 hour'
        and n.recipient_id in (select id from public.profiles where full_name like 'S18 %') and n.payload::text ~* v_forbidden));
end $$;

-- 6b / 7. Safety case 16, task routing and removal. A second block so the first one's checks are final.
do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  v_staff_a uuid; v_staff_b uuid; v_staff_c uuid;
  pn1 uuid; pn2 uuid; pn3 uuid; p2 uuid; p4 uuid;
  v_task uuid; v_task2 uuid; v_rest_task uuid; v_n integer; v_new_lead uuid; v_k uuid; p6 uuid; p8 uuid; r1 uuid; r2 uuid; r3 uuid; v_staff_r1 uuid; v_staff_r2 uuid; v_staff_r3 uuid; v_t_a uuid; v_t_b uuid;
  t1 timestamptz;
begin
  -- earlier phases switched roles and left a user claim behind; the test-flag guard needs it gone to create fixtures
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_admin from fx where label = 'admin';
  select id into v_cmo from fx where label = 'cmo';
  select id into v_a from fx where label = 'lead-a';
  select id into v_b from fx where label = 'lead-b';
  select id into v_c from fx where label = 'lead-c';
  select id into v_d from fx where label = 'oncall-d';
  select id into v_staff_a from public.clinical_staff where profile_id = v_a;
  select id into v_staff_b from public.clinical_staff where profile_id = v_b;
  select id into v_staff_c from public.clinical_staff where profile_id = v_c;
  select id into pn1 from fx where label = 'real-1';
  select id into pn2 from fx where label = 'real-2';
  select id into pn3 from fx where label = 'real-3';
  select id into p2 from fx where label = 'patient-2';
  select id into p4 from fx where label = 'patient-4';
  select id into p6 from fx where label = 'patient-6';
  select id into r1 from fx where label = 'real-lead-1';
  select id into r2 from fx where label = 'real-lead-2';
  select id into r3 from fx where label = 'real-lead-3';
  select id into v_staff_r1 from public.clinical_staff where profile_id = r1;
  select id into v_staff_r2 from public.clinical_staff where profile_id = r2;
  select id into v_staff_r3 from public.clinical_staff where profile_id = r3;
  p8 := pg_temp.mkuser(v_org, 'patient-8', 'patient', 'en');
  v_k := pg_temp.mkdoc(v_org, v_admin, 'lead-k', 'senior_medical_officer', 'contracted', '{en}', 10, '{lead_clinician,hypertension}');

  -- force lead-b (contracted) as lead of pn2 for the routing test (fixture-only write behind the guard flag)
  perform set_config('tarragon.lead_write', 'on', true);
  update public.lead_assignments set state = 'ended', ended_at = now(), end_reason = 'superseded' where patient_id = p2 and state = 'active';
  insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, config_version, is_test) values (v_org, p2, v_b, 'active', 'admin', 1, true);
  update public.care_team_assignment set clinician_id = v_b where patient_id = p2;
  perform set_config('tarragon.lead_write', 'off', true);

  -- lead-b has confirmed queue hours today: the task is offered to them
  v_task := private.create_clinical_task(p2, 'amber_bp_review', null, 's18-offer-1');
  perform pg_temp.rec('a contracted lead with declared hours is offered the task', 'offered_to_lead,' || v_b::text,
    (select state::text || ',' || lead_clinician_id::text from public.clinical_tasks where id = v_task));
  -- lead-b cancels the hours: the next task goes to the pool, not into a window nobody is working
  perform pg_temp.act(v_b);
  perform public.cancel_availability((select id from public.availability_blocks where clinician_id = v_b and kind = 'queue' and state <> 'cancelled' limit 1));
  perform pg_temp.back();
  v_task2 := private.create_clinical_task(p2, 'amber_bp_review', null, 's18-offer-2');
  perform pg_temp.rec('a contracted lead with no declared hours: the task goes to the pool', 'true',
    (select (state in ('open') or (state = 'offered_to_lead' and lead_clinician_id is distinct from v_b))::text from public.clinical_tasks where id = v_task2));

  -- post-call rest: lead-a worked a 12 hour on-call shift that ended two hours ago
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, is_test)
    values (v_org, now() - interval '14 hours', now() - interval '2 hours', v_a, v_c, true);
  perform set_config('tarragon.lead_write', 'off', true);
  perform pg_temp.rec('post-call rest is recognised', 'true', private.clinician_in_post_call_rest(v_a)::text);
  perform pg_temp.rec('a clinician who has not worked a long shift is not resting', 'false', private.clinician_in_post_call_rest(v_d)::text);
  perform pg_temp.rec('the backup is not resting: only the primary was on duty', 'false', private.clinician_in_post_call_rest(v_c)::text);
  perform pg_temp.act(v_cmo); perform public.assign_lead_clinician(p6); perform pg_temp.back();
  perform pg_temp.rec('p6 is led by lead-a', v_a::text, (select clinician_id::text from public.lead_assignments where patient_id = p6 and state = 'active'));
  v_rest_task := private.create_clinical_task(p6, 'amber_bp_review', null, 's18-rest-1');
  perform pg_temp.rec('a lead in post-call rest is not offered the task', 'true',
    (select (lead_clinician_id is distinct from v_a and pushed_to is distinct from v_a)::text from public.clinical_tasks where id = v_rest_task));
  perform set_config('tarragon.lead_write', 'on', true);
  delete from public.on_call_rota where primary_clinician_id = v_a and is_test and ends_at <= now();
  perform set_config('tarragon.lead_write', 'off', true);

  -- 6b. SAFETY CASE 16: lead-b's licence expires; the nightly sweep suspends; the handler moves everything
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, is_test)
    values (v_org, v_b, now() + interval '30 hours', now() + interval '34 hours', 'queue', 'declared', true);
  update public.clinical_staff set max_lead_patients = 50 where profile_id in (v_a, v_c);
  update public.clinical_staff set license_expires_at = now() - interval '2 days' where id = v_staff_b;
  perform private.credential_expiry_sweep();
  perform pg_temp.rec('the nightly credential sweep suspends the lead whose licence expired', 'suspended', (select status::text from public.clinical_staff where id = v_staff_b));
  perform pg_temp.rec('before the handler runs, the old lead is still on file (the event is what moves them)', 'true',
    (select (count(*) > 0)::text from public.lead_assignments where clinician_id = v_b and state = 'active'));
  perform pg_temp.rec('the suspension emitted its event', 'true', (select (count(*) > 0)::text from public.domain_events where event_type = 'clinician.suspended' and payload ->> 'clinical_staff_id' = v_staff_b::text));
  perform public.lead_on_clinician_event(v_staff_b, 'clinician.suspended');
  perform pg_temp.rec('SAFETY CASE 16: no patient keeps the expired clinician as lead', '0', (select count(*)::text from public.lead_assignments where clinician_id = v_b and state = 'active'));
  perform pg_temp.rec('every patient of the expired lead has a live lead row again', '0', (select count(*)::text from public.lead_assignments where state = 'unassigned' and patient_id in (p2, p4)));
  perform pg_temp.rec('the history says the licence expired', 'true', (select (count(*) > 0)::text from public.lead_assignments where patient_id = p2 and clinician_id = v_b and end_reason = 'licence_expired'));
  perform pg_temp.rec('care_team_assignment no longer names the expired lead', '0', (select count(*)::text from public.care_team_assignment where clinician_id = v_b));
  perform pg_temp.rec('the patient is told the lead changed', 'true', (select (count(*) > 0)::text from public.notifications where recipient_id = p2 and template = 'care_team_notice' and payload ->> 'kind' = 'changed'));
  select clinician_id into v_new_lead from public.lead_assignments where patient_id = p2 and state = 'active';
  perform pg_temp.rec('the offered task followed the patient to the new lead', v_new_lead::text, (select lead_clinician_id::text from public.clinical_tasks where id = v_task));
  perform pg_temp.rec('the removed clinician''s declared hours are cancelled', '0', (select count(*)::text from public.availability_blocks where clinician_id = v_b and state <> 'cancelled' and ends_at > now()));
  perform pg_temp.rec('the removed clinician is out of the rota (primary replaced by the backup)', '0', (select count(*)::text from public.on_call_rota where cancelled_at is null and ends_at > now() and (primary_clinician_id = v_b or backup_clinician_id = v_b)));
  perform pg_temp.rec('running the handler twice changes nothing', '0', coalesce((public.lead_on_clinician_event(v_staff_b, 'clinician.suspended') ->> 'leads_moved')::int, 0)::text);

  -- an offered task follows a lead change only to someone who can actually be working inside the window
  perform pg_temp.act(v_cmo); perform public.assign_lead_clinician(p8); perform pg_temp.back();
  v_t_a := private.create_clinical_task(p8, 'amber_bp_review', null, 's18-reroute-1');
  perform pg_temp.rec('the task is offered to the patient''s lead', 'offered_to_lead', (select state::text from public.clinical_tasks where id = v_t_a));
  perform private.reroute_offered_tasks(p8, v_a, v_k);
  perform pg_temp.rec('a new lead with no declared hours is not given an exclusive offer: the task goes to the pool', 'open,none',
    (select state::text || ',' || coalesce(lead_clinician_id::text, 'none') from public.clinical_tasks where id = v_t_a));
  v_t_b := private.create_clinical_task(p8, 'amber_bp_review', null, 's18-reroute-2');
  perform private.reroute_offered_tasks(p8, v_a, v_c);
  perform pg_temp.rec('a new lead who is working keeps the offer', 'offered_to_lead,' || v_c::text,
    (select state::text || ',' || coalesce(lead_clinician_id::text, 'none') from public.clinical_tasks where id = v_t_b));
  update public.clinical_staff set active = false where profile_id = v_k;

  -- nobody left to lead: suspend every lead-capable clinician; every patient is unassigned, tasks open, an incident stands
  update public.clinical_staff set license_expires_at = now() - interval '1 day' where id in (v_staff_a, v_staff_c, v_staff_r1, v_staff_r2, v_staff_r3);
  perform private.credential_expiry_sweep();
  perform public.lead_on_clinician_event(v_staff_a, 'clinician.suspended');
  perform public.lead_on_clinician_event(v_staff_c, 'clinician.suspended');
  perform public.lead_on_clinician_event(v_staff_r1, 'clinician.suspended');
  perform public.lead_on_clinician_event(v_staff_r2, 'clinician.suspended');
  perform public.lead_on_clinician_event(v_staff_r3, 'clinician.suspended');
  perform pg_temp.rec('with no lead-capable clinician left, patients are unassigned, never silently dropped', 'true',
    (select (count(*) > 0 and bool_and(clinician_id is null))::text from public.lead_assignments where state in ('active', 'unassigned') and patient_id in (p2, p4, p6, p8, pn1, pn2, pn3)));
  perform pg_temp.rec('an open incident stands for patients without a lead', '1', (select count(*)::text from public.ops_incidents where external_reference = 'lead_unassigned:' || v_org and status not in ('resolved', 'closed')));
  perform pg_temp.rec('offered tasks of removed leads moved to the pool', '0', (select count(*)::text from public.clinical_tasks where patient_id in (p2, p4, p6, p8, pn1, pn2, pn3) and state = 'offered_to_lead' and lead_clinician_id in (v_a, v_b, v_c, r1, r2, r3)));
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('capacity status reports no room', 'false', (public.lead_capacity_status(v_org) ->> 'accepting_new_patients'));
  perform pg_temp.back();
  perform pg_temp.rec('uncovered and thin rota hours remain visible after removals', 'true',
    (select (count(*) > 0)::text from private.rota_gaps(v_org, now(), now() + interval '14 days')));
  perform pg_temp.rec('every active lead_assignments row has an eligible clinician', '0',
    (select count(*)::text from public.lead_assignments la where la.state = 'active' and not private.clinician_is_eligible(la.clinician_id)));
end $$;

-- 9. SABOTAGE ------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_admin uuid; v_e uuid; p9 uuid; v_before text; v_after text;
begin
  -- earlier phases switched roles and left a user claim behind; the test-flag guard (is_test only by an admin or a service context) needs it gone
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_admin from fx where label = 'admin';
  v_e := pg_temp.mkdoc(v_org, v_admin, 'lead-e', 'senior_medical_officer', 'employed', '{en}', 99, '{lead_clinician,hypertension}');
  p9 := pg_temp.mkuser(v_org, 'patient-sabotage', 'patient', 'en');
  insert into public.clinician_conflicts (organisation_id, clinician_id, patient_id, reason, source, status, is_test) values (v_org, v_e, p9, 'sabotage fixture', 'cmo', 'active', true);
  -- real: with the conflict check in place the conflicted clinician is not chosen
  perform pg_temp.rec('the conflicted clinician is not chosen', 'false', (coalesce(private.choose_lead(p9) = v_e, false))::text);
  -- sabotage 1: drop the write guard; a direct insert must now succeed (so the "refused" check above would fail)
  drop trigger lead_assignments_guard on public.lead_assignments;
  insert into results values ('sabotaged', 'the owner cannot insert a lead row directly (guard)', '42501',
    pg_temp.try(format('insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, config_version, is_test) values (%L, %L, %L, ''active'', ''admin'', 1, true)', v_org, p9, v_e)));
  delete from public.lead_assignments where patient_id = p9;
  -- sabotage 2: make has_conflict return false; the conflicted clinician must now be chosen
  create or replace function private.has_conflict(p_clinician uuid, p_patient uuid) returns boolean language sql as $f$ select false $f$;
  insert into results values ('sabotaged', 'the conflicted clinician is not chosen', 'false', (coalesce(private.choose_lead(p9) = v_e, false))::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S18 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed: the runner treats
-- any FAIL verdict in the output as a failed proof.

rollback;
