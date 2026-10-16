-- Proof (follow-up 2026-10-15, CMO and founder answers to OQ-314..358): one rota gap alert, lead_ineligibility_reason, the grandfather end
-- date, triage approval scoped to the task types a rule set uses, the identity-check consent, and the is_test audit.
--
--   A. ONE rota gap alert per organisation (S18 kept). The SR5 check returns nothing; two evaluations leave no SR5 alert or incident; the SR5
--      clean-up resolves old open rows with no notification and touches nothing else; S18's one incident per organisation resolves itself when
--      cover is back and reopens when it is lost. SABOTAGE: the S18 auto-resolve removed; the "cover back resolves it" check must flip.
--   B. OQ-350: a real clinician with an in-date licence and no recorded verification is labelled verification_missing, an expired licence stays
--      licence_expired, a suspended clinician stays suspended; test clinicians and care coordinators (exempt from the gate) are never labelled
--      verification_missing. SABOTAGE: the gate forced open; the verification_missing check must flip.
--   C. OQ-344: the migration's end-date statement sets 2027-01-13 only on config versions with a null end date; a grandfathered clinician is
--      eligible on 2027-01-13 and not on 2027-01-14 (Africa/Lagos). SABOTAGE: the date cleared; the "not eligible after" check must flip.
--   D. OQ-334: approval is refused only when a task type USED by the rule set awaits confirmation. SABOTAGE: the old "any task type" definition
--      put back; the "an unrelated type does not block" check must flip.
--   E. OQ-352: the stored identity-check consent: only the subject records or withdraws it, the lookup is service-role only, a wrong subject,
--      an unknown id and a withdrawn consent all fail. SABOTAGE: the lookup made to answer true; the "unknown id" check must flip.
--   F. OQ-345: setting is_test on a clinician is audited (audit_row_change_trg lists is_test), and a non-admin cannot set it. SABOTAGE: the
--      audit trigger dropped; the audit check must flip.
-- (B uses the real lead_end_reason value 'verification_missing' added by the first follow-up migration.)
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.rec_s(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act_anon();
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'fu-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'FU ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
-- a clinician row; p_test false makes a REAL one (the gate does not exempt it)
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text, p_test boolean default true, p_licence timestamptz default null) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, license_expires_at, is_test)
  values (p_org, v, 'FU ' || p_label, 'MDCN', 'FU-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, p_licence, p_test)
  returning id into v_staff;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, v_staff, 'on_call', p_admin, true);
  insert into public.on_call_readiness (clinician_id, checklist_version, organisation_id, items, is_test) values (v, private.readiness_version(), p_org, private.readiness_items(), true);
  return v;
end $f$;

do $do$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_a uuid; v_b uuid; v_pat uuid; v_real uuid; v_exp uuid; v_susp uuid; v_cc uuid; v_gf uuid; v_gf_staff uuid;
  v_n integer; v_def text; v_old_alert uuid; v_notif_before integer; v_notif_after integer; v_set uuid; v_set2 uuid; v_cons uuid; v_res text;
  v_other uuid; v_audit_before integer; v_real_staff uuid;
begin
  insert into public.organisations (name, type) values ('FU Proof Org', 'direct_consumer') returning id into v_org;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  -- only our fixtures count: nobody else is on the rota or the staff list for this proof
  update public.clinical_staff set active = false where is_test is not true;
  update public.credentialing_config set rules = jsonb_set(rules, '{primary_source_required}', 'true'::jsonb) where is_active;

  ---------------------------------------------------------------- A. one rota gap alert
  v_a := pg_temp.mkdoc(v_org, v_admin, 'a', 'senior_medical_officer');
  v_b := pg_temp.mkdoc(v_org, v_admin, 'b', 'senior_medical_officer');
  perform pg_temp.rec('A1 the SR5 check returns no rows', '0', (select count(*)::text from private.ops_check_rota_gap_12h('{"hours": 12}'::jsonb, true)));
  perform private.ops_evaluate_alerts(true, true);
  perform private.ops_evaluate_alerts(true, true);
  perform pg_temp.rec('A2 two SR5 evaluations raise no alert for the organisation', '0',
    (select count(*)::text from public.ops_alerts where rule_code = 'rota_gap_12h' and state = 'open' and dedup_key like v_org::text || '%'));
  perform pg_temp.rec('A2 and no SR5 incident', '0',
    (select count(*)::text from public.ops_incidents where external_reference like 'ops_alert:rota_gap_12h:' || v_org::text || '%'));
  perform private.rota_gap_alert(v_org);
  perform private.rota_gap_alert(v_org);
  perform pg_temp.rec('A3 two S18 runs leave exactly one open incident for the organisation', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'rota_gap:' || v_org and status not in ('resolved', 'closed')));
  perform private.ops_evaluate_alerts(true, true);
  perform pg_temp.rec('A3 the whole rota gap picture is ONE open incident', '1',
    (select count(*)::text from public.ops_incidents where status not in ('resolved', 'closed')
        and (external_reference = 'rota_gap:' || v_org or external_reference like 'ops_alert:rota_gap_12h:' || v_org::text || '%')));

  -- the migration's clean-up statements on seeded old SR5 rows: no notification, other titles alone
  insert into public.ops_alerts (rule_code, dedup_key, severity, detail, is_test) values ('rota_gap_12h', v_org::text || ':rota_gap', 'sev1', '{}', true) returning id into v_old_alert;
  insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (null, 'technical', 'sev1', 'Nobody is on call for part of the next 12 hours', 'old', 'ops_alert:rota_gap_12h:' || v_org::text || ':rota_gap', now(), now());
  insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (null, 'technical', 'sev2', 'FU other incident', 'x', 'ops_alert:other:' || v_org::text, now(), now());
  select count(*) into v_notif_before from public.notifications;
  update public.ops_alerts set state = 'resolved', resolved_at = now() where rule_code = 'rota_gap_12h' and state = 'open';
  update public.ops_incidents set status = 'resolved', resolved_at = now(), acknowledged_at = coalesce(acknowledged_at, now()), mitigated_at = coalesce(mitigated_at, now()),
         root_cause = 'x', corrective_action = 'y', preventive_action = 'z'
   where external_reference like 'ops_alert:rota_gap_12h:%' and status not in ('resolved', 'closed');
  select count(*) into v_notif_after from public.notifications;
  perform pg_temp.rec('A4 clean-up sends no notification', 'true', (v_notif_after = v_notif_before)::text);
  perform pg_temp.rec('A4 the old SR5 alert and incident are resolved', 'true',
    (exists (select 1 from public.ops_alerts where id = v_old_alert and state = 'resolved')
     and not exists (select 1 from public.ops_incidents where external_reference like 'ops_alert:rota_gap_12h:' || v_org::text || '%' and status not in ('resolved', 'closed')))::text);
  perform pg_temp.rec('A4 another title is untouched', 'open',
    (select status::text from public.ops_incidents where title = 'FU other incident' and external_reference = 'ops_alert:other:' || v_org::text));

  -- cover back: the S18 incident resolves itself (it never used to)
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, is_test)
    values (v_org, now() - interval '1 hour', now() + interval '200 hours', v_a, v_b, true);
  perform set_config('tarragon.lead_write', 'off', true);
  perform pg_temp.rec('A5 with cover in place the check finds no gap', '0', private.rota_gap_alert(v_org)::text);
  perform pg_temp.rec('A5 and the one incident resolved itself', '0',
    (select count(*)::text from public.ops_incidents where external_reference = 'rota_gap:' || v_org and status not in ('resolved', 'closed')));
  -- cover lost again: a new one-and-only incident
  perform set_config('tarragon.lead_write', 'on', true);
  update public.on_call_rota set cancelled_at = now(), cancelled_reason = 'proof' where organisation_id = v_org;
  perform set_config('tarragon.lead_write', 'off', true);
  perform private.rota_gap_alert(v_org);
  perform pg_temp.rec('A6 cover lost again reopens exactly one incident', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'rota_gap:' || v_org and status not in ('resolved', 'closed')));

  -- a sev2 incident for a gap that has become live is raised to sev1 (never lowered)
  update public.ops_incidents set severity = 'sev2' where external_reference = 'rota_gap:' || v_org and status not in ('resolved', 'closed');
  perform private.rota_gap_alert(v_org);
  perform pg_temp.rec('A7 a sev2 rota gap incident rises to sev1 once the gap is live', 'sev1',
    (select severity::text from public.ops_incidents where external_reference = 'rota_gap:' || v_org and status not in ('resolved', 'closed')));
  -- the minutely SR5 evaluation now keeps the S18 incident fresh (one incident, no SR5 alert, resolved by the evaluator alone when cover is back)
  perform private.ops_evaluate_alerts(true, true);
  perform private.ops_evaluate_alerts(true, true);
  perform pg_temp.rec('A8 two evaluations while the gap lasts leave exactly one open incident and no SR5 alert', '1,0',
    (select count(*)::text from public.ops_incidents where external_reference = 'rota_gap:' || v_org and status not in ('resolved', 'closed')) || ',' ||
    (select count(*)::text from public.ops_alerts where rule_code = 'rota_gap_12h' and state = 'open' and dedup_key like v_org::text || '%'));
  perform set_config('tarragon.lead_write', 'on', true);
  update public.on_call_rota set cancelled_at = null, cancelled_reason = null where organisation_id = v_org;
  perform set_config('tarragon.lead_write', 'off', true);
  perform private.ops_evaluate_alerts(true, true);
  perform pg_temp.rec('A9 cover restored: the evaluation alone resolves the incident', '0',
    (select count(*)::text from public.ops_incidents where external_reference = 'rota_gap:' || v_org and status not in ('resolved', 'closed')));
  perform set_config('tarragon.lead_write', 'on', true);
  update public.on_call_rota set cancelled_at = now(), cancelled_reason = 'proof' where organisation_id = v_org;
  perform set_config('tarragon.lead_write', 'off', true);
  perform private.rota_gap_alert(v_org);

  -- SABOTAGE A: the S18 auto-resolve removed; restore cover; the incident must stay open
  v_def := pg_get_functiondef('private.rota_gap_alert(uuid)'::regprocedure);
  execute replace(v_def, 'if v_n = 0 then', 'if v_n = 0 then return 0; end if; if false then');
  perform set_config('tarragon.lead_write', 'on', true);
  update public.on_call_rota set cancelled_at = null, cancelled_reason = null where organisation_id = v_org;
  perform set_config('tarragon.lead_write', 'off', true);
  perform private.rota_gap_alert(v_org);
  perform pg_temp.rec_s('A5 and the one incident resolved itself', '0',
    (select count(*)::text from public.ops_incidents where external_reference = 'rota_gap:' || v_org and status not in ('resolved', 'closed')));
  execute v_def;   -- put the real one back

  ---------------------------------------------------------------- B. lead_ineligibility_reason
  v_real := pg_temp.mkdoc(v_org, v_admin, 'real', 'senior_medical_officer', false, null);
  v_exp := pg_temp.mkdoc(v_org, v_admin, 'expired', 'senior_medical_officer', false, now() - interval '90 days');
  select id into v_real_staff from public.clinical_staff where profile_id = v_real;
  v_susp := pg_temp.mkdoc(v_org, v_admin, 'susp', 'senior_medical_officer', false, null);
  update public.clinical_staff set status = 'suspended', active = false, suspended_reason = 'proof' where profile_id = v_susp;
  v_cc := pg_temp.mkdoc(v_org, v_admin, 'cc', 'care_coordinator', false, null);
  perform pg_temp.rec('B1 an in-date clinician with no verification is verification_missing', 'verification_missing', private.lead_ineligibility_reason(v_real, v_pat)::text);
  perform pg_temp.rec('B2 an expired licence is still licence_expired', 'licence_expired', private.lead_ineligibility_reason(v_exp, v_pat)::text);
  perform pg_temp.rec('B3 a suspended clinician is still suspended', 'suspended', private.lead_ineligibility_reason(v_susp, v_pat)::text);
  perform pg_temp.rec('B4 a test clinician is never verification_missing', 'true', (private.lead_ineligibility_reason(v_a, v_pat)::text <> 'verification_missing')::text);
  perform pg_temp.rec('B5 a care coordinator is never verification_missing', 'true', (private.lead_ineligibility_reason(v_cc, v_pat)::text <> 'verification_missing')::text);
  perform pg_temp.rec('B6 an unknown clinician is ineligible', 'ineligible', private.lead_ineligibility_reason(gen_random_uuid(), v_pat)::text);
  -- SABOTAGE B: the gate forced open
  v_def := pg_get_functiondef('private.psv_satisfied(uuid, timestamptz)'::regprocedure);
  execute 'create or replace function private.psv_satisfied(p_staff uuid, p_at timestamptz default now()) returns boolean language sql stable security definer set search_path = '''' as $f$ select true $f$';
  perform pg_temp.rec_s('B1 an in-date clinician with no verification is verification_missing', 'verification_missing', private.lead_ineligibility_reason(v_real, v_pat)::text);
  execute v_def;

  ---------------------------------------------------------------- C. grandfather end date
  alter table public.clinical_staff disable trigger clinical_staff_guard_psv_grandfathered;
  v_gf := pg_temp.mkdoc(v_org, v_admin, 'gf', 'senior_medical_officer', false, null);
  update public.clinical_staff set psv_grandfathered = true where profile_id = v_gf returning id into v_gf_staff;
  alter table public.clinical_staff enable trigger clinical_staff_guard_psv_grandfathered;
  update public.credentialing_config set rules = jsonb_set(rules, '{grandfather_ends_on}', 'null'::jsonb) where is_active;
  insert into public.credentialing_config (version, is_active, effective_from, rules) values
    (9001, false, current_date, '{"grandfather_ends_on": null}'::jsonb),
    (9002, false, current_date, '{"grandfather_ends_on": "2030-01-01"}'::jsonb),
    (9003, false, current_date, '{"other": 1}'::jsonb);
  perform pg_temp.rec('C1 open ended before the date is set', 'true,true', private.psv_satisfied(v_gf_staff, '2027-01-14 12:00:00+01')::text || ',' || private.psv_satisfied(v_gf_staff)::text);
  -- the migration's statement
  update public.credentialing_config set rules = jsonb_set(rules, '{grandfather_ends_on}', to_jsonb('2027-01-13'::text))
   where rules ? 'grandfather_ends_on' and rules -> 'grandfather_ends_on' = 'null'::jsonb;
  perform pg_temp.rec('C2 eligible today and on 2027-01-13 (Africa/Lagos)', 'true,true', private.psv_satisfied(v_gf_staff)::text || ',' || private.psv_satisfied(v_gf_staff, '2027-01-13 12:00:00+01')::text);
  perform pg_temp.rec('C3 not eligible on 2027-01-14 without evidence', 'false', private.psv_satisfied(v_gf_staff, '2027-01-14 12:00:00+01')::text);
  perform pg_temp.rec('C4 only null end dates were touched', '2027-01-13,2030-01-01,absent',
    (select (select rules ->> 'grandfather_ends_on' from public.credentialing_config where version = 9001) || ',' ||
            (select rules ->> 'grandfather_ends_on' from public.credentialing_config where version = 9002) || ',' ||
            (select case when rules ? 'grandfather_ends_on' then 'present' else 'absent' end from public.credentialing_config where version = 9003)));
  -- SABOTAGE C: the date cleared again
  update public.credentialing_config set rules = jsonb_set(rules, '{grandfather_ends_on}', 'null'::jsonb) where is_active;
  perform pg_temp.rec_s('C3 not eligible on 2027-01-14 without evidence', 'false', private.psv_satisfied(v_gf_staff, '2027-01-14 12:00:00+01')::text);
  update public.credentialing_config set rules = jsonb_set(rules, '{grandfather_ends_on}', to_jsonb('2027-01-13'::text)) where is_active;

  ---------------------------------------------------------------- D. approval scoped to the task types the set uses
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  update public.task_types set needs_confirmation = true, confirmed_at = null, confirmed_by = null where code in ('crisis_follow_up', 'amber_glucose_review');
  update public.task_types set needs_confirmation = false where code in ('red_patient_outreach');
  update public.task_types set confirmed_by = v_cmo, confirmed_at = now() where code = 'adherence_follow_up' and is_active and needs_confirmation;
  insert into public.triage_rule_sets (code, version, status, rules) values ('fu_set', 1, 'draft',
    '{"code":"fu_set","version":1,"rules":[{"id":"R1","actions":[{"kind":"create_task","task":"bp_review","dueMinutes":60}]}]}'::jsonb) returning id into v_set;
  insert into public.triage_rule_sets (code, version, status, rules) values ('fu_glucose_set', 1, 'draft',
    '{"code":"fu_glucose_set","version":1,"rules":[{"id":"R2","actions":[{"kind":"create_task","task":"urgent_glucose_review","dueMinutes":60}]}]}'::jsonb) returning id into v_set2;
  perform pg_temp.rec('D1 a set using a task type that awaits confirmation is refused', '22023', pg_temp.try_as(v_cmo, format('select public.approve_triage_rule_set(%L)', v_set2)));
  perform pg_temp.rec('D2 an unrelated unconfirmed type (crisis_follow_up) does not block a set that never uses it', 'ok', pg_temp.try_as(v_cmo, format('select public.approve_triage_rule_set(%L)', v_set)));
  perform pg_temp.rec('D2 and it is approved', 'approved', (select status::text from public.triage_rule_sets where id = v_set));
  perform pg_temp.rec('D3 only the CMO approves', '42501', pg_temp.try_as(v_a, format('select public.approve_triage_rule_set(%L)', v_set2)));
  perform pg_temp.act(v_cmo);
  perform public.confirm_task_type('amber_glucose_review', 'proof');
  perform pg_temp.back();
  perform pg_temp.rec('D4 confirming the used type releases the set', 'ok', pg_temp.try_as(v_cmo, format('select public.approve_triage_rule_set(%L)', v_set2)));
  -- SABOTAGE D: the old "any task type" check put back; a fresh draft with an unrelated unconfirmed type must now be refused
  insert into public.triage_rule_sets (code, version, status, rules) values ('fu_set_b', 1, 'draft',
    '{"code":"fu_set_b","version":1,"rules":[{"id":"R1","actions":[{"kind":"create_task","task":"bp_review","dueMinutes":60}]}]}'::jsonb) returning id into v_set;
  v_def := pg_get_functiondef('public.approve_triage_rule_set(uuid, text)'::regprocedure);
  execute replace(v_def, 'and exists (select 1 from jsonb_path_query(rs.rules, ''$.rules[*].actions[*] ? (@.kind == "create_task")'') x
                  where t.source_task_keys @> array[x ->> ''task''])', 'and true');
  perform pg_temp.rec_s('D2 an unrelated unconfirmed type (crisis_follow_up) does not block a set that never uses it', 'ok', pg_temp.try_as(v_cmo, format('select public.approve_triage_rule_set(%L)', v_set)));
  execute v_def;

  ---------------------------------------------------------------- E. identity check consent
  v_other := pg_temp.mkuser(v_org, 'other', 'patient');
  v_res := pg_temp.q_as(v_a, $q$select public.record_identity_check_consent('nin', 'v1')::text$q$);
  v_cons := v_res::uuid;
  perform pg_temp.rec('E1 the subject records a consent', 'true', (v_cons is not null)::text);
  perform pg_temp.rec('E2 the lookup is true for the right subject', 'true', public.identity_consent_valid(v_cons, v_a, 'nin')::text);
  perform pg_temp.rec('E3 false for another subject', 'false', public.identity_consent_valid(v_cons, v_other, 'nin')::text);
  perform pg_temp.rec('E3b false for another ID kind (a NIN consent does not cover a BVN check)', 'false', public.identity_consent_valid(v_cons, v_a, 'bvn')::text);
  perform pg_temp.rec('E3c recording again returns the same live consent, never a second row', 'true,1',
    ((pg_temp.q_as(v_a, $q$select public.record_identity_check_consent('nin', 'v2')::text$q$))::uuid = v_cons)::text || ',' ||
    (select count(*)::text from public.identity_check_consents where subject_profile_id = v_a and id_kind = 'nin' and withdrawn_at is null));
  perform pg_temp.rec('E4 false for an unknown id', 'false', public.identity_consent_valid(gen_random_uuid(), v_a, 'nin')::text);
  perform pg_temp.rec('E5 an authenticated user cannot call the lookup (no oracle)', '42501', pg_temp.try_as(v_a, format('select public.identity_consent_valid(%L, %L, ''nin'')', v_cons, v_a)));
  perform pg_temp.rec('E5 nor anon', '42501', pg_temp.try_anon(format('select public.identity_consent_valid(%L, %L, ''nin'')', v_cons, v_a)));
  perform pg_temp.rec('E6 anon cannot record a consent', '42501', pg_temp.try_anon($q$select public.record_identity_check_consent('nin', 'v1')$q$));
  perform pg_temp.rec('E7 no direct insert', '42501', pg_temp.try_as(v_a, format('insert into public.identity_check_consents (subject_profile_id, id_kind, consent_text_version) values (%L, ''nin'', ''v1'')', v_a)));
  perform pg_temp.rec('E8 another user cannot withdraw it', '22023', pg_temp.try_as(v_other, format('select public.withdraw_identity_check_consent(%L)', v_cons)));
  perform pg_temp.rec('E9 the subject sees their own row only', '1,0',
    pg_temp.q_as(v_a, 'select count(*)::text from public.identity_check_consents') || ',' || pg_temp.q_as(v_other, 'select count(*)::text from public.identity_check_consents'));
  perform pg_temp.rec('E10 a bad id kind is refused', '22023', pg_temp.try_as(v_a, $q$select public.record_identity_check_consent('passport', 'v1')$q$));
  perform pg_temp.rec('E11 the subject withdraws', 'ok', pg_temp.try_as(v_a, format('select public.withdraw_identity_check_consent(%L)', v_cons)));
  perform pg_temp.rec('E11b after withdrawal no live consent remains for that kind', '0',
    (select count(*)::text from public.identity_check_consents where subject_profile_id = v_a and id_kind = 'nin' and withdrawn_at is null));
  perform pg_temp.rec('E12 a withdrawn consent fails the lookup', 'false', public.identity_consent_valid(v_cons, v_a, 'nin')::text);
  perform pg_temp.rec('E13 recording is audited', 'true',
    (exists (select 1 from public.audit_log where action = 'identity_check_consents.created' and entity_id = v_cons))::text);
  -- SABOTAGE E: the lookup answers true for anything
  v_def := pg_get_functiondef('public.identity_consent_valid(uuid, uuid, text)'::regprocedure);
  execute 'create or replace function public.identity_consent_valid(p_consent uuid, p_subject uuid, p_id_kind text) returns boolean language sql stable security definer set search_path = '''' as $f$ select true $f$';
  perform pg_temp.rec_s('E4 false for an unknown id', 'false', public.identity_consent_valid(gen_random_uuid(), v_a, 'nin')::text);
  execute v_def;

  ---------------------------------------------------------------- F. is_test exemption is audited
  select count(*) into v_audit_before from public.audit_log where action = 'clinical_staff.updated' and entity_id = v_real_staff;
  update public.clinical_staff set is_test = true where id = v_real_staff;
  perform pg_temp.rec('F1 setting is_test on a clinician writes an audit row naming the column', 'true',
    (exists (select 1 from public.audit_log where action = 'clinical_staff.updated' and entity_id = v_real_staff
               and event -> 'changed_columns' ? 'is_test'))::text);
  perform pg_temp.try_as(v_a, format('update public.clinical_staff set is_test = false where profile_id = %L', v_a));
  perform pg_temp.rec('F2 a non-admin clinician cannot clear their own is_test (refused or filtered, never changed)', 'true',
    (select is_test::text from public.clinical_staff where profile_id = v_a));
  -- SABOTAGE F: the audit trigger dropped; a second change must then leave no audit row
  drop trigger audit_row_change_trg on public.clinical_staff;
  select count(*) into v_audit_before from public.audit_log where action = 'clinical_staff.updated' and entity_id = v_real_staff;
  update public.clinical_staff set is_test = false where id = v_real_staff;
  perform pg_temp.rec_s('F1 setting is_test on a clinician writes an audit row naming the column', 'true',
    ((select count(*) from public.audit_log where action = 'clinical_staff.updated' and entity_id = v_real_staff) > v_audit_before)::text);

  raise notice 'fu_rota_gap_and_credential_followups: sections done';
end $do$;

do $$
declare v_bad text; v_caught integer; v_sab integer;
begin
  select string_agg(check_name || ' => expected [' || expected || '] got [' || coalesce(actual, 'null') || ']', '; ') into v_bad
    from results where phase = 'real' and expected is distinct from actual;
  if v_bad is not null then raise exception 'follow-up proof FAILED: %', v_bad; end if;
  select count(*) into v_sab from results where phase = 'sabotaged';
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_sab <> 6 or v_caught <> 6 then
    raise exception 'VACUOUS TEST: % sabotage checks ran, % flipped (6 expected of each): %', v_sab, v_caught,
      (select string_agg(check_name || ' [' || expected || '/' || coalesce(actual, 'null') || ']', '; ') from results where phase = 'sabotaged' and expected is not distinct from actual);
  end if;
end $$;

select phase, check_name, expected, actual,
       case when phase = 'sabotaged' then case when expected is distinct from actual then 'PASS (caught)' else 'FAIL' end
            else case when expected is not distinct from actual then 'PASS' else 'FAIL' end end as result
  from results order by phase desc, check_name;
rollback;
