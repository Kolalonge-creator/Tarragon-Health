-- Fulfilment deferral, step 2 of 2: the column, the guards, and switching the
-- partner catalogues dormant.
--
-- WHY: Tarragon has no contracted lab or pharmacy partner. Counted live before
-- writing this: lab_orders 0, pharmacy_orders 0, commissions 0,
-- lab_result_documents 0, pharmacy_medications 0, care_vouchers 0. Every
-- partner row is a placeholder with an .example contact address. So no revenue
-- line is being given up here; one that was never live is being deferred, and
-- replaced by a path that works today with no contract in any state.
--
-- This is NOT one of the four founder-removal migrations (capitation, family
-- plans, etc.) which deleted enum values because those were business-model
-- reversals. This is sequencing, so everything stays reversible: no table, enum
-- value, policy, partner row, commission trigger or role is dropped. The
-- partner catalogues go is_active = false, the same dormant-until-real pattern
-- already used for home_visit_providers / logistics_partners / wellness class
-- providers. Contracting a real lab is then a single UPDATE, not a migration.

alter table public.lab_orders
  add column if not exists fulfilment public.lab_order_fulfilment
    not null default 'self_arranged';

comment on column public.lab_orders.fulfilment is
  'partner = Tarragon routes and bills it (dormant until a lab is contracted). self_arranged = patient uses any lab and uploads the result; carries no provider, no facility and no charge.';

create index if not exists lab_orders_awaiting_result_idx
  on public.lab_orders (fulfilment, status, ordered_at)
  where fulfilment = 'self_arranged' and status = 'ordered';

-- ---------------------------------------------------------------------------
-- Origin guard: fulfilment rules added, every pre-existing branch preserved
-- byte-for-byte from the live definition (pulled via pg_get_functiondef first).
-- ---------------------------------------------------------------------------
create or replace function private.enforce_lab_order_origin()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_schedule public.screening_schedules%rowtype;
  v_screen_type_code text;
begin
  -- Fulfilment guard, deliberately ORTHOGONAL to origin and evaluated before
  -- the origin branching below (which early-returns for self-bookable bundles).
  -- Both a patient self-serving a Screen and a clinician ordering a test are
  -- legitimately self_arranged: what makes it self-arranged is that the patient
  -- takes it to a lab of their own choosing, not who decided it was needed.
  if new.fulfilment = 'self_arranged' then
    if new.provider_id is not null or new.facility_id is not null then
      raise exception 'A self-arranged lab order cannot name a partner provider or facility — the patient chooses their own lab'
        using errcode = '23514';
    end if;
    if coalesce(new.total_kobo, 0) <> 0 then
      raise exception 'A self-arranged lab order is not billed by Tarragon — the patient pays the lab directly (total_kobo must be 0)'
        using errcode = '23514';
    end if;
    if new.status = 'pending_payment' then
      raise exception 'A self-arranged lab order is never pending_payment — there is nothing for Tarragon to collect'
        using errcode = '23514';
    end if;
  end if;

  if new.origin = 'patient_initiated' then
    if new.ordered_by is not null then
      raise exception 'patient_initiated lab_orders cannot set ordered_by' using errcode = '23514';
    end if;

    -- Prevention front-door exception: an explicitly self-bookable bundle
    -- needs no schedule and must not carry one — the due-screening path below
    -- stays the only schedule-linked route.
    if exists (
      select 1 from public.panel_bundles pb
      where pb.id = new.panel_bundle_id
        and pb.self_bookable
    ) then
      if new.screening_schedule_id is not null then
        raise exception 'Self-bookable bundles are ordered without a screening_schedule link' using errcode = '23514';
      end if;
      return new;
    end if;

    if new.screening_schedule_id is null then
      raise exception 'Self-service lab orders must be linked to a due screening_schedule — ad hoc tests require a clinician order'
        using errcode = '23514';
    end if;

    select * into v_schedule
    from public.screening_schedules
    where id = new.screening_schedule_id;

    if v_schedule.id is null or v_schedule.patient_id is distinct from new.patient_id then
      raise exception 'screening_schedule_id does not belong to this patient' using errcode = '23514';
    end if;

    if v_schedule.status not in ('pending', 'overdue') or v_schedule.due_date > current_date then
      raise exception 'This screening is not currently due for self-service booking' using errcode = '23514';
    end if;

    select code into v_screen_type_code
    from public.screen_types
    where id = v_schedule.screen_type_id;

    if not exists (
      select 1 from public.panel_bundles pb
      where pb.id = new.panel_bundle_id
        and pb.test_codes = array[v_screen_type_code]
    ) then
      raise exception 'panel_bundle_id must be the single-test bundle matching the due screening' using errcode = '23514';
    end if;
  else
    if new.ordered_by is null then
      raise exception 'Non-self-service lab_orders must set ordered_by to the clinician who generated the order'
        using errcode = '23514';
    end if;

    if not exists (
      select 1 from public.clinical_staff cs
      where cs.id = new.ordered_by
        and cs.organisation_id = new.organisation_id
        and cs.active
    ) then
      raise exception 'ordered_by must reference an active clinical_staff member of the same organisation' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Region guard: self-arranged orders are exempt.
--
-- This is the change that makes the platform national. region_service_available
-- returns true only when the state's master switch is on AND an active partner
-- covers that service, so with the catalogues dormant this trigger would reject
-- every patient-initiated order everywhere. But a self-arranged order needs no
-- partner by definition, so gating it on partner coverage is meaningless. The
-- gate stays fully intact for partner-fulfilled orders, ready for the day a lab
-- is contracted.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_lab_order_region()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_state text;
begin
  if new.fulfilment = 'self_arranged' then
    return new;
  end if;

  if new.origin = 'patient_initiated' then
    if new.facility_id is not null then
      select state into v_state from public.facilities where id = new.facility_id;
    end if;
    if v_state is null then
      select state into v_state from public.profiles where id = new.patient_id;
    end if;

    if v_state is not null and not public.region_service_available(v_state, 'lab') then
      raise exception 'Lab booking is not yet available in % — TarragonHealth is coming soon there.', v_state
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Partner catalogues dormant. Rows kept (name, regions, contact, licence
-- fields) so contracting a real partner is an is_active flip, not a re-seed.
-- Specialist referrals are deliberately untouched: out of scope for this pass.
-- ---------------------------------------------------------------------------
update public.lab_providers set is_active = false where is_active;
update public.pharmacy_partners set is_active = false where is_active;

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_origin_def text;
  v_region_def text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_orders' and column_name = 'fulfilment'
  ) then
    raise exception 'lab_orders.fulfilment was not created';
  end if;

  select pg_get_functiondef(oid) into v_origin_def
  from pg_proc where proname = 'enforce_lab_order_origin' and pronamespace = 'private'::regnamespace;
  if v_origin_def not like '%self-arranged lab order cannot name a partner%' then
    raise exception 'enforce_lab_order_origin is missing the fulfilment guard';
  end if;
  -- The pre-existing branches must survive the rewrite.
  if v_origin_def not like '%ad hoc tests require a clinician order%'
     or v_origin_def not like '%must reference an active clinical_staff member%' then
    raise exception 'enforce_lab_order_origin lost a pre-existing branch';
  end if;

  select pg_get_functiondef(oid) into v_region_def
  from pg_proc where proname = 'enforce_lab_order_region' and pronamespace = 'private'::regnamespace;
  if v_region_def not like '%self_arranged%' then
    raise exception 'enforce_lab_order_region is missing the self-arranged exemption';
  end if;
  if v_region_def not like '%region_service_available%' then
    raise exception 'enforce_lab_order_region lost the partner region gate';
  end if;

  if exists (select 1 from public.lab_providers where is_active) then
    raise exception 'a lab provider is still active';
  end if;
  if exists (select 1 from public.pharmacy_partners where is_active) then
    raise exception 'a pharmacy partner is still active';
  end if;

  -- Reversibility: nothing was deleted.
  if (select count(*) from public.lab_providers) <> 4
     or (select count(*) from public.pharmacy_partners) <> 4 then
    raise exception 'partner rows were deleted rather than deactivated';
  end if;
end;
$$;
