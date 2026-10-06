# S29 design review: whole patient experience (Topic C)

Date: 2026-10-06. Method: public web search results only (search summaries and vendor or NHS pages). No app was installed or used, so first-run and in-app behaviour is mostly "unverified" unless a source is named. No text or visuals copied. Where a point is my own reasoning, it is marked "inference".

Sources used: NHS BP@Home pages (Essex ICB, Sussex ICS, North Yorkshire, Healthwatch evaluation), Omada site and press coverage, Teladoc Livongo pages, Medisafe pages, mySugr and Glooko and Dario pages, Withings, Qardio, Omron reviews, Reliance Care and Helium Health and Wellahealth listings, Opera Mini pages, Techpoint on Clafiya.

## 1. Competitor notes

**Omada.** Connected cellular BP cuff and smart scale are sent to the member, so readings upload with no phone pairing (verified, press). A health coach plus a hypertension specialist plus peer groups sit behind the app. Notable: the device does the logging, the human does the follow-up. Cost model is employer or insurer paid. Offline behaviour and first-run: unverified.

**Livongo / Teladoc.** Member sets which out-of-range readings should trigger contact, the contact method, the ranges, and do-not-disturb hours; a coach then texts or calls on an out-of-range reading (verified, Teladoc library). Notable: patient-controlled alert rules and quiet hours, and a real human reply to a bad number. Heavily US, device-bundled.

**Kaia.** Search returned nothing usable. Everything about Kaia is unverified. Known only from general knowledge: a short daily lesson plus exercise plan format (unverified here).

**Lark.** Described in store and review text as supportive and nonjudgmental, with daily articles (verified, store listing). Chatbot-style coaching. Not suited to our safety needs: no on-call clinician path found.

**Noom.** Daily 5 to 10 minute CBT-style lessons that introduce ideas gradually (verified, vendor and review pages). Notable: motivation through learning, not through scolding. Lesson length is a data and attention cost for us.

**Medisafe.** Medfriend: a nominated person gets an in-app alert about 30 minutes after a missed dose and can see the schedule once they accept (verified). Free tier limits the number of Medfriends. Notable and a risk for us: the supporter sees dosing detail. Our Care Circle summary-only rule is stricter and better.

**MyTherapy.** Not searched. Unverified.

**Withings Health Mate.** One app for the whole device family, with data shared to a doctor by email or PDF (verified, review text). Notable: the report to the doctor is a first-class output.

**Qardio.** Cuff flags irregular heartbeat during a reading and shares to a clinician platform (QardioMD) (verified, vendor). Notable: the warning is attached to the measurement moment.

**Omron Connect.** Charts readings and can email them to a doctor; reviewers call the app more complicated than rivals (verified, one review). Omron is also the cuff patients most likely already own in Nigeria (inference).

**Apple Health.** Not searched. Unverified. iOS only, so low relevance to an Android-heavy base.

**BeatO.** Auto-stored glucose readings, colour-coded results, simple graphs, a chatbot, vitals tracking and online consults (verified, store text). Strong relevance for phase two (diabetes) because it comes from a price-sensitive, Android-heavy market (India). Offline detail: unverified.

**Dario.** Glucose meter plugs into the phone, BP also supported, estimated A1C, and a hypo alert that texts up to four people with the reading and a GPS link (verified, store and Healthline). Notable: a one-tap emergency broadcast to supporters. For us this must be opt-in and must not name a condition in the lock-screen text.

**Glooko.** Syncs 200+ devices, digital logbook, and shares data with a clinic through a short code (verified). Notable: the clinic code is a simple, low-friction hand-off.

**mySugr.** A mascot "monster" reacts to log entries; points reward logging, not good numbers (verified from vendor blog titles; exact scoring unverified). There is a help page for turning the monster off. Notable: motivation without shame, and an off switch.

**Clafiya (Nigeria).** Nurse or community health officer with the patient in person and a doctor on video, at about N5,000, or virtual only at about N2,500 (verified, Techpoint, price may be dated). Offers hypertension and glucose screening. Notable: human-assisted care for people who do not want to self-manage on a phone. App detail: unverified.

**Helium Health (MyHelium).** Patient super-app to view records, book appointments and order medicines (verified, press). Hospital-led, not a daily loop product.

**mPharma (mymutti).** App shows wallet, loyalty points, nearest pharmacy and a pay-later scheme (verified, press release). Notable: money and pharmacy finder front and centre. Not a clinical loop.

**Reliance Health (Reliance Care).** HMO app with virtual ID card, 24/7 doctor chat, prescription delivery, live chat (verified, store listing). Notable: the plan card on the phone is the trust anchor.

**Wellahealth.** No consumer app found; WellaPartner is the pharmacy-side app (verified, TechCabal and store). Not a patient-app comparator.

**Africa low-data pattern (Opera Mini, Truecaller).** Opera claims up to 90 percent data reduction through server-side compression (verified, vendor claim, not tested). Truecaller-style guidance: local database, update in short bursts, SMS fallback, low-RAM design (secondary source). Notable: data cost is treated as a feature. SMS fallback is a channel we do not have, so the in-app inbox plus push must carry the load.

**NHS BP@Home.** Patient measures at home with a validated monitor (practice may lend one), records on paper, spreadsheet or online form, submits to the practice, and gets guidance on technique, frequency and when to seek advice (verified, NHS pages). Notable: a clear short measurement protocol, a fixed submission rhythm, and a lent device when the patient cannot buy one. The Healthwatch evaluation exists; I did not read its findings, so patient experience results are unverified.

## 2. Best practice table

| Best practice | Who does it | Do we have it | Gap or risk |
|---|---|---|---|
| Log first on the home screen | Livongo, Omada, BeatO (inference) | Yes, Today screen | Check it loads and logs with zero network and on 2 GB RAM phones |
| Device auto-uploads the reading | Omada, Withings, Qardio | Partial (manual plus BLE planned) | Most users will type values; add "which cuff" capture and a typo guard (e.g. 1200 vs 120) |
| Cuff checklist before a reading | NHS BP@Home | Yes | Add a short "rest 5 minutes" timer and a posture picture that works offline |
| Validated cuff awareness | NHS (validated or lent monitor) | Not stated | Risk: unvalidated cuffs give false reassurance or false alarm; need a cuff model field and a "not validated" soft warning |
| Offline queue and sync | Truecaller-style local data | Yes | Risk: triage must run on-device so a red reading never waits for sync |
| Patient-set alert rules and do-not-disturb | Livongo | Quiet hours and discreet mode yes | Patient cannot choose who is contacted and how; add contact preference |
| Human reply to an out-of-range reading | Livongo, Omada | Page to on-call clinician for red | Amber has no stated human follow-up promise; define a time (e.g. next working day) |
| On-device emergency guidance | None found among competitors | Yes | Strongest differentiator; keep text in English and Pidgin and testable with airplane mode |
| Neutral notifications | Not seen in competitors | Yes | Verify lock-screen text, email subjects and the app icon name are also neutral |
| Missed dose alert to supporter | Medisafe | Care Circle summaries only | Good restraint. Decide whether supporters ever get a "no reading this week" nudge, with consent |
| One-tap emergency broadcast to people | Dario | Page to clinician only | Consider an opt-in "tell my supporter" after a red result, neutral wording |
| Share a report with the doctor | Withings, Omron, Glooko | Weekly trends, clinician has data | Add a printable or shareable summary for a visit at a clinic outside our network |
| Motivation without shame | mySugr (points for logging), Noom, Lark | Not stated | Define wording rules: celebrate logging, never grade the number |
| Bite-size learning | Noom | Audio planned (S32-S33) | Keep audio short and downloadable on Wi-Fi |
| Low-data mode | Opera Mini, Truecaller | Planned (S34) | It is later than it should be; the daily loop is already data-light, so ship the data meter early |
| Language switch | Reliance (English), none in Pidgin found | Yes | Pidgin health terms need review by a clinician and a native speaker |
| Plan card as trust anchor | Reliance Care | Membership | Show a clear "your care team" card with names, hours and what a reply time means |
| Human-assisted option | Clafiya | Care team calls | People who cannot self-log need a supporter or nurse route (Care Circle can log on behalf, if allowed) |
| Lend or subsidise a cuff | NHS BP@Home | Not stated | Biggest equity gap; at least a recommended-cuff list and price guidance |
| Turn off gamification | mySugr | n/a | If we add streaks, include an off switch |

## 3. Twelve design changes, ranked

1. **Make the red result path work fully offline and prove it.** Why: this is the one moment where a failure harms someone, and no competitor shows it. Test with airplane mode, low battery and a locked screen. Caution: power cuts and no data are normal, so the on-call page must queue and retry over push and a call prompt, and the app must say honestly "we could not reach the clinician yet, call now".
2. **Calm, specific wording for high readings.** Why: fear of a high reading makes people stop measuring or hide readings. Say what to do next in one line, never a score or a colour alone. Caution: red must not read as a death sentence; amber must not read as "all fine".
3. **A cuff-validity step in setup.** Why: NHS guidance relies on validated monitors, and a bad cuff corrupts every later triage result. Ask brand and model, show a plain "recommended" or "not checked" label, keep logging allowed. Caution: do not shame people who bought a cheap cuff; they may have nothing else.
4. **Shared-phone mode.** Why: phones are shared in many homes, and a reading shown to the wrong person is a privacy harm. Add a quick lock (PIN or pattern) on open, a "this is my phone" check at first run, and a way to hide the last reading on the Today screen. Caution: tie each log to a named person and warn if two profiles log on one device.
5. **Discreet mode that covers everything, not only notifications.** Why: stigma around hypertension and diabetes, and family disclosure, are real. Neutral app name option and icon, neutral email subjects, no condition word on the lock screen or in the share sheet. Caution: neutral text must still be clear enough to act on, so test with real patients.
6. **Data cost shown to the user and low-data mode earlier than S34.** Why: airtime is a daily budget. Show "this screen used about X KB", send text only until Wi-Fi, queue photos and audio. Caution: do not make audio a surprise download; ask first and show size.
7. **Audio-first path for low literacy, in short pieces.** Why: Noom-style lessons work, but 5 to 10 minutes is too long here. Use 30 to 60 second clips, with a text transcript and big play buttons, available offline once downloaded. Caution: audio on a shared phone in a family space can disclose condition; offer earphone prompt and a "play quietly" option.
8. **Motivation rule: reward logging, never the number.** Why: mySugr rewards logging, and Noom teaches rather than scolds. Use "thanks for checking, that helps your care team" and a gentle weekly line. Caution: streaks that break after a power cut or missed airtime will feel like punishment; use "welcome back" with no penalty.
9. **Printable or shareable visit summary.** Why: Withings, Omron and Glooko all treat the doctor report as core, and many Nigerian patients also see a clinic or pharmacist outside our network. One page, plain language, works as a PDF or screenshot. Caution: sharing must be a deliberate tap and strip names the patient did not choose to share.
10. **Contact preferences like Livongo.** Why: patients want to choose who calls, when, and by which route. Let them pick a call window and a backup person. Caution: some will not want a call at work or at home; default to in-app and push, with the call only on red.
11. **A named human at the top of the app.** Why: distrust of apps is common; Reliance puts the plan card forward and Clafiya sells a human present in person. Show the lead clinician, how fast replies come and what the app will never do (never ask for money in chat, never ask for a password). Caution: promised response times must be real; an unanswered written question breaks trust faster than no promise.
12. **Cuff loan or partner-pharmacy cuff guidance.** Why: NHS lends monitors and we have no equivalent; without a cuff the product does not start. Even a short "buy this class of cuff, here is the price range" list plus a pharmacy BP-check log option helps. Caution: do not pick one brand without a regulatory check; that is the same line CLAUDE.md already draws on selling hardware.

## 4. Nigeria cautions (checklist)

- Shared phones: PIN on open, per-person profile, hide last reading, no auto-share to the first contact in the phone.
- Discreet mode: neutral app name, icon, notification and email text; no condition or number on the lock screen.
- Airtime and data: data meter, text-first screens, no auto-play, audio and image downloads opt-in with size shown.
- Low literacy and audio: icons plus words, spoken prompts, English and Pidgin, numbers read aloud.
- Power cuts: save every field as it is typed, queue every send, resume after a restart, battery-saver friendly (no constant background sync).
- Distrust of apps: show who the clinicians are, what happens to the data, and an easy way to delete it; never ask for payment inside a health message.
- Unvalidated cuffs: record the model, soften triage messages for unknown cuffs, suggest a recheck, never block a log.
- Fear of a high reading: calm wording, "recheck after rest", clear next step, no red-alarm sound unless the emergency rule fires.
- Supporters: summaries only (as built); a supporter must not receive a reading value or a condition name by push.

## 5. Limits of this review

- Kaia, MyTherapy and Apple Health were not verified. Lark and Noom were read through store and review text only.
- No competitor app was run, so first-run, offline behaviour and real data use are unverified for all of them.
- Clafiya prices and Opera's 90 percent claim are vendor or press figures and may be dated.
- The NHS Healthwatch evaluation was found but not read.
- Everything under "do we have it" comes from the brief given, not from reading our code.
