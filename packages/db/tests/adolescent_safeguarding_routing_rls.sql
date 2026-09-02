-- ===========================================================================
-- Live proof for 20260902210919_adolescent_health_module.sql's patch to
-- safeguarding_concerns_select.
--
-- Context: 20260829212949_safeguarding_concerns.sql's original SELECT policy
-- (`reported_by = auth.uid() OR can_review_safeguarding_concern(...)`) was
-- safe when only org staff could ever INSERT a row (its own INSERT policy
-- requires is_org_staff), so reported_by was always a staff member's own id
-- -- a filer reading their own filed report is exactly the intended
-- behaviour (see packages/db/tests/wrong_patient_confirm_and_safeguarding_
-- rls.sql check 6, still correct and untouched by this patch).
--
-- The adolescent health module's psychosocial-check-in routing
-- (private.handle_adolescent_psychosocial_screen_flags, an AFTER INSERT
-- trigger on adolescent_psychosocial_screens) is the first path where a
-- PATIENT's own session can cause a safeguarding_concerns row to be
-- auto-inserted ABOUT THEMSELVES while auth.uid() is still that same
-- patient -- enforce_safeguarding_concern_attribution then stamps
-- reported_by := that patient's own id, and the original SELECT policy
-- would let the patient read their own safeguarding record back. That is
-- exactly the confidentiality failure this module exists to prevent (a
-- safeguarding record about someone is sometimes the one thing that must
-- not be visible to them).
--
-- Run: npx supabase db query --linked -f packages/db/tests/adolescent_safeguarding_routing_rls.sql
-- Wrapped in BEGIN/ROLLBACK -- a verification script, not seed data.
--
-- Checks:
--   1. A patient whose own psychosocial check-in flags self_harm gets a
--      safeguarding_concerns row auto-created (via the real trigger, not a
--      hand-inserted fixture) with reported_by = the patient's own id.
--   2. That same patient reads ZERO rows back from safeguarding_concerns --
--      the exact gap this migration closes.
--   3. A Tier 3 clinician in the same org reads the row (can_review_
--      safeguarding_concerns_concern branch, untouched by the patch).
--   4. Control, proving the test discriminates: a DIFFERENT org-staff
--      reporter (Care Coordinator filing about a patient who is NOT
--      themselves) still reads their own filed row -- reported_by <>
--      patient_id there, so the patch's extra condition is a no-op and the
--      original "reporter can read their own filing" behaviour survives.
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: change check 2's
-- policy-under-test back to the pre-patch form (drop the `and reported_by
-- <> patient_id` clause) and re-run -- check 2 must FAIL, showing the
-- patient reading their own safeguarding record.
-- ===========================================================================

begin;

create temporary table asr_fixture(k text primary key, v uuid) on commit drop;
create temporary table asr_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org uuid;
  r     record;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;

  if v_org is null then
    raise exception 'no organisation has patient profiles -- cannot run this test';
  end if;

  insert into asr_fixture(k, v) values ('org', v_org);

  for r in select * from (values
      ('adolescent', 'patient'), ('other_patient', 'patient'),
      ('tier3', 'clinician'), ('coordinator', 'care_coordinator')
    ) as t(key_name, role_name)
  loop
    insert into asr_fixture(k, v) values (r.key_name, gen_random_uuid());

    insert into auth.users (id, email)
    values ((select v from asr_fixture where k = r.key_name),
            format('asrtest.%s@example.com', r.key_name));

    insert into public.profiles (id, organisation_id, role, full_name, date_of_birth)
    values ((select v from asr_fixture where k = r.key_name),
            v_org, r.role_name::public.user_role, format('ASR Test %s', r.key_name),
            -- 'adolescent' gets a real 15-year-old DOB (the age band this
            -- module targets); irrelevant to the RLS checks themselves but
            -- keeps the fixture honest about what it represents.
            case when r.key_name = 'adolescent' then (current_date - interval '15 years')::date
                 when r.key_name = 'other_patient' then date '1990-01-01'
                 else null end)
    on conflict (id) do update
      set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  end loop;

  insert into public.clinical_staff
    (organisation_id, profile_id, full_name, doctor_tier, active, license_verified_at)
  values
    (v_org, (select v from asr_fixture where k = 'tier3'), 'ASR Test Tier3', 'tier_3'::public.doctor_tier, true, now())
  on conflict do nothing;
end $$;

-- ==========================================================================
-- 1. The adolescent's own self-harm-flagged check-in auto-files a
-- safeguarding_concerns row, via the real trigger chain, with
-- reported_by = the adolescent's own id.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from asr_fixture where k = 'org');
  v_adolescent uuid := (select v from asr_fixture where k = 'adolescent');
  v_screen_id uuid;
  v_concern_id uuid;
  v_reported_by uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_adolescent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.adolescent_psychosocial_screens
    (organisation_id, patient_id, self_harm_flagged)
  values (v_org, v_adolescent, true)
  returning id into v_screen_id;

  reset role;

  select id, reported_by into v_concern_id, v_reported_by
  from public.safeguarding_concerns
  where patient_id = v_adolescent
  order by created_at desc
  limit 1;

  insert into asr_fixture(k, v) values ('concern_id', v_concern_id);

  insert into asr_result values
    ('self-harm flag auto-files a safeguarding_concerns row', 'adolescent',
     case when v_concern_id is not null then 'filed' else 'not filed' end, 'filed',
     case when v_concern_id is not null then 'PASS' else 'FAIL' end);
  if v_concern_id is null then
    raise exception 'GAP: self_harm_flagged on adolescent_psychosocial_screens did not auto-file a safeguarding_concerns row';
  end if;

  insert into asr_result values
    ('auto-filed row is attributed to the patient themselves', 'adolescent',
     v_reported_by::text, v_adolescent::text,
     case when v_reported_by = v_adolescent then 'PASS' else 'FAIL' end);
  if v_reported_by is distinct from v_adolescent then
    raise exception 'fixture assumption broken: reported_by (%) is not the adolescent''s own id (%) -- checks 2-4 below are not testing what they claim to',
      v_reported_by, v_adolescent;
  end if;
end $$;

-- ==========================================================================
-- 2. The patient who was auto-attributed as the reporter of their OWN
-- concern reads ZERO rows back -- the gap this migration closes.
-- ==========================================================================
do $$
declare
  v_adolescent uuid := (select v from asr_fixture where k = 'adolescent');
  v_concern_id uuid := (select v from asr_fixture where k = 'concern_id');
  v_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_adolescent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.safeguarding_concerns where id = v_concern_id;
  reset role;

  insert into asr_result values
    ('patient cannot read their own auto-filed safeguarding concern', 'adolescent', v_count::text, '0',
     case when v_count = 0 then 'PASS' else 'FAIL' end);
  if v_count <> 0 then
    raise exception 'LEAK: patient reads % row(s) of their own safeguarding_concerns record via the reported_by=self carve-out', v_count;
  end if;
end $$;

-- ==========================================================================
-- 3. A Tier 3 clinician in the same org can still read it
-- (can_review_safeguarding_concern branch, untouched by the patch).
-- ==========================================================================
do $$
declare
  v_tier3 uuid := (select v from asr_fixture where k = 'tier3');
  v_concern_id uuid := (select v from asr_fixture where k = 'concern_id');
  v_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_tier3::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.safeguarding_concerns where id = v_concern_id;
  reset role;

  insert into asr_result values
    ('Tier 3 clinician still reads the auto-filed concern', 'tier3', v_count::text, '1',
     case when v_count = 1 then 'PASS' else 'FAIL' end);
  if v_count <> 1 then
    raise exception 'REGRESSION: Tier 3+/Clinical Director can no longer read a safeguarding_concerns row -- the patch broke the reviewer branch, not just the patient branch';
  end if;
end $$;

-- ==========================================================================
-- 4. Control: a staff reporter filing about a DIFFERENT patient still reads
-- their own filed row -- proves the patch's extra condition (reported_by <>
-- patient_id) is a no-op for the pre-existing, intended case and doesn't
-- regress it.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from asr_fixture where k = 'org');
  v_other_patient uuid := (select v from asr_fixture where k = 'other_patient');
  v_coordinator uuid := (select v from asr_fixture where k = 'coordinator');
  v_concern_id uuid;
  v_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coordinator::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.safeguarding_concerns
    (organisation_id, patient_id, concern_category, description)
  values (v_org, v_other_patient, 'child_safety', 'ASR control: staff filing about a different patient')
  returning id into v_concern_id;

  select count(*) into v_count from public.safeguarding_concerns where id = v_concern_id;
  reset role;

  insert into asr_result values
    ('control: staff reporter still reads their own filing about someone else', 'coordinator', v_count::text, '1',
     case when v_count = 1 then 'PASS' else 'FAIL' end);
  if v_count <> 1 then
    raise exception 'REGRESSION: a staff member filing a safeguarding concern about a different patient can no longer read their own filed row -- the patch over-restricted the reported_by=self carve-out';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from asr_result
order by verdict desc, check_name, role;

rollback;
