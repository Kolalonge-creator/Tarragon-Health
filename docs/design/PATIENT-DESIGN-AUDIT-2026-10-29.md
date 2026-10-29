# Patient app design audit: every page, both surfaces, against the competitors (2026-10-29)

Status: audit and redesign brief. Nothing built. Companion to `docs/design/UNIFIED-WEB-MOBILE-DESIGN.md` (the "one design, built together" rule and the phased plan); this file is the evidence and the page-by-page register. Builds on `MOBILE-DESIGN-AUDIT.md`, `DESIGN-PHASE-0.md`, `DESIGN-PHASE-1-VITALS.md`.

## 0. Method, and what this does NOT cover

| What | How | Coverage |
|---|---|---|
| Competitors | Android and iOS store listings (screenshots) for 25 apps: Nigerian (Reliance, MyHeala, Mobihealth, Healthtracka/Caretracka, Wellahealth), African (Zuri, MYDAWA, Vezeeta), international (Ada, Teladoc, Livongo, Omada, Hello Heart, Withings, Flo, Doctolib, Practo, Noom, Sword, Kaia, Hinge, MyChart, One Medical, Zocdoc, mySugr) | Store art only, not live use. K Health, Hims, Kaia, Clafiya and Helium Health could not be reviewed. |
| Web patient app | Headless Chromium, 390px phone width, signed in as a generated local patient, **all 89 static patient routes** captured; every page viewed on contact sheets | 89 of 110 routes (the other 21 are dynamic `[id]` pages, not captured) |
| Mobile app | iPhone 17 Pro simulator, debug build, same generated patient: Home, Vitals, Meds, Messages, More, sign-in, signup viewed. The other **60 of 66 screens were assessed from code only** (design-kit adoption), not seen | 6 of 66 seen |

Limits to keep in mind:
- **One account with little data.** 38 readings, 2 medicines, no messages, no results. Pages look emptier than a long-term patient's would. Empty states are judged here; data-heavy layouts (a year of labs) are not.
- **Local database flags.** The local database has go-live guards at their defaults, so pages that say "not open yet" (membership, consultations, community, testing days...) may be live in production. The design lesson (an off feature must not be a dead end) holds either way, but do not read the "not open yet" count as production state.
- **Dev build, light mode, one phone size**, no screen reader, no Android, no dark mode, no tablet or desktop width. Web screenshots are viewport captures at 1x.
- A "premium" judgement is partly taste. Where I say a page is dated or weak, the evidence is on the contact sheets; treat visual verdicts as a designer's first pass to be confirmed, not as measurements.
- Screenshots are saved outside the repo (scratchpad); this doc quotes them but does not embed them.

## 1. Headline numbers

- **110** web patient pages, **66** mobile screens, 5 bottom tabs on each.
- Of 89 web pages captured: **34 are 844px or shorter** (empty, dead-end or "not open yet" at one screen height). The five tallest: Labs **11,624px**, Health Check 8,710, Wellbeing 7,188, Home 6,625, Profile 5,972 (Vitals 5,093, Medications 5,055, Wellness 5,032).
- Zero horizontal page overflow and no stuck "Loading..." after 3.5 seconds on the captured pages. One real **404** (`/patient/heart-age`). One page clips its action buttons off the right edge (`/patient/actions`).
- **Mobile design-kit adoption: 20 of 66 screens on the new kit, 2 mixed, 44 still on the legacy kit** (Phase 0 and 1 moved Vitals, Medications, Messages, Overview, Labs and 15 others; Profile, Wellbeing, Prevention, Women's Health, Medicine Cabinet, Care & Support and 38 more have not moved).
- Web has **no equivalent of the mobile Phase 0/1 design pass** at all.

## 2. Systemic findings (these cause most of what feels un-premium)

Numbered so the register in section 4 can point at them.

**S1. One safety banner repeated on every page.** Every top-level section page (Labs, Meds, Prevention, Profile, Self-help, Support, Vitals, Wellbeing, Women's Health, Care, Cycle, Devices, Fasting, Healthy Ageing, Contraception) opens with a "Hi, Amaka / Patient dashboard" block plus a large red "Feeling something serious right now?" card, about 350px before any content. Wellbeing pages add a second red "If you need help right now" bar. Safety access is right; the delivery is a banner on 15+ pages. *Best practice:* a small persistent emergency button (corner or bottom bar), one expandable sheet.

**S2. Three different page headers.** (a) back link + icon + title + subtitle (most pages); (b) a bare title with no back link or icon (Lowcarb, Medicine report, Health report, Progress, Programmes); (c) the "Hi, Amaka" dashboard header. No single page template, so the app does not feel like one product.

**S3. Dead ends instead of hidden features.** Community, Cohorts, Diary, Consultations, Membership, Result passport, Records letters, Testing days, Learn course, Lowcarb, Contraception, Wellbeing breathing, Pathway and others render a header and one line ("is not open yet", "not available for you right now"). A page that can't be used should not be reachable, or should offer a join-the-waitlist action. See the local-flags caveat in section 0.

**S4. Form-first pages.** Alcohol (empty "target drinks" box), Sleep, Weight goal, Smoking status, Find a specialist, Directory (five blank filters, no results), Health history, Research. The patient meets blank fields before any value. *Best practice (Hello Heart, Omada, Flo, Livongo):* show the current state and trend first, then a "Log" button opening a sheet.

**S5. Walls of explanatory text before the action.** Care Circle, Family, Manage care together, Records from other places, Privacy, Care & support, Programmes, Sexual health. Often 6 to 10 lines of paragraph (some of it legal wording) above the first button. The existing "What this screen says" disclosure on Privacy is the right pattern; it is used on one page.

**S6. Monetisation above the user's own data.** Vitals opens with "A doctor can follow this with you. Membership is N129,000 for the year..." before the patient's readings. Home and Care carry similar blocks. Competitors (Hello Heart, Teladoc) show the data first and the offer second.

**S7. Too many actions per item.** Each dose on `/actions` shows six buttons (Taken, Skipped, Delayed, Not available, "I ran out, or cannot afford it", Missed), and they clip off the right edge at phone width. *Best practice (Livongo, MyTherapy):* one large "Taken" button with a "More" menu.

**S8. Very tall pages.** Labs 11,624px, Health Check 8,710, Wellbeing 7,188. A long single scroll with no summary at the top, no sticky navigation, no sections that collapse.

**S9. Nigerian context is a real strength but under-used visually.** "jollof rice", "eba or moi moi" in the meal logger, naira prices, Paystack wording, Quick exit and privacy PIN on Sexual health, discreet notifications, shared-phone mode. These are better than any competitor reviewed. The visual layer (plain bordered boxes) does not match the thoughtfulness of the content.

**S10. Plain text empty states.** "No services yet.", "Nothing here yet.", "No results with numbers yet." Competitors pair an icon or illustration, one sentence and one action (Flo, Omada).

**S11. Inconsistent card styles.** Bordered white cards, borderless cards, grey info boxes, red alert blocks and tinted boxes all appear, with different radii and padding. There is no clear hierarchy of "primary card / secondary / alert".

**S12. Mixed generations on mobile.** 44 of 66 screens sit on the legacy kit, so a patient moves between modern (Vitals, Messages) and dated screens inside one tab.

**S13. Probable logic bug on both surfaces.** Home says "Log your first readings and your score appears" although the patient has 38 readings (seeded with source `device`; may be seed-specific, confirm with a real reading). The same card on web and mobile.

**S14. Mobile specifics seen.** Onboarding tour card sits above the greeting on every tab; Meds pushes "Today's doses" below two other cards; signup is a long unbranded form with a typed `YYYY-MM-DD` date and a large "Close" button; login is phone-first while web is email-first.

## 3. What is already good (keep, then polish)

- **Mobile Vitals:** hero reading, badge with icon and words, 7-day average, trend with threshold line. The best screen in either app.
- **Mobile Home hero card** (big BP plus "Next best step") and web Home's "A dose is due" hero.
- **Mobile Messages:** real chat layout, composer pinned, warm empty state.
- **Mobile More menu:** 6-icon "Everyday" grid plus 4 collapsed groups.
- **Health Check checklist** (5 steps with To do / Open chips) and the **Timeline** (month groups with coloured dots and "Add a note / This looks wrong").
- **Sexual health:** Quick exit, Privacy PIN, "stays between you and your care team".
- **Discreet notifications and quiet hours**, **Emergency card**, **Doctor summary** (clear checkboxes, one PDF), **Private journal** (on-device, scrambled).
- Plain-language, warm, non-alarmist copy throughout. Brand colour, Warm Ivory canvas and Sora/Inter are consistent on both surfaces.

## 4. Page-by-page register (web), with mobile status and competitor benchmark

Verdict key: **KEEP** (good shape, light polish) | **FIX** (right content, fix layout/copy) | **REBUILD** (new layout) | **GATE** (hide or give it an action when the feature is off) | **MERGE** (fold into another page). Height is the page height at 390px. "Mobile" shows the screen's kit status from code: new = on new kit, legacy = old kit, n/a = no mobile screen found by that name.

### 4.1 Home and today
| Page | Height | Verdict | Issues and target | Mobile | Benchmark |
|---|---|---|---|---|---|
| Home `/patient` | 6,625 | REBUILD | S1, S6, S13; 6,600px scroll. One hero (next step), then Today doses, latest reading, next appointment. Rest behind More. Target 2 screens. | new (hero already) | Omada daily focus, Flo single hero |
| My actions | 1,644 | REBUILD | S7: 6 buttons per dose, clipped right edge. Merge with "Today's doses" on Home. | legacy | Livongo, MyTherapy |
| Your month / progress | 844 | GATE | Bare header, "first summary will appear". Fold into Home as a card once data exists. | new | Withings score, Noom |
| Activity timeline | 1,693 | KEEP | Good month-grouped list; add icons and filters. | legacy | MyChart (inverse) |

### 4.2 Vitals, trackers and habits
| Page | Height | Verdict | Issues and target | Mobile | Benchmark |
|---|---|---|---|---|---|
| Vitals & symptoms | 5,093 | REBUILD | S6 upsell first, filter chips before data. Port mobile Phase 1 (hero + chart + log sheet). | new | Hello Heart |
| Weight | 844 | FIX | S4 goal form; no chart without data. | n/a | Noom, Withings |
| Weight management | 2,044 | FIX | Tracker tiles are good; make each tile a hero metric. | legacy | Noom |
| Sleep | 2,103 | FIX | S4: goal form first. Hero hours, 7-day bars, log sheet. | n/a | Withings sleep |
| Activity | 1,706 | KEEP | Step ring is a good hero. | n/a | Withings, Fitbit |
| Alcohol | 1,164 | FIX | S4 (empty goal box first). | n/a | Drinkaware-style |
| Smoking | 958 | FIX | S4 status dropdown first. | n/a | Noom |
| Nutrition / Meals | 2,130 | KEEP | Meal tiles + Nigerian food search are excellent. Add photo-first logging. | legacy (lifestyle) | Omada photo scan |
| Lifestyle coaching | 2,028 | FIX | Hub of tiles; reduce to 3 priorities. | legacy | Omada |
| Fasting | 948 | FIX | Safety copy first is right; add a clear fasting timer once cleared. | legacy | Zero-style |
| Exercise | 2,134 | FIX | Programme catalogue; "Needs clearance" chip is good. Add progress. | legacy | Hinge, Sword |
| Lowcarb | 844 | GATE | S2 bare header, "not available". | new | n/a |
| Diary (paper readings) | 844 | GATE | "Not switched on yet". | n/a | mySugr |
| Health score | 844 | FIX | Empty because of S13; add explanation and hero score. | n/a | Withings Health Improvement Score |
| Heart age | 1,069 | **FIX NOW** | Returns a **404** page. Dead link; fix or remove. | n/a | Hello Heart |
| Biomarkers (results over time) | 844 | FIX | "No results with numbers yet"; S10. | new | Withings |

### 4.3 Medications
| Page | Height | Verdict | Issues and target | Mobile | Benchmark |
|---|---|---|---|---|---|
| Medications | 5,055 | REBUILD | Add-medication form and long text before "Today's doses"; per-medicine "Rx number/Verification code" block too heavy. Doses first, one card per medicine. | new (still buries doses) | Livongo (refill one tap), MyTherapy |
| Doses marked taken | 844 | FIX | S2 bare header; 8-line grey small print before the report. | n/a | mySugr report |
| Pharmacy collect | dynamic | not captured | | n/a | Zuri, MYDAWA (prescription upload in 2 steps) |

### 4.4 Care team, visits, booking
| Page | Height | Verdict | Issues and target | Mobile | Benchmark |
|---|---|---|---|---|---|
| Messages | 974 | FIX | Plain thread list; add named clinician, role, photo, reply-time line (null-gated). Mobile chat layout is the model. | new | Omada, Sword |
| Care & support | 4,983 | REBUILD | S1, S5: a paid-service explanation paragraph is the first thing. Make it "Your care team" with who, how to reach, what it costs. | legacy | Teladoc, One Medical |
| Help & support | 1,497 | FIX | Ticket form first; show FAQ and "Message care team" first. | legacy | Intercom-style |
| Appointments | 1,650 | REBUILD | A full booking form shows even though "consultations are not open"; S3. Show next slots, price, wait, doctor card. | new | Zocdoc, Vezeeta, Doctolib |
| Find a specialist | 1,128 | REBUILD | S4: empty filter form, no results. Results-first cards. | legacy | Practo, Zocdoc |
| Find care near you | 1,022 | REBUILD | Five blank filters, no list. Map/list with open-now. | legacy | Doctolib map |
| Your visits | 844 | FIX | Empty list; S10. | n/a | Zocdoc |
| Summary for a visit | 1,077 | KEEP | Clear checklist + one PDF. | n/a | Hello Heart clinician report |

### 4.5 Labs, results, records
| Page | Height | Verdict | Issues and target | Mobile | Benchmark |
|---|---|---|---|---|---|
| Labs & bookings | **11,624** | REBUILD | Tallest page. Results list, upload, documents, orders all stacked. Split into Results / Book a test / Documents tabs. | new | Healthtracka (category chips, prices) |
| Result passport | 844 | GATE | "Not open yet". | n/a | n/a |
| Health summary | 2,435 | FIX | Good coverage; make each block collapsible with a count. | legacy | MyChart (inverse) |
| Health history | 1,230 | REBUILD | S4: three blank forms. List first, add via sheet. | new | MyChart |
| Health report (yearly) | 844 | FIX | S2 no header; "no signed report yet" as plain text. | new | n/a |
| Health passport | 1,295 | FIX | | legacy | Apple Health ID |
| Documents (photos) | 932 | FIX | Upload first, list empty; show list/grid first. | n/a | Zuri |
| Records from other places | 2,324 | REBUILD | S5 long text before two download cards. | new | MyChart Share Everywhere |
| Summary of what is inside | 844 | FIX | | n/a | |
| Ask for your records | 844 | GATE/FIX | "Letters are not open yet" plus legal draft note. | legacy | |
| Share records | 1,458 | KEEP | Clear checkbox groups, expiry; add preview. | legacy | MyChart |
| My health hub | 1,722 | KEEP | Good hub of five cards; tidy. | legacy | |
| Immunisation card | 844 | FIX | Nice printable card; empty state. | n/a | |
| Lock-screen card | 844 | KEEP | Strong privacy copy. | n/a | |
| My phones | 844 | FIX | Empty. | legacy | |

### 4.6 Prevention and screening
| Page | Height | Verdict | Issues and target | Mobile | Benchmark |
|---|---|---|---|---|---|
| Prevention | 4,128 | FIX | Tabbed (Health Check / Screenings / R...) is good; tabs clip at phone width. | legacy | Zocdoc Well guide |
| Your Health Check | 8,710 | REBUILD | Good 5-step list, but the page is 8,700px. One step per screen with a progress bar. "To do" chips wrap. | legacy | Omada onboarding steps |
| Group screening days | 844 | GATE | Request form; clear. | legacy | |
| Testing days | 844 | GATE | "Part of Membership". | legacy | |

### 4.7 Programmes, learning, wellbeing
| Page | Height | Verdict | Issues and target | Mobile | Benchmark |
|---|---|---|---|---|---|
| Programmes | 906 | FIX | Two boxes of legal/benefit text before the code field; S2. | new | Hinge, Omada |
| Care pathway | 844 | GATE | "You are not on a care pathway yet." | n/a | |
| Self-help programmes | 1,022 | FIX | S1; shared-phone block first. Cards of programmes first. | n/a | Kaia |
| Learn | 3,437 | FIX | Library search; new-medication reading card is a good pattern. | mixed | Noom lessons |
| Three minute calm / course | 896 / 844 | GATE | "Course is not open yet." | new | |
| Wellbeing | **7,188** | REBUILD | S1 twice. A "Using a shared phone?" block first. 7,000px. | legacy | Headspace, Flo |
| Wellbeing: breathing / library | 844 / 935 | GATE | "Nothing is ready here yet." | new | Headspace |
| Private journal | 1,279 | KEEP | On-device privacy is a differentiator. | n/a | |
| Wellness rewards | 5,032 | FIX | Points with "usually added by 19:21" rows repeated; shorten. | legacy | Hello Heart tips |
| Healthy ageing | 3,976 | FIX | Stat tiles good; long check-in form. | legacy | |

### 4.8 Women's and sexual health
| Page | Height | Verdict | Issues and target | Mobile | Benchmark |
|---|---|---|---|---|---|
| Women's health | 1,306 | FIX | Red "get help now" block first (safe) but dominates; use a collapsed "When to seek help". | legacy | Flo |
| Your cycle | 1,450 | KEEP | Safety first is right; add Flo-style hero ("period in N days"). | new | Flo |
| Contraception | 844 | GATE | "Not open yet." | n/a | Flo |
| Sexual & reproductive health | 3,442 | KEEP+ | Best privacy design (Quick exit, PIN). Reduce length. | legacy | |

### 4.9 Family, circle, community
| Page | Height | Verdict | Issues and target | Mobile | Benchmark |
|---|---|---|---|---|---|
| Your people (family) | 3,364 | FIX | S5; children and add-child text first. | legacy | MyHeala family sharing |
| Manage care together | 1,110 | FIX | Stepper (Who/Details/What) is good; remove duplicate "Who is this for". | legacy | |
| Yearly reports for people | 844 | GATE | | n/a | |
| Care Circle | 3,756 | REBUILD | S5: a paragraph and a "share location" box before the button. Big "Ask for help" button first. | n/a | |
| People you support | 898 | FIX | Two identical "Buy care" buttons. | legacy | |
| Buy care for someone | 1,510 | FIX | Long explanation. | legacy | |
| Community / appeals / search / groups | 844 each | GATE | "Not open yet" dead ends (4 pages). | n/a | |

### 4.10 Money
| Page | Height | Verdict | Issues and target | Mobile | Benchmark |
|---|---|---|---|---|---|
| My services | 1,149 | FIX | Heavy copy; show active service card first. | new (services) | Teladoc price clarity |
| Membership / payment | 844 / 844 | GATE | "Membership is not open yet." Check live flags. | n/a | |
| Ask someone to pay | 844 | FIX | Great concept; clean up. | legacy | |
| Receipts | 844 | FIX | Plain empty box. | legacy | |
| Your finances | 992 | FIX | Four empty sections stacked; show only what exists. | legacy | |
| Insurance | 844 | FIX | Single card + button; good. | n/a | Reliance ID card |

### 4.11 Account, privacy, devices, safety
| Page | Height | Verdict | Issues and target | Mobile | Benchmark |
|---|---|---|---|---|---|
| Profile & settings | 5,972 | REBUILD | Photo upload with raw file input first; tabs clip. Section list, one task per screen. | legacy | Apple Health profile |
| Notification settings | 2,461 | KEEP+ | Discreet mode is excellent. Group channels. | legacy | |
| Privacy & your data | 4,847 | FIX | Good plain language; use the collapsed pattern throughout. | legacy | |
| How research uses data | 957 | FIX | | n/a | |
| Get a device | 1,770 | FIX | Good honesty ("we do not sell"); add a supported-device list once hardware is tested. | legacy | Withings (inverse) |
| Emergency card | 3,968 | KEEP+ | Strong; shorten and add a lock-screen preview. | legacy | |

## 5. Design language for the redesign (what "premium" means here)

From the competitor review and the screens above. Applies to **web and mobile identically** (tokens from one source).

1. **One page template, three types.** *Hub* (list of tiles with live status), *Metric* (hero number, status chip, trend, log button), *Task* (one job, one primary button). Every page is one of these. One header: title, optional back, optional one-line subtitle. No bare headers.
2. **Data first, offer second, explanation last.** Order: your value → what to do → why (collapsed "What this screen says").
3. **Hero metric component** (Hello Heart, Withings): large tabular number in Sora, unit, status chip with icon and words, time, trend sparkline. Used by Vitals, Weight, Sleep, Activity, Health Score, Cycle.
4. **Empty states with an action** (Flo, Omada): small illustration or icon, one sentence, one button. Never bare text.
5. **A real "Today"** (Omada, Livongo): next step plus doses plus next appointment. One tap to mark a dose taken.
6. **Persistent emergency access:** one small, always-visible control and a single sheet. Remove the banner from 15+ pages (S1). Keep the clinical content untouched.
7. **Navigation:** 5 tabs; More = "Everyday" grid + four groups (already built on mobile); global search; **pages for off features are hidden or show a waitlist action** (S3).
8. **Doctor and price cards** (Vezeeta, Zocdoc, Teladoc): photo or initials, role, price, next slot, typical wait. Real data only; nothing invented. Attribution stays null-gated.
9. **Premium restraint:** Warm Ivory canvas, one brand green, one gold accent, consistent 14px card radius, 8pt spacing, one elevation style; Sora for headlines and numbers, Inter for text; skeleton loading; haptics and motion on mobile; dark mode on both. No stock photography in clinical screens; real consented faces in onboarding and care-team areas only.
10. **Nigerian-first details:** naira formatting, local foods, low-data mode, shared-phone mode, discreet mode, offline-first logging. These are the differentiators; make them visible, not buried.
11. **Copy:** max 2 lines before the first action; no legal wording above the fold; no em dashes; calm, specific wording (existing rules).
12. **Accessibility baseline:** 44pt targets, AA contrast, screen-reader labels, dynamic type, reduced motion.

Not adopted: serif headlines (brand fixes Sora/Inter), streak penalties, gamified pressure, any WhatsApp or SMS dependency.

## 6. What to improve, in priority order

**P0 - fix now (small, independent, either surface)**
1. ~~`/patient/heart-age` returns 404~~ **Not a bug (checked 2026-10-29):** the page is deliberately gated on the `heart_age_card` flag, off pending clinical sign-off, and its only link is the hidden card. No change.
2. **Done** (design/p0-patient-fixes): dose rows show "Taken" + "More"; other answers open under the row. Regression test added.
3. **Done**: cause is that no stored score row exists yet (scores are computed server-side), not a broken query. Copy now reads "Your score appears here once we have a few days of your readings" on web and mobile.
4. **Done**: logo, three benefit lines, back arrow, native date picker (`@react-native-community/datetimepicker`). Needs a new EAS build; runtimeVersion bumped to `0.1.0-native9`.
5. **Done** for the reminder cards (now under Today's doses). The membership notice is a shell-level banner, not in this screen; still to do.
6. **Done on web Vitals** (founder chose "move below the data"): offers now sit under the trend and weekly cards. Home already places its promo after the clinical snapshot.

**P1 - shared foundations (before any redesign)**
7. Token parity test between `packages/ui/src/tokens.ts` and mobile `ui/design/tokens.ts`.
8. One page-header component on web (title, back, subtitle) and apply to all 110 pages; fixes S2.
9. Hero metric, status chip, empty-state, list item, sheet and skeleton components on web, matching the mobile kit.
10. Feature-flag-aware navigation and page gating (S3): one helper that hides a page when its guard is off, used by both apps.
11. One emergency control component, replacing the 15+ banners (S1).

**P2 - flagship screens on both surfaces together (Home, Vitals, Medications, Messages, Auth)**
12. Home, Vitals, Medications, Messages, Sign-in/Signup rebuilt to the spec, web catching up to mobile on Vitals and Home, mobile catching up to web on auth warmth and brand.
   - **Vitals (web): done.** A latest-blood-pressure hero (big number, worded status chip, time, 7-day average) now leads the page, built on `HeroMetric`, the shared reading-status classifier and the audited readings hook. Wearable estimates are never graded or averaged. Checked in the browser at phone width. Still open on Vitals: the trend chart stays on "Loading..." for several seconds on first view (lazy chart), and the floating emergency button covers content near the bottom edge while scrolling.
   - **Medications (web): done.** Today's doses now leads the page (and the single phone column), the medicine list follows, and "Add a medication" is a button that opens the form in a sheet instead of a long form on the page. Secondary cards (My day, reconciliation, check-ins, lab monitoring) stay in the second column. Checked in the browser at phone width.
   - **Home (web): done.** Page height on the local test patient fell from about 6,600px to about 3,200px at phone width. The main stack is now: hero, service status, quick actions, today's doses, pinned readings, next appointment, clinical risk signals. Everything else (focus, lessons, prevention tiles, score cards, trend chart, timeline, promo, domain cards, care team, and the long "Ask about a result" form) sits under one "More about your health" fold. A first-run patient still sees the Ask card. Also fixed the Vitals trend chart hydration mismatch (server and browser disagreed about IntersectionObserver); not confirmed gone in the browser because the console tool kept returning the old entry.
   - **Messages (web): done, not seen in a browser.** Attribution (name, role, licence badge, null-gated: a coordinator is never shown as a doctor) already existed. Added initials avatars, chat alignment (your messages right, others left; reversed in the staff view) and a warm empty state with one action. Covered by unit tests only: the local test patient has no threads. A "typically replies within..." line was NOT added because no real reply-time data exists yet (never invent it).
   - **Auth (mobile): done in code, not seen on a device.** Sign-in, sign-up and forgot-password now sit on the brand Warm Ivory canvas (was grey `#FAFAFA`), with the Sora wordmark and headings; signup already had the logo, benefits, back arrow and native date picker (P0). The Email/Phone toggle was already the same on sign-in and signup. Not checked on the simulator: the current debug build predates the date-picker native module, so a rebuild (and the runtimeVersion `0.1.0-native9` EAS build) is needed before signup can be viewed. The full move of these screens onto the new kit (and dark mode) is still P6.

P2 status: all five flagship screens have had their pass on web/mobile as described above.

**P3 - the long pages (REBUILD verdicts)**
13. Labs (11,624px), Health Check (8,710), Wellbeing (7,188), Profile (5,972), Care & support (4,983), Care Circle (3,756), Appointments/Find a specialist/Directory (results-first cards).
   - **Labs (web): done in code.** Results stay first and order/booking status stays visible. The long ordering material (annual bundle, full test catalogue, branch directory) is folded into one "Request a lab test" section (new shared `Disclosure` component). Released results show the latest three with "Show earlier results (N)"; interpreted results show three with the rest folded. Verified structurally in the browser on the local patient (no lab data there, so the 11,624px page was NOT reproduced and the new height is not measured on real data).
   - **Health Check (web): done.** Measured in the browser at phone width: 8,972px down to 2,008px. The five steps now show progress ("N of 4 steps done", only when every step could be read) and each row is one full tap target; step 2 links to the wellbeing section. The lab-booking card keeps the Health Check packages visible and folds "Confidential screenings" and "Other self-service tests". The wellbeing questionnaire (about 4,400px; PHQ-9, GAD-7, AUDIT-C, EPDS) is folded by default and its questions are untouched, since it is a clinical instrument. A one-question-at-a-time version is a separate clinical-sign-off decision. Fixed on the way: a confidential test could have been preselected inside a folded list; the default is now the Core package only (regression test added).
   - **Wellbeing (web): done.** Measured at phone width: at most about 2,000px (audit: 7,188px). The measuring setup has a roughly 2,000px floor (the app shell is `min-h-screen`), so the real content is at or below that; the local patient has little data, so a real account will be taller. Safety surfaces unchanged and on top (calm tool, crisis card, shared-phone gate, care-team hand-off notice). The daily check-in now sits straight under the tiles. Folded: mood alongside readings, the longer mental health questionnaire and its history, independent therapists, and the learning reads. "Talk to someone" and the library links stay visible. No questions or wording were changed.
   - **Profile (web): done.** The four settings groups are now collapsible sections (About you open because it holds the emergency contact; How things are shown, Notifications, Sign-in & security and the message history closed). The old jump list is gone since the headings are the list. Content ends at about 1,900px at phone width (audit: 5,972px) with About you open. No setting, form or wording was changed.
   - **Care & support (web): done.** Care plan, programme timeline, pregnancy status, escalations, hospital admissions, video visit, written question, visit summaries, referrals, navigation requests and the assistant (or its emergency button) stay visible. Three folded sections: "Notes, documents and second opinions", "Help with services and people who support you" (service assistant, care circle), and "Goals, rewards and feedback" (lifestyle progress, goals, wellness points, vouchers, testimonial). Content at most about 1,900px at phone width (audit: 4,983px; floor-bounded, see measuring note). No card or wording was changed; only the order and grouping.
   - **Care Circle (web): done.** The big "Ask my Care Circle for help" button now comes first (the audit's ask), with the location-sharing choice folded directly under it and its current state ("Location sharing is on/off") always visible in the heading; the consent control itself is unchanged. The page's pause panel and "who looked" log are folded; members, invites, tasks and the invite form stay visible, and the explanatory notices were left as written. Checked in the browser at phone width; the page height was not re-measured.
   - **Appointments (web): partly done.** Fixed the audit's specific complaint: while consultations are closed (or the guard is still being read) the booking card no longer shows the appointment-type form above the "not open" notice; only the notice shows. Tests added for closed, open and loading. NOT done: the audit's "show next slots, price, wait, doctor card" idea. That needs a defined data source and an honest fallback (open decision 5 below); nothing was invented. Page order (follow-up, my appointments, booking, second opinion) was left as is. Not checked in a browser.
   - **Find a specialist (web): done, not seen in a browser.** Results now come first: the speciality picker stays on top, the five optional filters (state, city, fee, language, telemedicine) are folded under "More filters" with an "N on" count, the patient's own state and city are still applied, there is a result count ("2 specialists in cardiology"), and the care-team footnote is now a real "Message your care team" button. Covered by 3 new tests. Not changed: it stays read-only (no patient-initiated referral), and no ranking was added.
   - **Directory (web): done, not seen in a browser.** It now opens on results: a first search with no filters runs on load (the RPC already limits to 50 and the not-open guard shows its calm notice), and it never sends a location on load; "near me" is still an explicit opt-in. State and Search sit on the main row; service, language, HMO, NHIA, open now and near me are folded under "More filters" with an "N on" count. A result count ("2 places") was added. Covered by 2 new tests.

P3 status: all pages on the list now have a first pass on web. Not yet touched: the same pages on mobile (P6), real-data re-measurement, and the Appointments "next slot, price, wait" idea (needs a data source).
   - Measuring note: heights below about 2,000px at phone width are bounded by the app shell's `min-h-screen` in the emulated viewport, so treat them as upper bounds. Re-measure on the demo account after deploy.

**P4 - the tracker family (Weight, Sleep, Alcohol, Smoking, Nutrition, Fasting, Exercise, Activity)** as one Metric template.
   - **P4 status (web): Weight, Sleep, Alcohol and Smoking done, not seen in a browser.** One template: a hero number first (current weight; last night's hours; drinks this week; smoke-free streak), the trend or history after, and the input forms (log, goal, smoking status, daily check-in) behind buttons that open a sheet. No form is open first any more, including when there is no goal yet. New shared `SheetButton` in `packages/ui`. Existing behaviour kept: the smoking status form still mounts only when opened, so the old stale-status bug cannot return (its test still passes). Activity and Nutrition were rated KEEP in the register and were not changed. **Also done:** Sleep 7-day bars (`sleep-week.tsx`: one bar per logged night, a missed night is an empty slot, never a zero; dashed goal line only when a goal exists) and Exercise reshaped to the template (active-programmes hero first, catalogue and readiness folded). **Deliberately NOT built:** (1) a Fasting timer: the Fasting page and its spec (S50b, 6.13) say it is a safety answer and never a fasting feature, with no timer and no sentence telling anyone to fast, so a timer needs a clinical and founder decision first; (2) an Exercise progress figure: no session or completion data is recorded anywhere, so any number would be invented; (3) Nutrition photo-first logging: it needs image storage and an AI call site registered in `ai_systems` under `runGovernedAi()` (AI governance rule), a feature not a layout change.

**P5 - gated and empty pages (34 short pages):** decide per page: hide, waitlist, or fold into a hub. Re-capture after go-live flags are set in the environment being reviewed.

**P6 - mobile legacy migration:** the 44 legacy-kit screens in the same order as the web pages above (largest first: medicine-cabinet 1,615 lines, women's-health 1,214, care-support 1,069, profile 941, prevention 774).

Each step ships on web and mobile together under the parity checklist in the companion doc.

## 7. Open decisions and checks needed

1. **Run the same capture against a patient with real data and production-like flags** (long history, results, messages, live membership). The empty-state verdicts depend on it.
2. **Mobile: see the other 60 screens.** Same method on the simulator for the 44 legacy screens first; Android after.
3. **Dark mode and screen-reader pass** on the flagship screens.
4. **Photography:** real consented images and a licensing decision.
5. **Price, next slot and wait data:** define the source and an honest fallback (show nothing rather than guess).
6. **Founder calls:** how to treat gated features (hide vs waitlist), and whether the Membership upsell stays on Vitals/Home at all.
7. **Confirm before building:** home-length target (2 screens) and the 5-tab set are proposals, not tested numbers.

## P6 progress (mobile, branch design/p6-mobile)
- Slices 1-5: top of Medicine Cabinet, Women's Health, Care & Support, Profile and Prevention moved onto the kit (headers, loading skeletons, error and empty states).
- Shared-component step 1: in `ui/legacy-kit.tsx`, `ScreenTitle`, `MutedText`, `ErrorText`, `SectionLabel` now draw through the kit `AppText`, and `PrimaryButton`/`SecondaryButton` through the kit `Button`. Every legacy screen picks up the new type faces and button look at once. Same names and props, so no screen files changed. Not yet seen on a simulator. The 44-point touch-target test was updated to check the kit Button's minimum.
- Lint counter of raw text not yet on the kit (warnings): 1,082 at the start, 1,073 now. Remaining: raw `<Text>` with literal font sizes inside screens, plus `Card`, `Badge`, `GroupedList`, `ChoiceChip` still on the old look.
- Shared-component step 2: `Card` (now the kit Card, with its soft light-mode shadow), `Badge`, `ChoiceChip`, `GroupedListRow` title, `QuickActionButton` label and `CalloutCard` text in `legacy-kit.tsx` now draw through kit components and theme colours. Lint warnings 1,082 at the start of P6, 1,065 now. Not yet seen on a simulator.
- Screen-body step (codemod): 846 raw `<Text style={{fontSize, fontWeight, color}}>` elements across 120 patient screens became `<AppText variant tone>` (bold 13 to label, bold 13.5-14.5 to bodyStrong, regular 12.5-14.5 to body, 12 and under to caption, 16 to bodyLarge, bold 18-20 to title, bold 24 to headline; ink, muted, subtle, danger and brandPressed colours to the matching tone). Skipped on purpose: bold 15-17, any other colour, anything with lineHeight or a computed value. Lint warnings 1,082 to 430. 114 files import `AppText` directly from `ui/kit/AppText` so logic tests that import a screen do not pull in the icon library. Visual change: font sizes shift by at most 1pt (13 to 14 regular, 12.5 to 14 bold label) and weights now come from the kit faces. Not yet seen on a simulator.
- Code review of P6 (high): the text codemod had also converted 10 screens that draw on the static light theme (emergency guidance, sign-in screens, red-care answer, emergency pack, biometric offer, verify code, DOB field, written questions). `AppText` reads the scheme, so in Dark those would show near-white text on white. Reverted those 10 files and added a guard test (`STATIC_LIGHT_FILES` in `ui/dark-aware.test.ts`). Lint warnings now 466.
