# Major Clinical Incident Runbook

*Operational runbook, not a legal filing. Unlike the other four runbooks in this directory, this one is backed by a real, live, database-enforced workflow — `public.clinical_incident_reports` and `public.safeguarding_concerns` — built by a concurrent session on this project and, as of this writing, undocumented anywhere else. **Neither table has a dedicated app screen yet.** A report can currently only be filed, reviewed, or closed by direct database access (e.g. through Supabase, by someone with the right privileges) — there is no UI for a clinician to work this queue from the clinician console. That is a real, current gap, not an oversight in this document; see "After the incident" below.*

*This runbook is about logging and governing an incident that already happened (or a near-miss that almost did) — it is not the mechanism that gets a doctor to an at-risk patient right now. For a live, in-the-moment danger (an abnormal screening result, a dangerous vitals reading on a paid plan), the existing `clinician_alerts`/escalation pipeline and its SLA already handle that separately, per CLAUDE.md's Category 2→1 upgrade rule and the doctor contact SLA. File a report here in addition to — never instead of — making sure the live escalation has actually happened.*

## What counts as a reportable incident

Two distinct but related tables exist for two distinct purposes — file into whichever actually matches what happened:

**`clinical_incident_reports`** — any clinical safety event or near-miss, filed by any org staff member (including a Care Coordinator noticing something and flagging it — filing a report is explicitly not one of the three actions a Care Coordinator is barred from). The live `category` values are: `medication_error`, `misdiagnosis_risk`, `escalation_delay`, `communication_breakdown`, `ai_recommendation_error`, `protocol_deviation`, `documentation_error`, `wrong_patient`, `missed_referral`, `device_malfunction`, `duplicate_prescription`, `other`. Examples:
- A patient was given (or nearly given) a medication or dose intended for someone else.
- A protocol deviation — a Tier 1 clinician initiated a new medication (outside their authority per the Clinical Tier Ladder) rather than escalating to Tier 2.
- An AI-generated recommendation (case brief, coach, cv-risk escalation) was clinically wrong and a human caught it before or after it reached a patient.
- An escalation sat past its SLA window before a doctor made contact.
- **`near_miss` is a severity value, not something to downgrade into `low`** — no harm reaching the patient is exactly the signal a governance reviewer or an insurer wants preserved distinctly, per the migration's own design intent.

**`safeguarding_concerns`** — a narrower, more sensitive category, visible only to the reporter and to Tier 3+/Clinical Director reviewers (not all org staff, unlike incident reports — see Roles). The live `concern_category` values are: `child_safety`, `vulnerable_adult`, `abuse`, `neglect`, `exploitation`, `immediate_safety_risk`, `other`. **Filing one is not passive** — inserting a row automatically raises a `clinician_alerts` row (`level = 'urgent_escalation'`, `category = 'clinical'`, `type_code = 'safeguarding_concern'`) via `private.raise_clinician_alert`, which is how it surfaces immediately on the clinician worklist (`apps/web/src/app/(dashboard)/clinician/worklist.tsx`) even though the underlying `safeguarding_concerns` record itself has no dedicated screen.

**When in doubt, open a report.** A false alarm closed with "reviewed, no action needed" costs a reviewer a few minutes; a real incident never logged means the same failure mode recurs with no record anyone can learn from — and, for safeguarding, means a vulnerable patient's situation never reached anyone with the authority to act on it.

## Severity and detection clock

No statutory clock applies to the log itself — but a live safety concern always outruns the paperwork:

- If there's any possibility a patient is at immediate risk **right now**, treat that as a live escalation first (confirm a `clinician_alerts`/escalation exists and is being worked under its own SLA), and file the incident/safeguarding report in parallel, not after.
- `clinical_incident_reports.severity`: `near_miss`, `low`, `medium`, `high`, `critical`.
- `safeguarding_concerns` has no separate severity field — every safeguarding concern raises an `urgent_escalation`-level alert on filing, by design; severity triage happens through the review step (Tier 3+/Director), not a self-reported field.

## Roles

- **Whoever notices first** (any employee, contractor, partner, or patient report) — escalates immediately by filing a report (or, for a live safeguarding concern, first making sure a person with authority actually knows, then filing). Do not sit on it to "confirm first."
- **Any org staff member** — may file a `clinical_incident_reports` row and add detail to an open one. This includes Care Coordinators.
- **Tier 3+ clinician or Clinical Director** — the only roles that can move a `clinical_incident_reports` row into `under_review`/`action_planned`/`closed`, or a `safeguarding_concerns` row into `under_review`/`closed`. This is enforced server-side by trigger (`private.enforce_clinical_incident_report_attribution`, `private.enforce_safeguarding_concern_attribution`), not just a UI convention — a Care Coordinator or Tier 1/2 clinician attempting it is rejected at the database. Matches the existing Tier 3 "standing QA/spot-audit" responsibility from the Clinical Tier Ladder.
- **Patient Safety / Governance Lead** [to be appointed/confirmed — no one currently holds a standing responsibility for mining `root_cause_category` across *closed* incidents for platform-wide patterns; today each incident is reviewed on its own by whichever Tier 3+ clinician closes it, but nothing yet looks across the set the way the migration's own stated purpose ("feeding governance review") intends].
- **Founder / engineering** — builds or fixes whatever the corrective action requires when it's a platform change (a code fix, an RLS tightening, a new guardrail), and is currently the only path to actually working this queue at all, since no clinician-console UI exists yet (see below).
- **Outside counsel** — not routinely involved, but should be looped in for anything that could carry indemnity or MDCN-registration exposure (a `misdiagnosis_risk`/`medication_error` incident involving a named clinician) or that turns into a safeguarding matter with a legal reporting obligation outside NDPA (e.g. child safety) — best-effort, non-blocking; don't wait on counsel to file or review a report.

## The four stages (matches each table's `status` field)

### 1. Report / detect
Anyone files a row. The database enforces the honesty of this stage regardless of what the UI (once built) shows: `reported_by`/`reported_at` are stamped server-side from the authenticated session, never client-supplied, and a brand-new row is always forced to `status = 'open'` with every review/closure field null — a filer cannot self-review or backdate a closure. For `clinical_incident_reports`, capture `category`, `severity`, `description`, `immediate_action_taken`, and `contributing_factors` if known. For `safeguarding_concerns`, capture `concern_category` and `description` — filing it alone already raises the urgent clinician alert, so the reporter's job at this stage is just to get an honest, complete description down, not to also separately notify someone.

### 2. Contain + review (`under_review` / `action_planned`)
A Tier 3+ clinician or the Clinical Director picks it up. Moving a row out of `open` is itself gated by the trigger to that authority level — attempting it as anyone else fails at the database, not just the UI. `reviewed_by_staff`/`reviewed_by_tier`/`reviewed_at` are stamped server-side from the reviewer's own `clinical_staff` record at the moment of the transition, so the record of who reviewed something can't be misattributed. `clinical_incident_reports` has an extra `action_planned` state between review and close that `safeguarding_concerns` doesn't — use it when a corrective action is agreed but not yet done.

### 3. Outcome + corrective action
Before a `clinical_incident_reports` row can move to `closed`, the database requires **both** a non-empty `review_outcome` and a non-empty `corrective_action` — there is no way to close one with "reviewed, nothing to say." `safeguarding_concerns` only requires a non-empty `review_outcome` to close (a `corrective_action` is optional there) — reflecting that some safeguarding concerns resolve with "assessed, no further action needed" rather than always producing a structural change.

### 4. Close
Once outcome (and, for incident reports, corrective action) is recorded, the reviewer closes it — `closed_by_staff`/`closed_at` are stamped the same server-side way. **A closed report is terminal**: the trigger rejects any further edit to a closed row outright ("File a new report if something new needs recording"). Neither table has a DELETE policy or even raw DELETE privilege at the grant level — a filed report, once it exists, is retained permanently, the same discipline as `data_breach_incidents`.

## After the incident
Every closed report on a genuinely structural cause should produce a concrete follow-up — a migration, a test, a protocol change — not just a closing note, matching the discipline CLAUDE.md already expects of RLS findings. Beyond any single incident, the standing gap worth raising explicitly: **there is currently no clinician-console screen for either table** — filing, reviewing, and closing all happen through direct database access. Building that screen (a queue view scoped by `status`, gated the same way the triggers already gate write access) is the natural next piece of this work, not something this runbook can substitute for indefinitely.

## Contact
Questions about this runbook: the founder, or the Clinical Director for anything requiring clinical-authority judgment.
