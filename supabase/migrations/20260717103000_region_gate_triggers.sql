-- Tarragon Health — region gate on patient-initiated lab/pharmacy orders (backstop)
--
-- The patient UI (RegionGate) is the primary gate, but per this codebase's structural-gate
-- discipline (enforce_lab_order_origin, enforce_active_logistics_partners) a crafted client
-- must not be able to POST a self-service order into a state that isn't live. These BEFORE
-- INSERT triggers reject a patient_initiated order when the delivery state is known and its
-- service isn't available there (public.region_service_available).
--
-- Scope — deliberately narrow, three ways:
--   1. Only `origin = 'patient_initiated'` inserts are gated. Staff/clinician-originated
--      orders (origin <> 'patient_initiated', ordered_by set) are NOT gated: a clinician may
--      legitimately order across the network, and — critically — the abnormal-result
--      Cat 2→1 escalation pipeline never creates a patient_initiated order, so this gate can
--      never block or silently swallow an abnormal screening result.
--   2. Only where the state is resolvable. Unknown state (no facility + no profile state) is
--      left to the UI gate rather than failing closed and breaking a legitimate order.
--   3. Composable — separate triggers from enforce_*_origin, both must pass (origin runs
--      first alphabetically, then region).
--
-- Raises 23514 with patient-friendly text; the order UI already surfaces trigger messages.

-- Lab: resolve the delivery state as the chosen facility's state (facilities.state is NOT
-- NULL) when a facility was picked, else the patient's own profile state.
create or replace function private.enforce_lab_order_region()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
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
$$;

drop trigger if exists lab_orders_enforce_region on public.lab_orders;
create trigger lab_orders_enforce_region
  before insert on public.lab_orders
  for each row execute function private.enforce_lab_order_region();

-- Pharmacy: the care-recipient's own profile state governs (a family member is their own
-- profiles row). Delivery vs pickup both need a pharmacy partner in-state, so gate on
-- 'pharmacy' here; the separate delivery/logistics availability is surfaced in the UI.
create or replace function private.enforce_pharmacy_order_region()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if new.origin = 'patient_initiated' then
    select state into v_state from public.profiles where id = new.patient_id;

    if v_state is not null and not public.region_service_available(v_state, 'pharmacy') then
      raise exception 'Pharmacy ordering is not yet available in % — TarragonHealth is coming soon there.', v_state
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pharmacy_orders_enforce_region on public.pharmacy_orders;
create trigger pharmacy_orders_enforce_region
  before insert on public.pharmacy_orders
  for each row execute function private.enforce_pharmacy_order_region();
