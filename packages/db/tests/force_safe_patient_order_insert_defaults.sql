-- ===========================================================================
-- Verification: 20260905000112_force_safe_patient_order_insert_defaults
--
-- The hole this closes, reproduced live against the production schema before
-- the fix (2026-09-05): a patient session inserting straight into
-- public.lab_orders with fulfilment='partner' and status='payment_confirmed'
-- got, for 18 of the self-bookable bundles,
--     status=payment_confirmed  transmission=queued
-- with total_kobo and partner_cost_kobo stamped by the pricing trigger — a
-- real order queued to the partner laboratory, up to ₦246,500 (Core Screen),
-- paid for by nobody.
--
-- This script proves:
--   * the attack is now normalised, not merely rejected — a patient's
--     partner order opens 'pending_payment'/'awaiting_payment' whatever
--     status they claimed;
--   * a forged payment_provider / payment_provider_ref / payment_confirmed_at
--     on the same insert is discarded rather than trusted;
--   * the two live legitimate patient paths still work unchanged —
--     the self-arranged Screen order (useCreateLabOrder) and the partner
--     order (useCreatePartnerLabOrder / createAndPayForPartnerLabOrder);
--   * an org-staff insert is untouched, so no server-side flow is caught in
--     the blast radius;
--   * pharmacy_orders, the dormant twin of the same hole, behaves the same;
--   * and a deliberate sabotage run — the trigger disabled — shows the
--     attack checks actually discriminate rather than passing vacuously.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — a verification script, never seed data.
--
-- Pattern (same as packages/db/tests/profiles_self_update_column_guard.sql):
-- set_config('request.jwt.claims', ...) + `set local role authenticated`
-- simulates a real client session — running as the connecting superuser
-- would silently bypass RLS and column privileges via table ownership.
-- ===========================================================================

begin;

create temporary table fspoi_fixture(k text primary key, v uuid) on commit drop;
create temporary table fspoi_result(
  check_name text,
  actor      text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

-- --------------------------------------------------------------------------
-- Fixtures: one patient, one org-staff clinician, and a self-bookable bundle
-- that is actually partner-priceable (several are not — the pricing trigger
-- rejects those before any of this is reachable, so picking one at random
-- would make the test pass for the wrong reason).
-- --------------------------------------------------------------------------
do $$
declare
  v_org     uuid;
  v_patient uuid := gen_random_uuid();
  v_staff   uuid := gen_random_uuid();
  v_staff_row uuid;
  v_bundle  uuid;
  v_probe   uuid;
  r         record;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient, 'fspoi-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_staff,   'fspoi-staff@example.invalid',   'x', now(), '{}', '{}');

  -- auth.users has a profile-provisioning trigger, hence the upserts.
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, sex)
  values (v_patient, v_org, 'patient', 'FSPOI Patient', date '1975-01-01', 'male')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = 'patient',
        date_of_birth = excluded.date_of_birth, sex = excluded.sex;

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_staff, v_org, 'clinician', 'FSPOI Clinician')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = 'clinician';

  -- clinical_staff_active_requires_verification: an active row must carry a
  -- licence verification timestamp.
  insert into public.clinical_staff
    (profile_id, organisation_id, active, doctor_tier, full_name, license_verified_at)
  values (v_staff, v_org, true, 'tier_2', 'FSPOI Clinician', now())
  returning id into v_staff_row;

  -- Find a self-bookable bundle this patient can actually be billed for.
  for r in select id, name from public.panel_bundles where self_bookable order by name loop
    begin
      insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, fulfilment, status)
      values (v_org, v_patient, r.id, 'partner', 'pending_payment')
      returning id into v_probe;
      delete from public.lab_orders where id = v_probe;
      v_bundle := r.id;
      exit;
    exception when others then
      null; -- not priceable for this patient; try the next one
    end;
  end loop;

  if v_bundle is null then
    raise exception 'no partner-priceable self-bookable bundle found — cannot run this test';
  end if;

  insert into fspoi_fixture values
    ('org', v_org), ('patient', v_patient), ('staff', v_staff),
    ('staff_row', v_staff_row), ('bundle', v_bundle);
end $$;

-- ==========================================================================
-- 1. THE ATTACK — a patient claiming their own partner order is already paid.
--    It must not stay 'payment_confirmed', and it must not reach the
--    transmission queue.
-- ==========================================================================
do $$
declare
  v_org     uuid := (select v from fspoi_fixture where k = 'org');
  v_patient uuid := (select v from fspoi_fixture where k = 'patient');
  v_bundle  uuid := (select v from fspoi_fixture where k = 'bundle');
  v_id      uuid;
  v_status  text;
  v_trans   text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, fulfilment, status)
  values (v_org, v_patient, v_bundle, 'partner', 'payment_confirmed')
  returning id into v_id;

  reset role;

  select status::text, transmission::text into v_status, v_trans
  from public.lab_orders where id = v_id;

  insert into fspoi_result values
    ('patient-claimed payment_confirmed partner order is forced unpaid', 'patient',
     v_status, 'pending_payment',
     case when v_status = 'pending_payment' then 'PASS' else 'FAIL' end);
  insert into fspoi_result values
    ('...and never reaches the partner transmission queue', 'patient',
     v_trans, 'awaiting_payment',
     case when v_trans = 'awaiting_payment' then 'PASS' else 'FAIL' end);

  if v_status <> 'pending_payment' or v_trans <> 'awaiting_payment' then
    raise exception 'HOLE OPEN: patient created a lab order with status=% transmission=%', v_status, v_trans;
  end if;

  delete from public.lab_orders where id = v_id;
end $$;

-- ==========================================================================
-- 2. A forged payment reference is discarded too.
--
--    NB there is deliberately no column-level REVOKE behind this: a
--    column-level revoke is a no-op while `authenticated` holds a
--    table-level INSERT grant (verified — the revoke runs without error and
--    has_column_privilege stays true), and `authenticated` is the same role
--    for a patient and for a clinician, so a column allowlist tight enough
--    to matter would break org staff. The trigger discriminates on
--    private.is_org_staff() instead, which the grant system cannot.
-- ==========================================================================
do $$
declare
  v_org     uuid := (select v from fspoi_fixture where k = 'org');
  v_patient uuid := (select v from fspoi_fixture where k = 'patient');
  v_bundle  uuid := (select v from fspoi_fixture where k = 'bundle');
  v_id      uuid;
  v_ref     text;
  v_prov    text;
  v_conf    timestamptz;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, fulfilment, status,
     payment_provider, payment_provider_ref, payment_confirmed_at)
  values (v_org, v_patient, v_bundle, 'partner', 'payment_confirmed',
          'paystack', 'forged-ref', now())
  returning id into v_id;

  reset role;

  select payment_provider::text, payment_provider_ref, payment_confirmed_at
    into v_prov, v_ref, v_conf
  from public.lab_orders where id = v_id;

  insert into fspoi_result values
    ('forged payment_provider / ref / confirmed_at are discarded', 'patient',
     format('%s/%s/%s', coalesce(v_prov,'null'), coalesce(v_ref,'null'),
            coalesce(v_conf::text,'null')),
     'null/null/null',
     case when v_prov is null and v_ref is null and v_conf is null then 'PASS' else 'FAIL' end);

  if v_prov is not null or v_ref is not null or v_conf is not null then
    raise exception 'HOLE OPEN: a patient session wrote payment provenance (%/%/%)', v_prov, v_ref, v_conf;
  end if;

  delete from public.lab_orders where id = v_id;
end $$;

-- ==========================================================================
-- 3. The two live legitimate patient paths still work, unchanged.
-- ==========================================================================
do $$
declare
  v_org     uuid := (select v from fspoi_fixture where k = 'org');
  v_patient uuid := (select v from fspoi_fixture where k = 'patient');
  v_bundle  uuid := (select v from fspoi_fixture where k = 'bundle');
  v_id      uuid;
  v_status  text;
  v_trans   text;
  v_total   bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);

  -- (a) useCreatePartnerLabOrder / createAndPayForPartnerLabOrder
  set local role authenticated;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, fulfilment, status)
  values (v_org, v_patient, v_bundle, 'partner', 'pending_payment')
  returning id into v_id;
  reset role;

  select status::text, transmission::text, total_kobo into v_status, v_trans, v_total
  from public.lab_orders where id = v_id;

  insert into fspoi_result values
    ('legitimate partner order still succeeds and is still priced', 'patient',
     format('%s/%s/total=%s', v_status, v_trans, v_total),
     'pending_payment/awaiting_payment/total>0',
     case when v_status = 'pending_payment' and v_trans = 'awaiting_payment' and coalesce(v_total,0) > 0
          then 'PASS' else 'FAIL' end);
  if v_status <> 'pending_payment' or v_trans <> 'awaiting_payment' or coalesce(v_total,0) <= 0 then
    raise exception 'BROKEN: the legitimate partner-order path no longer works (%/%/%)', v_status, v_trans, v_total;
  end if;
  delete from public.lab_orders where id = v_id;

  -- (b) useCreateLabOrder — self-arranged, free, nothing to transmit
  set local role authenticated;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, total_kobo, status)
  values (v_org, v_patient, v_bundle, 0, 'ordered')
  returning id into v_id;
  reset role;

  select status::text, transmission::text into v_status, v_trans
  from public.lab_orders where id = v_id;

  insert into fspoi_result values
    ('legitimate self-arranged order still succeeds', 'patient',
     v_status || '/' || v_trans, 'ordered/not_required',
     case when v_status = 'ordered' and v_trans = 'not_required' then 'PASS' else 'FAIL' end);
  if v_status <> 'ordered' or v_trans <> 'not_required' then
    raise exception 'BROKEN: the legitimate self-arranged path no longer works (%/%)', v_status, v_trans;
  end if;
  delete from public.lab_orders where id = v_id;
end $$;

-- ==========================================================================
-- 4. Control — an org-staff insert is NOT rewritten. The fix must be a
--    patient-side guard, not a platform-wide status lock.
-- ==========================================================================
do $$
declare
  v_org     uuid := (select v from fspoi_fixture where k = 'org');
  v_patient uuid := (select v from fspoi_fixture where k = 'patient');
  v_staff   uuid := (select v from fspoi_fixture where k = 'staff');
  v_staff_row uuid := (select v from fspoi_fixture where k = 'staff_row');
  v_bundle  uuid := (select v from fspoi_fixture where k = 'bundle');
  v_id      uuid;
  v_status  text;
  v_trans   text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, fulfilment, status, origin, ordered_by, clinical_indication)
  values (v_org, v_patient, v_bundle, 'partner', 'payment_confirmed',
          'clinically_triggered', v_staff_row, 'control: staff-authored order')
  returning id into v_id;

  reset role;

  select status::text, transmission::text into v_status, v_trans
  from public.lab_orders where id = v_id;

  insert into fspoi_result values
    ('org-staff insert keeps the status it was given', 'org staff',
     v_status || '/' || v_trans, 'payment_confirmed/queued',
     case when v_status = 'payment_confirmed' and v_trans = 'queued' then 'PASS' else 'FAIL' end);
  if v_status <> 'payment_confirmed' or v_trans <> 'queued' then
    raise exception 'OVERREACH: the guard rewrote an org-staff order (%/%)', v_status, v_trans;
  end if;
  delete from public.lab_orders where id = v_id;
end $$;

-- ==========================================================================
-- 5. pharmacy_orders — the dormant twin of the same hole.
--    enforce_pharmacy_order_origin limits a self-service order to a
--    clinician-prescribed active medication, so one is created first.
-- ==========================================================================
do $$
declare
  v_org     uuid := (select v from fspoi_fixture where k = 'org');
  v_patient uuid := (select v from fspoi_fixture where k = 'patient');
  v_id      uuid;
  v_status  text;
begin
  insert into public.medications
    (organisation_id, patient_id, drug_name, dose, frequency, is_active, source)
  values (v_org, v_patient, 'FSPOI Amlodipine', '5mg', 'once daily', true, 'clinician');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.pharmacy_orders
    (organisation_id, patient_id, items, total_kobo, status)
  values (v_org, v_patient,
          jsonb_build_array(jsonb_build_object('drug_name', 'FSPOI Amlodipine', 'quantity', 1, 'price_kobo', 100000)),
          100000, 'payment_confirmed')
  returning id into v_id;

  reset role;

  select status::text into v_status from public.pharmacy_orders where id = v_id;

  insert into fspoi_result values
    ('patient-claimed paid pharmacy order is forced unpaid', 'patient',
     v_status, 'pending_payment',
     case when v_status = 'pending_payment' then 'PASS' else 'FAIL' end);
  if v_status <> 'pending_payment' then
    raise exception 'HOLE OPEN: patient created a pharmacy order with status=%', v_status;
  end if;

  delete from public.pharmacy_orders where id = v_id;
end $$;

-- ==========================================================================
-- 6. SABOTAGE — disable the guard and re-run the attack. If it still comes
--    back 'pending_payment' the checks above are passing for some other
--    reason and prove nothing.
-- ==========================================================================
do $$
declare
  v_org     uuid := (select v from fspoi_fixture where k = 'org');
  v_patient uuid := (select v from fspoi_fixture where k = 'patient');
  v_bundle  uuid := (select v from fspoi_fixture where k = 'bundle');
  v_id      uuid;
  v_status  text;
  v_trans   text;
begin
  alter table public.lab_orders disable trigger lab_orders_force_safe_patient_insert;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, fulfilment, status)
  values (v_org, v_patient, v_bundle, 'partner', 'payment_confirmed')
  returning id into v_id;
  reset role;

  select status::text, transmission::text into v_status, v_trans
  from public.lab_orders where id = v_id;

  alter table public.lab_orders enable trigger lab_orders_force_safe_patient_insert;

  insert into fspoi_result values
    ('sabotage: guard disabled, attack succeeds again (proves the test discriminates)',
     'patient', v_status || '/' || v_trans, 'payment_confirmed/queued',
     case when v_status = 'payment_confirmed' and v_trans = 'queued' then 'PASS' else 'FAIL' end);

  if v_status <> 'payment_confirmed' or v_trans <> 'queued' then
    raise exception 'VACUOUS TEST: with the guard disabled the attack still did not reproduce (%/%) — section 1 proves nothing',
      v_status, v_trans;
  end if;

  delete from public.lab_orders where id = v_id;
end $$;

select check_name, actor, observed, expected, verdict
from fspoi_result
order by verdict desc, check_name, actor;

rollback;
