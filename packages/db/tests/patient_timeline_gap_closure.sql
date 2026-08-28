-- Tarragon Health — patient_timeline proof_log gap-closure verification
--
-- Proves the three fixes from the 2026-07-30 v3 port's proof_log
-- investigation:
--   1. Write-time plain-language guarantee: private.record_timeline_event
--      strips underscores from summary before insert, not just at display
--      time — a raw underscore-laden summary is stored clean.
--   2. pharmacy_order_dispenses now writes a medication_dispensed
--      patient_timeline row (this platform's real analog of proof_log's
--      required medication_dispenses trigger source).
--   3. patient_timeline_select RLS now admits a profile_access grantee, not
--      just the patient themselves or org staff — with a negative control
--      (a stranger with no grant reads zero rows).
--
-- Run inside a transaction that is always rolled back — nothing here should
-- ever be committed.

begin;

do $$
declare
  v_org uuid;
  v_owner uuid;
  v_grantee uuid;
  v_stranger uuid;
  v_admin uuid;
  v_clin_staff uuid;
  v_po_id uuid;
  v_count integer;
  v_summary text;
begin
  select id into v_clin_staff from public.clinical_staff limit 1;

  select p.id into v_owner from public.profiles p where p.role = 'patient' order by p.created_at limit 1;
  select p.id into v_grantee from public.profiles p where p.role = 'patient' and p.id <> v_owner order by p.created_at limit 1;
  select p.id into v_stranger from public.profiles p where p.role = 'patient' and p.id <> v_owner and p.id <> v_grantee order by p.created_at limit 1;
  select id into v_admin from public.profiles where role = 'admin' limit 1;

  if v_owner is null or v_grantee is null or v_stranger is null then
    raise exception 'FAIL: fixture needs 3 distinct patient profiles to exist already';
  end if;

  select organisation_id into v_org from public.profiles where id = v_owner;

  -- Fixture: grant v_grantee view access to v_owner's profile.
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_owner, v_grantee, 'view', v_admin);

  -- patient_timeline_select (like vitals_readings/care_plans/medications/etc)
  -- is gated by private.can_read_clinical(), which requires
  -- profile_access.clinical_access = true, NOT just a 'view'
  -- permission_level (20260731185243_sponsor_clinical_access_results_and_
  -- escalations.sql / 20260731181143_sponsor_clinical_access_consent.sql).
  -- private.enforce_clinical_access_consent_owner() forces clinical_access
  -- to false on every INSERT regardless of what's supplied, and only allows
  -- it to be flipped true by an UPDATE where auth.uid() = the record
  -- owner (profile_id) -- so it has to be granted as a second step, as the
  -- owner's own authenticated session, not folded into the insert above.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profile_access set clinical_access = true
    where profile_id = v_owner and grantee_user_id = v_grantee;
  reset role;

  -- 1) Write-time humanisation.
  perform private.record_timeline_event(
    v_org, v_owner, 'care_plan_updated', 'test_source', gen_random_uuid(),
    'Test event', 'total_cholesterol 300 (critical)', now(), null, '{}'::jsonb
  );
  select summary into v_summary from public.patient_timeline
    where patient_id = v_owner and title = 'Test event' order by created_at desc limit 1;
  if v_summary <> 'total cholesterol 300 (critical)' then
    raise exception 'FAIL: write-time humanisation did not clean the summary, got: %', v_summary;
  end if;
  raise notice 'PASS 1: write-time humanisation stores clean text (%)', v_summary;

  -- 2) pharmacy_order_dispenses → medication_dispensed.
  insert into public.pharmacy_orders (organisation_id, patient_id, items, origin, ordered_by)
  values (v_org, v_owner, '[{"name":"Metformin 500mg","quantity":"30 tablets"}]'::jsonb, 'clinically_triggered', v_clin_staff)
  returning id into v_po_id;

  insert into public.pharmacy_order_dispenses
    (organisation_id, patient_id, pharmacy_order_id, drug_name, quantity, dispensed_on, source)
  values (v_org, v_owner, v_po_id, 'Metformin 500mg', '30 tablets', current_date, 'patient');

  if not exists (
    select 1 from public.patient_timeline
    where patient_id = v_owner and event_type = 'medication_dispensed'
      and summary = 'Metformin 500mg · 30 tablets'
  ) then
    raise exception 'FAIL: dispense trigger did not write the expected patient_timeline row';
  end if;
  raise notice 'PASS 2: pharmacy_order_dispenses trigger writes a medication_dispensed event';

  -- 3a) RLS: grantee CAN see the owner's timeline.
  perform set_config('request.jwt.claims', json_build_object('sub', v_grantee, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_timeline where patient_id = v_owner;
  reset role;
  if v_count = 0 then
    raise exception 'FAIL: profile_access grantee could not read the owner''s timeline';
  end if;
  raise notice 'PASS 3a: profile_access grantee reads % timeline row(s)', v_count;

  -- 3b) RLS: a stranger with no grant sees zero rows.
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_timeline where patient_id = v_owner;
  reset role;
  if v_count <> 0 then
    raise exception 'FAIL: a stranger with no grant read % timeline row(s)', v_count;
  end if;
  raise notice 'PASS 3b: stranger with no grant reads 0 rows';

  raise notice 'ALL PATIENT_TIMELINE GAP-CLOSURE CHECKS PASSED';
end $$;

rollback;
