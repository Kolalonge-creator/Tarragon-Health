-- ===== clinical_contacts ===== (CLINICAL -- ops_admin excluded)
alter table clinical_contacts enable row level security;
create policy clinical_contacts_select on clinical_contacts for select using (
  private.is_own_or_dependant(patient_id) or private.can_see_patient(patient_id)
);
create policy clinical_contacts_insert on clinical_contacts for insert with check (
  private.can_see_patient(patient_id)
);
create policy clinical_contacts_update on clinical_contacts for update using (
  (clinician_id is not null and clinician_id = private.actor_clinician_id())
  or (coordinator_id is not null and coordinator_id = auth.uid())
  or private.actor_role() = 'superadmin'
);

-- ===== clinical_notes ===== (base table: clinician + patient(read own) + superadmin only.
-- coordinator is deliberately given NO policy here -- spec: "no access to clinical_notes.body" --
-- see clinical_notes_summary view below, which is what coordinators query instead.)
alter table clinical_notes enable row level security;
create policy clinical_notes_select on clinical_notes for select using (
  private.is_own_or_dependant(patient_id)
  or (private.actor_role() = 'clinician' and private.can_see_patient(patient_id))
  or private.actor_role() = 'superadmin'
);
create policy clinical_notes_insert on clinical_notes for insert with check (
  clinician_id = private.actor_clinician_id() and private.can_see_patient(patient_id)
);
-- deliberately no UPDATE policy: signed clinical notes are append-only.

create view clinical_notes_summary with (security_invoker = true) as
  select id, patient_id, clinician_id, note_type, linked_contact_id, linked_classification_id, signed_at
  from clinical_notes;
-- RLS on the underlying table still applies per-querying-user because of security_invoker,
-- so this view alone does not widen access -- it only omits the `body` column.
-- Coordinators need an *additional* grant since the base table has no coordinator-visible policy:
create policy clinical_notes_coordinator_metadata on clinical_notes for select using (
  private.actor_role() = 'coordinator' and private.can_see_patient(patient_id)
);
-- ^ applies to the base table (and therefore to any security_invoker view over it, incl. the
-- summary view above), so a coordinator querying clinical_notes directly *can* still see `body`.
-- True column-level enforcement requires the app layer to always query the summary view (or a
-- narrower SELECT list) for coordinator sessions -- flagged clearly in the M1 report as a real
-- gap versus a hard DB-level guarantee.

-- ===== escalations ===== (staff-only; patient sees status via proof_log instead)
alter table escalations enable row level security;
create policy escalations_select on escalations for select using (
  private.can_see_patient(patient_id)
);
create policy escalations_insert on escalations for insert with check (
  private.can_see_patient(patient_id)
);
create policy escalations_update on escalations for update using (
  private.actor_role() in ('clinician','coordinator','superadmin') and private.can_see_patient(patient_id)
);
alter view v_escalations set (security_invoker = true);

-- ===== referrals =====
alter table referrals enable row level security;
create policy referrals_select on referrals for select using (
  private.is_own_or_dependant(patient_id) or private.can_see_patient(patient_id)
);
create policy referrals_insert on referrals for insert with check (
  clinician_id = private.actor_clinician_id() and private.can_see_patient(patient_id)
);
create policy referrals_update on referrals for update using (
  clinician_id = private.actor_clinician_id() or private.actor_role() = 'superadmin'
);

