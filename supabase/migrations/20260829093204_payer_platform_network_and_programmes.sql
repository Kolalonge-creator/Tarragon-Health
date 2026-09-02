-- Tarragon Health — module 27, part 3: payer provider network (27.12) and
-- payer-directed chronic-disease programmes (27.9-27.11).
--
-- Network membership is polymorphic across the four existing provider
-- directories (facilities, lab_providers, pharmacy_partners,
-- specialist_providers) rather than four parallel payer_network_* tables —
-- same bare-uuid+provider_type idiom insurance_preauthorizations.source_id
-- already uses for polymorphic references on this platform. A row here
-- means "this insurer has an opinion about this provider" (in-network,
-- out-of-network, or restricted to a named benefit); absence of a row is
-- deliberately NOT "out of network" — most insurers cover most of an
-- open network by default, so an insurer starts with an empty table and
-- only adds exceptions, rather than every existing facility needing a row
-- before an insurer can be configured at all.

do $$ begin
  create type public.payer_network_provider_type as enum
    ('facility', 'lab_provider', 'pharmacy_partner', 'specialist_provider');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payer_network_status as enum ('in_network', 'out_of_network', 'restricted');
exception when duplicate_object then null; end $$;

create table public.payer_network_providers (
  id              uuid primary key default gen_random_uuid(),
  insurer_id      uuid not null references public.insurers (id) on delete cascade,
  provider_type   public.payer_network_provider_type not null,
  provider_id     uuid not null,
  status          public.payer_network_status not null default 'in_network',
  -- Non-null restricts this network row to one benefit category
  -- (27.12 "benefit-specific providers"); null applies to every category.
  service_category text check (service_category is null or service_category in
    ('consultation', 'laboratory', 'pharmacy', 'referral')),
  notes           text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (insurer_id, provider_type, provider_id, service_category)
);

comment on table public.payer_network_providers is
  '27.12. No row for a given provider = default open-network coverage; a row is always an insurer stating an EXCEPTION (in/out/restricted), never the only source of truth for "is this provider covered". A checkout/booking flow consulting this must treat a miss as in-network, not as unknown.';

create index payer_network_providers_insurer_idx on public.payer_network_providers (insurer_id, status);
create index payer_network_providers_provider_idx on public.payer_network_providers (provider_type, provider_id);

create trigger payer_network_providers_set_updated_at
  before update on public.payer_network_providers
  for each row execute function private.set_updated_at();

-- The provider_id must actually exist in the directory its provider_type
-- names — a polymorphic FK PostgreSQL cannot express declaratively, so a
-- trigger does what the constraint can't.
create or replace function private.payer_network_provider_exists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  v_ok := case new.provider_type
    when 'facility'            then exists (select 1 from public.facilities where id = new.provider_id)
    when 'lab_provider'        then exists (select 1 from public.lab_providers where id = new.provider_id)
    when 'pharmacy_partner'    then exists (select 1 from public.pharmacy_partners where id = new.provider_id)
    when 'specialist_provider' then exists (select 1 from public.specialist_providers where id = new.provider_id)
  end;
  if not v_ok then
    raise exception 'no % with id % exists', new.provider_type, new.provider_id using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger payer_network_provider_exists
  before insert or update of provider_type, provider_id on public.payer_network_providers
  for each row execute function private.payer_network_provider_exists();

alter table public.payer_network_providers enable row level security;

create policy payer_network_providers_select on public.payer_network_providers
  for select to authenticated
  using (private.is_insurance_admin() or private.module_enabled('payer_platform'));

create policy payer_network_providers_manage on public.payer_network_providers
  for all to authenticated
  using (private.is_insurance_admin() or private.is_payer_admin_for(insurer_id, array['benefits_manager']))
  with check (private.is_insurance_admin() or private.is_payer_admin_for(insurer_id, array['benefits_manager']));

grant select, insert, update, delete on public.payer_network_providers to authenticated;
revoke all on public.payer_network_providers from anon;

-- ---------------------------------------------------------------------------
-- Payer-directed programme enrolment (27.9). A directive names a Tarragon
-- programme and a condition filter; the RPC below enrols every ACTIVE,
-- VERIFIED member of this insurer who already carries a matching active
-- patient_conditions row. This never diagnoses or infers a condition on the
-- payer's behalf — it only acts on a diagnosis Tarragon's own care team
-- already recorded, which is the same "clinical appropriateness vs payer
-- coverage" separation spec §25.16 draws for pre-authorisation (27.6).
-- ---------------------------------------------------------------------------
create table public.payer_programme_directives (
  id               uuid primary key default gen_random_uuid(),
  insurer_id       uuid not null references public.insurers (id) on delete cascade,
  programme_id     uuid not null references public.chronic_condition_programmes (id) on delete restrict,
  is_active        boolean not null default true,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (insurer_id, programme_id)
);

comment on table public.payer_programme_directives is
  '27.9 "All members with hypertension receive BP monitoring and structured follow-up." One row = one standing instruction; public.apply_payer_programme_directive() is the only thing that acts on it, and only ever enrols members whose condition a Tarragon clinician already diagnosed.';

create trigger payer_programme_directives_set_updated_at
  before update on public.payer_programme_directives
  for each row execute function private.set_updated_at();

alter table public.payer_programme_directives enable row level security;

create policy payer_programme_directives_select on public.payer_programme_directives
  for select to authenticated
  using (private.is_insurance_admin() or private.is_payer_admin_for(insurer_id));

create policy payer_programme_directives_manage on public.payer_programme_directives
  for all to authenticated
  using (private.is_insurance_admin() or private.is_payer_admin_for(insurer_id, array['benefits_manager']))
  with check (private.is_insurance_admin() or private.is_payer_admin_for(insurer_id, array['benefits_manager']));

grant select, insert, update, delete on public.payer_programme_directives to authenticated;
revoke all on public.payer_programme_directives from anon;

create or replace function public.apply_payer_programme_directive(p_directive_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.payer_programme_directives%rowtype;
  v_programme public.chronic_condition_programmes%rowtype;
  v_enrolled integer := 0;
  v_already integer := 0;
  r record;
begin
  select * into v_d from public.payer_programme_directives where id = p_directive_id;
  if v_d.id is null then
    raise exception 'no such directive' using errcode = '42501';
  end if;
  if not private.is_payer_admin_for(v_d.insurer_id, array['benefits_manager', 'owner']) then
    raise exception 'not authorised to apply this insurer''s directives' using errcode = '42501';
  end if;
  if not v_d.is_active then
    raise exception 'this directive is not active' using errcode = '23514';
  end if;

  select * into v_programme from public.chronic_condition_programmes where id = v_d.programme_id;

  -- Every patient with: an active, verified policy under this insurer, and
  -- an active patient_conditions row a clinician already recorded matching
  -- the programme's condition. verified_at is not null is deliberate —
  -- 27.5's eligibility chain starts with "policy active", and an
  -- unverified, patient-self-reported card is not a confirmed member yet.
  for r in
    select distinct pc.patient_id, pc.organisation_id
    from public.insurance_policies ip
    join public.patient_conditions pc on pc.patient_id = ip.patient_id
    where ip.insurer_id = v_d.insurer_id
      and ip.status = 'active'
      and ip.verified_at is not null
      and (ip.effective_to is null or ip.effective_to >= current_date)
      and pc.status = 'active'
      and lower(pc.condition_name) = lower(v_programme.condition::text)
  loop
    if exists (
      select 1 from public.chronic_programme_enrolments
      where patient_id = r.patient_id and programme_id = v_d.programme_id and status = 'enrolled'
    ) then
      v_already := v_already + 1;
      continue;
    end if;

    insert into public.chronic_programme_enrolments
      (organisation_id, patient_id, programme_id, status, source, notes)
    values (
      r.organisation_id, r.patient_id, v_d.programme_id, 'enrolled', 'payer_directive',
      'Enrolled per ' || (select name from public.insurers where id = v_d.insurer_id) || ' programme directive.'
    );
    v_enrolled := v_enrolled + 1;
  end loop;

  perform private.log_audit('payer_programme_directive.applied', 'payer_programme_directive', p_directive_id,
    jsonb_build_object('insurer_id', v_d.insurer_id, 'programme_id', v_d.programme_id,
                        'newly_enrolled', v_enrolled, 'already_enrolled', v_already));

  return jsonb_build_object('ok', true, 'newly_enrolled', v_enrolled, 'already_enrolled', v_already);
end;
$$;

revoke all on function public.apply_payer_programme_directive(uuid) from public;
revoke all on function public.apply_payer_programme_directive(uuid) from anon;
grant execute on function public.apply_payer_programme_directive(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_table_privilege('authenticated', 'public.payer_network_providers', 'SELECT')
     or not has_table_privilege('authenticated', 'public.payer_programme_directives', 'SELECT') then
    raise exception 'FAIL: missing authenticated grants on the new tables';
  end if;

  if pg_get_functiondef('public.apply_payer_programme_directive(uuid)'::regprocedure)
       not like '%verified_at is not null%' then
    raise exception 'FAIL: the directive RPC does not require a verified policy';
  end if;

  if pg_get_functiondef('public.apply_payer_programme_directive(uuid)'::regprocedure)
       not like '%payer_directive%' then
    raise exception 'FAIL: enrolments applied by directive are not tagged with the payer_directive source';
  end if;

  raise notice 'PASS: payer network + programme-directive enrolment in place';
end $$;
