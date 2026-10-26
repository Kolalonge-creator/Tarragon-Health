-- Review fixes for the annual bundle and Plus states (code review of feat/plus-states-and-annual-bundle, 2026-10-26).
-- Applies after 20261026130810_plus_collection_states_and_annual_bundle_flow.sql.
--
--   1. start_annual_bundle can act for someone else. It now takes the patient (default: the caller). Another person's bundle needs the same
--      permission the lab-branch picker already asks for (can_act_for ... 'book_appointments'); the order always belongs to the patient,
--      never the actor. Before, a caregiver acting for a dependant created a bundle on their OWN account. The one-argument function is
--      dropped (not overloaded), so a bare call can never be ambiguous.
--   2. Concurrent starts. A per-patient transaction lock makes the once-a-year check hold when two calls arrive together.
--   3. A Plus approval is audited and timestamped whether it arrives by UPDATE or by INSERT.
--   4. An ACTIVE lab branch needs a town (a CHECK), so a branch added later cannot silently drop out of the town picker. All 39 active
--      branches already carry one (checked before this constraint was added). Both branch forms now ask for it.
--   5. private.plus_collection_state_enabled is documented as not yet enforced: the Plus checkout (tier ladder, PR 1253) will call it.
-- Live counts before: annual bundle orders 0; active branches without a town 0.
-- ROLLBACK: recreate start_annual_bundle(uuid) from 20261026130810, drop the CHECK, restore the UPDATE-only trigger.

-- 1 and 2
drop function public.start_annual_bundle(uuid);
create function public.start_annual_bundle(p_location_id uuid default null, p_patient uuid default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid := coalesce(p_patient, (select auth.uid()));
  v_org uuid; v_role text; v_order uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if v_patient is distinct from v_uid
     and not private.can_act_for(v_patient, 'book_appointments'::public.caregiver_permission) then
    raise exception 'not allowed to act for this patient' using errcode = '42501';
  end if;
  select organisation_id, role::text into v_org, v_role from public.profiles where id = v_patient;
  if v_org is null or v_role <> 'patient' then raise exception 'only a patient can have the annual bundle' using errcode = '42501'; end if;
  if p_location_id is not null and not exists (
       select 1 from public.lab_provider_locations l join public.lab_providers p on p.id = l.lab_provider_id
        where l.id = p_location_id and l.is_active and p.is_active) then
    raise exception 'location is not an active lab branch' using errcode = '23514';
  end if;
  -- one start at a time per patient, so two overlapping calls cannot both pass the check below
  perform pg_advisory_xact_lock(hashtextextended('annual_bundle:' || v_patient::text, 0));
  if exists (select 1 from public.lab_orders o where o.patient_id = v_patient and o.panel_code = 'membership_annual'
               and o.status not in ('cancelled', 'sample_rejected') and o.ordered_at > now() - interval '330 days') then
    raise exception 'annual_bundle_already_started' using errcode = '22023';
  end if;
  perform set_config('tarragon.annual_bundle_start', 'on', true);
  insert into public.lab_orders (organisation_id, patient_id, status, panel_code, fulfilment, origin, total_kobo, location_id)
  values (v_org, v_patient, 'ordered', 'membership_annual', 'self_arranged', 'patient_initiated', 0, p_location_id)
  returning id into v_order;
  perform set_config('tarragon.annual_bundle_start', 'off', true);
  perform private.log_audit('annual_bundle.started', 'lab_orders', v_order,
    jsonb_build_object('location_id', p_location_id, 'by', v_uid, 'for', v_patient));
  return v_order;
end $$;
revoke all on function public.start_annual_bundle(uuid, uuid) from public, anon;
grant execute on function public.start_annual_bundle(uuid, uuid) to authenticated;

-- 3
create or replace function private.service_regions_plus_audit() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.plus_collection_enabled then
      new.plus_collection_enabled_at := coalesce(new.plus_collection_enabled_at, now());
      perform private.log_audit('service_region.plus_collection_enabled', 'service_regions', new.id, jsonb_build_object('state', new.state));
    else
      new.plus_collection_enabled_at := null;
    end if;
    return new;
  end if;
  if new.plus_collection_enabled is distinct from old.plus_collection_enabled then
    new.plus_collection_enabled_at := case when new.plus_collection_enabled then now() else null end;
    perform private.log_audit(
      case when new.plus_collection_enabled then 'service_region.plus_collection_enabled' else 'service_region.plus_collection_withdrawn' end,
      'service_regions', new.id, jsonb_build_object('state', new.state));
  end if;
  return new;
end $$;
drop trigger service_regions_plus_audit on public.service_regions;
create trigger service_regions_plus_audit before insert or update on public.service_regions
  for each row execute function private.service_regions_plus_audit();

-- 4
alter table public.lab_provider_locations add constraint lab_provider_locations_active_needs_town
  check (not is_active or (town is not null and btrim(town) <> ''));

-- 5
comment on function private.plus_collection_state_enabled(text) is
  'NOT ENFORCED YET. The Plus checkout (tier ladder) must call this before a Plus order is created; until that lands the admin Plus toggle only changes data. See docs/DECISIONS.md 2026-10-26.';

do $$
begin
  if to_regprocedure('public.start_annual_bundle(uuid)') is not null then raise exception 'review fixes: the old one-argument function still exists'; end if;
  if has_function_privilege('anon', 'public.start_annual_bundle(uuid,uuid)', 'EXECUTE') then raise exception 'review fixes: anon can start a bundle'; end if;
  if not has_function_privilege('authenticated', 'public.start_annual_bundle(uuid,uuid)', 'EXECUTE') then raise exception 'review fixes: signed-in users cannot start a bundle'; end if;
  if exists (select 1 from public.lab_provider_locations where is_active and (town is null or btrim(town) = '')) then raise exception 'review fixes: an active branch has no town'; end if;
end $$;
