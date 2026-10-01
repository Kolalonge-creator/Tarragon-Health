-- ===========================================================================
-- S04: optional consent purposes (v5 4.2, function 1.13).
--
-- Counted first (live, 2026-10-01): consent_versions holds current rows for exactly three types (data_processing,
-- telehealth, terms_of_service); no optional type has a current row, so adding the flag changes no behaviour today.
--
-- private.has_required_consents gates onboarding on EVERY current consent version. The moment an optional purpose
-- (care_circle_sharing, research, sponsor_reporting, marketing, device_data, ...) gets a current row, that would block
-- every patient who declines it. is_optional says which purposes are a choice. It is deliberately the flag that must be
-- SET, not the one that must be remembered: a new version of a required purpose is published by a plain INSERT (twelve
-- such migrations exist), so a column defaulting to "optional" would silently drop the gate on the next legal bump.
-- Default false means every row, old or new, stays required unless someone explicitly declares it optional.
-- The wording for the optional purposes is NOT seeded here: it needs your approval (OQ-49).
-- ===========================================================================
alter table public.consent_versions add column if not exists is_optional boolean not null default false;

comment on column public.consent_versions.is_optional is
  'false (the default, so every new version of a required purpose stays required): onboarding cannot finish without an in-force acceptance of this purpose (private.has_required_consents). true: an optional purpose, recorded and withdrawable but never a gate. Set it explicitly when seeding an optional purpose.';

create or replace function private.has_required_consents(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.consent_versions cv
    where cv.is_current
      and not cv.is_optional
      and not exists (
        select 1
        from public.patient_consents pc
        where pc.patient_id = p_patient
          and pc.consent_version_id = cv.id
          and pc.action = 'accepted'
          and not exists (
            select 1 from public.patient_consents pc2
            where pc2.patient_id = pc.patient_id
              and pc2.consent_type = pc.consent_type
              and pc2.action = 'withdrawn'
              and pc2.created_at > pc.created_at
          )
      )
  );
$$;

-- Proof, not hope: every existing row is required (nothing was declared optional), so behaviour is unchanged today.
do $$
begin
  if exists (select 1 from public.consent_versions where is_optional) then
    raise exception 'S04: a consent version is marked optional by this migration';
  end if;
end $$;
