-- ============================================================================
-- Close the RLS gap on lpe_content_blocks: today `lpe_content_blocks_read`
-- (from 20260719120001_lpe_foundation.sql) is `for select to authenticated
-- using (true)` — any signed-in user can SELECT every row regardless of
-- `clinician_reviewed`. Harmless while nothing reads this table into a
-- patient-facing surface, but the review gate needs to be enforced at the
-- database level, not left as a "remember to filter in the query" note for
-- whoever builds retrieval later (CLAUDE.md: "RLS enforced at the Postgres
-- level... never bypass, never filter in application code instead").
--
-- Admins keep full read access (they're who reviews/approves draft rows),
-- mirroring the existing lpe_content_blocks_write policy's private.is_admin()
-- check. Every other authenticated user now only ever sees rows that have
-- actually been clinician-reviewed.
-- ============================================================================

drop policy if exists lpe_content_blocks_read on public.lpe_content_blocks;

create policy lpe_content_blocks_read on public.lpe_content_blocks
  for select to authenticated
  using (clinician_reviewed = true or private.is_admin());

-- Prove it landed, not just hope.
do $$
declare
  v_qual text;
begin
  select qual into v_qual
  from pg_policies
  where schemaname = 'public'
    and tablename = 'lpe_content_blocks'
    and policyname = 'lpe_content_blocks_read';

  if v_qual is null then
    raise exception 'FAIL: lpe_content_blocks_read policy not found';
  end if;
  if v_qual not ilike '%clinician_reviewed%' then
    raise exception 'FAIL: lpe_content_blocks_read policy does not reference clinician_reviewed: %', v_qual;
  end if;

  raise notice 'PASS: lpe_content_blocks_read now gates on clinician_reviewed (or admin)';
end $$;
