-- get_advisors (performance) flagged patient_timeline_actor_clinical_staff_id_fkey
-- as an uncovered foreign key right after the parent migration applied.
create index if not exists patient_timeline_actor_idx
  on public.patient_timeline (actor_clinical_staff_id);
