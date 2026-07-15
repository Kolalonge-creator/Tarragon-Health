-- Tarragon Health
-- Doctor-tier ladder foundation — docs/Tarragon_Health_Master_Operating_Plan_v4.md
-- §4. Additive-only pass: adds clinical_staff.doctor_tier alongside the
-- existing clinical_staff.role (clinical_director/clinician/escalation_doctor),
-- which is NOT retired here — that's a scoped follow-up once every
-- dependent call site (indemnity exemptions, admin UI, care-team-form,
-- medications forms) is rewired. clinical_director stays a separate
-- org-governance flag on `role`, orthogonal to tier — a Clinical Director
-- can sit at any tier, or none.
--
-- Backfill (best-effort, no seniority data on file): escalation_doctor ->
-- tier_4_senior_registrar (closest existing role to Senior Registrar);
-- clinician -> tier_1 (safest default — admin must explicitly promote
-- anyone who should carry Tier 2+ authority); clinical_director -> left
-- NULL (governance role, not itself a rung on the ladder). NULL is a real
-- state here, not an oversight — never infer/default a tier in app code.

create type public.doctor_tier as enum (
  'care_coordinator',
  'tier_1',
  'tier_2',
  'tier_3',
  'tier_4_senior_registrar',
  'tier_5_partner_specialist'
);

alter table public.clinical_staff
  add column doctor_tier public.doctor_tier;

update public.clinical_staff
  set doctor_tier = 'tier_4_senior_registrar'
  where role = 'escalation_doctor';

update public.clinical_staff
  set doctor_tier = 'tier_1'
  where role = 'clinician';

create index clinical_staff_doctor_tier_idx
  on public.clinical_staff (organisation_id, doctor_tier) where active;

-- ---------------------------------------------------------------------------
-- Indemnity requirement now also covers Tier 4/5 directly (master plan §16
-- open decision, resolved 2026-07-15: Clinical Director + Tier 4 + Tier 5
-- require cover; Tiers 1-3 are employed and covered under Tarragon's
-- institutional policy, not tracked individually). Role-based check is
-- kept alongside the tier check during the transition, since
-- escalation_doctor isn't retired from `role` yet — for every row today
-- the two checks agree (escalation_doctor rows were just backfilled to
-- tier_4_senior_registrar above), so this is a superset, not a behavior
-- change, for existing data.
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
  requires_indemnity := new.role in ('clinical_director', 'escalation_doctor')
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
      and (e.role is null or e.role = new.role)
  ) then
    return new;
  end if;

  if new.indemnity_expires_at is null or new.indemnity_expires_at <= now() then
    raise exception 'clinical_staff: % requires current indemnity cover, an individual exemption, or an org/role exemption before activation', new.full_name
      using errcode = '23514';
  end if;

  return new;
end;
$$;
