# Care Circle expansion: Phase 0 audit and implementation plan

**Date:** 2026-11-04
**Status:** Audit complete. Founder decisions D1, D2, D3 and D-help taken 2026-11-04 (section 10). Phase 1 built on branch
`feat/care-circle-phase1-foundation` (see section 13); not yet applied to production.
**Checked against:** `main-dev` at `637cadd0b` (0 commits behind `origin/main-dev`), the live database `koiplnmbgnqnbywhpjlf` (read-only queries), and the merged PRs #1669 and #1670.
**Brief:** "Care Circle: Product Expansion and Implementation Specification" (founder, 2026-11-04). Section numbers below as "spec §N" refer to it.

---

## 1. Summary

Care Circle is much further along than the spec assumes. Most of the "foundation" is built, tested in CI and live, and the right architecture is already in place:

- **One gate.** Every supporter read goes through `private.circle_member_for(patient, permission)`. It checks the signed-in supporter, an active, unexpired membership, an adult patient, the permission, and the pause rule.
- **Permissions are per supporter.** They are stored as a `text[]` on each `care_circle_members` row, validated by `private.circle_permissions_valid`. The spec's "daughter sees appointments, son does not" already works.
- **No second clinical record.** Supporters have no direct SELECT on any clinical table. Every block is computed from the source tables at read time by SECURITY DEFINER functions.
- **Payment grants nothing.** Paying for a gift Membership grants no read access. Access comes only from the patient's own tap.

**Live usage is zero.** Production holds 0 members, 0 invites, 0 tasks, 0 check-ins and 0 family doctor notes. Every schema change in this plan is therefore structural. No data conversion is needed and no existing supporter can be affected.

The work splits into three kinds:

1. **Fix real gaps the audit found** (section 5). Three places ignore the patient's sharing consent, and the help alert ignores the alerts pause. These come first.
2. **Finish and switch on what is built but off.** Digest, tasks, missed-dose nudge and check-in window all exist as switched-off modules.
3. **Build what is genuinely new:** investigation tracking, weight trend, care-plan progress, a person selector, sponsorship status for the payer, roles and timeline.

---

## 2. Current architecture

```
Patient record (vitals_readings, medication_logs, appointments, lab_orders, lab_results, care_tasks, ...)
        |
        |  read at request time, never copied
        v
private.circle_member_for()  -- the one gate: auth, active, unexpired, adult, permission, pause
private.consent_in_force()   -- S42 consent: vitals x care_circle_sharing  (NOT applied everywhere, see 5.1)
        |
        v
SECURITY DEFINER readers: circle_supporter_view -> circle_view_blocks (core + monthly + doctor note)
                          circle_weekly_digest, circle_help_alert_view, circle_tasks, ...
        |
        v
/patient/supporting (web)  +  circle-supporting-section (mobile)
        |
care_access_events  <- private.log_care_access  (the patient's "who looked" list)
```

### 2.1 Tables (all in `public`)

| Table | Role |
|---|---|
| `care_circle_members` | The relationship: `permissions text[]`, `state` (active, revoked, expired), `expires_at`, `alert_mode`, `monthly_report_shared`, `missed_dose_alert` |
| `care_circle_invites` | Invite with an HMAC-hashed contact, token hash, 72-hour TTL, max 5 attempts |
| `care_circle_pauses` | One row per patient. Pauses everyone; `pause_alerts` also pauses alerts |
| `care_circle_config`, `care_circle_tools_config`, `care_circle_help_alert_config` | Versioned rules (v4, v1, v1 active) |
| `care_circle_tasks` | Practical tasks: fixed kinds, a date, claim, complete. No free text. Module OFF |
| `care_circle_check_ins`, `care_circle_alert_acks`, `care_circle_help_alerts`, `care_circle_location_consents` | Check-in and help alert |
| `care_circle_missed_dose_alerts`, `supporter_missed_dose_notices` | Nudge records |
| `family_doctor_notes` | Doctor's family line (280 characters), released by the patient |
| `care_circle_gift_payer_dismissals` | "Not now" on sharing with a gift payer |
| `encounter_caregiver_passes` | A supporter invited into one consultation |

### 2.2 Permission keys today

`adherence_summary`, `weekly_bp_trend`, `appointments`, `red_alerts`, `pay_for_care`, `attend_consultation`, `doctor_note`. In addition, `monthly_report_shared` and `missed_dose_alert` are flags on the row.

The presets "Can see" and "Can see and help" exist on screen only (`packages/shared/src/care-circle-presets.ts`).

### 2.3 Switches (live state, 2026-11-04)

| Switch | Kind | Live |
|---|---|---|
| `care_circle_help_alert_enabled` | go-live guard (feature) | **ON** |
| `supporter_todays_doses` | go-live guard (feature) | ON |
| `care_circle_digest` | platform module | OFF |
| `care_circle_tasks` | platform module | OFF |
| `care_circle_missed_dose_alert` | platform module | OFF |
| `care_circle_checkin_window` | platform module | OFF |
| `care_circle_concierge` | platform module | OFF (no code behind it) |
| `public_signup_enabled` | master | ON |

Cron jobs that are live and running: `care-circle-expiry`, `care-circle-gift-expiry`, `care-circle-checkin-sweep` (every minute), `care-circle-missed-dose-sweep` (every 5 min), `care-circle-tasks-sweep`, and `care-circle-digest-weekly` (Monday 07:00 Lagos). Each one exits immediately while its module is off.

**Note:** the spec calls the digest monthly. The built digest is **weekly**, and the monthly summary is a separate, already-live block (`circle_monthly_block`).

---

## 3. Feature status against the spec

| Spec item | Status | Where |
|---|---|---|
| Patient invites, supporter-only account, token join (§3.1-3.2) | **Live** | #1669; `receives_care=false` marks supporter-only |
| Supporter dashboard (§3.3) | **Live**, but a stacked list of cards with no person selector | `/patient/supporting`, `/patient/supporting/circle/[patientId]` |
| Item-level permissions, pause, remove, expiry, renew (§6.3) | **Live** | Permission history is lossy (5.4) |
| Weekly BP trend, adherence, appointments, monthly summary (§3.4) | **Live** | Monthly block skips consent (5.1) |
| Check-in request on a red event (§3.4) | **Live** | Template has no content |
| One-tap help alert | **Live** (guard ON) | Ignores alerts pause (5.2) |
| Access log for the patient (§16.4) | **Live**, last 30 rows | Gaps in 5.4 |
| Gift Membership with patient acceptance (§12.1) | **Live** | Payer sees only a state word |
| Doctor's family note, patient release (§9) | **Live (built 2026-11-04)** | No "note waiting" notice to the patient; no per-recipient choice; release not logged |
| Caregiver joins an authorised consultation | **Built** | Needs the Meeting SDK path |
| Weekly digest (§10) | **Built, OFF** | Skips consent (5.1) |
| Practical tasks, close to "support requests" (§8) | **Built, OFF** | Fixed kinds, claimable, no per-recipient list, no "can't help" |
| Missed-dose nudge (§14.1) | **Built, OFF** | Patient opt-in per supporter; skips consent (5.1) |
| Check-in window (§14.2) | **Built, OFF** | OQ-700 waits on the CMO |
| Multi-patient selector (§5.1) | **Missing** | |
| Investigation tracking (§7) | **Missing** on the Care Circle path | Sources exist (section 6) |
| Weight trend (§6.2A) | **Missing** | Easy copy of the BP block |
| Care plan progress (§6.2C) | **Missing** | `care_tasks` and `screening_schedules` are the sources |
| Timeline (§11) | **Missing** | |
| Family roles, primary and backup contact (§13) | **Missing** | Presets are the stand-in |
| Sponsorship status view for the payer (§12.2) | **Partial** | Patient copy promises payer-visible gift state, but no supporter screen shows it |
| Multiple sponsors splitting one Membership (§12.3) | **Missing**, and should stay so for now (section 10) | |
| Mobile | **Substantial**: patient and supporter screens, same RPCs | Billing and booking for others open web |

---

## 4. PR #1669 and #1670: what is still outstanding

Both PRs merged on 2026-11-04 and are applied live. Open items:

1. **CMO/DPO copy review.** This covers 53 `supporterjoin.*`, 19 `giftshare.*` and 32 `familynote.*` strings, `cctools.preview.sees.doctor_note`, and the `circle_shared_with_you` template.
2. **Data registry.** `family_doctor_notes` and `care_circle_gift_payer_dismissals` are registered with `reviewed=false`.
3. **Payer's first name.** Showing it is a change from S29, which only said "someone has paid". It needs a decision.
4. **Never run end to end.** Nobody has run the email-confirm round trip, phone sign-up or the mobile screens in a browser or on a device.
5. **Invite-only loophole.** "Join as a patient too" lets a supporter become a patient without a sign-up invite. **It is moot today, because `public_signup_enabled` is ON**, so anyone may sign up as a patient anyway. It only matters if sign-up closes again.
6. **Hard-coded English.** `CheckInCard locale="en"`, the invite landing page, and the `supported-people.tsx` text are not localised. The platform is English-only by decision, so this is low priority.

---

## 5. Security and privacy findings (verified against live function bodies)

These are the release-critical items. All of them are present in production today. With zero members, no one has been exposed yet.

### 5.1 Patient consent is ignored in three places (HIGH)

The S42 consent `vitals × care_circle_sharing` is checked in `private.circle_view_blocks_core` only.

Three functions never call `private.consent_in_force` (confirmed live):

- `private.circle_monthly_block`
- `public.circle_weekly_digest`
- `private.sweep_circle_missed_doses`

So after a patient withdraws that consent, monthly BP and adherence averages, digest counts and missed-dose nudges still reach supporters.

**Fix:** move the consent check into one helper that every block calls. Add a proof that withdraws consent and asserts that each reader returns nothing, with a sabotage step that removes the check and confirms the proof fails.

### 5.2 The help alert ignores the alerts pause (HIGH, live because the guard is ON)

`send_circle_help_alert` has no `circle_alerts_paused` check (confirmed live). A patient who paused alerts still has push and email sent to supporters. The supporter then cannot open the alert, because the view does honour the pause.

**Fix:** respect the pause, or tell the patient on the button that their circle is paused, which they may want. **This needs a small product call:** a patient tapping "help" while paused is probably asking for help on purpose. My recommendation is to send the alert anyway and show "Your circle is paused; this will still reach them" before sending.

### 5.3 A removed supporter can read their own revoked row (MEDIUM)

The RLS policy `care_circle_members_own` lets the supporter SELECT their row in any state, including `revoked_by` (the patient), `revoked_at` and the patient's flags. This contradicts the S29 rule that "the supporter is told nothing".

**Fix:** narrow the policy so the supporter can see their row only while `state='active'`, or move the supporter's own reads to an RPC.

### 5.4 Audit trail gaps (MEDIUM)

- `log_care_access` drops repeats of the same (patient, actor, kind, scope) within an hour. Two permission changes in one hour keep only the first.
- Changes made by the patient are recorded with the supporter as `actor_profile_id`.
- Five actions write no `care_access_events` row:
  - revokes by bereavement
  - revokes by account closure
  - revokes by handover
  - revokes by the minor sweep
  - `set_family_note_shared` (releasing a note to family is a disclosure)
- `log_care_access` fails open: a failed log never blocks the read.

**Fix:**
- Add a `care_circle_permission_history` table (append-only, one row per change, true actor). This is the spec's "permission history" (§6.3), and it is the one new table the foundation needs.
- Log note release and all revoke paths.
- Exempt `permission_changed` from the one-hour dedup.

### 5.5 Supporter list readers skip parts of the gate (LOW)

`circle_open_alerts`, `circle_unanswered_check_ins` and `circle_recent_nudges` have no minor check and no supporter `is_active` check. **Fix:** route them through `circle_member_for`.

### 5.6 Gift-payer share creates membership without the payer accepting (LOW, product)

`share_circle_with_gift_payer` creates a membership with no acceptance from the payer. The patient did choose this, but every other route into a circle is opt-in for the supporter. See decision D3.

### 5.7 Two parallel family-access systems (ARCHITECTURAL)

The older `profile_access` / sponsorship path (`/patient/supporting` → `SupportedPeople`, `useSupportedPersonHealth`) gives grantees **direct RLS SELECT** on clinical tables, including mental-health tables via S56. Those reads are not logged as Care Circle reads, ignore Care Circle pause and permissions, and S56 even calls these grantees "Care Circle supporters".

The spec forbids a duplicate permission system. **Recommendation:**

- **Do not merge the two in this expansion.** `profile_access` is the act-for and proxy model for dependants and adults who cannot manage their own care. It has a different legal basis.
- Draw a hard line: **Care Circle is the family-abroad product**, and `profile_access` is proxy care.
- Stop marketing and labelling `profile_access` as Care Circle, and fix the S56 wording.
- Show each person on the supporter page under exactly one heading.

This stays a documented boundary, not a migration.

### 5.8 Sensitive categories

- Doctor notes rely on the patient seeing every note before release, which is a reasonable control.
- The appointments block shows the time of the next appointment whatever its type. That would reveal, for example, a sexual-health appointment.
- **Fix:** exclude appointments linked to a sensitive service, or to `reproductive_health` / `mental_health` categories, from the appointments block. The same filter is reused in investigation tracking (section 6).

### 5.9 Notifications

All 16 Care Circle templates were checked. **None leaks clinical content.** Subjects, push text and SMS are generic, and links point only to `/patient/supporting` or `/patient/care-circle`. Keep it this way: new templates in this plan follow the same `circleUpdateTemplate` pattern.

---

## 6. Investigation tracking: the design (spec §7)

### 6.1 Source of truth

There is no single status function today. The closest is `public.my_screening_requests(p_patient)`. It returns status only (`order_status`, `upload_count`, `doctor_reviewed`), already lets a caregiver with `view_results` read it, and **already hides sensitive screen types from anyone who is not the patient**.

The plan is one status projection, `private.investigation_status(p_patient)`, that both the patient dashboard and Care Circle read. It needs no new table. Stages come from:

| Stage | Source |
|---|---|
| Recommended | `screening_schedules` pending or overdue, no order |
| Requested | `lab_orders` row exists |
| Booked, sample taken | `lab_orders.status` |
| Awaiting result | Order with no upload and no result |
| Result received | Live `lab_result_documents` row or `lab_results` row |
| Read by computer, not yet checked | `lab_report_extractions.status = 'extracted'` |
| Awaiting doctor review | `lab_results.release_state` in `awaiting_review`, `clinician_disclosure_required` |
| Doctor reviewed | `lab_results.reviewed_at` / `released`, or `lab_result_documents.reviewed_at` |
| Follow-up needed | `acknowledgement_status = 'action_required'`, or an open `diagnostic_episode` |
| Done | `action_completed`, or schedule `completed` |

Imaging uses `diagnostic_requests.status`, which already maps one to one.

Since T2-07 (today), `lab_results` is the single result engine for every source, so "doctor reviewed" has one meaning everywhere. A failed extraction, or a computer-read report with no doctor review, can never show as reviewed. Those states come from columns that only a clinician action sets.

### 6.2 Supporter view

- A new permission, `investigation_status`, shows names and stages only. **Never values.**
- Gated by the gate plus a consent check like the vitals one (a new S42 data class, or reuse `labs_results`).

### 6.3 The sensitivity problem, and its fix

Sensitivity today is per **bundle**: `private.lab_order_is_sensitive`, via `screen_types.sensitive`, covers 15 codes including HIV, hepatitis B and C, syphilis, PSA, cervical and mammography. Because the yearly `annual_health_check` bundle contains HIV and hepatitis tests, **filtering whole orders would hide the entire yearly panel from family.**

The supporter projection must therefore work **per test** (`lab_order_test_status`, keyed by test code):

- Show "Kidney function: done" and "HbA1c: awaiting result".
- Silently omit the sensitive tests, so the family sees no gap where they would have been.
- Drop any result with `release_state = 'clinician_disclosure_required'` or a `sensitive_positive` item.

**Two gaps to close** (needs CMO input, decision D5):

- Pregnancy (hCG) tests are not flagged sensitive.
- Syphilis and chlamydia/gonorrhoea are flagged sensitive but not mapped to `reproductive_health`.

### 6.4 Values

The founder decided (D2) that family may see actual values behind a separate permission. Only doctor-reviewed, released, non-sensitive results qualify, shown in plain words and next to the doctor's family note. The full rules are in section 10.

---

## 7. Phased implementation plan

The order follows the founder's priority: security foundation, then the family dashboard and investigation tracking.

Each phase gets:
- its own worktree and PR into `main-dev`;
- DB proofs in `packages/db/tests/`, registered in `ci.manifest`, each with a sabotage step;
- Jest and a11y tests next to the components;
- `/code-review high`, or `/code-review ultra` where the brief requires it for RLS on patient-scoped data;
- migrations applied with pinned versions after CI passes.

No switch is turned on by a merge. The founder switches features on from `/admin/go-live`.

### Phase 1: secure and finish the foundation (P0)

| # | Work | Kind |
|---|---|---|
| 1.1 | One consent helper applied to the monthly block, weekly digest and missed-dose sweep (5.1) | migration + proof |
| 1.2 | Help alert respects the pause, or warns (5.2, per D-help) | migration + UI + proof |
| 1.3 | Supporter sees own member row only while active (5.3) | RLS migration + proof |
| 1.4 | `care_circle_permission_history` table plus true actor; log note release and all revoke paths; exempt permission changes from the dedup (5.4) | migration + proof + registry |
| 1.5 | Route alert, check-in and nudge list readers through the gate (5.5) | migration + proof |
| 1.6 | Appointments block omits sensitive appointments (5.8) | migration + proof |
| 1.7 | "A note from your doctor is waiting" notice to the patient (in-app and push, no content) | migration + template + edge redeploy |
| 1.8 | Data-registry entries for `family_doctor_notes` and `care_circle_gift_payer_dismissals`, filled in per spec §18.2, set `reviewed` after founder (DPO) review | migration |
| 1.9 | Digest made ready to switch on: add consent, fix the dedupe source, proofs for revoked, paused, cross-patient and duplicate-week cases. Then the founder switches the module on | migration + proof |
| 1.10 | Missed-dose nudge and check-in window: implement whatever D1 decides, otherwise leave off | config only |
| 1.11 | One end-to-end browser run of invite, join, permissions, view, pause, revoke and note release on the local stack, plus a cross-patient isolation pass | verification |
| 1.12 | Copy review pack for the founder (CMO/DPO): every new and pending string in one document | doc |
| 1.13 | Gift-payer share becomes an invite the payer accepts (D3) | migration + UI + proof |

**Not in Phase 1:**
- Push reliability on iPhone. This is the separate stale-VAPID issue, with its own memory and PRs, and it waits on devices resubscribing.
- The sign-up loophole, which is moot while public sign-up is ON.

### Phase 2: family dashboard and investigation tracking (P0/P1)

| # | Work |
|---|---|
| 2.1 | **Person selector** on `/patient/supporting`: one person at a time, remembered per viewer, each person's data fetched separately by `patient_id` through the gate (no shared state between people) |
| 2.2 | **Overview card per person:** name, relationship, "shared until", last shared activity, paused or nothing-shared states. No profile image in v1, because it needs a new permission |
| 2.3 | `private.investigation_status` projection (6.1) plus permission `investigation_status` plus per-test sensitive filtering (6.3); the patient's own "My tests" reads the same projection |
| 2.3b | **Test values** behind the separate `investigation_values` permission (D2, rules in section 10) |
| 2.4 | **Weight trend** block, a copy of the BP weekly-average logic with permission `weekly_weight_trend` |
| 2.5 | **Care plan progress** block: `screening_schedules` due and done plus `care_tasks` with a programme template, permission `care_plan_progress`. Shows only items actually in the patient's plan. Uses template titles, never free-text task titles, which could name a condition |
| 2.6 | **Clear data states** on every block: recorded, nothing recorded (never shown as "normal"), awaiting review, follow-up needed |
| 2.7 | Patient side: the new permissions in the invite form, member row, preview and presets, plus "see what they'd see" |
| 2.8 | Mobile parity for 2.1 to 2.7 (ships with the next store release) |
| 2.9 | Empty states per spec §19.3 |

All of Phase 2 needs **one** migration set. New permissions are new text values in `circle_permissions_valid`, not new tables. **No existing member gains anything:** new permissions start unticked for everyone, and only the patient can tick them.

### Phase 3: support requests (P1)

Extend `care_circle_tasks`; do not create a new table. Add:

- a per-request recipient list
- the spec's categories, mapped onto the existing fixed kinds plus "please call me", "help with paying for a test", "help with medicines"
- an optional short note, which needs a decision because tasks are deliberately no-free-text (D4)
- the responses "can help", "can't help" and "done"
- statuses and expiry

Then the founder switches on `care_circle_tasks`.

### Phase 4: timeline and roles (P2)

- **Timeline:** a read-time union of the authorised blocks' events. No event table.
- **Roles:** a display label (viewer, helper, payer) derived from permissions, so it can never grant anything.
- **Primary and backup family contact:** two nullable flags on the member row, with no access attached.

### Phase 5: sponsorship and acquisition (P2)

- A supporter-side "Membership you paid for" panel: state, dates, renewal. It uses W19 `payer_sees_gift_state` facts and no clinical data.
- Sponsoring several people already works.
- Update the marketing copy only for features that are switched on.
- Analytics: counts from `care_circle_members`, invites, gifts and `care_access_events`, with no clinical data.
- **Split payments are assessed only:** no build until a reconciliation and refund model exists.

---

## 8. Migrations expected

| Phase | Migration (working names) |
|---|---|
| 1 | `care_circle_consent_everywhere`, `care_circle_help_alert_pause`, `care_circle_members_supporter_rls`, `care_circle_permission_history`, `care_circle_gate_list_readers`, `care_circle_appointments_sensitive_filter`, `family_note_waiting_notice`, `care_circle_registry_entries`, `care_circle_digest_ready` |
| 2 | `investigation_status_projection`, `care_circle_blocks_investigations_weight_plan` |
| 3 | `care_circle_tasks_recipients_and_responses` |
| 4 | `care_circle_contact_roles` |

Rules for every migration:

- Each one redefines functions from their **live** bodies (`pg_get_functiondef`), not from the branch's history. Concurrent sessions touch neighbouring functions.
- Check `list_migrations` live for anything unrecognised before applying.
- Never hand-type a round timestamp.

## 9. Files likely to change

- **Database:**
  - `supabase/migrations/` (new files only)
  - `packages/db/tests/` (new proofs plus `ci.manifest`)
- **Web:**
  - `apps/web/src/lib/care-circle/model.ts`
  - `apps/web/src/lib/queries/care-circle.ts`
  - `apps/web/src/app/(dashboard)/patient/care-circle/care-circle-manager.tsx`
  - `apps/web/src/app/(dashboard)/patient/supporting/` (`circle-supporting.tsx`, `page.tsx`, `circle/[patientId]/supporter-blocks.tsx`, `supporter-view.tsx`)
  - `apps/web/src/components/care-circle/`
- **Shared:**
  - `packages/shared/src/care-circle-presets.ts`
  - `packages/i18n` (`circle.*`, `cctools.*`)
  - `packages/shared/src/database.types.ts` (only our own keys spliced in)
- **Notifications:** `supabase/functions/send-pending-notifications/templates.ts` (one new template, then redeploy and byte-check)
- **Mobile:**
  - `apps/mobile/src/lib/care-circle/`
  - `apps/mobile/src/screens/sections/circle-supporting-section.tsx`, `supporter-blocks.tsx`, `care-circle-section.tsx`

## 10. Decisions

### Decided by the founder, 2026-11-04

| # | Decision | Effect on the plan |
|---|---|---|
| D1 | **Switch on the missed-dose nudge; keep the check-in window off.** | Phase 1.10. The founder switches on `care_circle_missed_dose_alert` after 1.1 (consent) lands. Each patient still opts in per supporter, max 3 a day. `care_circle_checkin_window` stays off; OQ-700 stays open. |
| D2 | **Family may see actual test values, behind a separate permission.** | Phase 2.3b (below). |
| D3 | **The gift payer must accept first.** | Phase 1.13: `share_circle_with_gift_payer` creates an invite to the payer instead of a membership. |
| D-help | **The help alert sends while paused, and warns the patient first.** | Phase 1.2. |

**How D2 is built (Phase 2.3b).** A permission `investigation_values`, separate from `investigation_status`, that the patient ticks per supporter. The design keeps the spec §24 boundary: family are not asked to interpret results on their own.

- Only results with `lab_results.release_state = 'released'` and `reviewed_at` set: results a doctor has reviewed and released to the patient. Nothing held, nothing awaiting review, nothing computer-read only.
- Never a sensitive test (per-test filter, 6.3), and never a result with a `sensitive_positive` item or `clinician_disclosure_required`.
- A value shows with its unit and the lab's reference range in plain words ("within the lab's usual range" / "outside the lab's usual range"). It does not show an abnormal flag in red or any Tarragon interpretation.
- Each value is shown next to the doctor's latest released family note, if there is one, and a fixed line: "Ask {name} or their care team what this means for them."
- Every values view is logged as its own `care_access_events` kind (`result_viewed`), so the patient sees exactly who looked at their numbers.
- The wording of that fixed line and the range phrases goes in the CMO copy pack (1.12).

### Still open, not blocking Phase 1

| # | Decision | Recommendation | Needed by |
|---|---|---|---|
| D4 | Support requests: allow a short free-text note? | Yes, 140 characters, written by the patient only, with the same "don't write medical details" hint as the doctor note | Phase 3 |
| D5 | Treat pregnancy tests as sensitive, and map STIs to reproductive health | Yes (CMO) | Phase 2.3 |
| D6 | Show the payer's first name to the patient | Yes. The patient is told who paid; it discloses nothing about the patient | Phase 1.12 |

## 11. Test plan

- **DB proofs (BEGIN/ROLLBACK, sabotage step):**
  - consent withdrawal blanks every reader
  - pause blocks every reader except pay
  - revoked and expired members are refused, including by old URLs, since the RPC rechecks
  - supporter A cannot read patient B
  - a supporter with two patients sees each only under its own id
  - payment grants nothing
  - sensitive tests are never in the supporter projection, while the yearly panel's other tests are
  - a computer-read report never shows as doctor reviewed
  - digest dedupe per week
  - permission history records every change with the true actor
- **Jest and a11y:** person selector isolation (a fetch is keyed by patient id; switching clears state), every empty state, the new permission toggles, and the data-state labels.
- **Browser end to end (local stack):** invite → join signed-out → patient ticks permissions → supporter views → patient pauses → supporter sees nothing → patient revokes → old URL refused.
- **Notification check:** every new template is rendered and asserted free of names, values and conditions.

## 12. What will not happen without a further explicit ask

- Merging `profile_access` into Care Circle.
- Split or contributed payments.
- Family-funded labs or consultations.
- Sharing any test value outside the D2 rules (unreviewed, held, or sensitive results).
- Any AI-written family summary. Doctor notes stay human-written. The AI governance rule applies if this is ever revisited.

---

## 13. Phase 1 build status (2026-11-04)

Built on `feat/care-circle-phase1-foundation`. Two migrations, one new proof, three proofs updated, web UI.

| # | Item | Status |
|---|---|---|
| 1.1 | Consent applied to the monthly block, the digest (read and send), the nudge (sweep and list) | Done: `private.circle_consented_permissions` |
| 1.2 | Help alert while paused (D-help) | Done: still sends; the supporter can now open it; the patient is warned before and told after |
| 1.3 | Supporter sees own member row only while active | Done: policy `care_circle_members_own` |
| 1.4 | Permission history with true actor | Done: `care_circle_permission_history`, written by triggers (every path, including sweeps and pauses) and by note release; patient reads it as "Changes to sharing". `log_care_access` left unchanged: its 1-hour de-duplication is fine for the "who looked" log now that history no longer depends on it |
| 1.5 | List readers through the gate's checks | Done: `circle_open_alerts`, `circle_unanswered_check_ins`, `circle_recent_nudges`, `send_circle_digests` |
| 1.6 | Sensitive appointments omitted | Done: therapy, laboratory and imaging appointments, and any reason/service in a confidential domain. Known limit: a specialist appointment with a blank reason is still shown |
| 1.7 | "A note from your care team is waiting" | Done: template `family_note_waiting`, only when someone holds `doctor_note`. **Edge function redeploy needed** after merge |
| 1.8 | Data registry | New table registered `reviewed=false`. The two #1669/#1670 tables stay `reviewed=false`: marking them reviewed is the founder's (DPO) judgement, never an agent's |
| 1.9 | Digest ready to switch on | Done: consent, real `source_table`, minor check. **Founder switches on `care_circle_digest`** |
| 1.10 | Missed-dose nudge (D1) | Code ready (consent applied). **Founder switches on `care_circle_missed_dose_alert`** after the migration is live; `care_circle_checkin_window` stays off |
| 1.11 | End-to-end run | DB proofs: all 604 pass on a clean replay. Browser run of the full invite/join/pause/revoke journey: not yet done |
| 1.12 | Copy pack | All new strings under `circlep1.` in `packages/i18n/src/family-circle-copy.ts`, marked pending CMO/DPO review |
| 1.13 | Payer accepts first (D3) | Done: share creates an `offered` row; payer answers on `/patient/supporting`; patient sees "Waiting for a reply" and can withdraw |

Not in Phase 1: mobile has no screen for the payer's accept/decline yet (the payer answers on web; the mobile gift-share wording is
updated through the shared copy). Push re-subscription on iPhone remains the separate VAPID issue.

### Code review (`/code-review high`, 2026-11-04) and fixes

Fixed before the PR:
- An open gift-payer offer could be accepted after the patient's account closed or they died (closure and bereavement end only active
  rows). `respond_to_circle_share_offer` now requires the patient active and `profile_status = 'active'`; proof 9g2.
- Widening an EXISTING member sent "asked you to join" copy, and the patient's screen said they "see nothing until they say yes" though
  they could see it at once. Own template `circle_share_widened`, and `GiftShareStep` branches on `offered`.
- The paused help-alert fallback could open an alert sent BEFORE the pause; now only an alert sent during the current pause. Proof C0.
- The history trigger could abort a revoke or sweep on an actor with no profile; the actor is looked up, null otherwise.
- A withdrawn offer and a lapsed offer were recorded as "access ended"; now `withdrawn` and `offer_lapsed`.
- The "note waiting" notice failure now raises an incident, not only a warning.

Not fixed here: payer accept/decline on mobile (web only for now); the inline copy of the gate in the help-alert fallback (reuse).

## 14. Phase 2 build status (2026-11-04)

Built on `feat/care-circle-phase2-dashboard` (stacked on Phase 1). One migration (`20261104181057_care_circle_p2_investigations_weight_plan.sql`),
one proof (`care_circle_p2_investigations.sql`, 24 checks, 3 sabotage), web blocks and a person switcher.

| # | Item | Status |
|---|---|---|
| 2.1 | Person selector | Done (web): a switcher at the top of each person's page when someone supports two or more people; each person is a separate page and a separate gated read |
| 2.2 | Overview card | Existing page header kept (name, relationship, shared until). Not extended |
| 2.3 | Investigation status | Done: `investigation_status`, one row per everyday test in the plan, stages due/overdue/requested/awaiting_result/result_received/awaiting_review/reviewed/done, follow-up flag, no values |
| 2.3b | Test values (D2) | Done: `investigation_values`, released AND reviewed results only, latest per analyte, 12 months, lab range and an in/out answer, "ask them or their care team" line |
| 2.4 | Weight trend | Done: `weekly_weight_trend`, weekly averages and a direction; follows the S42 vitals consent |
| 2.5 | Care plan progress | Done: `care_plan_progress`, counts of everyday yearly tests done / due / overdue and the next due date (screening schedules only; free-text care tasks and goals are deliberately not shown) |
| 2.6 | Data states | Each block says "nothing recorded" in its own words; a computer-read report never shows as reviewed |
| 2.7 | Patient-side ticks | The four permissions appear in the invite form, member row and preview automatically (they read the permission list) |
| 2.8 | Mobile | Partial: mobile knows the new permissions (ticks and labels) and no longer hides a person over an unknown permission; the four new blocks are shown on web only |
| 2.9 | Empty states | A page whose only shared item is a new block is not the empty state |

**Privacy design of 2.3/2.3b.** What family may see about a test is an allow-list (`private.circle_screen_shareable`), not a deny-list: 19
everyday tests. Sensitive tests, reproductive ones not flagged sensitive (antenatal booking, PCOS), tuberculosis and any future test are
hidden until added on purpose. Values are filtered again per analyte, and pregnancy hormone is always hidden (D5 recommendation applied
here). No S42 consent cell exists for test results x Care Circle; the per-supporter tick is the consent. Adding a cell is a DPO decision.

**Open:** D5 (pregnancy and STI sensitivity platform-wide), the allow-list itself (operational privacy setting, founder may adjust), mobile
blocks, CMO/DPO review of the `circlep2.` strings.

## 15. Phase 3 build status (2026-11-04)

Built on `feat/care-circle-phase3-help-requests`. One migration (`20261104190227_care_circle_p3_help_requests.sql`), one proof
(`care_circle_p3_help_requests.sql`, 27 checks, 3 sabotage), web panel changes. Extends the existing shared jobs (S69b) rather than adding
a second feature. **Still behind the `care_circle_tasks` module, which is OFF: the founder switches it on.**

Founder decisions 2026-11-04: **D4** a patient may add a note of up to 140 characters (patient only, never in a notification); **who
answers** a person the patient names may answer that request even if they only view.

| Spec 8 item | Status |
|---|---|
| Categories | appointment, lab, medicines, visit, phone call, errand (existing) + transport, help paying for a test, help paying for medicines, help with a consultation, something else (needs a note) |
| Recipients | The patient may tick people; an addressed request is seen, notified and answerable only by them (an unaddressed one behaves as before) |
| Answers | "I can help" (claims), "I can't help" (recorded), done; the patient sees each named person's answer by first name |
| Statuses | open, claimed (accepted), done, cancelled, expired (new: a passed date is no longer shown as cancelled) |
| Notifications | Only the chosen people; payload is the patient id only; the note never leaves the request |
| Audit | A supporter's look is logged when they saw at least one request (an empty list is no longer a "look") |
| Not an emergency route | Nothing here reads a page, triage or emergency event |

Also fixed: the weekly digest no longer counts requests addressed to someone else.

## 16. Phase 4 build status (2026-11-04)

Built on `feat/care-circle-phase4-timeline-contacts`. One migration (`20261104211059_care_circle_p4_timeline_contacts.sql`), one proof
(`care_circle_p4_timeline_contacts.sql`, 19 checks, 3 sabotage), web changes. New wording is under `circlep4.` in
`packages/i18n/src/care-circle-p4-copy.ts`, approved by the founder as CMO and DPO on 2026-11-04 (CC-COPY-P4).

| Spec item | Status |
|---|---|
| 11 Timeline | `circle_supporter_timeline`: last 90 days, read-time, from the same permissions as the blocks: doctor's note released, appointment attended/missed (never sensitive), everyday test requested/reviewed (allow-list), help request asked/done (only those the reader may see). Source on each event. No value or free text. Shown as "Recent activity" on the supporter page |
| 13 Roles | No new role field: the presets ("Can see", "Can see and help") are the labels; a role must never grant anything |
| 13.1 Main/backup contact | `contact_role` on the member, one of each per circle, set only by the patient (`set_circle_contact_role`), grants nothing, not the emergency contact; shown to that person; in the sharing history |
| Also | The shared-tasks module description updated; web no longer offers "Something else" to helpers (only the patient can write its note) |
