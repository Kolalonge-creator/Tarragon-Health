-- Tarragon Health — Preventive Health Check Review, a new ₦15,000 SKU.
--
-- Launch-scope audit reconciliation, 2026-09-22 (see the plan's Work item 4
-- and docs/LAUNCH_SCOPE_AND_PLATFORM_REBUILD_AUDIT_2026-09-21.md §4.3/§6.1).
--
-- NOT a parallel review pipeline. CLAUDE.md forbids rebuilding the Annual
-- Health Review as a parallel record that redoes existing review machinery —
-- the same principle applies here. public.annual_health_checks (2026-07-05)
-- + public.open_health_check() (2026-07-19) + the clinician-side
-- completeHealthCheckReview / HealthCheckReview (health-check-actions.ts /
-- health-check-review.tsx) already have exactly the shape this product
-- needs: risk/screening intake -> result bundle (tests_completed,
-- lab_order_id) -> clinician-written plan (reviewed_by/reviewed_at/
-- review_summary). This migration wires a purchase onto that existing
-- pipeline; it creates no new review table.
--
-- THE ACTUAL GAP THIS CLOSES
-- ---------------------------
-- Before this migration, ANY patient's Health Check could be reviewed by
-- ANY available doctor for free, at any time, entirely at the doctor's own
-- initiative — completeHealthCheckReview has no payment or request check at
-- all, and no worklist anywhere surfaces "a patient is waiting on this" (a
-- doctor can only find a check to review by already knowing the patientId
-- and navigating straight to /clinician/patients/[patientId] — confirmed by
-- grep: health-check-actions.ts/health-check-review.tsx are referenced from
-- nowhere else). That is at odds with this platform's own "doctor time is a
-- paid-plan feature" rule (see CLAUDE.md's 2026-08-10 correction) and left
-- the free flow's review step both unpaid and undiscoverable. This SKU does
-- not remove the free flow (screening calendar, risk assessment, vitals
-- logging, self-arranged lab booking all stay free, per the platform's
-- "prevention is free, a doctor's time is paid" model) — it adds a real,
-- paid, discoverable "get a doctor's written plan attached to this year's
-- check" product on top of it, and gives the clinician side a genuine
-- worklist entry instead of requiring a doctor to already know who to look
-- for.
--
-- BLOCKING PREREQUISITE — DELIBERATELY NOT CLEARED HERE
-- --------------------------------------------------------
-- risk_questionnaire_configs.code = 'prevention_intake' (the 22-question,
-- 7-condition risk-scoring config that feeds this product's risk-assessment
-- half) is live in the database but UNSIGNED: approved_by/approved_at are
-- both null and is_active is false, enforced by
-- risk_questionnaire_configs_active_requires_signature (a real CHECK
-- constraint, not a convention). Signing it is a real Clinical Director's
-- clinical judgement — the same principle CLAUDE.md states for AI
-- governance evaluations ("never seed a passing evaluation... each
-- represents a human's judgement") applies equally here, and this migration
-- does not fabricate or bypass that signature. So this product ships with
-- is_active = false: fully built and wired, but genuinely NOT purchasable
-- (record_service_purchase_intent refuses any inactive product outright —
-- confirmed by reading its live definition) until a real Clinical Director
-- signs prevention_intake via the existing governed-config-signoff flow
-- (/admin/settings/risk-questionnaire-config) AND a founder/admin flips
-- service_products.is_active to true for this code. Flagged prominently in
-- the PR description as the actual go-live blocker.

begin;

alter table public.annual_health_checks
  add column if not exists review_requested_at timestamptz;

comment on column public.annual_health_checks.review_requested_at is
  'Set the moment a patient''s Preventive Health Check Review purchase activates (private.request_preventive_health_check_review, triggered off service_purchases). NULL means nobody has paid for a doctor to review this year''s check yet — the free open_health_check() journey alone never sets it. Distinguishes "a doctor may look at this if they want to" (the pre-existing free flow) from "a doctor is now expected to, because it was paid for".';

insert into public.service_products
  (code, name, description, price_kobo, currency, access_duration_days, features, is_active)
values
  ('preventive_health_check_review',
   'Preventive Health Check Review',
   'A doctor on your care team reviews this year''s Health Check — your risk assessment, your measurements and any results you''ve uploaded — and writes back a plain-language plan for what to do next. Deciding which checks you need and booking them stays free; this is what pays for a doctor''s written judgement on the result.',
   1500000, 'NGN', 90,
   array['preventive_health_check_review'],
   -- Deliberately false — see this migration's header. Do not flip to true
   -- without a real Clinical Director signature on risk_questionnaire_configs
   -- (code = 'prevention_intake') existing first.
   false)
on conflict (code) do update
  set name                 = excluded.name,
      description          = excluded.description,
      price_kobo           = excluded.price_kobo,
      access_duration_days = excluded.access_duration_days,
      features             = excluded.features;
      -- is_active intentionally omitted from the UPDATE SET — a re-run of
      -- this migration (or a future ON CONFLICT hit) must never silently
      -- flip an admin's considered activation back off, nor silently
      -- re-activate it if it was deliberately left off.

insert into public.service_delivery_cost_model
  (service_product_code, component, expected_minutes, delivered_by_tier, coordination_minutes, units_per_term, notes)
values
  ('preventive_health_check_review', 'delivery', 20, 'medical_officer', 5, 1,
   'Read the risk assessment, measurements and any uploaded results; write a plain-language plan. Single episode, same shape as written_result_interpretation''s costing.')
on conflict (service_product_code, component) do update
  set expected_minutes     = excluded.expected_minutes,
      delivered_by_tier    = excluded.delivered_by_tier,
      coordination_minutes = excluded.coordination_minutes,
      units_per_term       = excluded.units_per_term,
      notes                = excluded.notes;

-- ---------------------------------------------------------------------------
-- private.request_preventive_health_check_review — fires when a
-- service_purchases row for a product carrying the
-- 'preventive_health_check_review' feature reaches status = 'active'.
-- Mirrors private.activate_chronic_programme_doctor_supported_track's shape
-- (feature-array check, not a hardcoded product code, so a future repricing
-- of this SKU can't silently reopen the same drift CLAUDE.md documents that
-- trigger having hit twice already) and open_health_check()'s own
-- caller-scoped, idempotent open-the-current-year-row logic — reused here
-- rather than re-derived, since a purchase can arrive for a patient who has
-- never opened their Health Check journey at all yet.
-- ---------------------------------------------------------------------------

create or replace function private.request_preventive_health_check_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grants_review boolean;
  v_year integer;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then
    return new;
  end if;

  select 'preventive_health_check_review' = any(features) into v_grants_review
    from public.service_products where id = new.service_product_id;
  if v_grants_review is not true then
    return new;
  end if;

  v_year := extract(year from (now() at time zone 'Africa/Lagos'))::int;

  insert into public.annual_health_checks (organisation_id, patient_id, year, status)
  values (new.organisation_id, new.patient_id, v_year, 'pending')
  on conflict (patient_id, year) do nothing;

  update public.annual_health_checks
     set review_requested_at = coalesce(review_requested_at, now())
   where patient_id = new.patient_id and year = v_year;

  return new;
end;
$$;

revoke all on function private.request_preventive_health_check_review() from public;

drop trigger if exists service_purchases_request_preventive_health_check_review on public.service_purchases;
create trigger service_purchases_request_preventive_health_check_review
  after insert or update of status on public.service_purchases
  for each row execute function private.request_preventive_health_check_review();

-- ---------------------------------------------------------------------------
-- Proof that the trigger OPENS the request (not just that it compiles), that
-- it is scoped to THIS product's feature (an unrelated active purchase must
-- not set review_requested_at), and an informational note on the real,
-- current prevention_intake sign-off state so a reader of this migration's
-- output can see the blocker is genuinely still open, not just claimed to be.
-- ---------------------------------------------------------------------------

do $$
declare
  v_patient   uuid;
  v_org       uuid;
  v_product   uuid;
  v_other_product uuid;
  v_year      integer := extract(year from (now() at time zone 'Africa/Lagos'))::int;
  v_requested_at timestamptz;
  v_unrelated_requested_at timestamptz;
  v_row_existed boolean;
  v_prevention_intake_active boolean;
begin
  select id, organisation_id into v_patient, v_org
    from public.profiles where role = 'patient' limit 1;

  if v_patient is null then
    raise notice 'SKIP: no patient row to prove the trigger against; structural checks only';
  else
    select id into v_product from public.service_products where code = 'preventive_health_check_review';
    select id into v_other_product from public.service_products
      where code = 'async_consult_credit' and is_active limit 1;

    begin
      delete from public.annual_health_checks where patient_id = v_patient and year = v_year;

      -- An unrelated active purchase must never set review_requested_at.
      if v_other_product is not null then
        insert into public.service_purchases
          (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
        values
          (v_org, v_patient, v_other_product, 'active', 250000, 'NGN', now(), now() + interval '90 days');
      end if;

      select review_requested_at into v_unrelated_requested_at
        from public.annual_health_checks where patient_id = v_patient and year = v_year;

      -- The real purchase: even though this product ships is_active=false
      -- (see header), the trigger itself must still work correctly once a
      -- purchase DOES reach 'active' (e.g. an admin-granted comp, or once
      -- the product is switched on) — insert directly rather than going
      -- through record_service_purchase_intent, which would itself refuse
      -- an inactive product; that refusal is a different, already-proven
      -- behaviour (record_service_purchase_intent's own is_active check).
      insert into public.service_purchases
        (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
      values
        (v_org, v_patient, v_product, 'active', 1500000, 'NGN', now(), now() + interval '90 days');

      select review_requested_at into v_requested_at
        from public.annual_health_checks where patient_id = v_patient and year = v_year;
      v_row_existed := exists (select 1 from public.annual_health_checks where patient_id = v_patient and year = v_year);

      raise exception 'ROLLBACK_PROBE';
    exception when others then
      if sqlerrm <> 'ROLLBACK_PROBE' then
        raise;
      end if;
    end;

    if v_unrelated_requested_at is not null then
      raise exception 'FAIL: an unrelated product purchase set review_requested_at — the feature-array scoping is broken';
    end if;
    if v_requested_at is null then
      raise exception 'FAIL: an active preventive_health_check_review purchase did NOT set review_requested_at — the trigger is dead';
    end if;
    if v_row_existed is not true then
      raise exception 'FAIL: the trigger did not open (or find) this year''s annual_health_checks row';
    end if;

    raise notice 'PASS: purchasing Preventive Health Check Review opens/finds this year''s check and stamps review_requested_at; an unrelated purchase does not';
  end if;

  if (select is_active from public.service_products where code = 'preventive_health_check_review') is not false then
    raise exception 'FAIL: preventive_health_check_review must ship is_active = false pending Clinical Director sign-off on prevention_intake';
  end if;

  select is_active into v_prevention_intake_active
    from public.risk_questionnaire_configs where code = 'prevention_intake' and is_active limit 1;
  if v_prevention_intake_active then
    raise notice 'NOTE: prevention_intake is now SIGNED AND ACTIVE — the blocker described in this migration''s header is CLEARED. An admin may now flip service_products.is_active = true for preventive_health_check_review.';
  else
    raise notice 'NOTE: prevention_intake remains unsigned/inactive, as expected — preventive_health_check_review stays is_active = false until a Clinical Director signs it.';
  end if;

  raise notice 'PASS: Preventive Health Check Review SKU wired onto the existing annual_health_checks pipeline';
end $$;

commit;
