-- Local/CI-only fix-forward, NOT a functional migration -- same rationale
-- family as the other seeded-state fix-forward migrations in this history
-- (the CI-fixture patient profile, the chronic-pathway protocol signoffs):
-- 20260820183248_analytics_engagement_real_activity_not_pageviews.sql's own
-- sabotage check proves private.real_patient_ids()'s `@tarragon.test`
-- exclusion filter is doing real work by asserting its result count differs
-- from "every patient-role profile, unfiltered". On live that's always true
-- because of the real 2026-07-29 QA seed batch (project_qa_test_accounts_
-- 20260727 -- 23 accounts, 9 of them role='patient', all @tarragon.test).
-- No migration ever created those rows (they were seeded directly on live,
-- same class of out-of-band state as the chronic-pathway protocol
-- signoffs), so a fresh replay's only patient profile at this point is the
-- CI fixture from 20260706084838 (ci-fixture-patient@example.invalid --
-- deliberately NOT a @tarragon.test address), and the exclusion filter
-- correctly excludes nothing from a set that has nothing to exclude --
-- making the "did it exclude anything" sabotage check fail on a technicality
-- rather than a real bug.
--
-- Seeds one synthetic @tarragon.test patient account so the exclusion
-- filter has something real to exclude on a fresh replay too. Reuses the
-- exact insert-only-auth.users pattern from 20260706084838: profiles.id
-- references auth.users(id) on delete cascade, and the on_auth_user_created
-- trigger (wired to default onto the direct-consumer org with role=patient
-- for empty metadata, per that migration's own header) auto-provisions the
-- matching profiles row with zero extra insert logic here.
--
-- Guarded to be a genuine no-op on live: skips entirely once any
-- @tarragon.test patient-role account already exists, which is always true
-- there.
do $$
begin
  if not exists (
    select 1
    from auth.users u
    join public.profiles p on p.id = u.id and p.role = 'patient'
    where u.email ilike '%tarragon.test%'
  ) then
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (
      '00000000-0000-0000-0000-0000000000f3',
      'qa-seed-patient@tarragon.test',
      'x',
      now(),
      '{}',
      '{}'
    )
    on conflict (id) do nothing;
  end if;
end $$;
