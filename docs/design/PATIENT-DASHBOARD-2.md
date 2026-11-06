# Patient dashboard 2.0: Phase 0 discovery, gap analysis and plan (2026-11-06)

Status: discovery only. Nothing built. This is Phase 0 of the founder's "Tarragon Health 2.0 Complete Patient Dashboard Design and Development Specification" (pasted 2026-11-06, referred to below as "the spec", section numbers are the spec's). It mirrors `DOCTOR-WORKSPACE.md` (same day, doctor side).

Method: a read of `origin/main-dev` at 2026-11-06 (three parallel code audits: shell/home/design system, clinical modules, services/account), plus the earlier page-by-page audit `PATIENT-DESIGN-AUDIT-2026-10-29.md` and its P0-P9 build log, `UNIFIED-WEB-MOBILE-DESIGN.md` and `docs/DECISIONS.md`. Code only: nothing was clicked through in a browser for this pass, and no live data was read.

## 0. The headline

**The spec describes, almost item by item, a dashboard that already exists in pieces.** 110 web patient pages, 66 mobile screens, a care-plan module, a diagnostic directory, an upload-to-doctor-review pipeline, Care Circle with 11 sharing permissions, sponsorship with beneficiary acceptance, community, a consent matrix with receipts, and the Tarragon 2.0 work of 2026-11-04/05. The 2026-10-29 audit and its P0-P9 passes already shortened Home from about 6,600px to about 3,200px and rebuilt Vitals, Medications, Health Check, Wellbeing, Profile, Care and Care Circle.

So the job is **integration and finish, not a rebuild**: fewer, clearer doors (navigation), one Home that answers "where am I and what next", a handful of genuinely missing pieces (below), and a consistent visual layer. The spec's own rules ("do not rewrite", "do not build competing versions") point the same way.

## 1. Current-state assessment by spec section

Legend: **Have** = meets the spec in substance · **Partial** = exists, named gap · **Missing** = not found.

| Spec | Area | State | What exists | Gap |
|---|---|---|---|---|
| 3.1 | Navigation | Partial | `lib/navigation.ts`: 43 items in 5 bands (9 in the top band); page search on Ctrl-K | Too many doors; overlapping names (Health summary / My Health / My Health Records / Health Passport); search finds pages, not records |
| 3.2 | Desktop layout | Have | 256px sticky sidebar from `lg` | No right panel (the spec says optional) |
| 3.3 | Mobile layout | Partial | Web and Expo: Home, Vitals, Meds, Messages + More | Spec's tabs differ (Q1); 44 of 66 mobile screens still on the old kit |
| 4.1 | Greeting | Partial | "Hi, {full name}" plus a separate "Good morning" eyebrow, Lagos time | Not one line; full name, not first name |
| 4.2 | Health overview | Partial | Health-by-area dots (score retired, T2-06), service status card | No "2 actions, 1 result awaiting review, next consult" status strip |
| 4.3 | Next step | Partial | `NextBestAction`, fixed priority in `next-action-priority.ts` | Ignores upcoming consultation, unread care-team reply, new/held result, unfinished baseline assessment, care-plan acknowledgement |
| 4.4 | Care journey | Missing on Home | `/patient/pathway` (chronic pathway page only) | No stage tracker (assessment → review → plan → tests → results → monitoring) |
| 4.5 | Quick actions | Have | 6-7 shortcuts | "Find a diagnostic centre" and "Book consultation" not in the set |
| 4.6 | Recent activity | Have (folded) | `PatientTimeline`, 6 rows, inside "More about your health" | Hidden under the fold |
| 4.7 | Upcoming appointment | Missing on Home | Appointments page only | Not on Home; see 12.3 for the join bug |
| 4.8 | Education | Partial | Weekly lesson; feed personalised by care-plan condition and by events (`health_education_feed`) | Not a Home card |
| 5.1 | Health record | Partial | Health summary, records hub (`clinical_record_items`), history, passport, documents | Four overlapping pages; provenance labelled per module, no one scheme; imaging only as documents |
| 5.2 | Timeline | Partial | `/patient/timeline`, about 30 event types, month groups, load more | No filter by type |
| 5.3 | Downloads | Have | Passport, doctor summary, preventive plan, lab/imaging requests, referral letter, results, prescriptions, visit report, FHIR/IPS export | No consultation-summary PDF |
| 6 | Assessment | Partial | Onboarding risk profile (4 sub-steps, progress); T2 `preventive_baselines` with Waiting / Reviewed | No save-and-resume, no review-before-submit, no "more information needed" state |
| 7 | Care plan | Partial | `care_plans` + tasks + goals on `/patient/care`; preventive plan PDF | No last/next review dates, no categories, no why/when/how cards, no progress, versions clinician-only, no patient "what changed" + acknowledge |
| 8 | Investigations | Partial | Orders with statuses, prep, QR request PDF, directory search by test + GPS radius or state/LGA | Flat list, not grouped by status; spec's "Contact the facility for current pricing" line not used verbatim |
| 9.2 | Upload | Partial | PDF/JPG/PNG/WebP/HEIC, 10 MB, ClamAV scan, CDE intake | One file at a time; no camera capture on the results upload; no progress bar |
| 9.3-9.4 | Result status and detail | Partial | Statuses on records hub; doctor interpretation on reviewed documents; AI summary labelled "Not a medical opinion" | **No patient result detail page** separating original / AI extraction / doctor explanation / previous results |
| 9.6 | Critical results | Have | S27 tracked on-call call, disclosure hold, emergency guidance not plan-gated | None |
| 10 | Trends | Partial | Vitals chart (7/30/90d), biomarker chart (3m/6m/1y/all), lab trend cards | Two chart systems with different ranges; vitals chart has no text/table alternative |
| 11 | Medications | Partial | Doses (6 answers), history, side effect report, prescription PDFs, "I've got this medicine" | No "not sure" answer; availability and side effects do not create a care-team task |
| 12.1 | Appointment lists | Partial | Upcoming only | No past / cancelled / missed list |
| 12.2 | Booking | Partial | Slots, hold, pay to confirm, cancel | Reschedule RPC exists, no UI; cancel has no confirm |
| 12.3 | Video | **Bug** | Consultation room enforces 15 min before to 60 min after, server-side | List shows "Join call" by status alone (`my-appointments-list.tsx:31`), legacy waiting room by status + link |
| 12.4 | Summary | Have | `consultation_patient_summaries`, clinician notes staff-only | No PDF |
| 13 | Care Circle | Have | Invite + accept, 11 permissions, preview, pause, who-looked log, sponsorship with acceptance and separate data consent | No typed requests (transport, medicine collection, help booking) |
| 14 | Community | Have | Pseudonymous, groups, posts, replies, reactions, report, appeals, guidelines | Named "Community"; spec says "Tarragon Circles" (Q6) |
| 15 | Membership | Partial | One ₦100,000 card, entitlements with state, renewal, receipts, Paystack verified server-side | No Free card; "Membership Plus" still in a few unguarded strings (`service-status-card.tsx:18`, `subscription-manager.tsx:185`, `catalog.membership_annual.name`, `shop.plus.state.*`) |
| 16.1 | Notification centre | Partial | Header bell, unread, mark read, links | No page, no category filter, no history |
| 16.2 | Preferences | Have | 9 categories × email/push, in-app always on, quiet hours, discreet previews | Spec lists WhatsApp/SMS (see section 2) |
| 17 | Library | Partial | 15 categories, personalised feed | Shows only "Reviewed by our clinical team"; `reviewed_by_name`/`reviewed_at` exist but are not shown; no author or references |
| 18.1 | Profile | Partial | Emergency contact, units, password, phone, passkeys | Name / DOB / email not editable anywhere |
| 18.2 | Privacy & consent | Have | Consent matrix, per-item withdrawal, receipts, data export, deletion | None of substance |
| 18.3 | Security | Partial | MFA opt-in and sign-out-others on shared `/account` | Not linked from patient profile; no session list (MFA stays opt-in, SEC-01) |
| 19 | Design system | Partial | `packages/ui` (about 30 components), tokens, Sora/Inter, dark mode, Recharts | **No clinical status tokens** (raw emerald/amber/red per component); `clinical-amber` used by the acting-for banner is **undefined**, so the banner has no colour |
| 21 | Empty/loading/error | Partial | `EmptyState`, `Skeleton`, `LoadErrorCard`; one `loading.tsx` | Applied unevenly (2026-10-29 S10) |
| 22 | Accessibility | Partial | 47 jest-axe tests; mobile pass 1 | No web screen-reader pass; vitals chart has no text alternative; no global reduced-motion rule |
| 23 | Performance | Partial | Suspense on several cards | The folded "More about your health" still renders and fetches everything; four server cards block the stream; Home context read twice |
| 24 | Safety/privacy | Have | RLS, null-gated attribution, AI labels on about 10 surfaces, emergency not plan-gated | Acting-for banner only on `(sections)` pages and not sticky |
| 26 | Analytics | Partial, **privacy gap** | First-party page views only (`web_events`) | The raw path is stored with `profile_id`, so visits to `/patient/sexual-health` etc. and record IDs are tied to a person; no action events |

## 2. Where the spec meets a standing rule (default taken, not a question)

| Spec says | Standing rule | Default taken |
|---|---|---|
| 16.2 WhatsApp and SMS preferences | WhatsApp removed (F-02); SMS is phone codes only (OQ-05) | Preferences stay in-app, push, email. No change. |
| 4.2 / 20 no composite score | T2-06 already retired it | Keep health-by-area. Delete the dead `isHealthScoreThin`. |
| 15.1 Free + Membership ₦100,000, no Plus | T2-09 live | Add a Free card; remove remaining Plus strings for non-holders (legacy holders keep T2-13 notices). |
| 15.1 "One scheduled doctor video consultation monthly" | Current product calls it the "monthly check-in" (Members) | Keep the live entitlement wording; do not add a promise the product does not make (Q5 if the founder wants the spec wording). |
| 15.1 "Doctor review within the published service-level commitment" | T2 brief: no advertised turnaround until staffing is proven | Wording names the commitment only where `escalation_slas` publishes one. |
| 12.3 "Do not record by default" | Zoom `auto_recording: none` (doctor slice A, PR 1780) | Already covered on the doctor side. |
| 19.1 premium look | Brand guide: Sora/Inter, Tarragon Green, Warm Ivory | Keep the brand; the spec's font list is advisory. |
| 18.3 MFA | SEC-01: stays opt-in | Link the existing card from the patient profile only. |

## 3. Gaps, sized

S = under a day, M = 1-3 days, L = more. "Approval" = needs a founder or CMO call before building.

| # | Gap | Spec | Size | Approval |
|---|---|---|---|---|
| P1 | Join button shows outside the join window (list + legacy waiting room) | 4.7, 12.3 | S | No (bug) |
| P2 | `clinical-amber` undefined: acting-for banner unstyled; banner missing outside `(sections)` and not sticky | 19.3, 24 | S | No (bug) |
| P3 | Action centre computes "today" in UTC, Home in Lagos | 23 | S | No (bug) |
| P4 | Analytics stores sensitive paths and record IDs against a person | 24, 26 | S | No (privacy fix) |
| P5 | "Membership Plus" strings shown to non-holders; no Free card | 15 | S | No |
| P6 | Clinical status tokens (critical/urgent/attention/normal/info/inactive) used everywhere instead of raw colours | 19.3 | M | No |
| P7 | Navigation: regroup 43 items into the spec's six groups, merge the four record pages behind one "My health record" door | 3.1 | M | **Yes (Q1)** |
| P8 | Home: one greeting line, status strip, next step that knows consultations / results / assessment / replies, next appointment card, education card; keep the fold, render it lazily | 4 | M | **Yes (Q2)** |
| P9 | Care journey tracker (stages from real records, any order) | 4.4 | M | **Yes (Q3)** |
| P10 | Result detail page: original, AI extraction (labelled), doctor explanation or "not yet reviewed", next steps, previous values | 9.4 | M | No |
| P11 | Upload: several files / pages at once, camera capture, progress | 9.2 | M | No |
| P12 | Investigations grouped by status | 8.1 | S | No |
| P13 | Care plan for patients: review dates, categories, why/when/how action cards, progress, "what changed" with acknowledgement | 7 | L (schema) | **Yes (Q4)**, CMO sees the wording |
| P14 | Assessment: save and resume, review before submit, "more information needed" state | 6 | M (schema) | No |
| P15 | Appointments: past / cancelled / missed tabs, reschedule UI, cancel confirm, summary PDF | 12 | M | No |
| P16 | Medications: "Not sure" answer; availability and side-effect reports raise a care-team task | 11.2-11.3 | M | CMO (task routing) |
| P17 | Trends: one range set (7d/30d/90d/6m/12m/all) across both charts, data table alternative | 10.2, 20 | M | No |
| P18 | Timeline filters by type | 5.2 | S | No |
| P19 | Notification centre page with categories and history | 16.1 | M | No |
| P20 | Library shows reviewer, review date, references (columns exist) | 17.3 | S | No |
| P21 | Profile: request a name / DOB change (verified), link MFA and sign-out-others | 18 | M | No |
| P22 | Care Circle typed help requests (appointment, test payment, medicine collection, transport, call me), "not an emergency" line kept | 13.5 | M | **Yes (Q7)** |
| P23 | Record search (results, medicines, messages), not just pages | 3.1 | M | No |
| P24 | Product events (spec 26 list) with a no-clinical-data guard test | 26 | M | No |
| P25 | Mobile parity for every web item above (44 legacy screens) | 3.3, 29 | L | No |

## 4. Proposed information architecture

Web sidebar, six groups (spec 3.1), every current page kept but reachable through fewer doors:

- **Home**: Overview.
- **My health**: My health record (one door; tabs Summary, Timeline, Documents, History, Passport, replacing four menu items), Health assessment, Health trends (Vitals + Results over time), My care plan, Medications.
- **Healthcare**: Investigations (orders + find a lab), My results, Appointments (incl. consultations and the monthly check-in), Referrals.
- **My support**: Messages, Care Circle, Community, Notifications.
- **Resources**: Health library, Help & support (FAQ first).
- **Account**: Profile, Membership & payments, Privacy & consent, Settings, Emergency card (pinned), Sign out.

Condition and life-stage pages (Women's health, Sexual health, Wellbeing, Healthy ageing, Prevention, Lifestyle, Weight, Programmes, Family) stay as they are and appear inside **My health** only when relevant to the patient (the existing page-gate helpers), rather than as permanent menu items. Search reaches all of them.

Phone bottom bar: see Q1.

## 5. Build sequence (each a PR; web and mobile together per the unified-design rule)

1. **Slice A: safety and correctness, no approval needed.** P1 join window, P2 acting-for banner, P3 Lagos date, P4 analytics paths, P5 Plus strings + Free card, dead code. Regression tests for each.
2. **Slice B: foundations.** P6 status tokens, P17 chart ranges + table alternative, page header everywhere, lazy fold on Home.
3. **Slice C: navigation** (after Q1). P7 + P23.
4. **Slice D: Home** (after Q2/Q3). P8, P9.
5. **Slice E: results and investigations.** P10, P11, P12, P18.
6. **Slice F: care plan and assessment** (after Q4). P13, P14.
7. **Slice G: services.** P15, P16, P19, P20, P21, P22.
8. **Slice H: QA and release.** Spec 28 scenarios A-G as Playwright journeys on the local stack, a crawl at 390px and 1280px with a data-rich test patient (the 2026-10-29 audit's open item 1), a web screen-reader pass, then the founder's walk-through before any merge to `main-dev` (which deploys).

## 6. Open questions for the founder

- **Q1 Phone tabs.** Spec: Home, My Health, Care Plan, Appointments, More. Today: Home, Vitals, Meds, Messages, More. Messages is the only two-way channel to the care team and Vitals/Meds are the daily tasks, so dropping them is a real trade.
- **Q2 Home order.** Proposed: greeting, next step, status strip, next appointment, care journey, quick actions, today's doses, recent activity, education; everything else in the fold.
- **Q3 Care journey.** Show to every patient, or Members only (Free has no clinical review stage)?
- **Q4 Care plan schema.** Add `last_reviewed_at`, `next_review_due`, categories and patient acknowledgement to `care_plans`/versions, and show versions to the patient?
- **Q5 Membership wording.** Keep the live entitlement list, or adopt the spec's list (which says "video consultation monthly" where the product says "monthly check-in")?
- **Q6 "Tarragon Circles".** The project rule forbids inventing a sub-brand for an internal product (`CLAUDE.md`, brand guide). Rename Community to "Tarragon Circles" anyway, or keep "Community"?
- **Q7 Typed Care Circle requests** (transport, medicine collection, help booking, help paying for a test, call me): build now?

## 7. Founder answers (2026-11-06)

Logged as PD-01..PD-04 in `docs/DECISIONS.md`: phone tabs Home, My Health, Messages, Care Plan, More (Q1); keep "Community" (Q6); care journey for everyone, Free sees fewer stages (Q3); build Slice A and B first, PRs reviewed before merge. Q2, Q4, Q5 and Q7 stay open until those slices land.
