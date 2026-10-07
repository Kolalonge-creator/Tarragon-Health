-- Remove Supervised Weight Management entirely. Founder decision, 2026-09-24.
--
-- Reverses 20260910011851, 20260910053837 (its weight-management half only —
-- that migration's therapy-approval half is untouched), 20260910182555,
-- 20260910182855 and 20260912230030, plus the weight-management slice of
-- 20260910011854 (cost model) and 20260918091341 (clinical_encounters
-- unification).
--
-- ROW COUNTS FIRST, PER THIS PLATFORM'S OWN REMOVAL CONVENTION
-- --------------------------------------------------------------
-- Checked live before writing this: weight_management_enrolments,
-- _dose_steps and _checkins are all at 0 rows; no service_purchases row was
-- ever created against weight_management_3m/6m/12m; clinical_encounters has
-- no row with source_table = 'weight_management_checkins'. A zero-row
-- feature turns this into a pure structural change -- no data migration, no
-- conversion step, nothing to preserve.
--
-- WHAT DOES NOT MOVE
-- ------------------
-- public.obesity_assessments, public.bariatric_referrals, the free obesity
-- lifestyle-programme track, and the 'obesity' chronic_condition_programmes
-- row itself are untouched -- weight/lifestyle coaching stays free and stays
-- core. therapy_sessions, private.enforce_therapy_approver_authority and
-- public.approve_therapy_session (co-located with the weight-checkin review
-- RPC in 20260910053837 but a wholly separate product) are untouched.
-- clinical_tier_cost_rates (generic per-tier rates, no product-specific
-- rows) is untouched.
--
-- The three service_products rows are DELETED, not deactivated. Per this
-- platform's standing removal pattern: is_active = false would leave the
-- feature one flag-flip from silently growing back; deleting the row is what
-- makes "removed" provable rather than hopeful.

begin;

-- ---------------------------------------------------------------------------
-- 1. chronic_condition_programmes.obesity: revert the commercial-copy fields
--    20260910011851 overwrote to describe the paid product, back to the
--    values the 2026-07-16 free-programme seed originally gave them.
--    purchase_summary was NULL before 20260910011851 ever touched it (no
--    other migration has ever set it for this row) and obesity has no price
--    -- it was never itself a purchasable programme -- so NULL is its
--    correct, honest state, not a placeholder.
-- ---------------------------------------------------------------------------

update public.chronic_condition_programmes
   set monitoring_vitals     = array['weight', 'blood_pressure']::public.vital_type[],
       review_cadence_months = 6,
       purchase_summary      = null
 where code = 'obesity';

-- ---------------------------------------------------------------------------
-- 2. clinical_encounters: this is a shared table serving 8 OTHER encounter
--    types (video_consultation, escalation, medication_review,
--    annual_health_check, annual_review, async_consult, case_brief,
--    postnatal_checkin) -- only the weight-management slice of it moves.
-- ---------------------------------------------------------------------------

delete from public.clinical_encounters where source_table = 'weight_management_checkins';

alter table public.clinical_encounters
  drop constraint clinical_encounters_encounter_type_check;
alter table public.clinical_encounters
  add constraint clinical_encounters_encounter_type_check check (encounter_type in (
    'video_consultation', 'escalation', 'medication_review', 'annual_health_check',
    'annual_review', 'async_consult', 'case_brief', 'postnatal_checkin'
  ));

comment on table public.clinical_encounters is
  'Derived summary/index of 8 encounter-shaped source tables (video_consultations, escalations, medication_reviews, annual_health_checks, annual_reviews, async_consults, case_briefs, postnatal_checkins) -- see docs/DATA_ARCHITECTURE_GAPS_BUILD_PLAN.md §2. A 9th, weight_management_checkins, was removed 2026-09-24 alongside Supervised Weight Management. Kept in sync by one AFTER INSERT OR UPDATE trigger per remaining source table. The source tables remain the system of record; this table is additive and read-oriented, never written to directly.';

-- The sync trigger itself lives ON weight_management_checkins and must be
-- dropped (via that table, below) before this function can go -- the trigger
-- depends on the function, not the other way round. Dropped alongside the
-- other now-orphaned functions in step 5.

-- ---------------------------------------------------------------------------
-- 3. The purchase-activation trigger lives on service_purchases, a table
--    that stays -- dropped explicitly, not via cascade.
-- ---------------------------------------------------------------------------

drop trigger if exists service_purchases_create_weight_management_enrolment on public.service_purchases;
drop function if exists private.create_weight_management_enrolment_on_purchase();

-- ---------------------------------------------------------------------------
-- 4. The RPCs that return a %ROWTYPE of these tables must go before the
--    tables themselves -- Postgres tracks that as a dependency on the
--    table's implicit composite type, same class of ordering as the enum
--    below. The trigger-function versions (returns trigger, not a rowtype)
--    have no such dependency and are dropped after, once dropping the tables
--    has cascaded away the triggers that reference them.
-- ---------------------------------------------------------------------------

drop function if exists public.confirm_weight_management_eligibility(uuid, uuid, uuid, text);
drop function if exists public.review_weight_management_checkin(uuid, text);

-- ---------------------------------------------------------------------------
-- 5. The three dedicated tables. Dropping them cascades their own triggers,
--    RLS policies and indexes (weight_management_supervision_only,
--    weight_checkins_reviewer_authority, weight_checkins_red_flag,
--    weight_management_eligibility_authority, the *_set_updated_at triggers,
--    audit_row_change_trg, wm_*_select/insert/update/write, and the
--    clinical_encounters sync trigger) -- none of that needs a separate drop.
-- ---------------------------------------------------------------------------

drop table if exists public.weight_management_checkins;
drop table if exists public.weight_management_dose_steps;
drop table if exists public.weight_management_enrolments;

-- The trigger functions above are now orphaned (their triggers went with the
-- tables) and are dropped explicitly -- a function is not itself a dependent
-- object of a table/trigger and survives a table drop.
drop function if exists private.enforce_weight_management_eligibility_authority();
drop function if exists private.enforce_weight_checkin_reviewer_authority();
drop function if exists private.raise_weight_checkin_red_flag();
drop function if exists private.enforce_weight_management_supervision_only();
drop function if exists private.sync_clinical_encounter_weight_management_checkin();

-- The enum can only be dropped once nothing references it, i.e. after the
-- table that used it as a column type is gone.
drop type if exists public.weight_management_status;

-- ---------------------------------------------------------------------------
-- 6. Cost-model rows, then the products themselves. clinical_tier_cost_rates
--    carries no product-specific rows and is untouched.
-- ---------------------------------------------------------------------------

delete from public.service_delivery_cost_model
 where service_product_code in ('weight_management_3m', 'weight_management_6m', 'weight_management_12m');

delete from public.service_products
 where code in ('weight_management_3m', 'weight_management_6m', 'weight_management_12m');

-- ---------------------------------------------------------------------------
-- 7. Assertions -- prove the removal, not just the SQL running without error.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from public.service_products
              where code in ('weight_management_3m', 'weight_management_6m', 'weight_management_12m')) then
    raise exception 'FAIL: a weight_management_* service_products row still exists';
  end if;

  if exists (select 1 from public.service_delivery_cost_model
              where service_product_code in ('weight_management_3m', 'weight_management_6m', 'weight_management_12m')) then
    raise exception 'FAIL: a weight_management_* service_delivery_cost_model row still exists';
  end if;

  if exists (select 1 from information_schema.tables
              where table_schema = 'public'
                and table_name in ('weight_management_enrolments', 'weight_management_dose_steps', 'weight_management_checkins')) then
    raise exception 'FAIL: a weight_management_* table still exists';
  end if;

  if exists (select 1 from pg_type where typname = 'weight_management_status') then
    raise exception 'FAIL: public.weight_management_status still exists';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname in (
       'confirm_weight_management_eligibility', 'enforce_weight_management_eligibility_authority',
       'review_weight_management_checkin', 'enforce_weight_checkin_reviewer_authority',
       'raise_weight_checkin_red_flag', 'enforce_weight_management_supervision_only',
       'create_weight_management_enrolment_on_purchase', 'sync_clinical_encounter_weight_management_checkin'
     )
  ) then
    raise exception 'FAIL: a weight-management function still exists';
  end if;

  if exists (select 1 from public.clinical_encounters where source_table = 'weight_management_checkins') then
    raise exception 'FAIL: clinical_encounters still carries a weight-management row';
  end if;

  if (select monitoring_vitals from public.chronic_condition_programmes where code = 'obesity')
       <> array['weight', 'blood_pressure']::public.vital_type[]
     or (select review_cadence_months from public.chronic_condition_programmes where code = 'obesity') <> 6
     or (select purchase_summary from public.chronic_condition_programmes where code = 'obesity') is not null
  then
    raise exception 'FAIL: chronic_condition_programmes.obesity was not reverted to its free-programme shape';
  end if;

  -- private.enforce_therapy_approver_authority and public.approve_therapy_session
  -- are co-located in 20260910053837 with the (now-removed) weight-checkin
  -- review RPC; prove the removal did not take the unrelated product with it.
  if not exists (select 1 from pg_proc where proname = 'enforce_therapy_approver_authority')
     or not exists (select 1 from pg_proc where proname = 'approve_therapy_session') then
    raise exception 'FAIL: removing Supervised Weight Management took the unrelated therapy-approval product with it';
  end if;

  raise notice 'PASS: Supervised Weight Management fully removed; therapy approvals, clinical_encounters (8 remaining source tables) and the free obesity programme are intact';
end $$;

commit;
