-- Recovered 2026-09-03 (full-platform audit) from supabase_migrations.schema_migrations:
-- this migration was applied live as version 20260902204701 but existed in no commit on any
-- branch (the session that applied it never committed the file). Committed here verbatim so
-- the applied SQL has a home in git; the release-integrity migration-drift check flags this
-- class as UNTRACED. Do not re-apply.

-- Targeted fix matching supabase/migrations/20260829122052_pediatric_developmental_screening.sql
-- on this branch: the table/trigger/item-bank already exist live (applied earlier under a
-- different migration version during a prior/concurrent run of this same content), so only the
-- SELECT policy needs correcting to the 2-arg can_read_clinical(uuid, care_access_category) form
-- introduced by 20260830103251_category_scoped_clinical_access_and_emergency_access.sql.
drop policy if exists developmental_screenings_select on public.developmental_screenings;
create policy developmental_screenings_select on public.developmental_screenings
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category)
  );

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'developmental_screenings'
      and policyname = 'developmental_screenings_select'
      and qual::text like '%can_read_clinical(patient_id, ''medical_history''%'
  ) then
    raise exception 'developmental_screenings_select was not updated to the 2-arg can_read_clinical form';
  end if;
end $$;

