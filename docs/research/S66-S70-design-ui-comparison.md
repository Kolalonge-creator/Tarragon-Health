# S66-S70 design and UI comparison (research, 2026-10-22)

Scope: the second pass of the competitor scan, done on DESIGN and UI. Read-only: public pages only, no login, no account, no download, no data entered, no terms accepted.

## 0. Method and honest limits (read first)

- Tools used: WebFetch (page text), WebSearch (snippets of help centres), and the built-in browser pane (one screenshot of naturalcycles.com, plus `getComputedStyle` readings of the public marketing pages of Natural Cycles, Clue, Flo, Huckleberry and Oura).
- **None of this is the signed-in app.** Every app is behind a login or an app-store container. App Store and Google Play listings returned description text and price lists, but **not screenshot images or screenshot captions** (the fetch tool shows image placeholders only). So "home screen structure", "taps to log" and "empty states" are mostly **[not observed]** directly and are filled only where a public help article or listing states them in words. Where a claim comes from a search snippet and not an opened page, it is tagged `(snippet)`.
- Apple App Store pages returned HTTP 429 for Clue, Natural Cycles and Huckleberry, and 404 for Ovia. Withings, WHOOP (membership page and home), and BabyCenter refused (403 or blocked). Nara Baby's own domain is now an unrelated formula-recall notice. These are marked [not observed].
- Typography and colours below are of the **marketing website**, not the app. Do not copy them as app UI facts.
- Tarragon side is read from the repo at `origin/main-dev` (branch `research-design-ui`). I did not run the app.

---

## 1. Per-product observed facts

Format: what I could observe, with the URL. `[not observed]` means I tried and could not see it.

### 1.1 Flo
- URLs: https://apps.apple.com/us/app/flo-period-pregnancy-tracker/id1038369065 , https://flo.health/ , https://help.flo.health/hc/en-us , https://flo.health/product-tour/anonymous-mode (snippet), https://flo.health/privacy-portal/anonymous-mode-faq (snippet)
- Onboarding steps and questions: [not observed]. The store page has no onboarding text. The only onboarding detail seen is the Anonymous Mode switch: avatar, then the dark grey box near the top, then the Anonymous Mode button (snippet, product tour page).
- Home screen: [not observed]. Store listing names features only: "Over 70 trackable symptoms and moods", LH test strips, basal body temperature, discharge, a Perimenopause Score, a sleep/energy/mood tracker, a "24/7 virtual Health Assistant", and a "Flori well-being snapshot".
- Logging: symptom/mood list is large (70+); tap count [not observed].
- Calendar/prediction: predicts "fertile window and ovulation from logged period data" (listing). Visuals [not observed].
- Colour/type/tone: web site body font Roboto, H1 48px "We're Flo, the world's #1 women's health app" (computed style, flo.health). In-app colour [not observed].
- Empty states: [not observed].
- Privacy: "Anonymous Mode" described as use "without any personal identifiers being linked to your health data" (listing). The FAQ (snippet) states the trade-off in plain words: once it is on, data cannot be recovered if the phone is lost or changed. The listing's own App Privacy block, not verified by Apple, still lists health, contact, identifier and location data as linked, and identifiers and location as used for tracking. Note the tension.
- Pairing/sync UI: [not observed]. Alert wording: [not observed].
- Pricing structure: Free with in-app purchases; Premium priced "from $1.99 to $59.99" across several items; Premium bundles insights, expert videos, assistant. Subscriptions are split by life stage (cycle, pregnancy, birth-control reminder) with a free trial each.
- Accessibility claims: "developer has not indicated which accessibility features" (listing). Help centre has no accessibility category: eight categories, from Getting Started to Flo for Partners.
- Disclaimer: "does not provide medical advice, diagnosis, or treatment"; not a method of birth control.

### 1.2 Clue
- URLs: https://helloclue.com/ , https://helloclue.com/privacy , https://support.helloclue.com/hc/en-us/articles/215935063-How-do-I-track-my-period (snippet), https://support.helloclue.com/hc/en-us/articles/15007319214493 (snippet)
- Onboarding: [not observed].
- Home/Track/Calendar: tabs named Track and Calendar exist (help snippet). The Calendar "can get crowded with icons and colours, and the help icon in the top-right corner explains them" (snippet).
- Logging: Track or Calendar, choose the day (double-tap in Calendar), pick the Period category, choose a flow level (Light, Medium, Heavy, Super heavy), tap Save. That is about four steps (snippet). Categories are groups such as Period, Pain, Feelings; the site says symptom logging takes "seconds".
- Calendar/prediction visuals: period days in shades of red by flow; fertile window blue and can be switched off; predicted PMS days as white clouds; predicted periods light pink; predictions need about three cycles and use the last six (snippet).
- Colour/type/tone (web): H1 "The #1 women-led period and cycle tracker app", font Tt Commons 72px, colour rgb(168, 0, 20) deep red; body Arial; cookie banner with Essential, Analytical, Marketing toggles and both "Accept all" and "Reject all" buttons in the same blue (computed style and page text, helloclue.com). Tone: warm, inclusive ("everyone with a cycle").
- Empty states: [not observed].
- Privacy: a block titled "Your data is safe with us"; says never sells health data or shares it with authorities. The full privacy policy is one very long page with 11 numbered sections and lettered subsections (about 131k characters), with first-person bold consent statements. Plain headings mixed with legal ones.
- Pairing/sync, alert wording: [not observed].
- Pricing structure: Free (account, basic stats, basic predictions) versus Clue Plus (advanced insights, pattern analysis, switchable tracking modes, partner sharing via Clue Connect, 10 extra categories such as sleep quality). A "25% off" banner; no prices shown on the page.
- Accessibility: [not observed].

### 1.3 Natural Cycles
- URLs: https://www.naturalcycles.com/ , https://help.naturalcycles.com/hc/en-us/articles/360003339574-What-are-Red-and-Green-Days (snippet), https://help.naturalcycles.com/hc/en-us/articles/12125166082717 (snippet)
- Onboarding: the site lists four steps: sign up with subscription and device, download the app, "Follow the steps to set up your device", start measuring. Questions asked: [not observed].
- Home ("Today" view): a large coloured circle with text inside. Red day: red circle and the words "Use Protection". Green day: green circle and "Not fertile" (snippet). In Plan Pregnancy mode red days run on a light-pink to dark-red scale, and brown days appear when more data is needed (snippet).
- Logging: temperature and period data; the app tells you at once if a temperature looks implausible (snippet). Tap count [not observed]. Advice: log at least 70% of the time, or 5 of 7 days (snippet).
- Visual (web, observed in the browser pane): warm grey page background rgb(243, 238, 238), near-black text, purple accent rgb(114, 3, 93) on the Sign up button, H1 52px "Take control of your cycle" with the last word in purple, font Open Sauce One. A pill with "6+ million users", outlined "Explore" button.
- Privacy: "your data stays yours"; says it does not need to sell data; regulated medical device with FDA cybersecurity requirements. No detail.
- Pairing/sync: names compatible wearables (Oura, Garmin, Whoop, Apple Watch); sync UI [not observed].
- Alert wording: see Red days above. The red day is the only alarmed wording seen, and it is an instruction, not a fear message.
- Pricing structure: annual and monthly subscription; device bought separately; no prices shown.
- Accessibility: none claimed; many images with empty alt text on the site.
- Notes: over 18 only; effectiveness stated with typical and perfect use.

### 1.4 Ovia
- URLs: https://www.oviahealth.com/
- Observed: marketing site of Ovia Health by Labcorp. Consumer app described as three things: clinically guided programmes, personal tracking that syncs with Apple Health and Google Fit, and Care Team support, "unlimited, live 1:1" by message, phone or video "at no cost to the member". Sold mainly through employers, health plans and health systems.
- Onboarding, home, logging, calendar, empty states, alerts: [not observed]. Privacy: links only (privacy policy, non-app privacy policy, terms). Pricing: no individual price; free to members via their sponsor. Accessibility: [not observed].

### 1.5 BabyCenter
- URLs: https://www.babycenter.com/ (blocked), listings via search: https://apps.apple.com/ca/app/babycenter-pregnancy-tracker/id386022579 (snippet)
- Observed (snippet only): setup is one step, the due date; content then arrives by week of pregnancy; "Birth Club" community by due-month; health content approved by a medical advisory board; extras are a bump photo diary and a baby-names finder.
- Everything else, including ads, privacy and accessibility: [not observed].

### 1.6 Huckleberry
- URLs: https://huckleberrycare.com/ , https://huckleberrycare.com/product/free , https://huckleberrycare.com/blog/how-to-use-our-magical-sleep-predictor-sweetspot
- Onboarding: free sign-up, or download; two weeks of paid features free. Questions asked [not observed].
- Home: "adjust your Home Screen as they grow" (product page). Layout [not observed].
- Logging: "Built-in timers for sleep, feeding, and pumping sessions"; feeding covers nursing, bottle, tube, solids. The free page does not state one-touch logging; the store listing (snippet) says free includes "one-touch logging".
- Prediction (SweetSpot): app path is Child Profile tab, then "SweetSpot Settings" (bedtime, number of naps, "Custom SweetSpot"); an optional "SweetSpot Alert" notifies a set number of minutes before. Starts at 2 months. iOS lock-screen Live Activities and widgets (snippet). On-screen look and colours [not observed].
- Colour/type (web): Avenir, H1 "Sleep experts for every family." 46px, bright cyan button rgb(54, 210, 234) on white.
- Privacy: only a footer link on the home page.
- Pricing: three tiers named Free, Plus, Premium. Free: sleep, feeding, general tracking. Plus adds Insights, SweetSpot, Schedule Creator, AI logging, widgets, Watch, enhanced reports. Premium adds personalised sleep plans and a 24/7 guidance assistant. **Predictions are behind the paywall.**
- Multi-caregiver: caregivers can share one account across phones with automatic sync (FAQ on the free page).
- Accessibility: [not observed].

### 1.7 Nara Baby
- URLs: https://nara.com/ (now an unrelated formula-recall page, not the app), search snippets for the app listing (id1444639029).
- Observed (snippet): free, no ads or in-app purchases (one listing and one review); breastfeeding timer with left/right tap and a note of which side ended last feed; bottle by time and amount; multiple children; caregivers log and sync; graphs and reports. One aggregator says the app is in maintenance only, so treat as unverified.
- Everything else: [not observed].

### 1.8 Glow (Glow, Nurture, Baby, Eve)
- URL: https://glowing.com/
- Observed: four apps in one family; screenshot carousel; a new free "voice wellness check-in" ("Just talk for 20 seconds" producing a daily score for mood, energy, stress); Premium "starts with a 7-day free trial, then costs $59.99 per year", works across apps, "ad-free experience" is a Premium item (so the free tier carries ads); partner connection with shared fertile-window alerts; community members shown by the first two letters of their name; data export by emailing support (CSV).
- Onboarding, logging taps, calendar visuals: [not observed].

### 1.9 Medisafe
- URLs: https://apps.apple.com/us/app/medisafe-medication-management/id573916946 , https://www.medisafe.com/ , https://help-center.medisafe.com/en/articles/8395236-all-about-medfriends
- Onboarding, home layout: [not observed]. Reschedule: tap the next dose on Home and choose Reschedule (snippet).
- Reminders: fire "even if your device is asleep"; timezone aware; lock-screen widget; "Medtones" voice packs, including celebrity and character voices; refill reminders (listing).
- Missed-dose wording in app: [not observed]. The listing frames misses as risk: "missing a dosage", "taking a double dose".
- Caregiver ("Medfriend"): invite from side menu; the invite carries a **4-digit code** the friend types under "Verification Code"; view-only ("only viewing and not editing"); gets an alert if a dose is not actioned, 30 minutes after your last reminder, one hour after the scheduled time, fixed and not editable; rescheduling resets the timer. The article describes no separate consent step beyond the invite and code.
- Privacy: listing declares Health & Fitness, contact, identifiers, and also **Advertising Data and Device ID for third-party advertising** (not verified by Apple); claims HIPAA "best practices" recognition. The company site is a B2B pharma pitch (headline "patient engagement engine for pharma portfolios").
- Pricing: free with IAP; about $2.99 to $9.99 monthly, $27.99 to $39.99 yearly tiers (listing, inconsistent).
- Accessibility: "has not yet indicated".

### 1.10 Strava
- URLs: https://www.strava.com/features (nav and footer only), https://support.strava.com/hc/en-us/articles/216919377 , privacy-zone coverage via snippets (road.cc, bikerumor)
- Privacy controls: each activity is Everyone, Followers or Only You; a default can be set in Settings then Privacy Controls, and changed per activity via the pencil on web or the three-dot menu on mobile, then Visibility. Private activities do not appear on public leaderboards. Privacy zone hides up to 1 mile around an address; your own view shows the hidden part in grey and others see orange (snippet). Researchers reported the distance value could still leak (snippet).
- Home, record flow, streaks: [not observed] on the features page (it is navigation and footer only).
- Pricing structure: Subscription, Family Plan, Student, Gift, Teacher/Military/Medical discount, Bulk (footer links).
- Accessibility: [not observed].

### 1.11 Omada
- URL: https://www.omadahealth.com/
- Onboarding (FAQ, observed): three steps. 1 confirm coverage through employer or health plan, 2 short application for clinical eligibility, 3 once accepted: create a password, answer health questions, get paired with a coach and a peer group; a Welcome Kit ships first.
- Structure: audience menu For Individuals / For Organizations, hero stats, tabbed "Covered Conditions" (diabetes, hypertension, prevention, joint and muscle), video testimonials, FAQ accordion, disclaimer. Site has visible placeholder text in menu cards ("Duis mollis...") and a third-party ad in a menu.
- Devices: smart scale, BP monitor, glucose meter and CGM for eligible members, "yours to keep", sync to the app.
- App screens, alerts, sync UI: [not observed].
- Pricing: "at no cost to you" via employer or plan; joint and muscle subject to deductible and copay.
- Privacy: policy, HIPAA notice and state notices linked, no summary. Accessibility: only a "Language Help" link.

### 1.12 Apple Health
- URLs: https://www.apple.com/ios/health/ , https://support.apple.com/guide/iphone/track-your-menstrual-cycle-iph7ef4e6f1b/ios
- Observed: a Summary caption lists tiles for activity, cycle tracking, headphone levels, resting heart rate, sleep and state of mind. Cycle tracking logs periods, symptoms and cycle factors, predicts next period and fertile window, and can notify about cycle deviations and possible perimenopause (age 40 plus). "should not be used for birth control." Interactive charts for state of mind. PDF export to share with a doctor.
- Privacy wording: "encrypted on your device"; with iCloud and two-factor, end to end so "not even Apple can access your information".
- Sharing: only children's daylight time is called out on that page. Cycle sub-articles: Log, View predictions and history, Log a pregnancy, Track menopause stages (support TOC only; the step text was not returned).
- Tap counts, empty states, accessibility claims: [not observed]. Redesign "arrives in late 2026" is stated on the page.

### 1.13 Withings Health Mate
- URLs: https://www.withings.com/us/en/health-mate (403), https://apps.apple.com/au/app/id542701020 (snippet only)
- Dashboard, sync status UI: [not observed].
- Pricing (secondary reports, not Withings' page): Withings+ about $9.95 a month or $99.50 a year; it gates **automatic sync to Apple Health and Health Connect** for accounts created after a cutoff reported as 12 or 13 October 2026; basic data stays free and every user can export CSV or PDF; sync pauses without data loss if the plan lapses (ithinkdiff, mac4ever snippets).

### 1.14 Oura
- URLs: https://ouraring.com/ , https://support.ouraring.com/hc/articles/360025589793 (snippet)
- Site: "Wear your best life" H1 in Editorial New (serif) 72px, body AkkuratLL, blue Shop Now button rgb(42, 114, 222) (computed style). App "tracks over 50 health metrics". "Health Radar" is described as "patterns worth noting" with a footnote "general wellness purposes only". Marketing claims include "86% of Oura Members see their health improve" and a testimonial "saved my life".
- Readiness bands (support article snippet): 85-100 Optimal, 70-84 Good, 60-69 Fair, 0-59 Pay Attention; contributors needing attention get a red progress bar and a "pay attention" message; a crown icon appears at 85 or more; **Rest Mode** lets you mute activity scores and contributors during illness. A blog page gives only three bands, so the sources disagree.
- Today/Vitals tab layout, pairing UI: [not observed]. Pricing: "Explore Membership" link, no price on the page. Privacy: "We care about protecting your data", links to Privacy Policy and Security Center.

### 1.15 WHOOP
- URLs: https://www.whoop.com/ (403, membership page 403); search snippets: https://www.whoop.com/ch/pt/thelocker/how-does-whoop-recovery-work-101/ , https://developer.whoop.com/docs/whoop-101
- Recovery is a daily percent in three colour bands: green 67-99 (developer docs say 67-100), yellow 34-66, red 1-33 (docs say 0-33); WHOOP's own podcast says the colours simplify a continuous scale so 66 and 67 are neighbours (snippets). Colour guidance is "push harder / moderate / rest".
- Tiers, onboarding, privacy, app layout: [not observed].

### 1.16 Samsung Health
- URL: https://www.samsung.com/us/apps/samsung-health/
- Structure of the page (and so of the product's feature groups): Activity, Sleep, Nutrition, Mindfulness, Vitals, More, FAQ; Medication Management with reminders, interaction info and prescription scanning; Blood Pressure Trend, ECG and irregular-rhythm alerts; cycle tracking from skin temperature during sleep.
- Privacy wording: heading "Your health data is stored safely with Samsung Knox"; "you can stop sharing data at any time."
- Home layout, sync UI, accessibility, pricing: [not observed].

### 1.17 Hilo (formerly Aktiia)
- URL: https://hilo.com/ (https://aktiia.com redirects here)
- Structure: nav (Get Hilo, How it Works, Clinical Evidence, Resources, Accessories), hero "Next-generation blood pressure monitoring", press logos, a membership of three parts (Band, App, Cuff), testimonials, four app feature sections, key figures, comparison table vs a cuff.
- App (as described): weekly and monthly averages, trend spotting, "time spent within target range", doctor-ready reports; readings with weak signal are discarded; the cuff is used for "initial and periodic calibration".
- Accessibility: a "Skip to content" link is present on the site. No statement. Pricing: none shown; a regional popup and waitlist. Alert wording, pairing UI: [not observed]. Privacy: footer link only.

### 1.18 Dexcom Stelo
- URLs: https://www.stelo.com/ , https://www.adces.org/education/danatech/glucose-monitoring/continuous-glucose-monitors-(cgm)/cgm-selection-training/dexcom-g7-and-stelo-differences (snippet)
- Page: hero "Get 24/7 insights into how food, exercise, stress, and sleep affect your glucose.", benefits grid of ten outcomes with numbered citations, AI coach section with "not medical advice" footnote, testimonials (one marked paid), long disclaimer block.
- Pricing: "Glucose Biosensor, Monthly Subscription: $89.00" with $99.00 struck through; HSA/FSA eligible.
- Warm-up 30 minutes, sensor up to 15 days, adults 18 plus not on insulin; one footnote admits about 20% of sensors may not last the full 15 days. A diabetes-educator page says Stelo has **no real-time high/low alarms** (snippet; Dexcom's page is ambiguous, so unconfirmed).
- Graph, colours, glucose zones, pairing screens, alert wording: [not observed]. Accessibility: none stated; generic alt text.

### 1.19 mySugr
- URL: https://www.mysugr.com/
- Tone: friendly, informal; the "diabetes monster" mascot; "Make diabetes suck less."
- Logging: "Personalized Logging Screen" for insulin, activity, carbs and photos; meters can send readings over a wireless link; individual steps [not observed]. Logbook shows glucose, insulin and carbs graphs, daily averages and an **estimated A1c at the top of the screen**; the Logbook is a Class IIa device in the EU.
- Pricing: Basic free (logging, estimated A1c, backup, CSV reports) and PRO (bolus calculator, PDF and Excel reports, reminders, meal photos); PRO "free" for people who connect Accu-Chek devices.
- Privacy: "secure and encrypted", GDPR; footer notices. Accessibility: [not observed].

### 1.20 Hello Heart
- URL: https://helloheart.com/
- Page: hero "Here for every beat."; a free BP monitor offer; "Safe AI" section; the "Nia" 24/7 chatbot "informed by ACC and AHA guidelines and trained by clinicians", which clients can turn on or off; a connected pill box marked "Coming soon"; a privacy statement.
- Privacy wording: "we will never sell our members' health information".
- Pricing: consumers see no tier; employers purchase ("See if your company has you covered"). Cuff sync UI, alert and insight sample text, logging steps: [not observed]. Accessibility: none stated; form fields are labelled.

---

## 2. What Tarragon does today (read from the repo)

- Mobile cycle screen: `apps/mobile/src/screens/sections/cycle-screen.tsx` (757 lines). Cards named "Your tracker", "Where you are now", "What to expect", "Log a day", "Your patterns", "Periods you have logged". Two big period buttons: "My period started today" / "My period has ended". Log-a-day copy: "Tap anything that applies. Nothing here is required." A date field with a "Go" button and a "Today" button. A "Save this day" button. Inline chips for flow, physical symptoms, mood, an optional ovulation-test and waking temperature block. A "planning mode" switch. Danger signs card links to Messages; a calmer "Worth mentioning to your care team ... None of them is an emergency." card. The cycle sits inside `PrivateSection` with `CycleDangerSigns` outside it, so a shared phone can lock the private part but the safety card still shows. Errors: "We could not load your cycle just now." with "Try again".
- Observation: this screen is the **legacy** style, with inline font sizes of 11.5, 12.5, 13, 14.5 and many `Text`/`MutedText` pairs, while `apps/mobile/src/ui/kit/*` is the newer kit (Sora headings, Inter body, 12 to 40 scale, dark palette, text-scaling test).
- Mobile theme: `apps/mobile/src/ui/theme.ts` has brand `#0E7C52`, pressed `#0B6342`, navy `#12324B`, ink `#1C1917`, muted `#57534E`, `subtle #6B6560` (the only tertiary text colour allowed to carry text, 4.9:1), faint `#A8A29E` for decoration only (fails AA as text), background `#FAFAFA`, groupBg `#F1ECE3`, status warn `#B45309` on `#FEF3C7`, danger `#B3261E`, emergency `#DC2626`. Note `docs/BRAND_GUIDE.md` says mobile screens ship `#FAF7F2`; the legacy theme file says `#FAFAFA`. I did not check which one the kit palette uses, so treat this as a doc/code check, not a finding.
- Kit parts that matter: `EmptyState` (comment: never use for a failed load, "a failed read is never shown as none"), `ListenButton` (a "Listen" button shown only when a recorded, signed-off clip exists; words never replaced by audio), `InlineAlert`, `Skeleton`, `TrendChart`, `SegmentedControl`, `Sheet`, `Toast`, `PressableScale`, `haptics`, `FreshnessNote`, `NotADiagnosis`, `FeatureConsentGate`, `ActingForBanner`, `CycleDangerSigns`, `CyclePrivacyControls`, `ContraceptionEducation`. Repo tests: `a11y-scan.test.ts`, `text-scaling.test.ts`, `dark-aware.test.ts`.
- Web patient area: `apps/web/src/app/(dashboard)/patient/cycle/` has a ring (`cycle-ring.tsx`, `role="img"` with an `aria-label` that falls back to "No cycle logged yet."), a month calendar (`cycle-calendar.tsx`, `role="grid"`, per-day `aria-label`, `aria-current`, `aria-pressed`, prev/next month labels), a day log, an insights card, a length chart, privacy controls (access list with an explicit empty line `cycle.access.empty`, `role="alert"` errors), danger signs, a fertile-window notice. Also `growth-tracking-card.tsx` (paediatric, renders nothing at 19 plus, MUAC field with a help id), `device-sync-support-card.tsx` ("That's likely why nothing is syncing..." plus a warning icon), `cohorts/cohorts-home.tsx` (loading, closed, off and empty states each in `role="status"`), `care-circle/` (check-in card, help-alert card with consent block, pending gifts, manager).
- Brand: warm, calm, never alarmist; Red reserved "strictly for true clinical alerts"; always icon plus colour; Sprout Gold never for alarm; Sora headlines, Inter body ("excellent on low-end Android"); rounded 2px-stroke single-colour icons; card-based, "one clear next action" per card; no em dashes (house rule).

---

## 3. Design-pattern table

Constraints applied to every "adaptation" cell: low literacy, low bandwidth, shared phone, English only, no ads, warm non-fear voice, Tarragon Green `#0E7C52`.

| Pattern | Who does it best (observed) | Tarragon today | Recommended adaptation |
|---|---|---|---|
| Status as one big word plus colour, not a number | Natural Cycles: large circle with words "Use Protection" / "Not fertile" (snippet) | Cycle "Where you are now" card with text and a ring on web | One large plain-word status per card ("Period expected in about 3 days"), paired with an icon and a Green/Amber/Grey tint. Never red for a prediction. |
| Quick period log, minimal taps | Clue: about 4 steps (Track, Period, flow, Save) (snippet) | Two top buttons (1 tap) plus a longer "Log a day" form | Keep the one-tap buttons. Make the day form a bottom sheet with five big flow chips, Save pinned at the bottom, and no required field (already true in copy). |
| Optional everything, no streaks | Clue "seconds"; Tarragon's own "Nothing here is required." | Present in copy | Keep. Do not add streak counters or "you missed a day" prompts. |
| Plain explanation of colours on a crowded calendar | Clue: help icon top right explains marks (snippet) | Web calendar has aria labels; mobile has none | A single "What do these marks mean?" link opening a Sheet with three legend rows (icon, shape, word). Do not rely on colour alone (brand rule). |
| Prediction with honest confidence | Clue: needs about 3 cycles, based on last 6 (snippet); Hilo discards weak-signal readings | `prediction.confidenceReason` and `FERTILE_WINDOW_DISCLAIMER` already shown | Show confidence as words ("early estimate, gets better after 3 cycles") plus a small dot scale, not a percent. Keep the disclaimer. |
| Privacy in plain words with the trade-off stated | Flo: states data cannot be recovered after Anonymous Mode (snippet); Apple: "not even Apple can access" | `PrivateSection`, `CyclePrivacyControls`, `FeatureConsentGate` | One screen "Who can see this" with three rows (Only me, My care team, People I choose), each a toggle with a one-sentence result. State consequences ("If you lose your phone, this cannot be restored without your login"). |
| Shared-phone lock | Strava per-item visibility (Everyone, Followers, Only You) | `PrivateSection` hides cycle content | Offer a "Hide this on this phone" quick toggle on every sensitive card, and never put cycle words in a notification title or lock-screen text. |
| Consent for a caregiver or partner | Medisafe: invite plus 4-digit code, view-only; Clue Connect and Glow partner sharing | Care Circle with consent block and check-in | Keep consent in the app, show exactly what the person will see in a preview before the invite is sent, and let the patient revoke from the same card. |
| Free tier that still shows history | Nara Baby (free, no ads, snippet); mySugr Basic (backup, CSV) | App is free; history not gated | Keep history and export free forever. This is a trust advantage over Huckleberry (predictions in paid) and Withings (sync behind a plan). |
| Reminders with honest missed wording | Medisafe: sends alert to a friend at 1 hour (snippet) | Care Circle check-in card | Missed-dose or missed-log wording: "No problem. Want to log it now?" One snooze. No escalation to another person without the patient's earlier consent. |
| Score bands with a rest option | Oura: Rest Mode to mute scores when ill; four named bands with "Pay Attention" | No scores on cycle screen | If scores are ever added, use named bands in Tarragon Green, Sage and warm Grey only, add a "pause my scores" switch, and never name a band after fear. |
| Colour for good/neutral/low recovery | WHOOP green, yellow, red (snippet) | Clinical status colours exist as a separate system | Do not copy red for lifestyle metrics. Reserve red for the existing clinical-alert system only. |
| Pairing and sync status | Natural Cycles lists compatible wearables; Medisafe "even if your device is asleep" | `DeviceSyncSupportCard` explains why nothing syncs | A three-state line on every device row: "Connected, last reading 2 hours ago" / "Waiting for the first reading" / "Not connected. Tap to fix". Always show the last-synced time in words. |
| Empty state that says what to do next | Tarragon kit `EmptyState` | Exists, with rule "failed load is never empty" | Keep. Each empty state gets one sentence, one Green button. Cohorts and cycle-access empties need the same pattern. |
| Alert wording | Brand guide; Natural Cycles uses instruction words | `CycleDangerSigns`: "None of them is an emergency" | Template: what we noticed, what it may mean in one line, one next step, one button to message the care team. No exclamation marks, no "WARNING". |
| Low-literacy support | Tarragon `ListenButton` (nobody observed does this) | Built, shown only if audio exists | Put a Listen icon on every card title that explains a result, status, or alert, plus icons beside every chip label. |
| Low bandwidth | None observed | Skeletons and freshness notes exist | Offer text-only first paint, defer charts and images, and show "Saved on this phone, will send when online" on every log button. |
| Anonymity and device-only mode | Flo Anonymous Mode | Not present (account is tied to care) | Do not copy. Tarragon's value is a care team. Instead offer a clear "Pause sharing with my care team" for cycle data, as the category-scoped model already allows. |
| Pricing page structure | Clue: Free vs Plus two-column; Huckleberry Free/Plus/Premium | App free; doctor time per piece of work | One plain list: "Free: tracking, history, export, reminders. Pay only when you ask for a doctor's time", with the naira price beside each doctor service. No crossed-out prices. |
| Accessibility claims | None of the 20 state any (see section 1) | A11y tests in repo; `subtle` colour at 4.9:1 | Publish a short plain accessibility statement and check the text size on the legacy cycle screen (11.5 to 14.5 px). |

---

## 4. Ranked list of 15 concrete UI changes

Ranked by effect on the target users (low literacy, shared phone, low bandwidth) against effort. The first six need little new infrastructure.

1. **Move `cycle-screen.tsx` onto the kit and raise minimum text to 14 (body) and 16 for actions.** Mobile cycle screen. It still uses 11.5 to 14.5 px inline sizes and the kit is the one with text-scaling tests.
2. **Replace the "Go" date field with a week strip of seven tappable days plus a "Pick another date" link.** Mobile and web cycle "Log a day". Removes typing a date; one tap to choose a day.
3. **Turn "Log a day" into a bottom sheet with icon-plus-word chips (flow, pain, mood), Save pinned at the bottom.** Mobile cycle. Keep "Nothing here is required".
4. **One plain-word status line at the top of the cycle card, with icon and tint** ("Period expected in about 3 days. Early estimate."). Mobile cycle and web `cycle-ring.tsx`.
5. **A "Who can see this" screen with three rows and a one-sentence consequence for each, plus a preview of what a caregiver sees.** `CyclePrivacyControls` (mobile) and `cycle-privacy-controls.tsx` (web), and the Care Circle invite step.
6. **"Hide on this phone" quick switch on sensitive cards, and a rule that no notification title or lock-screen text names a cycle, pregnancy or contraception topic.** Shared phones; cycle, pregnancy, contraception, growth cards.
7. **Listen button on every card title that explains something** (status, result, danger sign, device state). Use the existing `ListenButton`; show a text fallback when no clip exists. Cycle, pregnancy, devices, alerts.
8. **A legend sheet ("What do these marks mean?") on the calendar** using icon shape plus word, not colour only. Web `cycle-calendar.tsx` and the mobile calendar.
9. **Device rows with three-state sync text and last-synced time in words**, with one Green fix button. Devices screen and `device-sync-support-card.tsx`.
10. **Save-offline message on every log button** ("Saved on this phone. It will send when you are online"), with a small queue badge. All logging forms, especially cycle, vitals, growth.
11. **Confidence shown as words plus a three-dot scale** for cycle and fertile-window predictions. Mobile "What to expect" and web insights card.
12. **Standard alert template (noticed, meaning, one step, message button)** and a lint test that rejects "WARNING", exclamation marks and red on non-clinical cards. `CycleDangerSigns`, pregnancy red-flag check, growth card.
13. **Care Circle check-in wording and one snooze:** "No problem. Want to answer now?" with no second-person alert to a relative unless the patient agreed during setup. `care-circle/check-in-card.tsx`, `help-alert-card.tsx`.
14. **Empty and closed states for cohorts and cycle access use `EmptyState` with one sentence and one button**, and a different "could not load" state with "Try again". `cohorts/cohorts-home.tsx`, `cycle.access.empty`.
15. **A one-page plain pricing and accessibility statement:** "History and export stay free. You pay only when you ask for a doctor's time", the naira price next to each doctor service, and a short list of what the app does for large text, screen readers and audio. Marketing site and in-app Settings.

---

## 5. Patterns to avoid

Dark patterns and engagement tricks seen or reported in the products above, and why Tarragon should not use them:

- **Streak shame and daily-log nagging.** Natural Cycles asks to log at least 70% of days, and more red days follow missed measurements (the page says so); that is a sound product rule for contraception, not a pattern to copy for general tracking. No streak counters, no "you broke your streak", no badges for logging every day. Keep "Nothing here is required."
- **Paywalled history or sync.** Huckleberry puts predictions behind Plus; Withings+ now gates automatic sync to Apple Health and Health Connect for new accounts (secondary reports). Do not gate a person's own readings, history, export or sync. A paid doctor service is fine; their own data is not for sale.
- **Alarmist or red-for-everything colour.** Natural Cycles uses red as a day label, WHOOP uses red for low recovery, Oura marks "Pay Attention" with a red bar. For lifestyle and prediction information use Green, Sage, warm Grey and Blue. Red stays for true clinical alerts only (existing brand rule).
- **Fear copy and borrowed authority claims.** "saved my life" and "86% see their health improve" style claims (Oura home page) and "proven" claims; do not use. Say what we observed in the person's own numbers.
- **Alerting a relative without the patient's earlier, specific agreement.** Medisafe's flow notifies a friend one hour after a missed dose; the consent step beyond invite and code is not described. Tarragon must show a preview of what the person will see and let the patient turn it off any time.
- **Ads and ad-tech in health apps.** Medisafe's listing declares advertising data and device ID for third-party advertising; Glow lists "ad-free" as a Premium perk; Flo's listing shows tracking-linked identifiers beside an "anonymous" claim. Tarragon: no ads, no ad SDKs, no advertising ID, and say so in one line in Settings.
- **Privacy that needs a lawyer to read.** Clue's policy is one page of 11 numbered sections with lettered subsections. Use a short plain summary first and the full text second.
- **Privacy claims with a hidden contradiction.** Flo's "anonymous" next to linked identifiers in its listing; Clue's "anonymous to researchers" next to a random-ID description. Only claim what is true on the screen, and state limits ("cannot be restored if you lose your login").
- **Cookie banners that tilt the choice.** Clue's banner is a good model (Reject all as visible as Accept all); do the same, and prefer not to need one.
- **Crossed-out prices, countdown offers, "25% off" banners** (Clue, Stelo). No false urgency. One price, shown once.
- **Gamified mascots or celebrity voice packs on medicine reminders** (Medisafe "Medtones", mySugr monster). Fun for some, but they trivialise serious conditions for others, and a voice pack on a shared phone can disclose what a person takes. Keep reminders neutral and private by default.
- **Predictive certainty.** "Green day" style certainty belongs to a regulated contraceptive device. Tarragon predictions are estimates and must say so (the existing disclaimer is right).
- **Hidden trade-offs on privacy modes.** Offer a mode only if the consequence is stated before the switch, not after.
- **Unlabelled placeholder content or third-party ads inside navigation** (seen on Omada's marketing menu). Not an app pattern, but a lesson: ship no filler.

---

## 6. Gaps and follow-ups

- Nothing here confirms in-app screens. To close that: run each app on a test device and record the first-run flow by hand, or use the apps' own public demo videos. This was not done and is out of the read-only brief.
- Unopened: Apple App Store pages for Clue, Natural Cycles, Huckleberry, Ovia (rate-limited or 404); WHOOP and Withings sites (403); BabyCenter (blocked); Nara Baby (site changed). Retry later or read the Google Play pages from a normal browser.
- Check which background colour the mobile kit palette uses against the brand guide's `#FAF7F2` statement, and update whichever is stale.
