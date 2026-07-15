-- Tarragon Health — clinician-originated orders guardrail.
--
-- Business decision: a patient must never be able to self-purchase an ad
-- hoc lab test or a brand-new medication straight out of the catalogue —
-- every lab_order/pharmacy_order has to trace back to either (a) the
-- platform's own screening engine (a genuinely due screening_schedule) or
-- (b) a clinician who already prescribed the medication (medications.source
-- = 'clinician'), or else (c) an explicit clinician-generated order. This
-- mirrors specialist_referrals, which has always been staff/trigger-created
-- only — patients have never had a "request a specialist" button.
--
-- Enforcement is a DB trigger, not just RLS/UX, per this codebase's existing
-- pattern for structural gates (clinical_staff_active_requires_verification,
-- enforce_clinical_staff_indemnity) — a CHECK constraint can't do the cross-
-- table lookups this needs, so a BEFORE INSERT trigger plays that role
-- instead. Only INSERT is gated: staff-only UPDATE (existing RLS) already
-- covers the lifecycle after creation.

alter table public.lab_orders
  add column ordered_by uuid references public.clinical_staff (id) on delete set null;

alter table public.pharmacy_orders
  add column ordered_by uuid references public.clinical_staff (id) on delete set null;

create index lab_orders_ordered_by_idx on public.lab_orders (ordered_by) where ordered_by is not null;
create index pharmacy_orders_ordered_by_idx on public.pharmacy_orders (ordered_by) where ordered_by is not null;

-- ---------------------------------------------------------------------------
-- lab_orders: patient self-service is limited to a bundle that is the
-- single-test bundle (test_codes = array[code]) for a screen_type the
-- patient has a currently-due screening_schedule for. Anything else needs
-- ordered_by set to the clinician who generated it.
-- ---------------------------------------------------------------------------

create or replace function private.enforce_lab_order_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.screening_schedules%rowtype;
  v_screen_type_code text;
begin
  if new.origin = 'patient_initiated' then
    if new.ordered_by is not null then
      raise exception 'patient_initiated lab_orders cannot set ordered_by' using errcode = '23514';
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
$$;

create trigger lab_orders_enforce_origin
  before insert on public.lab_orders
  for each row execute function private.enforce_lab_order_origin();

-- Prevents re-booking the same due screening twice via the self-service
-- path once an order for it exists.
create or replace function private.mark_screening_schedule_booked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.screening_schedule_id is not null then
    update public.screening_schedules
    set status = 'booked'
    where id = new.screening_schedule_id
      and status in ('pending', 'overdue');
  end if;
  return new;
end;
$$;

create trigger lab_orders_mark_schedule_booked
  after insert on public.lab_orders
  for each row execute function private.mark_screening_schedule_booked();

-- ---------------------------------------------------------------------------
-- pharmacy_orders: patient self-service is limited to items that match
-- (drug-name prefix, case-insensitive — pharmacy catalogue names bake the
-- dose into drug_name, e.g. "Amlodipine 5mg", while medications.drug_name
-- and .dose are separate columns) an active medications row this patient
-- already has with source = 'clinician'. A patient's own self-reported
-- medications (source = 'patient') don't count — that would let a patient
-- self-add a fake medications row and immediately "refill" it, defeating
-- the gate. New/never-prescribed items need ordered_by set instead.
-- ---------------------------------------------------------------------------

create or replace function private.enforce_pharmacy_order_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_drug_name text;
begin
  if new.origin = 'patient_initiated' then
    if new.ordered_by is not null then
      raise exception 'patient_initiated pharmacy_orders cannot set ordered_by' using errcode = '23514';
    end if;

    if jsonb_array_length(new.items) = 0 then
      raise exception 'pharmacy_orders must have at least one item' using errcode = '23514';
    end if;

    for v_item in select * from jsonb_array_elements(new.items)
    loop
      v_drug_name := v_item ->> 'drug_name';

      if not exists (
        select 1 from public.medications m
        where m.patient_id = new.patient_id
          and m.is_active
          and m.source = 'clinician'
          and v_drug_name ilike (m.drug_name || '%')
      ) then
        raise exception 'Self-service pharmacy orders are limited to medications a clinician already prescribed (item: %)', v_drug_name
          using errcode = '23514';
      end if;
    end loop;
  else
    if new.ordered_by is null then
      raise exception 'Non-self-service pharmacy_orders must set ordered_by to the clinician who generated the order'
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
$$;

create trigger pharmacy_orders_enforce_origin
  before insert on public.pharmacy_orders
  for each row execute function private.enforce_pharmacy_order_origin();

-- ---------------------------------------------------------------------------
-- RLS: tighten INSERT so a patient can only ever land in the trigger's
-- patient_initiated branch (never spoof ordered_by or origin) — staff keep
-- the same unrestricted insert they already had.
-- ---------------------------------------------------------------------------

drop policy lab_orders_insert on public.lab_orders;
create policy lab_orders_insert on public.lab_orders
  for insert to authenticated
  with check (
    private.is_org_staff(organisation_id)
    or (patient_id = (select auth.uid()) and origin = 'patient_initiated' and ordered_by is null)
  );

drop policy pharmacy_orders_insert on public.pharmacy_orders;
create policy pharmacy_orders_insert on public.pharmacy_orders
  for insert to authenticated
  with check (
    private.is_org_staff(organisation_id)
    or (patient_id = (select auth.uid()) and origin = 'patient_initiated' and ordered_by is null)
  );
