-- Tarragon Health — Symptom Assessment & Triage Engine, part 3 follow-up:
-- revoke the default-privileges INSERT/DELETE grant on
-- symptom_triage_assessments.
--
-- Same gotcha CLAUDE.md documents under "Standing engineering lessons":
-- Supabase's `alter default privileges` fix (applied after the 2026-08-01
-- sweep) grants full CRUD to `authenticated` on every NEWLY CREATED table
-- automatically — it is not something a table's own migration opts into by
-- writing (or omitting) a `grant` statement. The previous migration in this
-- set said "no insert grant to authenticated" in its comments, matching the
-- mental_health_screens precedent it was mirroring, but that precedent
-- predates the default-privileges fix; on this table the INSERT/DELETE
-- grants were present from creation regardless.
--
-- This was NOT a live security gap — with no permissive INSERT policy, RLS
-- already blocked every insert attempt from `authenticated` even with the
-- grant present (verified directly: a simulated authenticated session got
-- "new row violates row-level security policy"). This migration closes the
-- gap between the code and its own documented intent, and removes a
-- default grant nothing is meant to use, rather than relying solely on "no
-- permissive policy happens to exist" as the only line of defence.
revoke insert, delete on public.symptom_triage_assessments from authenticated;

do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'symptom_triage_assessments'
      and grantee = 'authenticated' and privilege_type in ('INSERT', 'DELETE')
  ) then
    raise exception 'FAIL: authenticated must not retain INSERT/DELETE on symptom_triage_assessments';
  end if;
  raise notice 'PASS: INSERT/DELETE revoked from authenticated on symptom_triage_assessments';
end $$;
