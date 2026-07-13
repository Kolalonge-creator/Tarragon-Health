-- Tarragon Health
-- clinical_staff indemnity/malpractice insurance tracking —
-- docs/CLINICAL_TRUST_MODEL_SPEC.md §5: "Indemnity/malpractice insurance
-- required for the Clinical Director and every escalation doctor before
-- they're activated in the rota — this is what actually protects them, not
-- the disclaimer text." Clinicians are not required to carry indemnity
-- cover under this spec, so the gate below only applies to
-- clinical_director / escalation_doctor roles.
--
-- Same structural-guarantee approach as clinical_staff_active_requires_verification:
-- a DB CHECK constraint, not just an app-layer check, so activation can
-- never be granted to a director/doctor with no on-file or lapsed cover.
-- Like license_verified_at, this is a write-time gate — it stops *setting*
-- active=true without current cover, it does not retroactively deactivate
-- an already-active row if cover lapses later. Ops must track expiring
-- cover and re-verify/deactivate before it lapses (see the admin UI).

alter table public.clinical_staff
  add column indemnity_insurer text,
  add column indemnity_policy_number text,
  add column indemnity_expires_at timestamptz;

alter table public.clinical_staff
  add constraint clinical_staff_active_requires_indemnity
  check (
    not (active and role in ('clinical_director', 'escalation_doctor'))
    or (indemnity_expires_at is not null and indemnity_expires_at > now())
  );
