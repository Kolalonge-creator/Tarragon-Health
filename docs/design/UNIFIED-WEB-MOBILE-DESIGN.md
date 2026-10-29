# Unified patient design: one design, built on web and mobile together (2026-10-29)

Status: proposal, nothing built. Builds on `docs/design/MOBILE-DESIGN-AUDIT.md`, `DESIGN-PHASE-0.md` and `DESIGN-PHASE-1-VITALS.md` (mobile) and `docs/BRAND_GUIDE.md`. It does not replace them. It adds the missing half: web, and a rule that every patient screen ships on both surfaces in the same change.

Evidence base: a competitor review of 25 store listings (Android and iOS) and a phone-size walk of the web patient app on 2026-10-29 (demo account, empty data). Not done: the mobile app was not run on a simulator or device in this pass, so every statement about mobile comes from code and the existing design docs, not from looking at it. Competitor screens were store screenshots, not live use.

## 1. The problem to solve

Web and mobile already share a brand (Tarragon Green, Warm Ivory, Sora headlines, Inter body) but not a design:

- **Three token sets.** Web: `packages/ui/src/tokens.ts` mirrored into `apps/web/src/app/globals.css` (a test fails if those two drift). Mobile: the new `apps/mobile/src/ui/design/tokens.ts` and the legacy `ui/theme.ts`. **No test ties mobile to the web tokens**, so a colour change on one side is invisible to the other.
- **Different screens.** Mobile Vitals leads with a hero reading and a Skia trend chart. Web Vitals leads with filter chips and a chart card that showed "Loading..." in the walk. The two apps answer "what do I see first?" differently.
- **Different home.** Web Home is about 6,300px tall with a quick-actions grid and promo cards. Mobile Home is a 4-tile pinned grid. Pins are shared logic (`packages/shared/src/home-pins.ts`) but the layouts around them are not.
- **Different navigation depth.** Both expose 40+ destinations; mobile has a 5-tab bar plus a drawer, web has a sidebar and a bottom bar on small screens.

### 1a. What the mobile app actually looks like (simulator walk, 2026-10-29)

Seen on an iPhone 17 Pro simulator, debug build, against a local database with a generated patient (28 days of BP and glucose, 2 medications). Not a device, not a screen-reader pass, not dark mode.

| Screen | What was seen | Compared with web |
|---|---|---|
| Home | Onboarding tour card and "What is this?" first, then a greeting, a "How you're doing" card, then a **green hero card: big latest BP (134/81) plus a "Next best step"** button, then "Today" doses and a "Three things to set up" checklist. | Closer to the target design than web. Web Home is ~6,300px with a quick-actions grid and promo cards. |
| Vitals | The redesigned screen: hero reading, "At target" badge with icon, time, 7-day average, then a trend chart with a dashed threshold line and a 7/30-day switch. | Web Vitals (filter chips, chart card stuck on "Loading...") has not had this pass. |
| Medications | Opens on a membership notice and a "Make reminders reliable" card; **"Today's doses" is below the fold** and showed skeleton placeholders. | Same problem as web (the add form comes first there). Neither surface leads with today's doses. |
| Messages | A real chat layout: warm empty state ("Start a conversation"), composer pinned to the bottom. | Better than web, which is a plain list of threads. |
| More | A 6-icon "Everyday" grid plus four collapsed groups (Your health, Stay well, Support, Your account), then name and Patient ID. | Clearer than the web sidebar of 40+ entries. The groups already exist on both; web should adopt this shape. |
| Auth | Phone-first, system font, grey canvas; signup is a long unbranded form with a big "Close" button and a typed `YYYY-MM-DD` date of birth. | Web auth is warmer and branded. |

Open items seen on mobile: the onboarding tour card sits above the greeting on every tab, pushing content down; the Home "How you're doing" card says "Log your first readings" even with 38 device readings (source `device`; could be seed-specific, confirm with a real reading); the Meds screen has no visible doses until after two other cards.

Takeaway for the plan: mobile is ahead on Home hero, Vitals and Messages; web is ahead on auth and brand warmth; both are weak on Medications. So the work is mostly "bring each surface up to the best version of each screen", not a ground-up redesign.

## 2. The rule: one design, two renderings, shipped together

1. **One spec per screen.** `docs/design/screens/<screen>.md`: the order of content, the one hero element, the single primary action, every state (loading, empty, error, offline, no data yet), and the exact copy keys. Both apps implement the spec. Where the surfaces must differ (BLE pairing, haptics, offline outbox on mobile; wide layout and keyboard on web) the spec says so explicitly. Everything else is identical.
2. **One source of truth for tokens.** `packages/ui/src/tokens.ts` is the source. A new test in `apps/mobile` imports it and fails if any shared role (brand, ivory canvas, status colours, radii, type scale) differs from `ui/design/tokens.ts`. The legacy `ui/theme.ts` stops being edited and is deleted when Phase 2 completes.
3. **One copy source.** All visible strings through `packages/i18n` (mobile Vitals already does this), so a wording change lands once. The house rules (no em dash, no fear wording) are enforced by the existing `copy-lint`.
4. **One display model.** Anything that decides what a patient is told (reading status "At target / Above target", hero text, locked pins, "not enough readings yet") lives in `packages/shared` and is imported by both apps, as `home-pins.ts` and the BP threshold sync already are. Neither app re-derives it.
5. **Built together.** A patient-screen change merges only if it either ships on both surfaces or names, in the PR, the spec section that makes it surface-specific. A parity checklist (section 6) is part of the PR template, and `/code-review high` runs on the combined diff.

## 3. The design, per screen (what changes on both)

Derived from the competitor review (Hello Heart, Omada, Flo, Livongo, Zocdoc, Vezeeta, Teladoc, MyHeala, Zuri) and the walk of the current web app.

| Screen | Both surfaces will | Evidence |
|---|---|---|
| **Home** | One hero card (today's next step), then a short ordered list: today's doses, latest reading, next appointment. Everything else behind "More". Target: no more than 2 screens of scroll on a phone. | Omada daily focus; Flo single hero; current web home is ~6,300px |
| **Vitals** | Latest reading is the largest thing on screen with a status band and one plain sentence; trend chart directly under it; empty state says what to do. Web catches up to the mobile Phase 1 layout. | Hello Heart; mobile Phase 1 already does this |
| **Medications** | Opens on "Today's doses" with large tick targets; "Add a medication" is a button that opens a sheet, not a form on the page. | Livongo, MyTherapy pattern; web opens straight into the add form today |
| **Messages** | Each message shows who wrote it: name, role, photo or initials, and a reply-time line. Care-team attribution stays server-derived and null-gated (the `ReviewedByDoctor` rule). | Omada, Sword; current web thread is anonymous rows |
| **Doctor time** | The card shows what you get, the price, and the next available slot and typical wait. Needs real data from `service_products` and provider availability, never invented. | Vezeeta, Zocdoc, Teladoc |
| **Navigation** | Five primary destinations on both (Home, Vitals, Meds, Messages, More). "More" is grouped into four headings that already exist (Your health, Stay well, Support, Your account) with the rest searchable. | All top apps keep 4 to 6 top-level items |
| **Empty states** | Warm, specific, one action. Never a bare "Loading..." beyond a skeleton. | Flo, Omada |
| **People** | Real, consented, diverse photography in onboarding and the care-team areas only; no stock imagery inside clinical screens. | Omada, Zuri, Teladoc |
| **Auth** | Keep as is (clean on both). Add the Email/Phone toggle consistently on mobile. | Walk of web login and signup |

Not adopted: serif headlines (the brand guide fixes Sora and Inter), score gamification and streak penalties (house voice), and any WhatsApp or SMS dependency (removed platform-wide).

## 4. Build order (extends the existing mobile phases; web joins at Phase 1)

- **Phase A, shared foundations (one small PR set).** Token parity test; screen-spec folder and template; move the "reading status and hero text" display model into `packages/shared` with tests; web gets the same skeleton and empty-state primitives as the mobile kit (as web components in `packages/ui`).
- **Phase B, the flagship four on both surfaces together:** Home, Vitals, Medications, Messages. Mobile Vitals is already done, so web Vitals is the first web screen to move. Each screen: spec, shared display model, mobile implementation, web implementation, dark mode, accessibility pass, one PR or a stacked pair merged one at a time.
- **Phase C, doctor time and navigation:** doctor card with price and slot, grouped More menu, search entry for every console page (existing rule).
- **Phase D, rollout:** remaining patient screens in groups, largest first (care support, women's health, profile, medicine cabinet), each on both surfaces. Delete `ui/theme.ts` and the lint ratchet baseline reaches zero.

Native builds: Phase A to C use only the existing kit and installed native modules, so they should be deliverable by OTA. Any new native module (for example a camera or image library for care-team photos) needs a new EAS build and a runtime version bump, so confirm before adding one.

## 5. Acceptance (every screen, both surfaces)

Light and dark pass visual review; WCAG AA text contrast; touch targets at least 44pt (mobile) and 44px (web); screen-reader walkthrough of the flow (VoiceOver, TalkBack, and a browser reader); no hard-coded strings; offline path checked on mobile; loading, empty and error states shown; Jest and CI green; the token parity test green; before and after screenshots of both surfaces attached to the PR.

## 6. Parity checklist (paste into the PR template)

- [ ] Screen spec exists and is linked
- [ ] Web and mobile both implement it, or the spec names why not
- [ ] Display model lives in `packages/shared`, not in a screen
- [ ] All strings via `packages/i18n`, copy-lint clean
- [ ] Token parity test green; no raw hex in moved screens
- [ ] Dark mode checked on both
- [ ] Empty, loading, error and offline states shown
- [ ] Accessibility pass recorded
- [ ] Screenshots of both surfaces attached

## 7. Open questions and things not verified

1. **Resolved in section 1a:** mobile Home, Vitals and Messages are already strong; Medications is not. Re-check dark mode, Android, and a screen reader, none of which were seen.
2. **Web hydration mismatch and "Loading..." chart.** Console showed a hydration mismatch in `ChartSkeleton` (`apps/web/src/components/vitals-trend-chart-lazy.tsx`) and the Vitals trend card stayed on "Loading..." for 9 seconds on an empty account. Could be dev-mode noise; confirm on a production build before treating it as a bug.
3. **Photography.** Needs real, consented images and a licence decision. Founder call.
4. **Price, next slot and wait time** need a defined data source and an honest fallback when none exists (show nothing, never a guess).
5. **Home length target.** "No more than 2 screens" is a proposal, not a tested number.
6. **Marketing site** shares tokens with the app but is out of scope here.
