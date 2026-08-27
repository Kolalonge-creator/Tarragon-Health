-- Local/CI-only fix-forward, NOT a functional migration -- same rationale
-- family as supabase/roles.sql's function stubs, but for a TABLE grant this
-- time: 20260803130645_lab_result_extractions.sql's own assertion (anon
-- must not be able to SELECT this table) fails on a fresh replay even
-- though that migration never grants anon anything, and the platform-wide
-- default-privileges fix (20260731232749_fix_missing_authenticated_table_grants.sql)
-- explicitly grants only `authenticated`, not `anon` -- so anon's SELECT
-- here comes from whatever unexplained local/hosted default-ACL gap
-- motivated roles.sql in the first place (see that file's header), just
-- surfacing on a table instead of a function this time.
--
-- Table grants can't be pre-seeded in roles.sql (the table doesn't exist
-- yet, before any migration). Instead, pre-create it here with the same
-- shape (CREATE TABLE IF NOT EXISTS, so the real migration's own create is
-- a no-op) and the grants already correct, one second before its real
-- consumer -- exactly the CREATE-OR-REPLACE-preserves-ACL trick used for
-- functions, applied to a table's default ACL instead.
create table if not exists public.lab_result_extractions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id uuid not null references public.profiles (id) on delete restrict,
  document_id uuid not null unique
    references public.lab_result_documents (id) on delete cascade,
  status text not null check (status in ('ready', 'failed')),
  model_id text,
  proposed jsonb not null default '[]'::jsonb,
  error_message text,
  confirmed_by uuid references public.clinical_staff (id) on delete restrict,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lab_result_extractions_patient_idx
  on public.lab_result_extractions (patient_id, created_at desc);

revoke all on public.lab_result_extractions from public;
revoke all on public.lab_result_extractions from anon;
grant select on public.lab_result_extractions to authenticated;
