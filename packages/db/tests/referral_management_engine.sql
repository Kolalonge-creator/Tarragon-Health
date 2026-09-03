-- Tarragon Health — Referral Management Engine (2026-08-29 build).
--
-- Pins the pieces genuinely new in this build, layered on top of the
-- concurrently-shipped Specialist Referral intake/provenance/outcome/
-- closure/staleness work (20260828231858 through 20260829144134) rather
-- than duplicating what that work already proves: the clinical-tier
-- create-gate (closing the direct-insert bypass around
-- refer_patient_to_specialist's own RPC-level check), referred_by correctly
-- stamped as a clinical_staff.id, the declined-requires-reason CHECK, the
-- new 'emergency' urgency value, and 'draft' status + submission stamping.
-- Case 6 is a short end-to-end sanity check that a referral created through
-- the new create-gate can still flow through the already-live closure
-- trigger without any friction between the two.
--
-- Simulated-session pattern matches tier_authority_monotonicity.sql /
-- self_arranged_referrals.sql: the connection stays superuser throughout
-- (RLS is irrelevant to what's under test here), only request.jwt.claims is
-- set so auth.uid() resolves to a real profile.
--
-- Run: npx supabase db query --linked -f packages/db/tests/referral_management_engine.sql
-- Rolled back — nothing here persists.

begin;
create temp table r(step text, verdict text) on commit drop;

do $$
declare
  v_org           uuid := '00000000-0000-0000-0000-000000000001';
  v_pt            uuid;
  v_clinical_pf   uuid;
  v_coord_pf      uuid;
  v_clinical_staff_id uuid;
  v_coord_staff_id    uuid;
  v_ref           uuid;
  v_row           public.specialist_referrals%rowtype;
  v_caught        boolean;
begin
  select id into v_pt from public.profiles
   where organisation_id = v_org and role = 'patient' limit 1;
  if v_pt is null then
    raise exception 'fixture lookup failed - no patient in org % - test would be vacuous', v_org;
  end if;

  -- Two spare profiles (no existing clinical_staff row) to probe as a
  -- clinical-tier clinician and as a Care Coordinator, without touching any
  -- real staff record. Same technique as tier_authority_monotonicity.sql.
  select p.id into v_clinical_pf from public.profiles p
   where p.organisation_id = v_org
     and not exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id)
   order by p.created_at limit 1;
  select p.id into v_coord_pf from public.profiles p
   where p.organisation_id = v_org
     and not exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id)
     and p.id <> coalesce(v_clinical_pf, '00000000-0000-0000-0000-000000000000'::uuid)
   order by p.created_at limit 1;
  if v_clinical_pf is null or v_coord_pf is null then
    raise exception 'fixture lookup failed - not enough spare profiles in org % - test would be vacuous', v_org;
  end if;

  insert into public.clinical_staff
    (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
  values (v_org, v_clinical_pf, 'RME Probe Clinician', true, now(), 'tier_2')
  returning id into v_clinical_staff_id;

  insert into public.clinical_staff
    (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
  values (v_org, v_coord_pf, 'RME Probe Coordinator', true, now(), 'care_coordinator')
  returning id into v_coord_staff_id;

  -- ---------------------------------------------------------------------
  -- 1. Care Coordinator is blocked from creating a referral directly
  --    (the gap the concurrently-shipped refer_patient_to_specialist RPC
  --    leaves open — its own tier check only covers that one RPC path).
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord_pf, 'role', 'authenticated')::text, true);
  v_caught := false;
  begin
    insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, referral_reason)
    values (v_org, v_pt, 'cardiology', 'Coordinator should not be able to do this');
  exception when insufficient_privilege then v_caught := true;
  end;
  insert into r values ('1 care_coordinator blocked from creating a referral (direct insert)', case when v_caught then 'PASS' else 'FAIL' end);

  -- ---------------------------------------------------------------------
  -- 2. Clinical tier CAN create a referral; referred_by is stamped as a
  --    clinical_staff.id (not a bare profile id — the column's real FK
  --    target, confirmed live via 20260828231917), organisation_id is
  --    forge-proof, and the new referral_source/requested_service fields
  --    round-trip.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_clinical_pf, 'role', 'authenticated')::text, true);
  insert into public.specialist_referrals
    (organisation_id, patient_id, specialist_type, referral_reason, referral_source, requested_service, urgency)
  values (v_org, v_pt, 'cardiology', 'Persistently raised BP despite two agents', 'chronic_care_programme', 'Echo + outpatient review', 'priority')
  returning id into v_ref;
  select * into v_row from public.specialist_referrals where id = v_ref;
  insert into r values ('2 clinical tier can create; referred_by resolves to clinical_staff.id',
    case when v_row.referred_by = v_clinical_staff_id and v_row.organisation_id = v_org
          and v_row.referral_source = 'chronic_care_programme' and v_row.requested_service = 'Echo + outpatient review'
          and v_row.submitted_at is not null
         then 'PASS' else 'FAIL' end);

  -- ---------------------------------------------------------------------
  -- 3. A draft referral has no submitted_at; submitting it stamps one.
  -- ---------------------------------------------------------------------
  insert into public.specialist_referrals
    (organisation_id, patient_id, specialist_type, status)
  values (v_org, v_pt, 'endocrinology', 'draft')
  returning id into v_ref;
  select * into v_row from public.specialist_referrals where id = v_ref;
  insert into r values ('3a draft referral has no submitted_at',
    case when v_row.submitted_at is null then 'PASS' else 'FAIL' end);

  update public.specialist_referrals set status = 'pending' where id = v_ref;
  select * into v_row from public.specialist_referrals where id = v_ref;
  insert into r values ('3b submitting a draft stamps submitted_at',
    case when v_row.submitted_at is not null then 'PASS' else 'FAIL' end);

  -- ---------------------------------------------------------------------
  -- 4. Declining without a reason is blocked; with one, succeeds. The live
  --    closure CHECK (specialist_referrals_closed_requires_outcome) only
  --    governs status='closed', so this is a genuinely separate gap.
  -- ---------------------------------------------------------------------
  v_caught := false;
  begin
    update public.specialist_referrals set status = 'declined' where id = v_ref;
  exception when check_violation then v_caught := true;
  end;
  insert into r values ('4a decline without reason blocked', case when v_caught then 'PASS' else 'FAIL' end);

  update public.specialist_referrals
    set status = 'declined', declined_reason = 'Patient no longer meets pathway criteria'
    where id = v_ref;
  select * into v_row from public.specialist_referrals where id = v_ref;
  insert into r values ('4b decline with reason succeeds',
    case when v_row.status = 'declined' then 'PASS' else 'FAIL' end);

  -- ---------------------------------------------------------------------
  -- 5. 'emergency' urgency value accepted (previously only routine/
  --    priority/urgent existed live).
  -- ---------------------------------------------------------------------
  insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, urgency)
  values (v_org, v_pt, 'nephrology', 'emergency')
  returning id into v_ref;
  select * into v_row from public.specialist_referrals where id = v_ref;
  insert into r values ('5 emergency urgency value accepted',
    case when v_row.urgency = 'emergency' then 'PASS' else 'FAIL' end);

  -- ---------------------------------------------------------------------
  -- 6. End-to-end sanity: a referral created through the new create-gate
  --    flows cleanly through the already-live closure trigger
  --    (specialist_referrals_enforce_outcome_and_closure, 20260828231947)
  --    with no friction between the two pieces of work.
  -- ---------------------------------------------------------------------
  update public.specialist_referrals
    set treatment_plan_received_at = now(), treatment_plan_note = 'ACE-i uptitrated, recheck U&E in 2 weeks'
    where id = v_ref;
  update public.specialist_referrals
    set status = 'closed', care_plan_update_note = 'Routine BP monitoring resumes with own care team'
    where id = v_ref;
  select * into v_row from public.specialist_referrals where id = v_ref;
  insert into r values ('6 referral created via new create-gate closes cleanly through the live closure trigger',
    case when v_row.status = 'closed' and v_row.closed_by = v_clinical_staff_id and v_row.closed_at is not null
         then 'PASS' else 'FAIL' end);
end $$;

select step, verdict from r order by step;
rollback;
