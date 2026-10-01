-- ===========================================================================
-- S04: optional consent purposes (v5 4.2, function 1.13).
--
-- Counted first (live, 2026-10-01): consent_versions holds current rows for exactly three types (data_processing,
-- telehealth, terms_of_service); no optional type has a current row, so adding the flag changes no behaviour today.
--
-- private.has_required_consents gates onboarding on EVERY current consent version. The moment an optional purpose
-- (care_circle_sharing, research, sponsor_reporting, marketing, device_data, ...) gets a current row, that would block
-- every patient who declines it. is_required says which purposes gate onboarding; the other purposes are a choice, and
-- the patient's answer is still recorded and withdrawable. The three existing types are required, as they are now.
-- The wording for the optional purposes is NOT seeded here: it needs your approval (OQ-49).
-- ===========================================================================
alter table public.consent_versions add column if not exists is_required boolean not null default false;

update public.consent_versions
   set is_required = true
 where consent_type in ('data_processing', 'telehealth', 'terms_of_service');

comment on column public.consent_versions.is_required is
  'true: onboarding cannot finish without an in-force acceptance of this purpose (private.has_required_consents). false: an optional purpose, recorded and withdrawable but never a gate.';

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
      and cv.is_required
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

-- Proof, not hope: the three original types stayed required, and only they.
do $$
begin
  if exists (select 1 from public.consent_versions
              where consent_type in ('data_processing', 'telehealth', 'terms_of_service') and is_current and not is_required) then
    raise exception 'S04: a current original consent type lost is_required';
  end if;
  if exists (select 1 from public.consent_versions
              where consent_type not in ('data_processing', 'telehealth', 'terms_of_service') and is_required) then
    raise exception 'S04: an optional consent type is marked required';
  end if;
end $$;
