-- Local/CI-only fix-forward, NOT a functional migration -- same rationale
-- family as the other seeded-state fix-forward migrations in this history
-- (complete_usd's price-lock seed, the escalation_slas v3 lookup fix):
-- 20260813163440_fix_chronic_protocol_signoff_attribution_and_harden_trigger.sql's
-- own self-test asserts a protocol_versions row exists for each of
-- chronic_hypertension_who / chronic_diabetes_who / chronic_obesity_who,
-- signed by an active Clinical Director. That migration's own header
-- comment confirms this state is real on live -- "all three protocol_versions
-- rows' approved_by already points to clinical_staff.id ...54598937...,
-- Dr Kola Longe" -- but it got there because a real Clinical Director signed
-- these three protocols through the app UI at some point after
-- 20260716223544 seeded the underlying WHO reference content, not because
-- any migration ever inserted a protocol_versions row. A fresh replay never
-- runs that app action, so protocol_versions is empty for all three slugs
-- and the assertion fails (found 0, not 3).
--
-- Not fixed by editing the historical migration -- it isn't even wrong, it
-- correctly describes/depends on state no migration ever created. Instead,
-- seeds a synthetic CI-only Clinical Director (a bio-only clinical_staff
-- record with no profile_id -- that table's own header comment documents
-- this as a legitimate real shape, "may exist as a bio-only marketing
-- record with no platform login", not a fixture hack) plus the three signed
-- protocol_versions rows this migration's target assertion needs.
--
-- Timestamped one second before 20260812034845_protocol_versions_self_attribution.sql
-- installs its BEFORE INSERT trigger deliberately: that trigger re-derives
-- approved_by from auth.uid() and unconditionally rejects any insert where
-- it can't find a matching active-director clinical_staff row for the
-- caller -- a plain migration-context insert has no authenticated session,
-- so auth.uid() is null and would be rejected outright if this ran any
-- later. Running before that trigger exists makes this a plain, trigger-free
-- insert, exactly like every earlier protocol_versions-seeding migration in
-- this history.
--
-- clinical_staff.is_clinical_director + active = true also fires
-- private.enforce_clinical_staff_indemnity (20260715175909) -- satisfied
-- here with a real future indemnity_expires_at rather than the
-- indemnity_exempt escape hatch, so this fixture carries the same shape a
-- genuine Clinical Director record would.
--
-- Looked up by natural key (full_name + credential_number), not a hardcoded
-- id, matching this history's established pattern for cross-statement
-- fixture references. Guarded to be a genuine no-op on live: both inserts
-- skip entirely once any protocol_versions row exists for any of the three
-- slugs, which is already true there.
insert into public.clinical_staff (
  organisation_id, full_name, is_clinical_director, active,
  credential_type, credential_number, indemnity_expires_at
)
select
  o.id,
  'CI Fixture Clinical Director',
  true,
  true,
  'MDCN',
  'CI-FIXTURE-0001',
  now() + interval '5 years'
from public.organisations o
where not exists (
  select 1 from public.protocol_versions
  where protocol_id in ('chronic_hypertension_who', 'chronic_diabetes_who', 'chronic_obesity_who')
)
limit 1;

insert into public.protocol_versions (
  organisation_id, protocol_id, version_number, title, change_summary, content,
  approved_by, approved_at
)
select
  cs.organisation_id, slug.protocol_id, 1,
  'CI fixture signed protocol -- ' || slug.protocol_id,
  'CI-only fixture signature so a fresh replay has a signed protocol version to activate against.',
  '{}'::jsonb,
  cs.id, now()
from public.clinical_staff cs
cross join (values
  ('chronic_hypertension_who'),
  ('chronic_diabetes_who'),
  ('chronic_obesity_who')
) as slug(protocol_id)
where cs.full_name = 'CI Fixture Clinical Director'
  and cs.credential_number = 'CI-FIXTURE-0001'
  and not exists (
    select 1 from public.protocol_versions pv2
    where pv2.protocol_id = slug.protocol_id
  );
