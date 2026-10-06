-- S19b: on-call readiness. A clinician confirms the on-call phone checklist (the guidance on /clinician/on-call: notifications on,
-- battery saving off, data and power, a working email, a cover plan) before they can be put on the rota or take a swap.
--
-- Why: S19 pages the on-call clinician by push, in-console alarm and email, and phones stop apps in the background. A shift given to
-- someone whose phone has never been set up is a quiet gap. The confirmation is the clinician's own statement, dated and audited; it
-- cannot prove the phone is configured, and the page says so. Reviewers see who has and has not confirmed.
--
-- The checklist version is a constant (1). A change to the wording of the list bumps it and everyone confirms again; that is a
-- content version, not a policy number, so it is not in versioned config. Invariants: INV-05 (a page needs a reachable person),
-- INV-07 (no clinical content in any notice here).

create table public.on_call_readiness (
  clinician_id      uuid not null references public.profiles (id) on delete cascade,
  checklist_version integer not null,
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  items             text[] not null,
  confirmed_at      timestamptz not null default now(),
  is_test           boolean not null default false,
  primary key (clinician_id, checklist_version)
);
alter table public.on_call_readiness enable row level security;
create policy on_call_readiness_read on public.on_call_readiness for select to authenticated
  using (clinician_id = (select auth.uid()) or private.can_credential_review());
revoke all on public.on_call_readiness from public, anon, authenticated;
grant select on public.on_call_readiness to authenticated;

create function private.readiness_version() returns integer language sql immutable set search_path = '' as $$ select 1 $$;
create function private.readiness_items() returns text[] language sql immutable set search_path = ''
as $$ select array['notifications_on', 'battery_saving_off', 'data_and_power', 'email_opens', 'cover_plan'] $$;
revoke all on function private.readiness_version() from public, anon, authenticated;
revoke all on function private.readiness_items() from public, anon, authenticated;

create function private.on_call_ready(p_profile uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.on_call_readiness r where r.clinician_id = p_profile and r.checklist_version = private.readiness_version()) $$;
revoke all on function private.on_call_ready(uuid) from public, anon, authenticated;

-- The rota refuses anyone who has not confirmed (builder, swaps and urgent cover all go through this).
create or replace function private.rota_validate_clinician(p_profile uuid, p_org uuid, p_start timestamptz, p_end timestamptz)
returns void language plpgsql stable security definer set search_path = ''
as $$
declare cs public.clinical_staff%rowtype;
begin
  select * into cs from public.clinical_staff where profile_id = p_profile and organisation_id = p_org;
  if not found then raise exception 'unknown clinician for this organisation' using errcode = '22023'; end if;
  if not private.has_competency(p_profile, 'on_call') then raise exception '% does not have the on-call competency', cs.full_name using errcode = '22023'; end if;
  if not private.on_call_ready(p_profile) then raise exception '% has not confirmed the on-call phone checklist', cs.full_name using errcode = '22023'; end if;
  if not private.clinician_eligible_through(p_profile, greatest(p_start, now()), p_end) then
    raise exception '% is not eligible for the whole shift (licence, indemnity or status)', cs.full_name using errcode = '22023';
  end if;
  if private.clinician_on_leave_during(p_profile, p_start, p_end) then raise exception '% is on leave for part of this shift', cs.full_name using errcode = '22023'; end if;
  if cs.employment_type = 'contracted' and not exists (select 1 from public.availability_blocks b
        where b.clinician_id = p_profile and b.state = 'confirmed' and b.kind = 'on_call' and b.starts_at <= p_start and b.ends_at >= p_end) then
    raise exception '% has no confirmed on-call hours covering this shift', cs.full_name using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.rota_validate_clinician(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

create function public.confirm_on_call_readiness(p_items text[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare cs public.clinical_staff%rowtype;
begin
  select * into cs from public.clinical_staff where profile_id = (select auth.uid()) and active and status = 'active';
  if not found then raise exception 'not authorised' using errcode = '42501'; end if;
  if (select array_agg(i order by i) from unnest(coalesce(p_items, '{}'::text[])) i) is distinct from (select array_agg(i order by i) from unnest(private.readiness_items()) i) then
    raise exception 'every item on the checklist must be confirmed' using errcode = '22023';
  end if;
  insert into public.on_call_readiness (clinician_id, checklist_version, organisation_id, items, is_test)
    values (cs.profile_id, private.readiness_version(), cs.organisation_id, private.readiness_items(), cs.is_test)
  on conflict (clinician_id, checklist_version) do update set confirmed_at = now(), items = excluded.items;
  perform private.credential_audit(cs.organisation_id, cs.profile_id, 'rota.readiness_confirmed', 'clinical_staff', cs.id, jsonb_build_object('checklist_version', private.readiness_version()));
end;
$$;

create function public.my_on_call_readiness() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'version', private.readiness_version(),
    'items', to_jsonb(private.readiness_items()),
    'confirmed_at', (select r.confirmed_at from public.on_call_readiness r where r.clinician_id = (select auth.uid()) and r.checklist_version = private.readiness_version()),
    'on_call_clinician', private.has_competency((select auth.uid()), 'on_call'))
$$;

-- Reviewers: every active clinician with the on-call competency in their organisation, and whether they have confirmed.
create function public.on_call_readiness_overview() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid;
begin
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = (select auth.uid());
  return coalesce((
    select jsonb_agg(jsonb_build_object('clinician_id', cs.profile_id, 'name', cs.full_name, 'ready', r.clinician_id is not null, 'confirmed_at', r.confirmed_at) order by (r.clinician_id is not null), cs.full_name)
    from public.clinical_staff cs
    left join public.on_call_readiness r on r.clinician_id = cs.profile_id and r.checklist_version = private.readiness_version()
    where cs.organisation_id = v_org and cs.active and cs.status = 'active' and cs.profile_id is not null and private.has_competency(cs.profile_id, 'on_call')), '[]'::jsonb);
end;
$$;

revoke all on function public.confirm_on_call_readiness(text[]) from public, anon;
revoke all on function public.my_on_call_readiness() from public, anon;
revoke all on function public.on_call_readiness_overview() from public, anon;
grant execute on function public.confirm_on_call_readiness(text[]) to authenticated;
grant execute on function public.my_on_call_readiness() to authenticated;
grant execute on function public.on_call_readiness_overview() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.confirm_on_call_readiness(text[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_on_call_readiness()', 'EXECUTE')
     or has_function_privilege('anon', 'public.on_call_readiness_overview()', 'EXECUTE')
     or has_table_privilege('anon', 'public.on_call_readiness', 'SELECT')
     or has_table_privilege('authenticated', 'public.on_call_readiness', 'INSERT') then
    raise exception 's19b: readiness grants are wrong';
  end if;
end $$;
