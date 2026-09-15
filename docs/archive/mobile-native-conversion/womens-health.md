# Women's Health — Native Conversion Scope

> Paste this entire file as your first message in a fresh Claude Code
> session in this repo. It is self-contained. Read
> `apps/mobile/src/lib/weight-management.ts` +
> `apps/mobile/src/screens/sections/weight-management-screen.tsx` first —
> they're the reference implementation for the pattern this doc assumes.
> Section id for this feature: `womensHealth`.
>
> **Read the "Reproductive-health safety notes" section below in full
> before writing any code.** This feature touches menstrual/pregnancy/
> fertility/contraception data, which has a documented history of real
> access-control mistakes in this codebase from copying a sibling table's
> RLS shape. This doc's job is to tell you exactly what to reuse — do not
> design any new access-control shape.

## Summary

"Women's Health" (`/patient/womens-health`, spec §44) is one destination
integrating prevention, reproductive health, pregnancy, postnatal care, and
long-term conditions for female patients. It gates on `profile.sex ===
"female"` (a friendly UI explanation, not a security check) and then,
driven entirely by two self-reported signals —
`reproductive_health_profiles.life_stage` and
`patient_pregnancy.is_pregnant` — shows only the cards relevant to the
patient's current life stage: cycle/life-stage summary + contraception
(menstruating), antenatal tracking + pregnancy red-flag checklist
(pregnant), postnatal check-ins (postpartum), fertility assessment request
(trying to conceive), menopause symptom tracking (peri/menopausal).
Breast-symptom reporting appears regardless of life stage. A closely
related but **separate route**, `/patient/cycle`, holds the actual
menstrual cycle tracker (calendar, daily symptom/mood/BBT logging, a pure
prediction engine for next-period/ovulation/fertile-window, and pattern
insights) — linked to from this page's cycle card, not embedded in it.
`/patient/cycle` is a large subsystem in its own right (~2,660 lines).
Everything here is explicitly non-diagnostic, never feeds risk/escalation
scoring (except two deterministic red-flag paths that reuse existing
emergency/alert machinery), and several tables carry a well-documented,
repeatedly-regressed RLS history that must be reused verbatim, not
re-derived.

## File inventory

### Women's Health page + cards
| File | Lines |
|---|---|
| `apps/web/src/app/(dashboard)/patient/(sections)/womens-health/page.tsx` | 267 |
| `apps/web/src/app/(dashboard)/patient/reproductive-health-card.tsx` | 179 |
| `apps/web/src/app/(dashboard)/patient/contraception-card.tsx` | 83 |
| `apps/web/src/app/(dashboard)/patient/antenatal-card.tsx` | 119 |
| `apps/web/src/app/(dashboard)/patient/pregnancy-red-flag-check.tsx` | 123 |
| `apps/web/src/app/(dashboard)/patient/postnatal-card.tsx` | 197 |
| `apps/web/src/app/(dashboard)/patient/breast-symptom-card.tsx` | 138 |
| `apps/web/src/app/(dashboard)/patient/menopause-symptom-card.tsx` | 139 |
| `apps/web/src/app/(dashboard)/patient/fertility-request-card.tsx` | 89 |
| `apps/web/src/app/(dashboard)/patient/womens-health-actions.ts` | 297 |

### Cycle tracker (separate route, linked to from the card above)
| File | Lines |
|---|---|
| `apps/web/src/app/(dashboard)/patient/(sections)/cycle/page.tsx` | 80 |
| `apps/web/src/app/(dashboard)/patient/cycle/cycle-tracker.tsx` | 472 |
| `apps/web/src/app/(dashboard)/patient/cycle/cycle-calendar.tsx` | 247 |
| `apps/web/src/app/(dashboard)/patient/cycle/cycle-ring.tsx` | 248 |
| `apps/web/src/app/(dashboard)/patient/cycle/cycle-day-log.tsx` | 283 |
| `apps/web/src/app/(dashboard)/patient/cycle/cycle-insights-card.tsx` | 116 |
| `apps/web/src/app/(dashboard)/patient/cycle/cycle-length-chart.tsx` | 104 |

### Shared lib
| File | Lines |
|---|---|
| `apps/web/src/lib/queries/reproductive-health.ts` | 61 |
| `apps/web/src/lib/queries/womens-health.ts` | 159 |
| `apps/web/src/lib/queries/menstrual-cycle.ts` | 332 |
| `apps/web/src/lib/rules/womens-health-intersections.ts` | 46 |
| `apps/web/src/lib/rules/gestational-age.ts` | 62 |
| `apps/web/src/lib/rules/cycle-nudges.ts` | 84 |
| `apps/web/src/lib/rules/cycle-prediction.ts` | 650 |
| `apps/web/src/lib/rules/cycle-insights.ts` | 208 |
| `apps/web/src/lib/rules/cycle-thermal-shift.ts` | 127 |
| `apps/web/src/lib/rules/cycle-reading.ts` | 122 |
| `apps/web/src/lib/validation/womens-health.ts` | 151 |

**Total: ~4,100 lines** across 21 files (life-stage cards: ~1,530 lines;
cycle tracker: ~2,660 lines). Large — treat "life-stage cards" and "cycle
tracker" as two separable work items even though they ship as one
`womensHealth` section.

### Explicitly NOT in scope
- `apps/web/src/app/(dashboard)/patient/sexual-health/*` (fertility
  assessment forms, `fertility-actions.ts`, male fertility assessment) —
  these back the **`sexualHealth`** SectionId, a separate scope doc.
- `apps/web/src/app/(dashboard)/patient/pregnancy-status.tsx`/
  `pregnancy-form.tsx`/`actions.ts::setPregnancyStatus` — rendered on the
  **Care** section page, not Women's Health, but writes the same
  `patient_pregnancy` table the Antenatal card reads. `care` is already a
  native mobile section; worth checking separately whether it already
  covers this pregnancy toggle (a quick check found it doesn't today) —
  flagging as a related, adjacent gap, not part of this scope.
- Clinician-side `womens-health-{actions.ts,panel.tsx}` — staff-only, out
  of scope.
- `lib/rules/sti-*` — separate STI module, part of `sexualHealth`.

## Data model

RLS shape key: **RLS-self-sufficient** = the policy's own `patient_id =
auth.uid()` branch fully covers the patient acting for themself (or a
caregiver they've delegated to, via `resolveSubjectId`/`acting.ts`), with
zero app-layer gating required beyond calling with the resolved subject id.

| Table / RPC | Purpose | R/W | Direct-client safe? | Access-control mechanism (current, live) |
|---|---|---|---|---|
| `reproductive_health_profiles` | life_stage, last_period_date, average_cycle_length_days, current_contraception_method | R+W | **Yes** for patient's own row | SELECT: `patient_id=auth.uid() OR is_org_staff() OR has_emergency_access(...,'reproductive_health') [always false] OR (can_read_clinical(patient_id,'reproductive_health') AND guardian_may_view_confidential_domain(patient_id, auth.uid(), 'sexual_reproductive_health'))`. INSERT/UPDATE: `patient_id=auth.uid() OR (profile_access_categories 'reproductive_health' grant AND permission_level='manage' AND guardian_may_edit_confidential_domain(patient_id))`. Final shape: `20260902213714` (SELECT) + `20260902222215` (INSERT/UPDATE) — three earlier versions were regressions, see safety notes. |
| `menstrual_cycles` | one row per observed bleeding episode | R+W+D | **Yes** for patient's own row | Identical SELECT shape (final fix `20260904235836`). Write: `patient_id=auth.uid() OR (profile_access_categories 'reproductive_health' grant AND permission_level='manage')` — **write side is NOT additionally gated by `guardian_may_edit_confidential_domain`, a documented open gap, irrelevant to a patient acting for themself.** |
| `menstrual_daily_logs` | one row/patient/day: flow, symptoms, moods, notes, BBT, ovulation test | R+W+D | **Yes** for patient's own row | Identical to `menstrual_cycles`. |
| `patient_pregnancy` | current pregnancy status snapshot | R+W | **Yes** | `patient_id=auth.uid() OR is_org_staff(organisation_id)` — no caregiver branch at all. |
| `antenatal_visits` | gestational-timeline checklist per visit | R+W | **Yes** | `patient_id=auth.uid() OR is_org_staff(organisation_id)` — deliberately no caregiver access ("stays as private as the pregnancy record it extends"). |
| `postnatal_profiles` | one row per delivery | R+W | **Yes** | Same as above, no caregiver branch. |
| `postnatal_checkins` | week1/6/month3/6/12 check-ins, links to `mental_health_screens` (EPDS) | R+W | **Yes** | Same as `postnatal_profiles`. |
| `breast_symptom_reports` | symptom report → triggers `clinician_review` alert | R + insert-only | **Yes** | `patient_id=auth.uid() OR is_org_staff()` for SELECT/INSERT; UPDATE staff-only. BEFORE INSERT trigger `private.handle_breast_symptom_report()` raises the alert server-side. |
| `menopause_symptom_logs` | symptom log; `postmenopausal_bleeding=true` → alert | R+W | **Yes** | `patient_id=auth.uid() OR is_org_staff()`. BEFORE INSERT trigger `private.handle_menopause_symptom_log()` raises `clinician_review` when true. |
| `fertility_assessment_requests` | patient logs an enquiry; status progressed by staff only | R + insert-only | **Yes** | INSERT `with check` forces `status='requested', appointment_id IS NULL, specialist_referral_id IS NULL` at the DB level. UPDATE staff-only. |
| `emergency_events` (insert, `source='pregnancy_symptom_checklist'`) | pregnancy red-flag report → existing emergency pipeline | insert-only | **Yes** | `patient_id=auth.uid()` (or `can_act_for(patient_id)`) — plain RLS insert, same mechanism web's `reportDangerSymptoms`/`reportPregnancyDangerSymptoms` use directly, no service role. `handle_emergency_event` trigger does all classification server-side. |
| `care_plans` (read active condition) | drives cross-condition caution copy | R | **Yes** | Ordinary org-scoped patient-owns-their-row RLS. |
| `appointments` (read next upcoming) | "next appointment" stat | R | **Yes** | Ordinary patient-owns-their-row RLS. |
| `profiles.sex` | gates the section (UI relevance only) | R | **Yes** | Not a security gate. |

## Recommended new API routes

**None required.** Every read and every patient-initiated write is either
RLS-self-sufficient, or a plain RLS-scoped insert whose clinical consequence
(an alert) is raised by a **database trigger**, not application code. There
is no service-role client anywhere in this feature, and no app-layer
consent/authorization logic sits in front of any table beyond RLS.

One nuance, not a gap: `cycle-prediction.ts`'s clinical flags (irregular
cycles, prolonged/heavy bleeding, amenorrhoea, postmenopausal bleeding) are
computed client-side from already-RLS-scoped data — precedented (same
pattern as `bp-classification.ts`, already ported to
`apps/mobile/src/lib/bp-classification.ts`) precisely because the file's
own header states cycle data "is never fed into risk or escalation
scoring... a separate, explicit output that a human reads." Safe to port as
a pure `.ts` file.

## Recommended mobile files

### Lib
- `apps/mobile/src/lib/womens-health.ts` — plain RLS-scoped reads/writes
  mirroring `queries/{reproductive-health,womens-health}.ts` and
  `womens-health-actions.ts`: `loadReproductiveHealthProfile`,
  `saveReproductiveHealthProfile`, `saveContraceptionMethod`,
  `loadPregnancy`, `setLastMenstrualPeriod`, `reportPregnancyDangerSigns`
  (insert into `emergency_events`), `loadAntenatalVisits`,
  `loadPostnatalProfiles`/`recordDelivery`, `loadPostnatalCheckins`/
  `logPostnatalCheckin`, `loadBreastSymptomReports`/
  `reportBreastSymptoms`, `loadMenopauseSymptomLogs`/
  `logMenopauseSymptoms`, `loadFertilityAssessmentRequests`/
  `requestFertilityAssessment`. Follow `QueryResult<T>`.
- `apps/mobile/src/lib/womens-health-intersections.ts` — direct port of
  `rules/womens-health-intersections.ts` (pure, trivial).
- `apps/mobile/src/lib/gestational-age.ts` — direct port (pure).
- **Cycle tracker (larger, can be a follow-up pass):**
  `apps/mobile/src/lib/menstrual-cycle.ts` (mirrors `queries/menstrual-cycle.ts`)
  + `cycle-prediction.ts` (verbatim pure-function port of the 650-line
  engine, same discipline as `bp-classification.ts`) + `cycle-insights.ts`
  + `cycle-thermal-shift.ts` + `cycle-reading.ts` (all pure, no DB).

### Screens
- `apps/mobile/src/screens/sections/womens-health-screen.tsx` — top-level:
  reads `profiles.sex`, then `reproductive_health_profiles` +
  `patient_pregnancy` + `care_plans` + next `appointments`, conditionally
  renders sub-sections matching web's `showContraception`/`showFertility`/
  `showMenopause`/`showPostnatal`/always-`BreastSymptomCard` logic. Do not
  collapse a failed read into "not pregnant"/"not tracked" — an errored
  read is not an absence, same discipline as web's comments.
- Sub-components mirroring the web card boundaries (life-stage +
  contraception editor, antenatal + red-flag checklist, postnatal
  delivery/check-in log, breast symptom reporter, menopause symptom logger,
  fertility request card).
- **Cycle tracker screen** (separate, larger effort):
  `apps/mobile/src/screens/sections/cycle-screen.tsx`, reachable from the
  Women's Health screen's "Open your cycle tracker" card, mirroring
  `/patient/cycle`'s own separate-route treatment. Either add a dedicated
  `SectionId` or nest it as internal navigation state (matching how
  `devices` nests `openDevice`/`SyncScreen` in `home-shell.tsx`).

## Wiring

1. `sections.ts`: remove `webviewPath: "/patient/womens-health"`.
2. `home-shell.tsx`: replace the `WebViewHubScreen` block for
   `womensHealth` with `<WomensHealthScreen patientId={subjectId}
   organisationId={organisationId} onNavigate={handleSelect} />`, using the
   same `subjectId`/`organisationId` already computed for `vitals`/
   `medications`/`prevention`.
3. `sexualHealth` stays untouched (separate scope doc) — don't remove its
   `webviewPath` here.

## Reproductive-health safety notes

**This is the most important section of this document. Do not write or
design any new access-control shape for these tables — the existing RLS is
the intended reuse target, and it is already correct for the one thing
mobile needs (a patient acting for themself or a delegated dependent via
`resolveSubjectId`).**

1. **The governing rule, quoted from CLAUDE.md:** *"`reproductive_health`
   is one of eight values in the `care_access_category` enum, and
   `private.has_emergency_access` deliberately excludes it from break-glass
   ... What actually protects an adolescent is the separate
   `private.guardian_may_view_confidential_domain()` gate ... Never copy an
   RLS shape from an older sibling table for anything touching
   menstrual/pregnancy/fertility/contraception data — write the
   category-scoped check fresh, and prove with a simulated
   caregiver/emergency session that access is actually refused, not just
   that the policy compiles."* This mobile port **writes no RLS and no new
   tables** — it only calls existing, already-audited tables/RPCs through
   the exact same `patient_id = auth.uid()` client the web app already
   uses. There is no new RLS shape to get wrong here as long as mobile lib
   functions do a plain `supabase.from(...).select/insert/update` scoped
   by `resolveSubjectId()`, exactly like `weight-management.ts` does.

2. **`reproductive_health_profiles`, `menstrual_cycles`,
   `menstrual_daily_logs` have a real, documented history of this mistake
   recurring three times** (migrations `20260830012429` →
   `20260902213714` → `20260902222215` for the profile table;
   `20260902215227` → `20260904235836` for the two cycle tables) — each
   time because a new table or a caregiver access path copied an older,
   pre-category-model shape. The current (final, live) SELECT shape for
   all three is:
   ```
   patient_id = auth.uid()
   OR is_org_staff(organisation_id)
   OR has_emergency_access(patient_id, 'reproductive_health')   -- always false by design
   OR ( can_read_clinical(patient_id, 'reproductive_health')
        AND guardian_may_view_confidential_domain(patient_id, auth.uid(), 'sexual_reproductive_health') )
   ```
   Mobile never needs to touch or reason about the third/fourth OR-branches
   — those exist for a caregiver/org-staff account viewing someone else, a
   *different* login session. A patient (or a supporter genuinely
   acting-for, via `acting.ts`'s `resolveSubjectId`, which is a
   **DB-verified `can_act_for` check re-run on every call, not a
   client-trusted hint**) always satisfies the first branch unconditionally
   — see migration `20260904235836`'s own assertion: *"A patient must
   never be locked out of her own record by this change."*

3. **Write side is looser than read side on `menstrual_cycles`/
   `menstrual_daily_logs`** — INSERT/UPDATE/DELETE require
   `profile_access_categories='reproductive_health' AND
   permission_level='manage'` but are **not** additionally gated by
   `guardian_may_edit_confidential_domain`, a gap the migration's own
   header flags as open and unresolved. Irrelevant to a patient writing
   their own row; relevant only if the mobile port ever supports a
   caregiver *editing* a dependent's cycle log — that specific case is
   currently under-protected on web too. Not a mobile-specific bug to fix;
   out of scope here.

4. **`private.can_read_clinical`'s dependent-account bypass had a real,
   live drift incident** (migration `20260902231348`) where a function's
   live body silently reverted outside any migration record. If verifying
   current behavior rather than trusting this document, run
   `pg_get_functiondef` on `private.can_read_clinical(uuid,
   care_access_category)` directly.

5. **Tables with no caregiver branch at all** (`patient_pregnancy`,
   `antenatal_visits`, `postnatal_profiles`, `postnatal_checkins`,
   `breast_symptom_reports`, `menopause_symptom_logs`,
   `fertility_assessment_requests`): `patient_id=auth.uid() OR
   is_org_staff(organisation_id)`, full stop. Each table's migration header
   explicitly documents removing a caregiver `EXISTS` branch during a
   pre-launch security review — these particular records have no plausible
   caregiver-support use case. **Do not add a caregiver-access affordance
   for these on mobile** — that would be new scope beyond web parity.

6. **Two DB triggers, not app code, do the clinical-safety-relevant work**:
   `private.handle_breast_symptom_report()` and
   `private.handle_menopause_symptom_log()` (on
   `postmenopausal_bleeding=true`) each raise a `clinician_alerts` row
   server-side on `BEFORE INSERT`. Mobile inserts need do nothing beyond a
   plain insert — never duplicate "should this alert" logic client-side.

7. **A pre-existing web bug, worth not copying**: `womens-health-actions.ts`'s
   `setLastMenstrualPeriod`, `recordDelivery`, and `logPostnatalCheckin`
   use `user.id` directly instead of `resolveSubjectId(user.id)` (unlike
   `saveContraceptionMethod`/`reportBreastSymptoms`/
   `logMenopauseSymptoms`/`requestFertilityAssessment`, which correctly
   route through it). A caregiver acting for a dependent would silently
   write to their own record instead of the dependent's — a correctness
   bug, not a security leak (RLS still only lets them write their own
   row). **Use `resolveSubjectId()` consistently for every write in the
   mobile port, including these three** — don't replicate the
   inconsistency.

8. **`emergency_events` insert for the pregnancy red-flag checklist has no
   existing mobile precedent to copy from.** Mobile's current red-flag UX
   (`emergency-guidance-modal.tsx`) is a client-only, offline-capable modal
   over a locally-computed classification that does NOT insert or
   acknowledge a server-side `emergency_events` row itself — that happens
   later, server-side, once the underlying reading syncs. Web's
   `reportPregnancyDangerSymptoms` inserts directly into `emergency_events`
   from a tapped checklist. No existing "one-touch danger-symptom checklist
   → emergency_events insert" pattern exists anywhere on mobile today —
   this port is likely the *first* instance of that pattern. Design it so
   it's naturally reusable if/when a general one-touch checklist is ported
   too, and check whether `activeEmergencyKey`-style "there is now an
   active unacknowledged emergency" polling has any mobile equivalent
   before assuming the post-insert UX will just work.

9. **`profile.sex !== "female"` gate is UI-relevance only, never a security
   boundary.** A male patient hitting the RLS directly would just get an
   empty result set for their own `patient_id`, not a leak.

## Parts to keep as WebView / link-out

- **`sexualHealth` section** stays WebView (separate scope doc). Don't
  duplicate fertility-assessment logic here.
- **`/patient/learn` article links** — Learn is deliberately WebView-only
  per founder instruction. Link out generically via `onNavigate('learn')`
  rather than deep-linking a specific article code unless a mobile
  deep-link mechanism already exists — investigate before assuming one
  does.
- **Appointment booking** — `appointments` is already native; link out via
  `onNavigate('appointments')`.
- **Messaging** — `messages` is already native; link out via
  `onNavigate('messages')`.
- **Postnatal mental-health screening** — `PostnatalCard`'s comment
  explicitly says it "reuses the existing mental-health check-in... rather
  than a parallel form." Mobile's `wellbeing-screen.tsx` **already has EPDS
  wired up natively**. Link out via `onNavigate('wellbeing')` rather than
  build a second EPDS form.
- **Cycle tracker, possibly as a whole first pass** — given its size
  (~2,660 lines: calendar, ring visualization, 650-line prediction engine,
  insights engine, thermal-shift detector), recommend shipping the
  life-stage cards page first with the cycle tracker still linking out to
  the web version (a `WebViewHubScreen` reachable only from inside the new
  native Women's Health screen, pointed at `/patient/cycle`), then build
  the full native cycle tracker as a follow-up phase. Mirrors how
  `devices`/`wellbeing` were built incrementally elsewhere.
