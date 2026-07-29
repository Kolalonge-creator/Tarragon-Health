-- Tarragon Health
-- Retires clinical_staff.role (clinical_director/clinician/escalation_doctor)
-- per docs/Tarragon_Health_Master_Operating_Plan_v4.md's tier ladder —
-- doctor_tier (added 20260715172711) is now the sole source of clinical
-- seniority/routing; Clinical Director becomes its own orthogonal
-- governance flag (clinical_staff.is_clinical_director) instead of a value
-- sharing a column with tier — a person can hold Clinical Director status
-- at any tier, or none, which a single enum column couldn't express.
--
-- Founder decision (2026-07-15, confirmed same session as this migration):
-- indemnity-exemption scoping moves from clinical_staff_role to
-- doctor_tier + a director flag, so ops can exempt "all Tier 5s"
-- separately from "all Clinical Directors" instead of collapsing both into
-- one role value.
--
-- Data mapping: role='clinical_director' -> is_clinical_director=true
-- (doctor_tier is untouched — stays NULL for these rows per the previous
-- migration, since governance is orthogonal to tier and there's no
-- seniority data to infer one from). role='clinician'/'escalation_doctor'
-- carried no information doctor_tier doesn't already have — both were
-- backfilled from role in 20260715172711 (clinician -> tier_1,
-- escalation_doctor -> tier_4_senior_registrar) — so dropping role loses
-- nothing for those rows.

alter table public.clinical_staff
  add column is_clinical_director boolean not null default false;

update public.clinical_staff
  set is_clinical_director = true
  where role = 'clinical_director';

create index clinical_staff_director_idx
  on public.clinical_staff (organisation_id)
  where active and is_clinical_director;

drop index if exists public.clinical_staff_role_idx;

-- ---------------------------------------------------------------------------
-- clinical_staff_indemnity_exemptions: role -> doctor_tier + applies_to_director.
-- A row's scope is exactly one of: a single tier, "all Clinical Directors",
-- or (both null/false) the whole org — never a tier and the director flag
-- together, enforced below.
-- ---------------------------------------------------------------------------

drop index if exists public.clinical_staff_indemnity_exemptions_role_idx;
drop index if exists public.clinical_staff_indemnity_exemptions_org_wide_idx;

alter table public.clinical_staff_indemnity_exemptions
  add column doctor_tier public.doctor_tier,
  add column applies_to_director boolean not null default false;

update public.clinical_staff_indemnity_exemptions
  set applies_to_director = true
  where role = 'clinical_director';

update public.clinical_staff_indemnity_exemptions
  set doctor_tier = 'tier_4_senior_registrar'
  where role = 'escalation_doctor';

alter table public.clinical_staff_indemnity_exemptions
  add constraint clinical_staff_indemnity_exemptions_single_scope
  check (not (doctor_tier is not null and applies_to_director));

alter table public.clinical_staff_indemnity_exemptions
  drop column role;

create unique index clinical_staff_indemnity_exemptions_org_wide_idx
  on public.clinical_staff_indemnity_exemptions (organisation_id)
  where doctor_tier is null and not applies_to_director;
create unique index clinical_staff_indemnity_exemptions_tier_idx
  on public.clinical_staff_indemnity_exemptions (organisation_id, doctor_tier)
  where doctor_tier is not null;
create unique index clinical_staff_indemnity_exemptions_director_idx
  on public.clinical_staff_indemnity_exemptions (organisation_id)
  where applies_to_director;

-- ---------------------------------------------------------------------------
-- Trigger rewrite: is_clinical_director + tier drive both the requirement
-- check and the exemption lookup now, not role.
-- ---------------------------------------------------------------------------

create or replace function private.enforce_clinical_staff_indemnity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requires_indemnity boolean;
begin
  requires_indemnity := new.is_clinical_director
    or coalesce(new.doctor_tier in ('tier_4_senior_registrar', 'tier_5_partner_specialist'), false);

  if not new.active or not requires_indemnity then
    return new;
  end if;

  if new.indemnity_exempt then
    return new;
  end if;

  if exists (
    select 1 from public.clinical_staff_indemnity_exemptions e
    where e.organisation_id = new.organisation_id
      and (
        (e.doctor_tier is null and not e.applies_to_director)
        or e.doctor_tier = new.doctor_tier
        or (e.applies_to_director and new.is_clinical_director)
      )
  ) then
    return new;
  end if;

  if new.indemnity_expires_at is null or new.indemnity_expires_at <= now() then
    raise exception 'clinical_staff: % requires current indemnity cover, an individual exemption, or an org/tier/director exemption before activation', new.full_name
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Drop role from clinical_staff, then the now-unreferenced enum type.
-- ---------------------------------------------------------------------------

alter table public.clinical_staff drop column role;

drop type public.clinical_staff_role;
