-- Children's immunization (founder-directed 2026-07-23): the NPHCDA routine
-- childhood schedule as vaccination_catalog data, plus profile_access-based
-- family authority so a parent with a 'manage' grant can keep a child's
-- vaccine card. Nigeria context: penta3 coverage ~56%, world's largest
-- zero-dose child population, and the paper child health card is routinely
-- lost — this is the family's digital card, doctor-verifiable via the
-- existing certificate pathway. NOT a government/EMID registry and never
-- claimed as one.
--
-- Schedule rows use the new DOB-anchored recommended_age shape
-- { age_schedule_weeks: [...], max_age_years } added to
-- computeVaccinationStatuses the same day; max_age_years keeps BCG/penta off
-- every adult's card (catch-up beyond the window is a clinical decision).

insert into public.vaccination_catalog (code, name, description, recommended_age)
values
  ('child_bcg', 'BCG (tuberculosis)', 'One dose at birth.',
    '{"age_schedule_weeks": [0], "max_age_years": 5}'),
  ('child_hep_b_birth', 'Hepatitis B birth dose', 'Within 24 hours of birth.',
    '{"age_schedule_weeks": [0], "max_age_years": 2}'),
  ('child_opv', 'Oral polio (OPV)', 'Birth, then 6, 10 and 14 weeks.',
    '{"age_schedule_weeks": [0, 6, 10, 14], "max_age_years": 5}'),
  ('child_penta', 'Pentavalent (DTP-HepB-Hib)', 'Three doses: 6, 10 and 14 weeks.',
    '{"age_schedule_weeks": [6, 10, 14], "max_age_years": 5}'),
  ('child_pcv', 'Pneumococcal (PCV)', 'Three doses: 6, 10 and 14 weeks.',
    '{"age_schedule_weeks": [6, 10, 14], "max_age_years": 5}'),
  ('child_rota', 'Rotavirus', 'Two doses: 6 and 10 weeks.',
    '{"age_schedule_weeks": [6, 10], "max_age_years": 2}'),
  ('child_ipv', 'Inactivated polio (IPV)', 'One dose at 14 weeks.',
    '{"age_schedule_weeks": [14], "max_age_years": 5}'),
  ('child_measles', 'Measles (MCV)', 'Two doses: 9 and 15 months.',
    '{"age_schedule_weeks": [39, 65], "max_age_years": 5}'),
  ('child_yellow_fever', 'Yellow fever', 'One dose at 9 months.',
    '{"age_schedule_weeks": [39], "max_age_years": 5}'),
  ('child_men_a', 'Meningococcal A', 'One dose from 9 months.',
    '{"age_schedule_weeks": [39], "max_age_years": 5}'),
  ('child_hpv_girls', 'HPV (girls 9–14)', 'One dose for girls aged 9–14 (routine since 2023).',
    '{"age_schedule_weeks": [469], "max_age_years": 14, "sex": "female"}')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Family authority: profile_access grantees can SEE a linked profile's
-- vaccination state ('view' or 'manage'); only 'manage' grantees can WRITE
-- dose records (log a child's vaccine). Verification/certificate issuing
-- stays staff-only via the existing enforce_vaccination_verification trigger,
-- which this does not touch.
-- ---------------------------------------------------------------------------

drop policy if exists vaccination_records_select on public.vaccination_records;
create policy vaccination_records_select on public.vaccination_records
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = vaccination_records.profile_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

drop policy if exists vaccination_records_insert on public.vaccination_records;
create policy vaccination_records_insert on public.vaccination_records
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = vaccination_records.profile_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

drop policy if exists vaccination_records_update on public.vaccination_records;
create policy vaccination_records_update on public.vaccination_records
  for update to authenticated
  using (
    profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = vaccination_records.profile_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  )
  with check (
    profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = vaccination_records.profile_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

drop policy if exists vaccination_schedules_select on public.vaccination_schedules;
create policy vaccination_schedules_select on public.vaccination_schedules
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = vaccination_schedules.patient_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );
