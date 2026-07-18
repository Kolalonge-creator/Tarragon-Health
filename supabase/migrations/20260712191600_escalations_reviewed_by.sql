-- Tarragon Health
-- escalations.reviewed_by / reviewed_at: the null-gate fields required by
-- docs/CLINICAL_TRUST_MODEL_SPEC.md §2 — no "Dr. X reviewed this" UI may
-- render for an escalation until both are set, and they are set once, at
-- review time, by the reviewing doctor (§5 — no retroactive attribution).
-- The existing resolution_note column already carries the doctor's
-- review note / action plan, so no separate review_note column is added.

alter table public.escalations
  add column reviewed_by uuid references public.profiles (id) on delete set null,
  add column reviewed_at timestamptz;

create index escalations_reviewed_by_idx on public.escalations (reviewed_by);
