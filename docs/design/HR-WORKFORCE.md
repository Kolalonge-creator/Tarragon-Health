# HR and Workforce dashboard: gap map and build plan

Status: decisions HR-01 to HR-04 taken 2026-11-07 (see `docs/DECISIONS.md`); Phase A in build.
Source: the "HR and Workforce Management Dashboard" spec pasted by the founder on 2026-11-07.
Branch checked: `origin/main-dev` at the time of writing, plus the live project `koiplnmbgnqnbywhpjlf`.

## 1. The size of the problem today

Live staff accounts on 2026-11-07: 4 clinicians (2 CMO rows, 2 senior medical officers), 2 admins, 1 analyst,
1 finance. About nine people, and the founder holds several of the roles. The spec itself says not to build
enterprise HR machinery with no immediate use. This plan builds the record and the compliance view first and
leaves recruitment pipelines, workforce planning and analytics until there is a workforce to plan.

## 2. What already exists (reuse, never duplicate)

| Spec area | Already authoritative | Where |
|---|---|---|
| Platform identity, role, suspension | `profiles.role`, `profiles.is_active`, `set_member_role`, `set_member_active` | `admin/settings/members` |
| Fine-grained permissions | `custom_roles`, `permissions`, `role_permissions`, `user_permission_grants` | 20260718230000 |
| Clinician record | `clinical_staff` (tier, employment_type, licence, indemnity, status) | `admin/settings/clinical-staff` |
| Clinician credentialing | `clinician_applications`, `clinician_documents`, `clinician_checks`, `credential_verifications`, `clinician_primary_source_verifications`, `credential_work_items`, expiry/recheck/re-verification sweeps, `private.clinician_is_eligible` | `admin/credentialing` (S15, S76, P5) |
| Clinician lifecycle | `suspend_clinician`, `offboard_clinician`, `reinstate_clinician` | S15 |
| Onboarding training (clinicians) | `training_modules`, `training_progress` (keyed to an application), competencies | S15 |
| Rota and on-call | `on_call_rota`, `rota_swaps`, `rota_cover_policy`, `availability_blocks`, gap sweeps, `on_call_cover_ok` | `admin/rota`, `clinician/team-rota` |
| Leave that affects routing | `provider_time_off` (`leave`/`blocked`), `private.clinician_on_leave` | clinician availability manager |
| Caseload and utilisation | `lib/staffing/caseload.ts` | `admin/staffing/caseload` |
| Access reviews | `staff_access_reviews`, items, weekly reminder | `admin/staff-access-review` |
| MFA policy | `mfa_group_requirements` (all groups off, SEC-01) | `admin/settings/two-factor` |
| Contracted pay | `earnings_ledger`, `payouts`, `clinician_bank_accounts`, `clinician_tax_profiles` | `admin/payouts` |
| Private files | bucket pattern of `clinician-documents`, ClamAV scan (T2-08), `signStoragePaths` | |
| Audit | `audit_log` via `private.log_audit` in the same transaction | |

The ownership split in the spec maps cleanly: Superadmin is `admin/settings/members` plus MFA and access
review; Clinical Workforce Management is credentialing, `clinical_staff`, the rota and `clinician_is_eligible`.
HR must read those, never write them.

## 3. What does not exist (the real gap)

1. An employment record for anyone: job title, department, line manager, start date, contract end,
   contracted hours, employment history. Non-clinical staff have nothing beyond `profiles.role`.
2. Departments and reporting lines for Tarragon's own staff (the `employer_*` and `provider_org_*`
   department tables belong to customers and partners, not to us).
3. Mandatory training for active staff (data protection, confidentiality, safeguarding and so on),
   with renewal dates. S15 training is a one-off onboarding test tied to an application.
4. Credentials for non-clinical regulated staff (none today) and a single cross-staff compliance view.
5. Supervision and appraisal records.
6. Leave requests with approval. Today a clinician inserts `provider_time_off` directly, no approver.
7. HR documents for non-clinicians (contracts, job descriptions, policy acknowledgements).
8. An onboarding and offboarding checklist that spans HR, platform access and clinical readiness.
9. Payroll. Out of scope by design (no payroll subsystem; salaries stay outside the platform).

Found in passing, worth fixing whatever is decided here: credentialing uploads to `clinician-documents`
get a magic-byte check but are not run through the ClamAV scan.

## 4. Design rules for this module

- One person, one record: `staff_employment` keys on `profiles.id`. Clinician fields stay on
  `clinical_staff`; HR shows them read-only and links to credentialing.
- History, not overwrite: employment changes are append-only rows with an effective date; the current
  view is derived.
- HR never changes platform access. An employment event (start, leave, termination) creates an access
  request that an admin actions through the existing members page and RPCs. Termination never deletes.
- Leave has one source of truth for routing: an approved leave request writes the `provider_time_off`
  row (for clinicians) inside the same transaction. No second calendar, no second rota.
- Compliance is shown per item (Compliant, Due soon, Overdue, Pending verification, Not applicable),
  never as one blended score. Unverified is never shown as compliant.
- Sensitive fields (home address, emergency contact, national ID, sickness reason, disciplinary
  notes, supervision notes) live in a separate table with its own narrower policy. No salary or bank
  data in HR at all; bank and tax details stay in the existing S31 tables.
- No new master switch. The module is staff-only, so it needs no go-live guard (GATE-MODEL rule 1).
- No AI in Phase 1. Any later AI call goes through `runGovernedAi()` and the registry.
- Every page gets a nav entry so it is searchable (`admin-search.test.ts`).

## 5. Proposed build phases

| Phase | Scope | Size |
|---|---|---|
| A | `departments`, `staff_employment` (+ history), `staff_sensitive_details`; People directory, staff profile with tabs (Employment, Credentials read-only, Rota/leave read-only, Access read-only); HR overview with the attention panel built only from real data | 1 PR |
| B | Mandatory training catalogue by role, assignments, completions with certificate upload (scanned), renewal sweep; Compliance Centre combining training + existing clinician credential state | 1 PR |
| C | Leave requests with manager approval writing `provider_time_off`; staff self-service page; leave calendar | 1 PR |
| D | Onboarding/offboarding checklists with access-request hand-off to members; supervision and appraisal records | 1 PR |
| E | Org chart, workforce reports and CSV export, planning (only once headcount justifies it) | later |

## 6. Founder decisions needed

- HR-1 Where it lives: `/admin/people` inside `apps/web` now, or a new `apps/console` area.
- HR-2 Who runs HR: admins only for now, or a new `hr` account role.
- HR-3 Line managers: record `line_manager_id` and let managers approve their team's leave, or route
  every approval to admins until there are teams.
- HR-4 Sensitive data scope: which of home address, emergency contact, national ID, sickness reason
  to store at all.
- HR-5 Order of phases after A.

Answers are recorded in `docs/DECISIONS.md` once given. HR-1 to HR-4 were answered on 2026-11-07 (HR-01 to HR-04);
HR-5 (phase order after A) is still open.

## 7. Phase A as built (2026-11-07)

- Migration `20261107022335_hr_people_phase_a_employment_records.sql`: `staff_departments`, append-only
  `staff_employment_records` (one full snapshot per change; the record in force is the latest row whose date has arrived),
  `staff_sensitive_details` (no table access; audited RPC read, repeat reads by the same admin within 10 minutes logged
  once), `people_directory()`, `people_recent_activity()`. Proof: `packages/db/tests/hr_people_phase_a_employment_records.sql`.
- Pages: `/admin/people` (attention list, headline figures, composition, recent activity), `/admin/people/directory`,
  `/admin/people/[profileId]` (Employment, Personal details, Credentials read-only, Platform access read-only),
  `/admin/people/departments`.
- Clinician verification and clearance come from credentialing's own functions (`psv_satisfied`, `indemnity_required`,
  `clinician_is_eligible`), never from `clinical_staff.credential_verified_at` (legacy, and empty for grandfathered doctors).
- Line managers do not read employment rows, because a suspension or leaving row carries a note that may be disciplinary.
  Phase C gives a manager a narrow function that returns only what leave approval needs (HR-03).
- Warning windows live in the registry (`hr.attention_windows`: licence 90, indemnity 60, contract 60 days).
- Not in Phase A: staff self-service (viewing their own record, editing their own contact and address; the database
  already allows both), training, leave, supervision, onboarding checklists, reports and export.

Found in passing: credentialing uploads to `clinician-documents` were not run through the ClamAV scan. Fixed in a
separate PR (#1823).

## 8. Phase B as built (2026-11-07): training

- Migration `20261107035358_hr_people_phase_b_training.sql`: `staff_training_courses` (mandatory or professional, optional
  renewal period), `staff_training_requirements` (everyone, a role or a department; due a set number of days after the later
  of the person's start date and the day the rule was added; removed rules are kept), `staff_training_completions`
  (never edited or deleted, voided with a reason; counts only once verified by an admin who is not the person), and
  `people_training_records()`. Proof: `packages/db/tests/hr_people_phase_b_training.sql`.
- Status per person and course (`lib/people/training.ts`): Compliant, Due soon (30 days before renewal, or not yet done
  and not yet due), Overdue, Pending verification. An unverified completion is never compliant. Headline figure is a
  plain "x of y mandatory requirements met", never a blended score.
- Pages: `/admin/people/training` (figures, who has done what, requirements, catalogue), a Training tab on each profile
  (required courses, record a completion, history with verify and void), a Training column in the directory, and overdue or
  unverified training in the overview's attention list.
- Nothing is seeded: which courses are mandatory, and for whom, is entered on the page.
- Not in Phase B: certificate file upload (a new storage path that must go through the malware scan), staff recording their
  own training, reminders before a course is due.

## 9. Phase C as built (2026-11-07): leave

- Migration `20261107071754_hr_people_phase_c_leave.sql`: `staff_leave_requests` (never edited directly or deleted; changed
  only by the leave functions) and `staff_leave_sickness_reasons` (no table access). Proof:
  `packages/db/tests/hr_people_phase_c_leave.sql`.
- Who decides (HR-03): the current line manager, told in-app; with no manager, every active admin is told. An admin may
  decide any request. Nobody decides their own. Declining needs a reason.
- One routing system: approving a clinician's leave writes the existing `provider_time_off` row ('leave') in the same
  transaction. That insert cancels their booked appointments in the period (`private.cascade_provider_time_off`), so the
  approver is shown the count first and must confirm the same number; if bookings changed, approval is refused. The row's
  reason is NULL, so the patient's notice reads the neutral default and never the leave type. Cancelling approved leave
  before it starts removes the row (already-cancelled appointments stay cancelled).
- Sickness reason (HR-04): only the person and admins (an admin's read is audited); the manager sees only "Sick leave".
- Pages: `/account/leave` for every staff member (ask, follow, withdraw or cancel; and decide, for line managers),
  `/admin/people/leave` (waiting, away in the next eight weeks, every request, sickness reason on demand), the overview
  figure and attention items, in-app notifications on request and on decision.
- Not in Phase C: balances and entitlements, a public-holiday calendar (days are Monday to Friday), half days, and the
  existing direct "time off" entry clinicians use in the availability manager, which still bypasses approval.
