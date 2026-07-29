-- Tarragon Health — Care Coordination Build 3: link a specialist_referrals
-- row to a concrete specialist_providers row, so the clinician worklist has
-- something to assign. No assigned_by/assigned_at audit columns — unlike
-- doctor-review attribution (a strict clinical-trust-model requirement),
-- assigning an external provider has no compliance requirement to attribute
-- per-case.
alter table public.specialist_referrals
  add column specialist_provider_id uuid references public.specialist_providers (id) on delete set null;

create index specialist_referrals_provider_idx on public.specialist_referrals (specialist_provider_id);
