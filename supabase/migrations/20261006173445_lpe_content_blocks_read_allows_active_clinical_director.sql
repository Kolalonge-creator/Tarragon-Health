-- Let the active Chief Medical Officer READ unreviewed lpe_content_blocks.
--
-- Why: the only SELECT policy (20260810034122) is
--   clinician_reviewed = true or private.is_admin()
-- and a real CMO account is always profiles.role = 'clinician', never 'admin'
-- (CLAUDE.md, "never re-split the account role"). So the one person who may
-- call sign_lpe_content_block could not see a single block that needs signing:
-- the sign-off hub's count (clinician_reviewed = false) returned 0 with no
-- error, and /clinician/lpe-content-library listed only already-approved rows.
--
-- Read-only and additive: the existing policy is untouched (permissive
-- policies OR together), writes stay admin-only (lpe_content_blocks_admin_write)
-- and signing still goes only through sign_lpe_content_block. Patient-facing
-- retrieval is unaffected: match_lpe_content_blocks keeps its own explicit
-- clinician_reviewed = true filter. Same precedent as
-- 20260916013857_ai_evaluation_write_allows_active_clinical_director.sql, which
-- ORs private.is_active_clinical_director() into a policy the same way.
create policy lpe_content_blocks_read_director on public.lpe_content_blocks
  for select to authenticated
  using (private.is_active_clinical_director());

do $$
declare
  v_qual text;
begin
  select qual into v_qual from pg_policies
   where schemaname = 'public' and tablename = 'lpe_content_blocks' and policyname = 'lpe_content_blocks_read_director';
  if v_qual is null or v_qual not like '%is_active_clinical_director%' then
    raise exception 'FAIL: lpe_content_blocks_read_director missing or wrong: %', v_qual;
  end if;
  if (select cmd from pg_policies where schemaname = 'public' and tablename = 'lpe_content_blocks' and policyname = 'lpe_content_blocks_read_director') <> 'SELECT' then
    raise exception 'FAIL: lpe_content_blocks_read_director must be SELECT-only';
  end if;
end $$;
