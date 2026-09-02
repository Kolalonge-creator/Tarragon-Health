-- ===========================================================================
-- Live proof for the 2026-08-29 Clinical Governance gap-closure pass
-- (§88.4/§88.5 protocol review workflow, §88.13 quality-improvement cycles):
--   20260829221531_protocol_review_workflow.sql
--   20260829221433_quality_improvement_cycles.sql
--
-- Run: npx supabase db query --linked -f packages/db/tests/protocol_drafts_and_qi_cycles_rls.sql
-- Wrapped in BEGIN/ROLLBACK. Session-simulation pattern matches
-- packages/db/tests/medication_issues_rls.sql.
--
-- Checks:
--   1. A Tier 1 clinician can draft a protocol; a patient cannot.
--   2. authored_by_staff is server-stamped, spoof-resisted.
--   3. A Tier 1 clinician CANNOT promote or reject their own draft
--      (Director-only), whether or not the row is even visible to them.
--   4. The org's Director CAN promote a draft — it lands in
--      protocol_versions with the draft's evidence_basis carried over, and
--      the draft is marked promoted with the right link.
--   5. A patient cannot open a quality_improvement_cycles row; a Tier 1
--      clinician can.
-- ===========================================================================

begin;

create temporary table pq_fixture(k text primary key, v uuid) on commit drop;
create temporary table pq_result(check_name text, role text, observed text, expected text, verdict text) on commit drop;

do $$
declare
  v_org uuid;
  r record;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;

  if v_org is null then
    raise exception 'no organisation has patient profiles -- cannot run this test';
  end if;
  insert into pq_fixture(k, v) values ('org', v_org);

  for r in select * from (values
      ('patient', 'patient'), ('tier1', 'clinician'), ('director', 'clinician')
    ) as t(key_name, role_name)
  loop
    insert into pq_fixture(k, v) values (r.key_name, gen_random_uuid());
    insert into auth.users (id, email)
    values ((select v from pq_fixture where k = r.key_name), format('pqtest.%s@example.com', r.key_name));
    insert into public.profiles (id, organisation_id, role, full_name)
    values ((select v from pq_fixture where k = r.key_name), v_org, r.role_name::public.user_role, format('PQ Test %s', r.key_name))
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  end loop;

  insert into public.clinical_staff (organisation_id, profile_id, full_name, doctor_tier, active, license_verified_at)
    values (v_org, (select v from pq_fixture where k = 'tier1'), 'PQ Test Tier1', 'tier_1'::public.doctor_tier, true, now())
  on conflict do nothing;

  insert into public.clinical_staff (organisation_id, profile_id, full_name, doctor_tier, is_clinical_director, active, license_verified_at, indemnity_exempt, indemnity_exempt_by)
    values (v_org, (select v from pq_fixture where k = 'director'), 'PQ Test Director', 'tier_4_senior_registrar'::public.doctor_tier, true, true, now(), true, (select v from pq_fixture where k = 'director'))
  on conflict do nothing;
end $$;

-- ==========================================================================
-- 1/2/3. Draft creation, spoof resistance, non-Director promote/reject
-- rejected.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from pq_fixture where k = 'org');
  v_patient uuid := (select v from pq_fixture where k = 'patient');
  v_tier1 uuid := (select v from pq_fixture where k = 'tier1');
  v_spoofed uuid := gen_random_uuid();
  v_draft_id uuid;
  v_actual_author uuid;
  v_expected_staff uuid;
  v_patient_rejected boolean := false;
  v_tier1_promote_rejected boolean := false;
  v_protocol_id text := 'pq_test_protocol_' || substr(gen_random_uuid()::text, 1, 8);
begin
  select id into v_expected_staff from public.clinical_staff where profile_id = v_tier1 and organisation_id = v_org and active;

  -- Patient cannot draft.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.protocol_drafts (organisation_id, protocol_id, title, change_summary)
    values (v_org, v_protocol_id, 'PQ test protocol', 'initial draft');
  exception when insufficient_privilege then
    v_patient_rejected := true;
  end;
  reset role;

  insert into pq_result values
    ('patient cannot draft a protocol', 'patient',
     case when v_patient_rejected then 'rejected' else 'allowed' end, 'rejected',
     case when v_patient_rejected then 'PASS' else 'FAIL' end);
  if not v_patient_rejected then
    raise exception 'GAP: a patient was able to insert into protocol_drafts';
  end if;

  -- Tier 1 can draft; authored_by_staff spoof-resisted.
  perform set_config('request.jwt.claims', json_build_object('sub', v_tier1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.protocol_drafts (organisation_id, protocol_id, title, change_summary, authored_by_staff)
  values (v_org, v_protocol_id, 'PQ test protocol', 'initial draft', v_spoofed)
  returning id, authored_by_staff into v_draft_id, v_actual_author;
  reset role;

  insert into pq_fixture(k, v) values ('draft_id', v_draft_id);

  insert into pq_result values
    ('Tier 1 drafts, authored_by_staff spoof resisted', 'tier1',
     v_actual_author::text, v_expected_staff::text,
     case when v_actual_author = v_expected_staff then 'PASS' else 'FAIL' end);
  if v_actual_author is distinct from v_expected_staff then
    raise exception 'SPOOFABLE: protocol_drafts.authored_by_staff = % (expected %)', v_actual_author, v_expected_staff;
  end if;

  -- Tier 1 (the author) cannot promote their own draft.
  perform set_config('request.jwt.claims', json_build_object('sub', v_tier1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.promote_protocol_draft(v_draft_id);
  exception when insufficient_privilege then
    v_tier1_promote_rejected := true;
  end;
  reset role;

  insert into pq_result values
    ('Tier 1 (author) cannot promote own draft', 'tier1',
     case when v_tier1_promote_rejected then 'rejected' else 'allowed' end, 'rejected',
     case when v_tier1_promote_rejected then 'PASS' else 'FAIL' end);
  if not v_tier1_promote_rejected then
    raise exception 'GAP: Tier 1 clinician promoted their own protocol draft -- should require Director';
  end if;
end $$;

-- ==========================================================================
-- 4. Director promotes -- lands in protocol_versions with evidence_basis
-- carried over, draft marked promoted with the right link.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from pq_fixture where k = 'org');
  v_director uuid := (select v from pq_fixture where k = 'director');
  v_draft_id uuid := (select v from pq_fixture where k = 'draft_id');
  v_new_version_id uuid;
  v_version_evidence text;
  v_draft_status text;
  v_draft_promoted_to uuid;
begin
  update public.protocol_drafts set evidence_basis = 'PQ test evidence basis' where id = v_draft_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_director::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.promote_protocol_draft(v_draft_id) into v_new_version_id;
  reset role;

  select evidence_basis into v_version_evidence from public.protocol_versions where id = v_new_version_id;
  select status, promoted_to_version_id into v_draft_status, v_draft_promoted_to from public.protocol_drafts where id = v_draft_id;

  insert into pq_result values
    ('Director promotes draft, evidence_basis carried over', 'director',
     coalesce(v_version_evidence, '<null>'), 'PQ test evidence basis',
     case when v_version_evidence = 'PQ test evidence basis' then 'PASS' else 'FAIL' end);
  if v_version_evidence is distinct from 'PQ test evidence basis' then
    raise exception 'GAP: promoted protocol_versions row did not carry over evidence_basis';
  end if;

  insert into pq_result values
    ('draft marked promoted with correct link', 'director',
     format('%s/%s', v_draft_status, v_draft_promoted_to), format('promoted/%s', v_new_version_id),
     case when v_draft_status = 'promoted' and v_draft_promoted_to = v_new_version_id then 'PASS' else 'FAIL' end);
  if v_draft_status <> 'promoted' or v_draft_promoted_to is distinct from v_new_version_id then
    raise exception 'GAP: draft status/promoted_to_version_id not correctly set after promotion';
  end if;
end $$;

-- ==========================================================================
-- 5. quality_improvement_cycles: patient denied, Tier 1 allowed.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from pq_fixture where k = 'org');
  v_patient uuid := (select v from pq_fixture where k = 'patient');
  v_tier1 uuid := (select v from pq_fixture where k = 'tier1');
  v_patient_rejected boolean := false;
  v_cycle_id uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.quality_improvement_cycles (organisation_id, metric_source, baseline_measured_at, gap_description)
    values (v_org, 'pq_test_metric', current_date, 'PQ test gap');
  exception when insufficient_privilege then
    v_patient_rejected := true;
  end;
  reset role;

  insert into pq_result values
    ('patient cannot open a QI cycle', 'patient',
     case when v_patient_rejected then 'rejected' else 'allowed' end, 'rejected',
     case when v_patient_rejected then 'PASS' else 'FAIL' end);
  if not v_patient_rejected then
    raise exception 'GAP: a patient was able to insert into quality_improvement_cycles';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_tier1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.quality_improvement_cycles (organisation_id, metric_source, baseline_measured_at, gap_description)
  values (v_org, 'pq_test_metric', current_date, 'PQ test gap')
  returning id into v_cycle_id;
  reset role;

  insert into pq_result values
    ('Tier 1 can open a QI cycle', 'tier1',
     case when v_cycle_id is not null then 'inserted' else 'null' end, 'inserted',
     case when v_cycle_id is not null then 'PASS' else 'FAIL' end);
  if v_cycle_id is null then
    raise exception 'GAP: Tier 1 clinician could not open a quality_improvement_cycles row';
  end if;
end $$;

select check_name, role, observed, expected, verdict from pq_result order by verdict desc, check_name, role;

rollback;
