# Clinical & Compliance Feature Checklist

> §88.18 / §87.18 of the 2026-08-29 governance/safety spec audit: "compliance
> should be embedded in the product lifecycle rather than handled as
> paperwork after development." This is that embedding — a checklist to run
> through before merging a clinically-relevant or compliance-relevant
> feature, not a form to fill in after the fact.

Run through this before opening a PR for any feature that touches patient
safety, clinical decision-making, or personal/health data. Most features
only need a handful of these — skip what genuinely doesn't apply, but say so
in the PR description rather than silently skipping.

## Clinical features (§88.18)

- [ ] **Clinical owner** — who is accountable for this feature's clinical
      correctness? Named in the migration header or PR description, not
      implied.
- [ ] **Protocol** — does this feature implement, read, or depend on a
      clinical protocol? If so, which `protocol_versions`/`protocol_drafts`
      row, and is it signed (or does the feature correctly behave as
      "not yet available" until it is)?
- [ ] **Escalation pathway** — if this feature can detect something needing
      clinical attention, does it route through `clinician_alerts` /
      `escalations` with a real `escalation_slas` entry, not a bespoke
      notification path?
- [ ] **Audit mechanism** — can you answer "who did this, when, under what
      authority" for this feature's write path? (`private.is_org_staff`-gated
      RLS + a stamped attribution trigger is the standing pattern — see any
      migration from this pass for the shape.)
- [ ] **Tier authority** — if this feature gates on `doctor_tier`, is the
      gate a floor (`tier_2+`) not a fence (`= 'tier_2'`)? See
      `packages/db/tests/tier_authority_monotonicity.sql`.
- [ ] **Safety failure mode** — what happens if this feature's data is
      missing, stale, or wrong? ("Silence is not assumed safe" is the
      standing default — see `private.flag_overdue_vitals()`.)

## Data/compliance features (§87.18)

- [ ] **Classification** — does this feature create or touch a new category
      of personal/health data? If so, is it represented in
      `table_classifications` (built, §87.2 — 20 rows live; see `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md`)?
- [ ] **Retention** — does this data type have a `data_retention_policies`
      row, and is it `founder_confirmed`? If not, flag it rather than
      assuming indefinite retention is fine.
- [ ] **Third-party sharing** — if this feature sends patient data to an
      external organisation (lab, HMO, AI vendor, etc.), is that logged via
      `private.log_care_access()` with a real `scope` value?
- [ ] **Consent** — does this feature require a consent context that doesn't
      exist yet in `consent_type`? Don't overload an existing context to
      avoid a migration.

## How this is enforced

Not by CI today — this is a checklist a reviewer (human or Claude) runs
through, not a blocking gate. If a future pass adds an automated check, it
should verify against this file, not duplicate its content elsewhere.
