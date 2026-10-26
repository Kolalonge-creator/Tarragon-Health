-- Membership Plus collection states, and the open annual-test-bundle flow (founder decision 2026-10-26, docs/DECISIONS.md).
--
--   1. service_regions.plus_collection_enabled: the admin's "Tarragon can collect blood here" approval, separate from is_active
--      (which gates every partner action in a state). The partner-lab list for the annual bundle is NATIONWIDE and ignores both
--      flags: it only needs an active laboratory branch. Launch states: Lagos, Oyo (Ibadan), Osun, Ogun. Any of the 36 states + FCT
--      can be approved or withdrawn by an admin at any time; every change is audited.
--   2. lab_provider_locations.town: the patient picks state, then town, then sees the partner labs near them. Backfilled for
--      every branch live on 2026-10-26 (the branch NAME is not a town for several, e.g. "Lekki EC", so this is a mapping).
--   3. Read RPCs for the picker (towns in a state, labs in a town) and for the Plus checkout (the approved states).
--      Authenticated only; revoke from PUBLIC, not from anon (CLAUDE.md).
--   4. private.plus_collection_state_enabled(text): the one predicate a Plus order must pass. The order-side enforcement is added with
--      the Plus checkout (PR #1253 lineage); this migration only provides the predicate and the data.
--   5. public.start_annual_bundle(location): any signed-in patient, any plan, starts the once-a-year annual bundle as a SELF-ARRANGED
--      order (patient pays the lab; Tarragon bills nothing). The origin guard is extended by exactly one transaction-local setting,
--      the same pattern the testing-day check-in uses.
--
-- Live counts before (read-only, 2026-10-26): service_regions 37 (only Lagos is_active), lab_provider_locations active 40 across
-- 15 states, all Synlab Nigeria; no lab_orders with panel_code membership_annual that were patient-started.

-- 1. Plus collection approval per state
alter table public.service_regions
  add column plus_collection_enabled boolean not null default false,
  add column plus_collection_enabled_at timestamptz;

update public.service_regions
   set plus_collection_enabled = true, plus_collection_enabled_at = now()
 where state in ('Lagos', 'Oyo', 'Osun', 'Ogun');

create function private.service_regions_plus_audit() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.plus_collection_enabled is distinct from old.plus_collection_enabled then
    new.plus_collection_enabled_at := case when new.plus_collection_enabled then now() else null end;
    perform private.log_audit(
      case when new.plus_collection_enabled then 'service_region.plus_collection_enabled' else 'service_region.plus_collection_withdrawn' end,
      'service_regions', new.id, jsonb_build_object('state', new.state));
  end if;
  return new;
end $$;
revoke all on function private.service_regions_plus_audit() from public, anon, authenticated;
create trigger service_regions_plus_audit before update on public.service_regions
  for each row execute function private.service_regions_plus_audit();

create function private.plus_collection_state_enabled(p_state text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select r.plus_collection_enabled from public.service_regions r where r.state = p_state), false)
$$;
revoke all on function private.plus_collection_state_enabled(text) from public, anon, authenticated;

create function public.plus_collection_states() returns table (state text, display_name text)
language sql stable security definer set search_path = ''
as $$
  select r.state, r.display_name from public.service_regions r where r.plus_collection_enabled order by r.display_name
$$;
revoke all on function public.plus_collection_states() from public, anon;
grant execute on function public.plus_collection_states() to authenticated;

-- 2. Town on every lab branch
alter table public.lab_provider_locations add column town text;

update public.lab_provider_locations l set town = m.town
  from (values
    ('Abuja', 'Asokoro', 'Asokoro'), ('Abuja', 'Gwagwalada', 'Gwagwalada'), ('Abuja', 'Gwarinpa', 'Gwarinpa'),
    ('Abuja', 'Kubwa Lab', 'Kubwa'), ('Abuja', 'Wuse II', 'Wuse II'),
    ('Benue', 'Benue State University Teaching Hospital', 'Makurdi'),
    ('Delta', 'DELSUTH', 'Oghara'), ('Delta', 'Warri', 'Warri'),
    ('Ebonyi', 'Ebonyi', 'Uburu'), ('Anambra', 'Onitsha', 'Onitsha'), ('Edo', 'Benin', 'Benin City'),
    ('Enugu', 'Enugu', 'Enugu'), ('Imo', 'Owerri', 'Owerri'), ('Kaduna', 'Kaduna', 'Kaduna'), ('Kwara', 'Ilorin', 'Ilorin'),
    ('Lagos', 'Ago Palace Way Lab', 'Okota'), ('Lagos', 'Agungi, Lekki', 'Lekki'), ('Lagos', 'Ajah', 'Ajah'),
    ('Lagos', 'Festac', 'Festac'), ('Lagos', 'Ikeja BCP - I', 'Ikeja'), ('Lagos', 'Ikeja Lab', 'Ikeja'),
    ('Lagos', 'Ikoyi BCP', 'Ikoyi'), ('Lagos', 'Ilupeju BCP', 'Ilupeju'), ('Lagos', 'Lekki EC', 'Lekki'),
    ('Lagos', 'Lekki Lab', 'Lekki'), ('Lagos', 'LUTH', 'Surulere'), ('Lagos', 'NSIA-LUTH Cancer Centre (NLCC)', 'Surulere'),
    ('Lagos', 'Ogba BCP', 'Ogba'), ('Lagos', 'Ogudu Lab', 'Ogudu'), ('Lagos', 'Sangotedo', 'Sangotedo'),
    ('Lagos', 'Surulere', 'Surulere'), ('Lagos', 'Victoria Island', 'Victoria Island'),
    ('Ogun', 'Abeokuta', 'Abeokuta'), ('Ogun', 'Sagamu', 'Sagamu'), ('Osun', 'Ife', 'Ile-Ife'), ('Oyo', 'Ibadan Lab', 'Ibadan'),
    ('Rivers', 'Port Harcourt (Enaan Towers / UPTH Choba)', 'Port Harcourt'), ('Rivers', 'Port Harcourt Lab', 'Port Harcourt'),
    ('Rivers', 'Port Harcourt (GRA) BCP', 'Port Harcourt')
  ) as m(state, name, town)
 where l.state = m.state and l.name = m.name;

-- 3. The picker: towns in a state, then the labs in a town. Nationwide: needs only an active laboratory and branch.
create function public.list_annual_bundle_towns(p_state text) returns table (town text, lab_count integer)
language sql stable security definer set search_path = ''
as $$
  select l.town, count(*)::integer
    from public.lab_provider_locations l join public.lab_providers p on p.id = l.lab_provider_id
   where l.is_active and p.is_active and l.state = p_state and l.town is not null
   group by l.town order by l.town
$$;
revoke all on function public.list_annual_bundle_towns(text) from public, anon;
grant execute on function public.list_annual_bundle_towns(text) to authenticated;

create function public.list_annual_bundle_labs(p_state text, p_town text default null)
returns table (location_id uuid, provider_name text, location_name text, town text, state text, address text,
               contact_phone text, opening_hours jsonb)
language sql stable security definer set search_path = ''
as $$
  select l.id, p.name, l.name, l.town, l.state, l.address, l.contact_phone, l.opening_hours
    from public.lab_provider_locations l join public.lab_providers p on p.id = l.lab_provider_id
   where l.is_active and p.is_active and l.state = p_state and (p_town is null or l.town = p_town)
   order by l.town, p.name, l.name
$$;
revoke all on function public.list_annual_bundle_labs(text, text) from public, anon;
grant execute on function public.list_annual_bundle_labs(text, text) to authenticated;

-- 5a. The origin guard: its live text is read and ONE alternative added to the annual-panel clause (nothing else can drift)
do $$
declare
  v_def text;
  v_old constant text := E'    if new.panel_code = ''membership_annual'' and coalesce(current_setting(''tarragon.testing_day_checkin'', true), '''') = ''on'' then';
  v_new constant text := E'    if new.panel_code = ''membership_annual'' and (coalesce(current_setting(''tarragon.testing_day_checkin'', true), '''') = ''on'' or coalesce(current_setting(''tarragon.annual_bundle_start'', true), '''') = ''on'') then';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'enforce_lab_order_origin';
  if v_def is null then raise exception 'annual bundle: private.enforce_lab_order_origin not found'; end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'annual bundle: expected exactly one annual-panel clause in private.enforce_lab_order_origin';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- 5b. Start the annual bundle (self-arranged; the patient pays the lab directly)
create function public.start_annual_bundle(p_location_id uuid default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid; v_role text; v_order uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select organisation_id, role::text into v_org, v_role from public.profiles where id = v_uid;
  if v_org is null or v_role <> 'patient' then raise exception 'only a patient can start the annual bundle' using errcode = '42501'; end if;
  if p_location_id is not null and not exists (
       select 1 from public.lab_provider_locations l join public.lab_providers p on p.id = l.lab_provider_id
        where l.id = p_location_id and l.is_active and p.is_active) then
    raise exception 'location is not an active lab branch' using errcode = '23514';
  end if;
  -- once a year: a live earlier order blocks a second (a cancelled order or a rejected sample does not), same window as testing days
  if exists (select 1 from public.lab_orders o where o.patient_id = v_uid and o.panel_code = 'membership_annual'
               and o.status not in ('cancelled', 'sample_rejected') and o.ordered_at > now() - interval '330 days') then
    raise exception 'annual_bundle_already_started' using errcode = '22023';
  end if;
  perform set_config('tarragon.annual_bundle_start', 'on', true);
  insert into public.lab_orders (organisation_id, patient_id, status, panel_code, fulfilment, origin, total_kobo, location_id)
  values (v_org, v_uid, 'ordered', 'membership_annual', 'self_arranged', 'patient_initiated', 0, p_location_id)
  returning id into v_order;
  perform set_config('tarragon.annual_bundle_start', 'off', true);
  perform private.log_audit('annual_bundle.started', 'lab_orders', v_order, jsonb_build_object('location_id', p_location_id));
  return v_order;
end $$;
revoke all on function public.start_annual_bundle(uuid) from public, anon;
grant execute on function public.start_annual_bundle(uuid) to authenticated;

do $$
begin
  if (select count(*) from public.service_regions where plus_collection_enabled) <> 4 then raise exception 'self-check: expected exactly the four launch states'; end if;
  if exists (select 1 from public.service_regions where plus_collection_enabled and state not in ('Lagos','Oyo','Osun','Ogun')) then raise exception 'self-check: unexpected Plus state'; end if;
  if exists (select 1 from public.lab_provider_locations where is_active and town is null) then raise exception 'self-check: an active lab branch has no town'; end if;
  if has_function_privilege('anon', 'public.start_annual_bundle(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.list_annual_bundle_labs(text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.plus_collection_states()', 'EXECUTE') then raise exception 'self-check: anon can execute a bundle function'; end if;
  if has_function_privilege('authenticated', 'private.plus_collection_state_enabled(text)', 'EXECUTE') then raise exception 'self-check: private predicate is callable'; end if;
end $$;
