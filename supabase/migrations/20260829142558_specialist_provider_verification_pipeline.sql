-- Tarragon Health
-- Specialist Network & Provider Platform — verification/onboarding pipeline
-- for specialist_providers (66.3: Application -> Identity verification ->
-- Professional registration verification -> Qualification verification ->
-- Specialty verification -> Contract -> Onboarding -> Clinical approval ->
-- Active).
--
-- docs/CLINICAL_NETWORK_SPEC.md §4.3 flagged this as a real, confirmed gap:
-- "no multi-step onboarding pipeline... for any provider type — onboarding
-- today is a manual admin insert." This closes it for specialist_providers
-- specifically (the outer referral-network catalogue), following the two
-- closest existing precedents rather than inventing a new shape:
-- clinical_staff's point-in-time-flag-plus-CHECK pattern (verification gates
-- activation at the DB level, not just app code) and
-- clinical_encounter_notes' attributed-event trail.
--
-- specialist_providers rows have no login (confirmed: no profile_id/auth
-- linkage exists on this table, per specialist-referrals.ts's own comment
-- that "specialists have no platform login"), so unlike clinical_staff there
-- is no self-verification risk to guard against — every transition here is
-- inherently admin-performed. What IS worth enforcing at the DB level,
-- mirroring clinical_staff_active_requires_verification: is_active can only
-- be true once verification_stage = 'active'.
create type public.specialist_verification_stage as enum (
  'application',
  'identity_verification',
  'registration_verification',
  'qualification_verification',
  'specialty_verification',
  'contract',
  'onboarding',
  'clinical_approval',
  'active'
);

alter table public.specialist_providers
  add column if not exists verification_stage public.specialist_verification_stage not null default 'application';

-- Existing 9 placeholder rows are all is_active=false already; they land on
-- the 'application' default rather than a fabricated completed pipeline.

alter table public.specialist_providers
  add constraint specialist_providers_active_requires_verification_stage
    check (not is_active or verification_stage = 'active');

create table public.specialist_provider_verification_events (
  id                      uuid primary key default gen_random_uuid(),
  specialist_provider_id  uuid not null references public.specialist_providers (id) on delete cascade,
  from_stage              public.specialist_verification_stage,
  to_stage                public.specialist_verification_stage not null,
  note                    text,
  performed_by            uuid not null references public.profiles (id) on delete restrict,
  created_at              timestamptz not null default now()
);

create index specialist_provider_verification_events_provider_idx
  on public.specialist_provider_verification_events (specialist_provider_id, created_at desc);

alter table public.specialist_provider_verification_events enable row level security;

create policy specialist_provider_verification_events_select
  on public.specialist_provider_verification_events
  for select to authenticated
  using (private.is_admin() or private.has_permission('partners.specialists.manage'));

grant select on public.specialist_provider_verification_events to authenticated;

-- No direct insert/update/delete policy on the events table: every
-- transition happens only through advance_specialist_verification_stage()
-- below (SECURITY DEFINER), which records performed_by from auth.uid()
-- server-side rather than trusting a client-supplied value — same
-- no-client-forged-attribution posture as the rest of the platform's
-- verification trails.
create or replace function public.advance_specialist_verification_stage(
  p_specialist_provider_id uuid,
  p_to_stage public.specialist_verification_stage,
  p_note text default null
)
returns public.specialist_providers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.specialist_providers;
  v_from public.specialist_verification_stage;
begin
  if not (private.is_admin() or private.has_permission('partners.specialists.manage')) then
    raise exception 'not authorised to advance specialist verification' using errcode = '42501';
  end if;

  select * into v_row from public.specialist_providers where id = p_specialist_provider_id for update;
  if not found then
    raise exception 'specialist_providers row % not found', p_specialist_provider_id;
  end if;

  v_from := v_row.verification_stage;

  -- Moving away from 'active' deactivates the row (the CHECK constraint
  -- would otherwise reject it) — a stage regression (e.g. a license lapses
  -- and an admin sends the row back for re-verification) should not leave a
  -- specialist listed as active with an incomplete pipeline. Moving TO
  -- 'active' does not itself flip is_active true — that stays the existing,
  -- separate admin action (useSetSpecialistProviderActive), same two-step
  -- shape as clinical_staff's license_verified_at + active being distinct.
  update public.specialist_providers
    set verification_stage = p_to_stage,
        is_active = case when p_to_stage = 'active' then is_active else false end
    where id = p_specialist_provider_id
    returning * into v_row;

  insert into public.specialist_provider_verification_events
    (specialist_provider_id, from_stage, to_stage, note, performed_by)
  values (p_specialist_provider_id, v_from, p_to_stage, p_note, auth.uid());

  return v_row;
end;
$$;

-- anon inherits EXECUTE through the PUBLIC pseudo-role unless explicitly
-- revoked from public (not from anon) — see CLAUDE.md's standing gotcha.
revoke all on function public.advance_specialist_verification_stage(uuid, public.specialist_verification_stage, text) from public;
revoke all on function public.advance_specialist_verification_stage(uuid, public.specialist_verification_stage, text) from anon;
revoke all on function public.advance_specialist_verification_stage(uuid, public.specialist_verification_stage, text) from public, anon;
grant execute on function public.advance_specialist_verification_stage(uuid, public.specialist_verification_stage, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'specialist_providers' and column_name = 'verification_stage'
  ) then
    raise exception 'specialist_providers.verification_stage was not created';
  end if;
  if has_function_privilege('anon', 'public.advance_specialist_verification_stage(uuid, public.specialist_verification_stage, text)', 'EXECUTE') then
    raise exception 'anon must not be able to execute advance_specialist_verification_stage';
  end if;
end $$;
