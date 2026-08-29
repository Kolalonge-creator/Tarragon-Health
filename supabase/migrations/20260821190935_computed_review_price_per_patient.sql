-- Founder decision 2026-08-21, open item 3 of the "One review, adapted" note:
-- an annual review is priced from the tests THAT PATIENT is actually getting,
-- computed per person, and displayed to them as ONE number.
--
-- WHY THIS IS A BUG FIX AND NOT JUST A PRICING PREFERENCE
-- ------------------------------------------------------
-- Two code paths already decide "which tests does this patient actually get",
-- and they had drifted apart:
--
--   * private.check_screen_order_completeness  — knows about sex, age and the
--     dormant (can't-fulfil-yet) list, so a woman's Screen order is never left
--     hanging waiting for a PSA result she is structurally forbidden from
--     having (private.enforce_psa_sdm_gate: "PSA screening_results are
--     male-only").
--   * private.compute_screening_order_exclusions — knows about lifetime-once
--     items already on file, terminal serology states, the pending-PSA
--     shared-decision gate, and items an active chronic pathway already
--     covers. Knows nothing about sex or age.
--   * pricing — knew about none of it. lab_orders.total_kobo was set to the
--     flat panel_bundles.price_kobo with no per-patient adjustment at all, so
--     a woman was charged for the prostate check and a man for cervical
--     screening.
--
-- Nobody has been overcharged because 20260803124833_self_arranged_lab_
-- fulfilment.sql forces total_kobo = 0 on every order created today (live
-- count re-confirmed before writing this: lab_orders 1 row, total_kobo 0,
-- fulfilment self_arranged) — the wrong number was being multiplied by
-- nothing. It becomes a live overcharge on the first day partner billing is
-- switched on, which is exactly what the founder has now chosen to do.
--
-- So the fix is structural rather than a patch on the flat price: ONE
-- canonical "what is this patient actually being given" function, and both
-- completeness and pricing read it. A future exclusion rule can then only be
-- added in one place, and cannot silently apply to one path and not the
-- other.
--
-- Three further things this migration deliberately moves out of code and into
-- data, because each has already been copy-pasted between migrations and
-- drifted:
--   * the dormant list (hardcoded `v_dormant text[] := array[...]` re-declared
--     in four separate migrations — 20260802224400, 20260802224614,
--     20260811223330, 20260811233602 — each time by rewriting the whole
--     function body just to edit one array literal) becomes
--     screen_types.fulfilment_dormant.
--   * the per-test price becomes screen_types.price_kobo, with price_source
--     recording where the number came from so a placeholder is never mistaken
--     for a contracted rate.
--   * the review discount (a review costs less than buying its tests one by
--     one) becomes panel_bundles.review_discount_bp, computed below from the
--     existing price list rather than hand-typed, so today's headline prices
--     survive this migration unchanged.

-- ---------------------------------------------------------------------------
-- 1. Dormancy as data.
-- ---------------------------------------------------------------------------
alter table public.screen_types
  add column if not exists fulfilment_dormant boolean not null default false;

comment on column public.screen_types.fulfilment_dormant is
  'True when Tarragon cannot yet fulfil this item at all, so it is skipped when deciding whether an order is complete and is never priced into a review. Distinct from is_active, which governs whether the screening calendar ever recommends the item. Replaces the hardcoded v_dormant array that had been re-declared inside private.check_screen_order_completeness by four separate migrations.';

update public.screen_types set fulfilment_dormant = true  where code = 'echo';
update public.screen_types set fulfilment_dormant = false where code <> 'echo';

-- ---------------------------------------------------------------------------
-- 2. Per-test price list.
--
-- price_source is not decoration. No laboratory is contracted today (live:
-- 0 active lab_providers, 0 active lab facilities), so every number here is a
-- placeholder — the column records which kind of placeholder, so that the
-- admin screen and the founder can see at a glance which figures still need a
-- real contracted rate behind them before partner billing goes live.
--   lab_price_list — taken from public.lab_tests, the per-provider price list
--                    (median across the providers that quote the test). Those
--                    provider rows are themselves placeholders with .example
--                    contact addresses, so this means "derived from a price
--                    list", NOT "contracted".
--   provisional    — set here from typical Nigerian private-laboratory list
--                    prices because no price list quotes the test at all.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.screen_price_source as enum ('lab_price_list', 'provisional');
exception when duplicate_object then null; end $$;

alter table public.screen_types
  add column if not exists price_kobo   bigint,
  add column if not exists price_source public.screen_price_source;

comment on column public.screen_types.price_kobo is
  'List price for this single test, in kobo. NULL means not priced yet — a review containing an unpriced applicable test cannot be partner-billed (public.price_review_for_patient reports it rather than guessing a number).';
comment on column public.screen_types.price_source is
  'Where price_kobo came from. NO LAB IS CONTRACTED YET, so every price is a placeholder: lab_price_list = median of public.lab_tests quotes (themselves placeholder providers), provisional = set from typical market rates because nothing quotes it. Both must be replaced with contracted rates before partner billing is switched on.';

-- 2a. Anything a price list already quotes wins, so this migration invents as
--     few numbers as it can get away with.
with quoted as (
  select lt.code,
         (percentile_cont(0.5) within group (order by lt.price_kobo))::bigint as median_kobo
  from public.lab_tests lt
  where lt.price_kobo > 0
  group by lt.code
)
update public.screen_types st
   set price_kobo   = q.median_kobo,
       price_source = 'lab_price_list'
  from quoted q
 where q.code = st.code
   and st.price_kobo is null;

-- 2b. Everything else. Deliberately NOT a blanket default: a test absent from
--     both lists stays NULL and is reported as unpriced rather than guessed.
update public.screen_types st
   set price_kobo   = v.price_kobo,
       price_source = 'provisional'
  from (values
    ('fbc',                   500000::bigint),
    ('lft',                   800000::bigint),
    ('kft',                   800000::bigint),
    ('tft',                  1200000::bigint),
    ('urinalysis',            300000::bigint),
    ('urine_acr',             700000::bigint),
    ('ogtt_fpg',              600000::bigint),
    ('ecg_resting',          1000000::bigint),
    ('fit',                  1500000::bigint),
    ('syphilis',              500000::bigint),
    ('ferritin',             1100000::bigint),
    ('vitamin_b12',          1300000::bigint),
    ('abdominal_ultrasound', 1500000::bigint),
    ('breast_imaging',       2500000::bigint),
    ('prostate_ultrasound',  1800000::bigint),
    ('mammography',          3000000::bigint),
    ('colonoscopy',         15000000::bigint),
    ('bone_density',         2500000::bigint),
    ('tb_screen',             700000::bigint),
    ('malaria_rdt',           200000::bigint),
    ('pcos_panel',           2500000::bigint),
    ('vision_check',          500000::bigint),
    ('hearing_check',         700000::bigint),
    ('dental_check',          700000::bigint),
    ('echo',                 3000000::bigint)
  ) as v(code, price_kobo)
 where v.code = st.code
   and st.price_kobo is null;

-- blood_pressure is measured by the patient or in a consultation; it is never
-- a billable laboratory line on a review.
update public.screen_types set price_kobo = 0, price_source = 'provisional'
 where code = 'blood_pressure' and price_kobo is null;

-- ---------------------------------------------------------------------------
-- 3. The canonical delivered set.
--
-- "Which tests is THIS patient actually being given out of this list."
-- Everything that prices, or decides completeness, reads this and only this.
--
-- Composed of the two filters that already existed separately:
--   * structural — dormant, sex, age. A null date_of_birth never excludes on
--     age grounds (the same "age-gated included when DOB unknown" convention
--     as private.open_annual_review and the function this replaces).
--   * clinical — private.compute_screening_order_exclusions: lifetime-once
--     already on file, terminal serology, pending PSA shared decision, item
--     already covered by an active chronic pathway within its cadence.
-- ---------------------------------------------------------------------------
create or replace function private.patient_delivered_test_codes(
  p_patient_id uuid,
  p_organisation_id uuid,
  p_test_codes text[]
)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_patient_sex text;
  v_patient_age int;
  v_excluded    jsonb;
  v_code        text;
  v_st          public.screen_types%rowtype;
  v_out         text[] := '{}';
begin
  if p_patient_id is null or p_test_codes is null then
    return '{}';
  end if;

  select p.sex::text, extract(year from age(now(), p.date_of_birth))::int
    into v_patient_sex, v_patient_age
  from public.profiles p where p.id = p_patient_id;

  v_excluded := coalesce(
    private.compute_screening_order_exclusions(p_patient_id, p_organisation_id, p_test_codes),
    '[]'::jsonb
  );

  foreach v_code in array p_test_codes loop
    select * into v_st from public.screen_types st where st.code = v_code;

    -- Unknown code: keep it. Dropping a code the catalogue has never heard of
    -- would silently make an order look complete, which is the more dangerous
    -- of the two failure modes.
    if v_st.code is null then
      v_out := v_out || v_code;
      continue;
    end if;

    if v_st.fulfilment_dormant then
      continue;
    end if;
    if v_st.sex_applicability::text <> 'all'
       and v_st.sex_applicability::text is distinct from coalesce(v_patient_sex, '') then
      continue;
    end if;
    if v_st.age_from is not null and v_patient_age is not null and v_patient_age < v_st.age_from then
      continue;
    end if;
    if v_st.age_to is not null and v_patient_age is not null and v_patient_age > v_st.age_to then
      continue;
    end if;

    -- Only SETTLED exclusions remove a code. This is the one place the two
    -- callers could have been given different answers and must not be.
    --
    -- private.compute_screening_order_exclusions returns four reasons, and
    -- one of them is not the same kind of thing as the other three. Its own
    -- migration says so explicitly: 'pending_shared_decision' is
    -- "inclusion-blocking, not 'already covered'" — the PSA conversation has
    -- not happened YET. The patient is still having that test; it is waiting
    -- on a step, not removed from their review.
    --
    -- Honouring it here would break both callers in opposite directions:
    -- completeness would auto-resolve a man's Comprehensive Screen while its
    -- PSA line is still outstanding (packages/db/tests/screening_ladder_
    -- order_completeness.sql check9 exists precisely to catch that), and
    -- pricing would systematically undercharge every eligible man's review
    -- and then raise the price after the conversation — a quote that moves
    -- between being shown and being paid.
    --
    -- Whitelisted rather than blacklisted on purpose: a reason added later
    -- that nobody has thought about here keeps the code required and billed,
    -- which is the safe direction to fail in.
    if exists (
      select 1 from jsonb_array_elements(v_excluded) e
      where e ->> 'item_code' = v_code
        and (
          e ->> 'reason' in ('lifetime_once_on_file', 'terminal_serology_state')
          or e ->> 'reason' like 'owned_by_pathway:%'
        )
    ) then
      continue;
    end if;

    v_out := v_out || v_code;
  end loop;

  return v_out;
end;
$$;

revoke all on function private.patient_delivered_test_codes(uuid, uuid, text[]) from public;

comment on function private.patient_delivered_test_codes(uuid, uuid, text[]) is
  'The one answer to "which of these tests is this patient actually being given". Both private.check_screen_order_completeness and public.price_review_for_patient read it, so a new exclusion rule can never again apply to one and not the other.';

-- ---------------------------------------------------------------------------
-- 4. Completeness now reads the canonical set.
--
-- Supersedes the copy in 20260811233602. Two deliberate behaviour changes,
-- both fixes rather than side effects:
--   * the clinical exclusions now count. Before this, an order containing
--     hep_b for a patient whose profile records chronic HBV could never
--     complete — the exclusion engine knew the test would never be resulted
--     (private.compute_screening_order_exclusions, reason
--     'terminal_serology_state') and wrote it into lab_orders.
--     excluded_test_codes, but completeness ignored that column and waited
--     for a result that is never coming. A PSA line awaiting its
--     shared-decision conversation is deliberately NOT in this group — see
--     the long note inside private.patient_delivered_test_codes for why that
--     one reason stays required.
--   * the once-per-lifetime special case is gone as redundant, not as a
--     relaxation. It asked "does a result for this code exist for this
--     patient at all"; the exclusion engine asks exactly that question first
--     (reason 'lifetime_once_on_file') and removes the code, so the branch
--     could only ever have been reached with the answer already known to be
--     no — in which case both versions return false.
-- ---------------------------------------------------------------------------
create or replace function private.check_screen_order_completeness(p_lab_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test_codes text[];
  v_delivered  text[];
  v_patient_id uuid;
  v_org_id     uuid;
  v_code       text;
begin
  select lo.patient_id, lo.organisation_id, pb.test_codes
    into v_patient_id, v_org_id, v_test_codes
  from public.lab_orders lo
  join public.panel_bundles pb on pb.id = lo.panel_bundle_id
  where lo.id = p_lab_order_id;

  if v_patient_id is null or v_test_codes is null then
    return false;
  end if;

  v_delivered := private.patient_delivered_test_codes(v_patient_id, v_org_id, v_test_codes);

  foreach v_code in array v_delivered loop
    if not exists (
      select 1 from public.screening_results
      where lab_order_id = p_lab_order_id and screen_type_code = v_code
    ) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function private.check_screen_order_completeness(uuid) from public;

-- ---------------------------------------------------------------------------
-- 5. The review discount, derived rather than invented.
--
-- A review costs less than buying the same tests one at a time. That gap
-- already exists in the live price list (Core Screen is priced at 65,000 NGN
-- against a sum-of-parts of 81,000 NGN); it had simply never been written
-- down as a number, because a flat bundle price has no need to know it.
-- Computing per-patient prices does.
--
-- Calibrated so a patient who receives the whole sex-neutral part of a bundle
-- pays exactly today's headline price — this migration must not silently
-- reprice the platform. Sex-specific items are excluded from the calibration
-- base precisely because nobody receives all of them (no single patient gets
-- both the prostate check and cervical screening), so including them would
-- overstate the base and manufacture a discount nobody agreed to.
--
-- Clamped at zero: a bundle already priced at or above its sex-neutral
-- sum-of-parts (every single_* bundle whose only test is sex-specific, whose
-- base is therefore empty) simply carries no discount.
--
-- ONE CONSEQUENCE WORTH KNOWING BEFORE THIS GOES LIVE, measured rather than
-- guessed (dry run against the live catalogue, 2026-08-21):
--   Core Screen           flat 65,000 NGN -> computed 65,003 NGN
--   Comprehensive Screen  flat 149,000 NGN -> 173,500 NGN for a woman,
--                                             178,500 NGN for a man
-- Comprehensive lands above its old flat price because that flat price was
-- already below its own sex-neutral sum-of-parts (so review_discount_bp
-- clamps to zero), and the sex-specific items each patient does receive —
-- breast imaging for her, PSA and prostate ultrasound for him — then add on
-- top. That is the arithmetic working, not a bug: the flat price was
-- cross-subsidised and nobody was ever charged for exactly what they got.
-- It does mean panel_bundles.price_kobo is now an indicative figure and not
-- a promise, which is why no patient-facing surface quotes it any more —
-- they are shown their own number before they confirm.
-- ---------------------------------------------------------------------------
alter table public.panel_bundles
  add column if not exists review_discount_bp integer not null default 0
    constraint panel_bundles_review_discount_bp_range check (review_discount_bp between 0 and 10000);

comment on column public.panel_bundles.review_discount_bp is
  'Basis points off the sum of the patient''s applicable test list prices. Seeded so a sex-neutral patient pays exactly the price_kobo this bundle already carried, so price_kobo stays meaningful as the headline/"from" figure while the charged number is computed per person.';

with base as (
  select pb.id,
         pb.price_kobo,
         sum(st.price_kobo) as neutral_sum
  from public.panel_bundles pb
  join lateral unnest(pb.test_codes) as tc(code) on true
  join public.screen_types st on st.code = tc.code
  where st.sex_applicability::text = 'all'
    and st.fulfilment_dormant = false
    and st.price_kobo is not null
  group by pb.id, pb.price_kobo
)
update public.panel_bundles pb
   set review_discount_bp = greatest(
         0,
         10000 - round(10000.0 * base.price_kobo / base.neutral_sum)::int
       )
  from base
 where base.id = pb.id
   and base.neutral_sum > 0;

-- ---------------------------------------------------------------------------
-- 6. The price itself.
--
-- private.compute_review_price does the arithmetic with no access check —
-- it is called by the order trigger, which has already established that the
-- row is legitimate. public.price_review_for_patient is the caller-facing
-- door: it checks who is asking, and strips per-test prices for anyone who
-- is not org staff.
--
-- That strip is a product rule enforced at the boundary rather than in the UI.
-- The patient is promised one review, one price, one confirm button — they
-- see WHICH tests are included (they always could) but never what each one
-- costs, so no screen can accidentally render a per-line price, because the
-- RPC a patient calls does not return one.
-- ---------------------------------------------------------------------------
create or replace function private.compute_review_price(
  p_patient_id uuid,
  p_organisation_id uuid,
  p_bundle_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bundle    public.panel_bundles%rowtype;
  v_delivered text[];
  v_lines     jsonb := '[]'::jsonb;
  v_unpriced  text[] := '{}';
  v_subtotal  bigint := 0;
  v_code      text;
  v_st        public.screen_types%rowtype;
  v_provisional boolean := false;
begin
  select * into v_bundle from public.panel_bundles where id = p_bundle_id;
  if v_bundle.id is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_bundle');
  end if;

  v_delivered := private.patient_delivered_test_codes(
    p_patient_id, p_organisation_id, v_bundle.test_codes
  );

  foreach v_code in array v_delivered loop
    select * into v_st from public.screen_types st where st.code = v_code;

    if v_st.code is null or v_st.price_kobo is null then
      v_unpriced := v_unpriced || v_code;
      continue;
    end if;

    if v_st.price_source = 'provisional' then
      v_provisional := true;
    end if;

    v_subtotal := v_subtotal + v_st.price_kobo;
    v_lines := v_lines || jsonb_build_object(
      'code', v_st.code,
      'name', v_st.name,
      'price_kobo', v_st.price_kobo,
      'price_source', v_st.price_source
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'bundle_code', v_bundle.code,
    'bundle_name', v_bundle.name,
    'currency', 'NGN',
    -- One number. Everything else in this object exists for staff, finance
    -- and this migration's own assertions.
    'total_kobo', round(v_subtotal::numeric * (10000 - v_bundle.review_discount_bp) / 10000.0)::bigint,
    'subtotal_kobo', v_subtotal,
    'review_discount_bp', v_bundle.review_discount_bp,
    'headline_price_kobo', v_bundle.price_kobo,
    'lines', v_lines,
    'unpriced_codes', to_jsonb(v_unpriced),
    'delivered_count', coalesce(array_length(v_delivered, 1), 0),
    -- False whenever an applicable test has no price at all, and also when
    -- the patient turns out to be receiving nothing from this bundle. That
    -- second case is not hypothetical: dry-running this migration priced a
    -- single_psa review at exactly zero for a patient with no
    -- shared-decision record, and a single_cervical_smear at zero for a male
    -- patient — every line excluded, subtotal 0, and an order that would
    -- have been created, billed at nothing, and then waited forever for a
    -- result nobody can produce. An empty review is a mistake to refuse, not
    -- a free one to sell.
    'priceable', (array_length(v_unpriced, 1) is null
                  and coalesce(array_length(v_delivered, 1), 0) > 0),
    'has_provisional_prices', v_provisional
  );
end;
$$;

revoke all on function private.compute_review_price(uuid, uuid, uuid) from public;

create or replace function public.price_review_for_patient(
  p_patient_id uuid,
  p_bundle_code text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org    uuid;
  v_bundle uuid;
  v_staff  boolean;
  v_result jsonb;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select organisation_id into v_org from public.profiles where id = p_patient_id;
  if v_org is null then
    raise exception 'no such patient' using errcode = '42501';
  end if;

  v_staff := private.is_org_staff(v_org);

  if not (
    p_patient_id = v_caller
    or v_staff
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = p_patient_id and pa.grantee_user_id = v_caller
    )
  ) then
    raise exception 'you cannot price a review for this patient' using errcode = '42501';
  end if;

  select id into v_bundle
    from public.panel_bundles
   where code = p_bundle_code and is_active;
  if v_bundle is null then
    raise exception 'that review is not available' using errcode = '42501';
  end if;

  v_result := private.compute_review_price(p_patient_id, v_org, v_bundle);

  if not v_staff then
    -- Patient-facing shape: the tests by name, and one price.
    v_result := v_result
      - 'subtotal_kobo' - 'review_discount_bp' - 'unpriced_codes' - 'has_provisional_prices' - 'delivered_count'
      || jsonb_build_object(
           'lines',
           coalesce((
             select jsonb_agg(jsonb_build_object('code', l ->> 'code', 'name', l ->> 'name'))
             from jsonb_array_elements(v_result -> 'lines') l
           ), '[]'::jsonb)
         );
  end if;

  return v_result;
end;
$$;

revoke all on function public.price_review_for_patient(uuid, text) from public;
revoke all on function public.price_review_for_patient(uuid, text) from anon;
grant execute on function public.price_review_for_patient(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Orders carry the computed price.
--
-- This is the line that actually retires the flat bundle price. Fires only on
-- partner-fulfilled orders: a self-arranged order is still not billed by
-- Tarragon at all, and private.enforce_lab_order_origin still rejects one
-- carrying any price.
--
-- Deliberately unconditional for a partner order rather than "only when
-- total_kobo was left at 0" — the whole point is that no caller anywhere gets
-- to hand this table a price for a review. A negotiated or corporate rate
-- would need its own explicit mechanism; there is no such ask today, and
-- leaving a silent "caller-supplied price wins" hole would reintroduce
-- exactly the bug this migration exists to close.
--
-- Trigger name matters: it must sort after lab_orders_annotate_exclusions
-- (so exclusions are already annotated) and before
-- lab_orders_screening_subscriber_discount (which takes 15% off total_kobo
-- for a subscriber and would otherwise be discounting a number this trigger
-- had not written yet). 'compute' sits between 'annotate'/'assign' and
-- 'screening' alphabetically, which is how Postgres orders same-timing
-- triggers.
-- ---------------------------------------------------------------------------
create or replace function private.set_lab_order_computed_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price jsonb;
begin
  if new.fulfilment is distinct from 'partner' or new.panel_bundle_id is null then
    return new;
  end if;

  v_price := private.compute_review_price(
    new.patient_id, new.organisation_id, new.panel_bundle_id
  );

  if not coalesce((v_price ->> 'ok')::boolean, false) then
    raise exception 'Cannot price this review: %', coalesce(v_price ->> 'error', 'unknown')
      using errcode = '23514';
  end if;

  if coalesce((v_price ->> 'delivered_count')::int, 0) = 0 then
    raise exception 'This review contains nothing for this patient — every test in % is excluded for them (sex, age, already on file, or an unmet gate). Ordering it would bill nothing and wait forever for a result.',
      v_price ->> 'bundle_code'
      using errcode = '23514';
  end if;

  if not coalesce((v_price ->> 'priceable')::boolean, false) then
    raise exception 'Cannot bill this review — no price on file for: %. Set screen_types.price_kobo before billing it.',
      (select string_agg(value #>> '{}', ', ') from jsonb_array_elements(v_price -> 'unpriced_codes'))
      using errcode = '23514';
  end if;

  new.total_kobo := (v_price ->> 'total_kobo')::bigint;
  return new;
end;
$$;

revoke all on function private.set_lab_order_computed_price() from public;

drop trigger if exists lab_orders_compute_review_price on public.lab_orders;
create trigger lab_orders_compute_review_price
  before insert on public.lab_orders
  for each row execute function private.set_lab_order_computed_price();

-- ---------------------------------------------------------------------------
-- 8. Assertions — "computed" is provable here, not hopeful.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad        text;
  v_count      int;
  v_neutral    bigint;
  v_recomputed bigint;
  v_tolerance  bigint;
  v_row        record;
begin
  -- 8a. Dormancy moved cleanly: echo and only echo.
  select string_agg(code, ', ') into v_bad
    from public.screen_types where fulfilment_dormant and code <> 'echo';
  if v_bad is not null then
    raise exception 'unexpected dormant screen types: %', v_bad;
  end if;
  if not exists (select 1 from public.screen_types where code = 'echo' and fulfilment_dormant) then
    raise exception 'echo should still be fulfilment_dormant';
  end if;

  -- 8b. Nothing orderable is unpriced. If this fires, a test was added to a
  --     live bundle without a price and the review containing it could not
  --     have been billed.
  select string_agg(distinct tc.code, ', ') into v_bad
    from public.panel_bundles pb
    join lateral unnest(pb.test_codes) as tc(code) on true
    join public.screen_types st on st.code = tc.code
   where pb.is_active
     and st.fulfilment_dormant = false
     and st.price_kobo is null;
  if v_bad is not null then
    raise exception 'active bundles contain unpriced tests: %', v_bad;
  end if;

  -- 8c. No silent reprice. A sex-neutral patient still pays each bundle's
  --     existing headline price, within the rounding the basis-point
  --     representation allows.
  for v_row in
    select pb.id, pb.code, pb.price_kobo, pb.review_discount_bp
      from public.panel_bundles pb
     where pb.is_active and pb.review_discount_bp > 0
  loop
    select sum(st.price_kobo) into v_neutral
      from unnest((select test_codes from public.panel_bundles where id = v_row.id)) as tc(code)
      join public.screen_types st on st.code = tc.code
     where st.sex_applicability::text = 'all'
       and st.fulfilment_dormant = false
       and st.price_kobo is not null;

    v_recomputed := round(v_neutral::numeric * (10000 - v_row.review_discount_bp) / 10000.0)::bigint;
    v_tolerance  := ceil(v_neutral::numeric / 10000.0)::bigint + 1;

    if abs(v_recomputed - v_row.price_kobo) > v_tolerance then
      raise exception 'bundle % would reprice from % to % (tolerance %)',
        v_row.code, v_row.price_kobo, v_recomputed, v_tolerance;
    end if;
  end loop;

  -- 8d. The two paths really do share one answer now: no copy of the old
  --     hardcoded dormant array survives inside the completeness function.
  if pg_get_functiondef('private.check_screen_order_completeness(uuid)'::regprocedure)
       not like '%patient_delivered_test_codes%' then
    raise exception 'check_screen_order_completeness is not reading the canonical delivered set';
  end if;

  -- 8e. Every partner-billing path goes through the trigger.
  select count(*) into v_count from pg_trigger
   where tgrelid = 'public.lab_orders'::regclass
     and tgname = 'lab_orders_compute_review_price'
     and not tgisinternal;
  if v_count <> 1 then
    raise exception 'lab_orders_compute_review_price trigger missing';
  end if;
end $$;
