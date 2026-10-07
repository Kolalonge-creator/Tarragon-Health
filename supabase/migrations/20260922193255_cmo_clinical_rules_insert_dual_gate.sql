-- CMO governance self-sufficiency, continued: clinical_rules_insert was also
-- private.is_admin()-only, with no Clinical Director fallback — same bug
-- shape as 20260922193027_cmo_governed_config_insert_dual_gate.sql, found
-- while wiring up the /clinician mirror of the clinical sign-off checklist.
--
-- signClinicalRuleWithGovernanceAction (admin/settings/clinical-signoff/
-- actions.ts) — the checklist's one-button fix for a shadow rule missing an
-- owner/protocol link — has no app-layer role check of its own; it relies
-- entirely on RLS to gate who may insert the corrected draft it creates, and
-- on sign_clinical_rule (already Clinical-Director-only) to gate the sign.
-- Without this, a CMO clicking the checklist's fix button on
-- /clinician/clinical-signoff would have hit a silent RLS insert failure —
-- the exact same "gate closes on the only account that could pass the
-- sign" bug as the 5 tables fixed a moment ago, just one table further in.
--
-- Proof: packages/db/tests/cmo_clinical_rules_insert_dual_gate.sql.
--
-- Deliberately NOT touched: clinical_rules_update_draft (editing a draft in
-- place before promotion is an authoring step, stays admin-only by design)
-- and promote_clinical_rule_to_shadow's own admin-only RPC gate (see that
-- function's comment — a shadow rule cannot reach a patient, so requiring a
-- signature just to start measuring one would discourage the shadow step).
alter policy clinical_rules_insert on public.clinical_rules
  with check (
    (private.is_admin() or exists (
      select 1 from public.clinical_staff
      where clinical_staff.profile_id = (select auth.uid())
        and clinical_staff.active
        and clinical_staff.doctor_tier = 'chief_medical_officer'
    ))
    and status = 'draft'
    and approved_by is null
    and approved_at is null
    and activated_at is null
  );
