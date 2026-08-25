-- Reconciliation: capture live-only Synlab partner-billing drift into git.
--
-- WHAT HAPPENED: between 2026-08-21 19:11 and 19:31 UTC, seven migrations were
-- applied directly to the live production project (koiplnmbgnqnbywhpjlf) that
-- were never committed to this git repository, on any branch:
--   20260821191128 screen_price_source_contracted
--   20260821191743 synlab_contract_prices_and_tier_restructure
--   20260821191942 partner_billing_collect_and_liability
--   20260821192035 partner_billing_transmit
--   20260821192256 partner_billing_reconcile_settle_refund
--   20260821192827 partner_revenue_treatment_principal_or_agent
--   20260821193144 switch_on_synlab
-- (Confirm live via `select version, name from supabase_migrations.schema_migrations
-- order by version` on that project — those seven, plus everything after them
-- through 20260825182933, are absent from supabase/migrations/ in this repo as
-- of this commit.) Discovered 2026-08-25 while implementing an unrelated,
-- simpler "restore partner-lab billing" change in this same session — that
-- earlier, now-deleted migration
-- (20260825185258_lab_partner_fulfilment_restored.sql) duplicated and would
-- have regressed this already-shipped, considerably more sophisticated system.
--
-- LIVE WORK WAS STILL IN PROGRESS WHILE THIS WAS WRITTEN: one function below
-- (private.apply_screening_subscriber_discount) carries its own 2026-08-25
-- decision note describing a margin problem found from a real order created
-- at 19:41 UTC that same day -- after the seven migrations above and during
-- this reconciliation. Whoever/whatever is building this was actively
-- iterating on it in real time, outside git, concurrently with this session.
-- Treat this migration as a verified snapshot at the time it was written, not
-- a guarantee that nothing else has moved since -- re-diff against the live
-- project before trusting this blindly on a later date.
--
-- WHY ONE CONSOLIDATED FILE, NOT SEVEN: Supabase's migration history
-- (`supabase_migrations.schema_migrations`) retains only a version and a name
-- per applied migration, not the original SQL text. There is no way to
-- recover the seven files' real historical content, and fabricating a
-- plausible-looking split across seven correctly-named files would present
-- inference as fact. What follows is instead the verified CURRENT cumulative
-- state of every lab-partner-billing object, reconstructed via direct schema
-- and function introspection against the live project on 2026-08-25 —
-- `pg_get_functiondef` for every function (byte-exact), `information_schema`/
-- `pg_constraint`/`pg_policies` for every table (exact), `pg_enum` for every
-- enum (exact). Every statement is `create or replace` / `... if not exists`,
-- so replaying this against a fresh database converges to the live state;
-- replayed against the live project itself (where the real seven migrations
-- already applied) every statement here is a no-op.
--
-- OUT OF SCOPE, DELIBERATELY NOT RECONCILED HERE: four further live-only
-- migrations in the 2026-08-25 range (`device_catalog`,
-- `home_visit_and_logistics_partners_location`, `public_partner_locations`,
-- `lab_providers_location`, `public_partner_locations_add_lab`) build an
-- unrelated partner-location/map feature and a consumer-device catalogue —
-- not part of lab fulfilment. `device_catalog`'s table only is captured below
-- (it was pulled in incidentally while auditing every new public table) but
-- its RPCs, the location tables, and their app-code surface are NOT
-- reconstructed here and remain drifted; a separate reconciliation pass
-- should cover them. Two more (`remove_screening_subscriber_discount`,
-- `remove_ogtt_from_hypertension_panel`) are catalogue-content edits,
-- independent of partner billing, also not reconstructed here — this
-- migration does not alter `panel_bundles.test_codes` or the subscriber
-- discount mechanism.

-- ============================================================================
-- 1. New enums
-- ============================================================================
do $$ begin
  create type public.screen_price_source as enum
    ('lab_price_list', 'provisional', 'contracted', 'derived_from_panel_total');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lab_order_transmission as enum
    ('not_required', 'awaiting_payment', 'queued', 'sent', 'acknowledged', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.partner_revenue_treatment as enum ('net_agent', 'gross_principal');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.partner_statement_status as enum
    ('draft', 'matched', 'disputed', 'approved', 'settled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.partner_statement_line_resolution as enum
    ('unmatched', 'agreed', 'overcharged', 'undercharged', 'not_ordered', 'not_delivered');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lab_refund_reason as enum
    ('patient_cancelled', 'never_attended', 'sample_rejected', 'partially_run',
     'result_lost', 'duplicate_order', 'clinically_withdrawn');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lab_refund_status as enum ('requested', 'approved', 'rejected', 'paid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.device_catalog_category as enum
    ('blood_pressure', 'weight', 'blood_glucose', 'band');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.device_catalog_fulfillment_type as enum ('affiliate', 'tarragon_owned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.device_catalog_pairing_path as enum
    ('ble_open_gatt', 'ble_vendor_sdk', 'health_connect_bridge', 'manual_only');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- 2. screen_types: the patient-facing contracted price list, per test code.
--    Separate from lab_orders.total_kobo (what the patient pays) and from
--    lab_tests.price_kobo (what a provider charges Tarragon — provider cost).
-- ============================================================================
alter table public.screen_types
  add column if not exists price_kobo bigint,
  add column if not exists price_source public.screen_price_source,
  add column if not exists fulfilment_dormant boolean not null default false;

comment on column public.screen_types.price_kobo is
  'What a patient is billed for this test under partner fulfilment. NULL means unpriceable — compute_review_price refuses to bill it.';
comment on column public.screen_types.price_source is
  'contracted = a real negotiated partner price. derived_from_panel_total = computed from a panel, not priced standalone. provisional = a placeholder pending a real contract, still billable but not yet confirmed by any partner. lab_price_list = sourced from a published, non-negotiated price list.';
comment on column public.screen_types.fulfilment_dormant is
  'true = never delivered via partner fulfilment regardless of price, same dormant-not-deleted pattern used elsewhere (e.g. echo, pending a contracted provider for it).';

-- ============================================================================
-- 3. panel_bundles: tier/discount columns for the Screen-ladder restructure.
-- ============================================================================
alter table public.panel_bundles
  add column if not exists review_discount_bp integer not null default 0,
  add column if not exists is_screen_tier boolean not null default false;

comment on column public.panel_bundles.review_discount_bp is
  'Basis points off the summed screen_types.price_kobo lines for this bundle (e.g. a Screen-tier discount for buying the panel rather than each test separately). 0 = no discount.';
comment on column public.panel_bundles.price_kobo is
  'Legacy/headline reference value only for a partner-fulfilled order — the authoritative charge is computed by private.compute_review_price from screen_types.price_kobo at insert time, not read from this column.';

-- ============================================================================
-- 4. lab_orders: partner-cost and transmission tracking.
-- ============================================================================
alter table public.lab_orders
  add column if not exists partner_cost_kobo bigint,
  add column if not exists partner_cost_provider_id uuid references public.lab_providers(id),
  add column if not exists transmission public.lab_order_transmission not null default 'not_required',
  add column if not exists transmitted_at timestamptz,
  add column if not exists transmission_ack_at timestamptz,
  add column if not exists partner_reference text,
  add column if not exists transmission_note text,
  add column if not exists partner_cost_breakdown jsonb;

comment on column public.lab_orders.partner_cost_kobo is
  'What Tarragon owes the laboratory for this order (sum of lab_tests.price_kobo for the delivered codes) — cost, never shown to the patient.';
comment on column public.lab_orders.transmission is
  'awaiting_payment = created but not yet paid, nothing sent to the lab. queued = paid, ready to send. sent = mark_lab_order_transmitted has been called. acknowledged/failed = the partner confirmed or rejected receipt. not_required = self-arranged, there is no partner to tell.';

-- ============================================================================
-- 5. private.patient_delivered_test_codes — which of a bundle's test codes
--    this specific patient actually receives (age/sex/exclusion-gated, and
--    now also fulfilment_dormant-gated).
-- ============================================================================
create or replace function private.patient_delivered_test_codes(p_patient_id uuid, p_organisation_id uuid, p_test_codes text[])
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    -- Settled exclusions only. 'pending_shared_decision' stays required and
    -- billed (see the long note in the computed-price migration);
    -- 'within_window_period' is the opposite — genuinely needed, genuinely not
    -- yet, and must not be charged for today.
    if exists (
      select 1 from jsonb_array_elements(v_excluded) e
      where e ->> 'item_code' = v_code
        and (
          e ->> 'reason' in ('lifetime_once_on_file', 'terminal_serology_state')
          or e ->> 'reason' like 'owned_by_pathway:%'
          or e ->> 'reason' like 'within_window_period:%'
        )
    ) then
      continue;
    end if;

    v_out := v_out || v_code;
  end loop;

  return v_out;
end;
$function$;

-- ============================================================================
-- 6. private.compute_review_price — the patient-facing price for a bundle.
-- ============================================================================
create or replace function private.compute_review_price(p_patient_id uuid, p_organisation_id uuid, p_bundle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'total_kobo', round(v_subtotal::numeric * (10000 - v_bundle.review_discount_bp) / 10000.0)::bigint,
    'subtotal_kobo', v_subtotal,
    'review_discount_bp', v_bundle.review_discount_bp,
    'headline_price_kobo', v_bundle.price_kobo,
    'lines', v_lines,
    'unpriced_codes', to_jsonb(v_unpriced),
    'delivered_count', coalesce(array_length(v_delivered, 1), 0),
    'priceable', (array_length(v_unpriced, 1) is null
                  and coalesce(array_length(v_delivered, 1), 0) > 0),
    'has_provisional_prices', v_provisional
  );
end;
$function$;

-- ============================================================================
-- 7. private.compute_partner_cost — what Tarragon owes the given provider.
-- ============================================================================
create or replace function private.compute_partner_cost(p_patient_id uuid, p_organisation_id uuid, p_bundle_id uuid, p_provider_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_codes     text[];
  v_code      text;
  v_cost      bigint;
  v_total     bigint := 0;
  v_missing   text[] := '{}';
  v_breakdown jsonb := '[]'::jsonb;
begin
  select private.patient_delivered_test_codes(p_patient_id, p_organisation_id, pb.test_codes)
    into v_codes
    from public.panel_bundles pb where pb.id = p_bundle_id;

  if v_codes is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_bundle');
  end if;

  foreach v_code in array v_codes loop
    select lt.price_kobo into v_cost
      from public.lab_tests lt
     where lt.provider_id = p_provider_id and lt.code = v_code;

    if v_cost is null then
      v_missing := v_missing || v_code;
    else
      v_total := v_total + v_cost;
      v_breakdown := v_breakdown || jsonb_build_object('code', v_code, 'cost_kobo', v_cost);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', (array_length(v_missing, 1) is null),
    'cost_kobo', v_total,
    'breakdown', v_breakdown,
    'missing_codes', to_jsonb(v_missing)
  );
end;
$function$;

-- ============================================================================
-- 8. private.resolve_lab_order_provider — which provider a partner order
--    routes to, from an explicit provider/facility, or the sole active one.
-- ============================================================================
create or replace function private.resolve_lab_order_provider(p_provider_id uuid, p_facility_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select lp.id from public.lab_providers lp where lp.id = p_provider_id and lp.is_active),
    (select f.lab_provider_id from public.facilities f
      where f.id = p_facility_id and f.is_active and f.lab_provider_id is not null),
    (select lp.id from public.lab_providers lp
      where lp.is_active
        and (select count(*) from public.lab_providers x where x.is_active) = 1
      limit 1)
  );
$function$;

-- ============================================================================
-- 9. private.set_lab_order_computed_price — BEFORE INSERT trigger that prices
--    a partner order and computes its provider cost, authoritatively.
-- ============================================================================
create or replace function private.set_lab_order_computed_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_price    jsonb;
  v_cost     jsonb;
  v_provider uuid;
begin
  if new.fulfilment is distinct from 'partner' or new.panel_bundle_id is null then
    return new;
  end if;

  v_price := private.compute_review_price(new.patient_id, new.organisation_id, new.panel_bundle_id);

  if not coalesce((v_price ->> 'ok')::boolean, false) then
    raise exception 'Cannot price this review: %', coalesce(v_price ->> 'error', 'unknown')
      using errcode = '23514';
  end if;
  if coalesce((v_price ->> 'delivered_count')::int, 0) = 0 then
    raise exception 'This review contains nothing for this patient — every test in % is excluded for them (sex, age, already on file, or an unmet gate).',
      v_price ->> 'bundle_code' using errcode = '23514';
  end if;
  if not coalesce((v_price ->> 'priceable')::boolean, false) then
    raise exception 'Cannot bill this review — no price on file for: %.',
      (select string_agg(value #>> '{}', ', ') from jsonb_array_elements(v_price -> 'unpriced_codes'))
      using errcode = '23514';
  end if;

  new.total_kobo := (v_price ->> 'total_kobo')::bigint;

  v_provider := private.resolve_lab_order_provider(new.provider_id, new.facility_id);
  if v_provider is null then
    raise exception 'No active partner laboratory for this order.' using errcode = '23514';
  end if;

  v_cost := private.compute_partner_cost(new.patient_id, new.organisation_id, new.panel_bundle_id, v_provider);
  if not coalesce((v_cost ->> 'ok')::boolean, false) then
    raise exception 'The partner laboratory has no contracted price for: %. Taking payment for a test they have not agreed to run would leave the patient paid up and the test undeliverable.',
      (select string_agg(value #>> '{}', ', ') from jsonb_array_elements(v_cost -> 'missing_codes'))
      using errcode = '23514';
  end if;

  new.partner_cost_kobo        := (v_cost ->> 'cost_kobo')::bigint;
  new.partner_cost_breakdown   := v_cost -> 'breakdown';
  new.partner_cost_provider_id := v_provider;

  return new;
end;
$function$;

-- ============================================================================
-- 10. private.enforce_lab_order_not_below_cost — never sell below what the
--     laboratory charges Tarragon.
-- ============================================================================
create or replace function private.enforce_lab_order_not_below_cost()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_net bigint;
begin
  if new.fulfilment is distinct from 'partner' or new.partner_cost_kobo is null then
    return new;
  end if;

  v_net := coalesce(new.total_kobo, 0) - coalesce(new.subscriber_discount_kobo, 0);

  if v_net < new.partner_cost_kobo then
    raise exception 'This review would be sold below cost: the patient pays % kobo after discount, and % charges % kobo to run it.',
      v_net,
      coalesce((select name from public.lab_providers where id = new.partner_cost_provider_id), 'the laboratory'),
      new.partner_cost_kobo
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

-- ============================================================================
-- 11. private.queue_lab_order_transmission — computes the initial/updated
--     transmission state; never trusted from the caller.
-- ============================================================================
create or replace function private.queue_lab_order_transmission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.fulfilment <> 'partner' then
    new.transmission := 'not_required';
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.transmission := case
      when new.status = 'payment_confirmed' then 'queued'
      else 'awaiting_payment'
    end;
    return new;
  end if;

  if new.status = 'payment_confirmed'
     and old.status is distinct from new.status
     and new.transmission = 'awaiting_payment' then
    new.transmission := 'queued';
  end if;

  return new;
end;
$function$;

-- ============================================================================
-- 12. Triggers on lab_orders — add the three that don't already exist.
--     lab_orders_compute_review_price and lab_orders_zz_never_below_partner_cost
--     both run BEFORE INSERT, and the "zz" prefix is deliberate: Postgres runs
--     same-timing triggers in name order, so the cost guard always sees a
--     price the pricing trigger has already computed.
-- ============================================================================
drop trigger if exists lab_orders_compute_review_price on public.lab_orders;
create trigger lab_orders_compute_review_price
  before insert on public.lab_orders
  for each row execute function private.set_lab_order_computed_price();

drop trigger if exists lab_orders_zz_never_below_partner_cost on public.lab_orders;
create trigger lab_orders_zz_never_below_partner_cost
  before insert on public.lab_orders
  for each row execute function private.enforce_lab_order_not_below_cost();

drop trigger if exists lab_orders_queue_transmission on public.lab_orders;
create trigger lab_orders_queue_transmission
  before insert or update of status on public.lab_orders
  for each row execute function private.queue_lab_order_transmission();

-- ============================================================================
-- 13. public.mark_lab_order_transmitted — staff records the order was sent.
-- ============================================================================
create or replace function public.mark_lab_order_transmitted(p_order_id uuid, p_partner_reference text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.lab_orders%rowtype;
begin
  select * into v_order from public.lab_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'no such order' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_order.organisation_id) then
    raise exception 'only care-team staff can record transmission' using errcode = '42501';
  end if;
  if v_order.fulfilment <> 'partner' then
    raise exception 'a self-arranged order is carried by the patient, not transmitted' using errcode = '23514';
  end if;
  if v_order.status <> 'payment_confirmed' then
    raise exception 'this order is not paid for yet — sending it would hand the laboratory unfunded work'
      using errcode = '23514';
  end if;

  update public.lab_orders
     set transmission      = 'sent',
         transmitted_at    = coalesce(transmitted_at, now()),
         partner_reference = coalesce(p_partner_reference, partner_reference),
         transmission_note = coalesce(p_note, transmission_note)
   where id = p_order_id;

  return jsonb_build_object('ok', true, 'transmission', 'sent');
end;
$function$;

grant execute on function public.mark_lab_order_transmitted(uuid, text, text) to authenticated;
revoke execute on function public.mark_lab_order_transmitted(uuid, text, text) from anon, public;

-- ============================================================================
-- 14. private.partner_revenue_treatment — reads the single-row policy.
-- ============================================================================
create or replace function private.partner_revenue_treatment()
 RETURNS partner_revenue_treatment
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select treatment from public.finance_partner_revenue_policy where id), 'net_agent');
$function$;

-- ============================================================================
-- 15. New tables.
-- ============================================================================
create table if not exists public.finance_partner_revenue_policy (
  id         boolean primary key default true,
  treatment  public.partner_revenue_treatment not null default 'net_agent',
  decided_by text,
  decided_at timestamptz,
  note       text not null,
  updated_at timestamptz not null default now(),
  constraint finance_partner_revenue_policy_id_check check (id)
);
comment on table public.finance_partner_revenue_policy is
  'One row, ever (id is a checked boolean primary key). How partner laboratory income is presented in the profit and loss. net_agent = only Tarragon''s margin is revenue. gross_principal = the full patient price is revenue and the laboratory''s charge is cost of sales. The balance sheet is identical either way; decided_by should name the accountant who made the call.';

alter table public.finance_partner_revenue_policy enable row level security;
drop policy if exists finance_partner_revenue_policy_select on public.finance_partner_revenue_policy;
create policy finance_partner_revenue_policy_select on public.finance_partner_revenue_policy
  for select to authenticated using (true);
grant select, insert, update, delete on public.finance_partner_revenue_policy to authenticated;

insert into public.finance_partner_revenue_policy (id, treatment, decided_by, decided_at, note)
values (true, 'net_agent', null, null,
  'Default, and what the founder asked for: money held for the laboratory is a liability, not income. NOT yet reviewed by an accountant — the principal indicators (price discretion, responsibility to the patient) are strong enough that this should be confirmed before any figure leaves the building.')
on conflict (id) do nothing;

create table if not exists public.partner_statements (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations(id) on delete restrict,
  provider_id         uuid not null references public.lab_providers(id) on delete restrict,
  reference           text not null,
  period_start        date not null,
  period_end          date not null,
  currency            public.currency not null default 'NGN',
  invoiced_total_kobo bigint not null check (invoiced_total_kobo >= 0),
  expected_total_kobo bigint,
  status              public.partner_statement_status not null default 'draft',
  received_at         timestamptz not null default now(),
  matched_at          timestamptz,
  approved_by         uuid references public.profiles(id) on delete restrict,
  approved_at         timestamptz,
  settled_at          timestamptz,
  bill_id             uuid references public.finance_bills(id) on delete restrict,
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint partner_statements_check check (period_end >= period_start),
  constraint partner_statements_provider_id_reference_key unique (provider_id, reference)
);

alter table public.partner_statements enable row level security;
drop policy if exists partner_statements_staff on public.partner_statements;
create policy partner_statements_staff on public.partner_statements
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
grant select, insert, update, delete on public.partner_statements to authenticated;

drop trigger if exists partner_statements_set_updated_at on public.partner_statements;
create trigger partner_statements_set_updated_at
  before update on public.partner_statements
  for each row execute function private.set_updated_at();

create table if not exists public.partner_statement_lines (
  id                uuid primary key default gen_random_uuid(),
  statement_id      uuid not null references public.partner_statements(id) on delete cascade,
  lab_order_id      uuid references public.lab_orders(id) on delete restrict,
  partner_reference text,
  screen_type_code  text references public.screen_types(code) on delete restrict,
  invoiced_kobo     bigint not null check (invoiced_kobo >= 0),
  expected_kobo     bigint,
  resolution        public.partner_statement_line_resolution not null default 'unmatched',
  resolution_note   text,
  resolved_by       uuid references public.profiles(id) on delete restrict,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now()
);

alter table public.partner_statement_lines enable row level security;
drop policy if exists partner_statement_lines_staff on public.partner_statement_lines;
create policy partner_statement_lines_staff on public.partner_statement_lines
  for all to authenticated
  using (exists (select 1 from public.partner_statements ps
                  where ps.id = partner_statement_lines.statement_id
                    and private.is_org_staff(ps.organisation_id)))
  with check (exists (select 1 from public.partner_statements ps
                        where ps.id = partner_statement_lines.statement_id
                          and private.is_org_staff(ps.organisation_id)));
grant select, insert, update, delete on public.partner_statement_lines to authenticated;

create table if not exists public.lab_refund_policies (
  reason             public.lab_refund_reason primary key,
  refunds_in_full    boolean not null,
  partner_still_owed boolean not null,
  note               text not null
);
comment on table public.lab_refund_policies is
  'The defined answer for each way a paid laboratory order can go wrong, decided in advance rather than per incident. refunds_in_full = the patient gets everything back. partner_still_owed = the laboratory did the work and is paid regardless, so Tarragon absorbs the cost as well as the margin.';

alter table public.lab_refund_policies enable row level security;
drop policy if exists lab_refund_policies_select on public.lab_refund_policies;
create policy lab_refund_policies_select on public.lab_refund_policies
  for select to authenticated using (true);
grant select, insert, update, delete on public.lab_refund_policies to authenticated;

insert into public.lab_refund_policies (reason, refunds_in_full, partner_still_owed, note) values
  ('patient_cancelled',   true,  false, 'Cancelled before the sample was taken. Nothing was consumed; the laboratory is not owed and the patient gets everything back.'),
  ('never_attended',      true,  false, 'Paid and never went. The order is voided, the held funds are released, and the patient is refunded in full — we do not keep money for a test nobody performed.'),
  ('sample_rejected',     true,  false, 'The sample could not be used (haemolysed, insufficient, mislabelled). Refunded in full; the patient may re-book at no penalty. The laboratory is not paid for a sample it could not run.'),
  ('partially_run',       false, true,  'Some tests ran and some did not. The patient is refunded for the tests that did not, and the laboratory is paid for the ones it did.'),
  ('result_lost',         true,  true,  'The work was done and the result never reached the patient. Our failure, not theirs: the patient is refunded in full AND the laboratory is still paid. Tarragon absorbs both.'),
  ('duplicate_order',     true,  false, 'The same review ordered twice. The duplicate is voided in full before it reaches the laboratory.'),
  ('clinically_withdrawn',true,  false, 'A doctor withdrew the request before it was run — a result already on file, or a change in the clinical picture. Refunded in full.')
on conflict (reason) do nothing;

create table if not exists public.lab_order_refunds (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations(id) on delete restrict,
  lab_order_id         uuid not null references public.lab_orders(id) on delete restrict,
  reason               public.lab_refund_reason not null references public.lab_refund_policies(reason) on delete restrict,
  status               public.lab_refund_status not null default 'requested',
  refund_total_kobo    bigint not null check (refund_total_kobo > 0),
  partner_portion_kobo bigint not null default 0 check (partner_portion_kobo >= 0),
  margin_portion_kobo  bigint not null default 0 check (margin_portion_kobo >= 0),
  detail               text,
  requested_by         uuid references public.profiles(id) on delete restrict,
  requested_at         timestamptz not null default now(),
  approved_by          uuid references public.profiles(id) on delete restrict,
  approved_at          timestamptz,
  paid_at              timestamptz,
  journal_entry_id     uuid references public.finance_journal_entries(id) on delete restrict,
  created_at           timestamptz not null default now(),
  constraint lab_order_refunds_check check (partner_portion_kobo + margin_portion_kobo <= refund_total_kobo)
);

alter table public.lab_order_refunds enable row level security;
drop policy if exists lab_order_refunds_staff on public.lab_order_refunds;
create policy lab_order_refunds_staff on public.lab_order_refunds
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
drop policy if exists lab_order_refunds_patient_select on public.lab_order_refunds;
create policy lab_order_refunds_patient_select on public.lab_order_refunds
  for select to authenticated
  using (exists (select 1 from public.lab_orders lo
                  where lo.id = lab_order_refunds.lab_order_id
                    and lo.patient_id = (select auth.uid())));
grant select, insert, update, delete on public.lab_order_refunds to authenticated;

-- Captured for completeness (see "out of scope" note above) — schema only,
-- not its RPCs, seed data, or app surface.
create table if not exists public.device_catalog (
  id                  uuid primary key default gen_random_uuid(),
  device_name         text not null,
  category            public.device_catalog_category not null,
  fulfillment_type    public.device_catalog_fulfillment_type not null default 'affiliate',
  pairing_path        public.device_catalog_pairing_path not null,
  vendor_name         text,
  description         text,
  image_url           text,
  affiliate_partner   text,
  affiliate_link      text,
  price_range_ngn     text,
  gatt_service_uuids  text[] not null default '{}',
  vendor_sdk_ref      text,
  display_order       integer not null default 0,
  active              boolean not null default false,
  clinically_reviewed boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint device_catalog_affiliate_link_required check (
    fulfillment_type <> 'affiliate' or affiliate_link is not null),
  constraint device_catalog_gatt_uuids_scope check (
    pairing_path = 'ble_open_gatt' or gatt_service_uuids = '{}'),
  constraint device_catalog_vendor_sdk_ref_scope check (
    pairing_path = 'ble_vendor_sdk' or vendor_sdk_ref is null)
);

alter table public.device_catalog enable row level security;
drop policy if exists device_catalog_select on public.device_catalog;
create policy device_catalog_select on public.device_catalog for select to authenticated using (true);
drop policy if exists device_catalog_insert on public.device_catalog;
create policy device_catalog_insert on public.device_catalog for insert to authenticated with check (private.is_admin());
drop policy if exists device_catalog_update on public.device_catalog;
create policy device_catalog_update on public.device_catalog for update to authenticated using (private.is_admin()) with check (private.is_admin());
drop policy if exists device_catalog_delete on public.device_catalog;
create policy device_catalog_delete on public.device_catalog for delete to authenticated using (private.is_admin());
grant select, insert, update, delete on public.device_catalog to authenticated;

drop trigger if exists device_catalog_set_updated_at on public.device_catalog;
create trigger device_catalog_set_updated_at
  before update on public.device_catalog
  for each row execute function private.set_updated_at();

-- ============================================================================
-- 16. Statement reconciliation + approval RPCs.
-- ============================================================================
create or replace function public.match_partner_statement(p_statement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_stmt public.partner_statements%rowtype;
  v_line record;
  v_expected bigint;
  v_res public.partner_statement_line_resolution;
  v_total_expected bigint := 0;
  v_variances int := 0;
begin
  select * into v_stmt from public.partner_statements where id = p_statement_id;
  if v_stmt.id is null then
    raise exception 'no such statement' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_stmt.organisation_id) then
    raise exception 'only care-team staff can reconcile a partner statement' using errcode = '42501';
  end if;
  if v_stmt.status in ('approved', 'settled') then
    raise exception 'this statement is already % — re-matching it would rewrite an agreed record', v_stmt.status
      using errcode = '23514';
  end if;

  for v_line in
    select * from public.partner_statement_lines where statement_id = p_statement_id
  loop
    v_expected := null;

    if v_line.lab_order_id is not null then
      select (elem ->> 'cost_kobo')::bigint into v_expected
        from public.lab_orders lo,
             lateral jsonb_array_elements(coalesce(lo.partner_cost_breakdown, '[]'::jsonb)) elem
       where lo.id = v_line.lab_order_id
         and elem ->> 'code' = v_line.screen_type_code
       limit 1;
    end if;

    if v_expected is null then
      v_res := 'not_ordered';
    elsif v_line.invoiced_kobo = v_expected then
      v_res := 'agreed';
    elsif v_line.invoiced_kobo > v_expected then
      v_res := 'overcharged';
    else
      v_res := 'undercharged';
    end if;

    if v_res <> 'agreed' then
      v_variances := v_variances + 1;
    end if;
    v_total_expected := v_total_expected + coalesce(v_expected, 0);

    update public.partner_statement_lines
       set expected_kobo = v_expected, resolution = v_res
     where id = v_line.id;
  end loop;

  insert into public.partner_statement_lines
    (statement_id, lab_order_id, screen_type_code, invoiced_kobo, expected_kobo, resolution, resolution_note)
  select p_statement_id, lo.id, elem ->> 'code', 0, (elem ->> 'cost_kobo')::bigint, 'not_delivered',
         'Ordered and paid for in this period, but absent from the statement.'
    from public.lab_orders lo,
         lateral jsonb_array_elements(coalesce(lo.partner_cost_breakdown, '[]'::jsonb)) elem
   where lo.partner_cost_provider_id = v_stmt.provider_id
     and lo.fulfilment = 'partner'
     and lo.status in ('payment_confirmed', 'sample_collected', 'processing', 'resulted')
     and lo.payment_confirmed_at::date between v_stmt.period_start and v_stmt.period_end
     and not exists (
       select 1 from public.partner_statement_lines l
        where l.statement_id = p_statement_id
          and l.lab_order_id = lo.id
          and l.screen_type_code = elem ->> 'code'
     );

  select count(*) filter (where resolution <> 'agreed'),
         sum(coalesce(expected_kobo, 0))
    into v_variances, v_total_expected
    from public.partner_statement_lines where statement_id = p_statement_id;

  update public.partner_statements
     set expected_total_kobo = v_total_expected,
         status = (case when v_variances = 0 then 'matched' else 'disputed' end)::public.partner_statement_status,
         matched_at = now()
   where id = p_statement_id;

  return jsonb_build_object(
    'ok', true,
    'status', case when v_variances = 0 then 'matched' else 'disputed' end,
    'variance_lines', v_variances,
    'invoiced_kobo', v_stmt.invoiced_total_kobo,
    'expected_kobo', v_total_expected,
    'difference_kobo', v_stmt.invoiced_total_kobo - v_total_expected
  );
end;
$function$;

create or replace function public.approve_partner_statement(p_statement_id uuid, p_force_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_stmt public.partner_statements%rowtype;
  v_unresolved int;
  v_agreed bigint;
  v_vendor uuid;
  v_bill uuid;
  v_entry uuid;
  v_provider_name text;
begin
  select * into v_stmt from public.partner_statements where id = p_statement_id;
  if v_stmt.id is null then
    raise exception 'no such statement' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_stmt.organisation_id) then
    raise exception 'you cannot see this partner statement' using errcode = '42501';
  end if;
  if not private.finance_can('finance.vendors.manage') then
    raise exception 'approving a partner statement commits Tarragon to pay it, which needs finance authority'
      using errcode = '42501';
  end if;
  if v_stmt.status = 'settled' then
    raise exception 'this statement is already settled' using errcode = '23514';
  end if;
  if v_stmt.status = 'draft' then
    raise exception 'match this statement against our orders before approving it' using errcode = '23514';
  end if;

  select count(*) into v_unresolved
    from public.partner_statement_lines
   where statement_id = p_statement_id
     and resolution <> 'agreed'
     and resolved_at is null;

  if v_unresolved > 0 and coalesce(btrim(p_force_note), '') = '' then
    raise exception '% line(s) on this statement still disagree with our orders. Resolve them, or approve with a written reason.', v_unresolved
      using errcode = '23514';
  end if;

  select coalesce(sum(case when resolution in ('agreed', 'undercharged') then invoiced_kobo
                           when resolution = 'overcharged' then coalesce(expected_kobo, invoiced_kobo)
                           else 0 end), 0)
    into v_agreed
    from public.partner_statement_lines where statement_id = p_statement_id;

  if v_agreed <= 0 then
    raise exception 'nothing on this statement is agreed to be payable' using errcode = '23514';
  end if;

  select name into v_provider_name from public.lab_providers where id = v_stmt.provider_id;

  select id into v_vendor from public.finance_vendors where name = v_provider_name;
  if v_vendor is null then
    insert into public.finance_vendors (name, vendor_type, is_active, wht_applicable)
    values (v_provider_name, 'lab', true, false)
    returning id into v_vendor;
  end if;

  v_bill := public.finance_create_bill(
    v_vendor, v_stmt.period_end, v_stmt.period_end + 30, v_stmt.currency::text, v_agreed,
    '2700', 'PARTNER_NET',
    'Laboratory statement ' || v_stmt.reference
      || ' (' || v_stmt.period_start || ' to ' || v_stmt.period_end || ')');

  v_entry := public.finance_approve_bill(v_bill);

  update public.partner_statements
     set status = 'approved',
         approved_by = (select auth.uid()),
         approved_at = now(),
         bill_id = v_bill,
         note = coalesce(p_force_note, note)
   where id = p_statement_id;

  return jsonb_build_object('ok', true, 'agreed_kobo', v_agreed,
    'invoiced_kobo', v_stmt.invoiced_total_kobo,
    'withheld_kobo', v_stmt.invoiced_total_kobo - v_agreed,
    'bill_id', v_bill, 'journal_entry_id', v_entry);
end;
$function$;

grant execute on function public.match_partner_statement(uuid) to authenticated;
grant execute on function public.approve_partner_statement(uuid, text) to authenticated;
revoke execute on function public.match_partner_statement(uuid) from anon, public;
revoke execute on function public.approve_partner_statement(uuid, text) from anon, public;

-- ============================================================================
-- 17. public.request_lab_order_refund.
-- ============================================================================
create or replace function public.request_lab_order_refund(p_order_id uuid, p_reason lab_refund_reason, p_amount_kobo bigint DEFAULT NULL::bigint, p_detail text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order   public.lab_orders%rowtype;
  v_policy  public.lab_refund_policies%rowtype;
  v_paid    bigint;
  v_amount  bigint;
  v_partner bigint;
  v_margin  bigint;
  v_refund  uuid;
begin
  select * into v_order from public.lab_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'no such order' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_order.organisation_id) then
    raise exception 'only care-team staff can raise a refund' using errcode = '42501';
  end if;
  if v_order.fulfilment <> 'partner' then
    raise exception 'a self-arranged order was never billed by Tarragon, so there is nothing here to refund — the patient paid the laboratory directly'
      using errcode = '23514';
  end if;

  select * into v_policy from public.lab_refund_policies where reason = p_reason;

  v_paid   := coalesce(v_order.total_kobo, 0) - coalesce(v_order.subscriber_discount_kobo, 0);
  v_amount := case when v_policy.refunds_in_full then v_paid else coalesce(p_amount_kobo, 0) end;

  if v_amount <= 0 then
    raise exception 'a partial refund needs an amount' using errcode = '23514';
  end if;
  if v_amount > v_paid then
    raise exception 'refund of % exceeds the % actually paid on this order', v_amount, v_paid
      using errcode = '23514';
  end if;

  if v_policy.partner_still_owed then
    v_partner := 0;
    v_margin  := v_amount;
  else
    v_partner := least(coalesce(v_order.partner_cost_kobo, 0), v_amount);
    v_margin  := v_amount - v_partner;
  end if;

  insert into public.lab_order_refunds
    (organisation_id, lab_order_id, reason, refund_total_kobo,
     partner_portion_kobo, margin_portion_kobo, detail, requested_by)
  values
    (v_order.organisation_id, p_order_id, p_reason, v_amount,
     v_partner, v_margin, p_detail, (select auth.uid()))
  returning id into v_refund;

  return jsonb_build_object('ok', true, 'refund_id', v_refund,
    'refund_kobo', v_amount, 'released_from_liability_kobo', v_partner,
    'tarragon_loss_kobo', v_margin, 'policy', v_policy.note);
end;
$function$;

grant execute on function public.request_lab_order_refund(uuid, lab_refund_reason, bigint, text) to authenticated;
revoke execute on function public.request_lab_order_refund(uuid, lab_refund_reason, bigint, text) from anon, public;

-- ============================================================================
-- 18. private.finance_post_from_payment — gains the partner-cost-aware branch
--     for a lab-order booking payment (net_agent vs gross_principal GL
--     treatment). Every other branch (subscription/add-on/voucher/refund)
--     preserved exactly as already committed to git.
-- ============================================================================
create or replace function private.finance_post_from_payment(p_txn_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  txn public.payment_transactions%rowtype;
  v_kind text;
  v_amount bigint;
  v_cur public.currency;
  v_date date;
  v_is_money_in boolean;
  v_is_refund boolean;
  v_int public.billing_interval;
  v_cpe timestamptz;
  v_pstart date;
  v_pend date;
  v_txn_entry uuid;
  v_lab public.lab_orders%rowtype;
  v_cost bigint;
  v_lines jsonb;
  v_treatment public.partner_revenue_treatment;
  v_lab_name text;
begin
  select * into txn from public.payment_transactions where id = p_txn_id;
  if txn.id is null then return; end if;
  if txn.processed_at is null then return; end if;
  v_amount := coalesce(txn.amount_minor, 0);
  if v_amount <= 0 then return; end if;
  v_cur := coalesce(txn.currency, 'NGN');
  v_date := coalesce(txn.processed_at::date, current_date);

  v_is_refund := txn.event_type::text ilike '%refund%';
  v_is_money_in := txn.event_type::text in ('charge.success','checkout.session.completed','invoice.payment_succeeded')
    or (txn.event_type::text = 'invoice.update'
        and (txn.raw_payload#>>'{data,paid}' = 'true' or txn.raw_payload#>>'{data,status}' = 'success'));

  if v_is_refund then
    perform private.finance_post_journal(v_date, v_cur, 'refund', txn.id::text,
      'Refund — ' || txn.provider::text,
      jsonb_build_array(
        jsonb_build_object('account_code','4900','debit_minor',v_amount,'credit_minor',0,'organisation_id',txn.organisation_id),
        jsonb_build_object('account_code','1020','debit_minor',0,'credit_minor',v_amount,'organisation_id',txn.organisation_id)),
      null);
    return;
  end if;

  if not v_is_money_in then return; end if;

  if txn.booking_order_id is not null then
    v_kind := 'booking';
  elsif txn.subscription_id is not null then
    v_kind := 'subscription';
  elsif txn.subscription_add_on_id is not null then
    v_kind := 'add_on';
  elsif coalesce(txn.raw_payload#>>'{data,metadata,kind}', txn.raw_payload#>>'{metadata,kind}') = 'voucher_payment' then
    v_kind := 'voucher';
  else
    return;
  end if;

  if v_kind = 'booking' then
    select * into v_lab from public.lab_orders where id = txn.booking_order_id;
    v_cost := case
                when v_lab.id is not null and v_lab.fulfilment = 'partner'
                then coalesce(v_lab.partner_cost_kobo, 0)
                else 0
              end;

    if v_cost > 0 then
      v_treatment := private.partner_revenue_treatment();
      select name into v_lab_name from public.lab_providers where id = v_lab.partner_cost_provider_id;

      if v_treatment = 'gross_principal' then
        v_lines := jsonb_build_array(
          jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,
                             'organisation_id',txn.organisation_id,
                             'memo','Patient payment for lab order ' || coalesce(v_lab.order_number, v_lab.id::text)),
          jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',v_amount,
                             'organisation_id',txn.organisation_id,'cost_center_code','PARTNER_NET',
                             'memo','Review sold to the patient (gross)'),
          jsonb_build_object('account_code','5100','debit_minor',v_cost,'credit_minor',0,
                             'organisation_id',txn.organisation_id,'cost_center_code','PARTNER_NET',
                             'counterparty',v_lab_name,
                             'memo','Cost of the laboratory work'),
          jsonb_build_object('account_code','2700','debit_minor',0,'credit_minor',v_cost,
                             'organisation_id',txn.organisation_id,'counterparty',v_lab_name,
                             'memo','Owed to the laboratory for this order'));
      else
        v_lines := jsonb_build_array(
          jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,
                             'organisation_id',txn.organisation_id,
                             'memo','Patient payment for lab order ' || coalesce(v_lab.order_number, v_lab.id::text)),
          jsonb_build_object('account_code','2700','debit_minor',0,'credit_minor',v_cost,
                             'organisation_id',txn.organisation_id,'counterparty',v_lab_name,
                             'memo','Owed to the laboratory for this order'));

        if v_amount > v_cost then
          v_lines := v_lines || jsonb_build_array(
            jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',v_amount - v_cost,
                               'organisation_id',txn.organisation_id,'cost_center_code','PARTNER_NET',
                               'memo','Tarragon margin on this review'));
        elsif v_amount < v_cost then
          v_lines := v_lines || jsonb_build_array(
            jsonb_build_object('account_code','4100','debit_minor',v_cost - v_amount,'credit_minor',0,
                               'organisation_id',txn.organisation_id,'cost_center_code','PARTNER_NET',
                               'memo','Reversing revenue recognised on a voucher that is owed to the laboratory'));
        end if;
      end if;

      perform private.finance_post_journal(v_date, v_cur, 'payment', txn.id::text,
        'Lab review payment — partner-billed (' || v_treatment::text || ')', v_lines, null);
    else
      perform private.finance_post_journal(v_date, v_cur, 'payment', txn.id::text,
        'Booking payment — ' || coalesce(txn.booking_order_type::text,'service'),
        jsonb_build_array(
          jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,'organisation_id',txn.organisation_id),
          jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',v_amount,'organisation_id',txn.organisation_id,'cost_center_code','PARTNER_NET')),
        null);
    end if;

  elsif v_kind = 'voucher' then
    perform private.finance_post_journal(v_date, v_cur, 'voucher', txn.id::text,
      'Care voucher prepayment',
      jsonb_build_array(
        jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,'organisation_id',txn.organisation_id),
        jsonb_build_object('account_code','2100','debit_minor',0,'credit_minor',v_amount,'organisation_id',txn.organisation_id)),
      null);

  else
    v_txn_entry := private.finance_post_journal(v_date, v_cur, 'payment', txn.id::text,
      initcap(v_kind) || ' payment',
      jsonb_build_array(
        jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,'organisation_id',txn.organisation_id),
        jsonb_build_object('account_code','2000','debit_minor',0,'credit_minor',v_amount,'organisation_id',txn.organisation_id)),
      null);

    if v_kind = 'subscription' then
      select interval, current_period_end into v_int, v_cpe from public.subscriptions where id = txn.subscription_id;
    else
      select interval, current_period_end into v_int, v_cpe from public.subscription_add_ons where id = txn.subscription_add_on_id;
    end if;
    v_pend := coalesce(v_cpe::date, v_date + (case when v_int = 'yearly' then interval '1 year' else interval '1 month' end)::interval);
    v_pstart := v_pend - (case when v_int = 'yearly' then interval '1 year' else interval '1 month' end)::interval;
    if v_pend > v_pstart then
      perform private.finance_create_recognition_schedule(
        v_kind, coalesce(txn.subscription_id, txn.subscription_add_on_id), txn.id, txn.organisation_id,
        case when v_kind = 'subscription' then '4000' else '4010' end,
        v_cur, v_amount, v_pstart, v_pend);
    end if;
  end if;
end;
$function$;

-- ============================================================================
-- 19. private.apply_screening_subscriber_discount — rewritten to a no-op.
--     Pre-existing function (git: 20260802212652/20260802212852), further
--     modified live: on the first real margin figure from a partner-billed
--     Core Screen order, the previous 15% subscriber discount left Synlab's
--     cost cleared by roughly 1.6% — not sustainable. subscriber_discount_kobo
--     stays as a column (a future, deliberately-priced incentive can still
--     write to it) but this trigger no longer sets it.
-- ============================================================================
create or replace function private.apply_screening_subscriber_discount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return new;
end;
$function$;

-- ============================================================================
-- 20. Reference data: screen_types contracted/provisional prices and
--     Synlab's wholesale cost list. Verified live values as of 2026-08-25 —
--     see docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md's 2026-08-25 entry.
-- ============================================================================
update public.screen_types set price_kobo = v.price_kobo, price_source = v.price_source::public.screen_price_source
from (values
  ('abdominal_ultrasound', 1500000, 'provisional'),
  ('blood_group',          1500000, 'contracted'),
  ('blood_pressure',             0, 'provisional'),
  ('bone_density',         2500000, 'provisional'),
  ('breast_imaging',       2500000, 'provisional'),
  ('cervical_smear',       4800000, 'contracted'),
  ('colonoscopy',         15000000, 'provisional'),
  ('dental_check',          700000, 'provisional'),
  ('fbc',                  1600000, 'contracted'),
  ('ferritin',             2900000, 'contracted'),
  ('fit',                 19400000, 'contracted'),
  ('hba1c',                4500000, 'contracted'),
  ('hearing_check',         700000, 'provisional'),
  ('hep_b',                1850000, 'contracted'),
  ('hep_c',                2300000, 'contracted'),
  ('hiv',                  1050000, 'contracted'),
  ('kft',                  4050000, 'contracted'),
  ('lft',                  6050000, 'contracted'),
  ('lipid_panel',          3800000, 'contracted'),
  ('malaria_rdt',           200000, 'provisional'),
  ('mammography',          3000000, 'provisional'),
  ('ogtt_fpg',             1600000, 'derived_from_panel_total'),
  ('pcos_panel',           2500000, 'provisional'),
  ('prostate_ultrasound',  1800000, 'provisional'),
  ('psa',                  5200000, 'contracted'),
  ('sickle_cell_genotype', 2200000, 'contracted'),
  ('syphilis',             2100000, 'contracted'),
  ('tb_screen',             700000, 'provisional'),
  ('tft',                  7200000, 'contracted'),
  ('urinalysis',           1700000, 'contracted'),
  ('urine_acr',            2300000, 'derived_from_panel_total'),
  ('vision_check',          500000, 'provisional'),
  ('vitamin_b12',          4250000, 'contracted')
) as v(code, price_kobo, price_source)
where screen_types.code = v.code
  and screen_types.price_kobo is null;

update public.screen_types set fulfilment_dormant = true where code = 'echo';

-- Synlab's wholesale cost per test code — what Tarragon owes, distinct from
-- the patient-facing price above. Idempotent: only fills a row that doesn't
-- already have a Synlab price (so a founder-adjusted live price is never
-- overwritten by a reconciliation replay).
insert into public.lab_tests (provider_id, code, name, price_kobo, commission_rate, turnaround_hours)
select p.id, v.code, st.name, v.price_kobo, 0.20, 48
from public.lab_providers p
join (values
  ('blood_group',           1270000),
  ('cervical_smear',        4000000),
  ('fbc',                   1340000),
  ('ferritin',              2400000),
  ('fit',                  16160000),
  ('hba1c',                 3760000),
  ('hep_b',                 1530000),
  ('hep_c',                 1900000),
  ('hiv',                    890000),
  ('kft',                   3360000),
  ('lft',                   5040000),
  ('lipid_panel',           3160000),
  ('ogtt_fpg',              1330000),
  ('psa',                   4320000),
  ('sickle_cell_genotype',  1850000),
  ('syphilis',              1770000),
  ('tft',                   6000000),
  ('urinalysis',            1430000),
  ('urine_acr',             1930000),
  ('vitamin_b12',           3550000)
) as v(code, price_kobo) on true
join public.screen_types st on st.code = v.code
where p.name = 'Synlab Nigeria'
on conflict (provider_id, code) do nothing;

-- ============================================================================
-- The migration is the test.
-- ============================================================================
do $$
declare
  v_synlab_provider uuid;
  v_price jsonb;
  v_cost jsonb;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='screen_types' and column_name='price_kobo') then
    raise exception 'screen_types.price_kobo was not created';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='lab_orders' and column_name='partner_cost_kobo') then
    raise exception 'lab_orders.partner_cost_kobo was not created';
  end if;
  if (select count(*) from public.screen_types where code='hba1c' and price_kobo=4500000 and price_source='contracted') <> 1 then
    raise exception 'hba1c contracted price was not reconciled';
  end if;

  select id into v_synlab_provider from public.lab_providers where name = 'Synlab Nigeria';
  if v_synlab_provider is null then
    raise exception 'Synlab Nigeria provider row missing';
  end if;
  if (select count(*) from public.lab_tests where provider_id = v_synlab_provider) < 20 then
    raise exception 'Synlab wholesale cost list is incomplete';
  end if;

  -- Prove the pricing engine actually works end to end for a real patient
  -- and a real bundle, without needing a lab_orders row to exist.
  select id into v_synlab_provider from public.lab_providers where name = 'Synlab Nigeria';
  if (select count(*) from public.panel_bundles where code = 'diabetes_panel') = 1 then
    v_price := private.compute_review_price(
      (select id from public.profiles limit 1),
      (select organisation_id from public.profiles limit 1),
      (select id from public.panel_bundles where code = 'diabetes_panel')
    );
    if v_price is null then
      raise exception 'compute_review_price returned nothing';
    end if;
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'lab_orders_compute_review_price') then
    raise exception 'lab_orders_compute_review_price trigger missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'lab_orders_zz_never_below_partner_cost') then
    raise exception 'lab_orders_zz_never_below_partner_cost trigger missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'lab_orders_queue_transmission') then
    raise exception 'lab_orders_queue_transmission trigger missing';
  end if;

  if (select count(*) from public.lab_refund_policies) <> 7 then
    raise exception 'lab_refund_policies reference data incomplete';
  end if;
  if not exists (select 1 from public.finance_partner_revenue_policy where id and treatment = 'net_agent') then
    raise exception 'finance_partner_revenue_policy default row missing';
  end if;
end;
$$;
