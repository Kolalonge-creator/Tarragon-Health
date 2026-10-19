# Retiring the older clinician message and the Care Circle notice: CMO test pack

For the Chief Medical Officer. Run this in staging with **test patients** before switching any version on at the sign-off hub (`/clinician/clinical-signoff`, the line "Older clinician-message retirement"). Nothing in this pack touches a real patient. Nothing switches itself on: the switch is yours and it asks you to confirm you ran this pack.

What this is, in one paragraph: today a blood pressure red event, a blood pressure crisis and (once its rules are signed) a glucose emergency each send **two** notices, the older one to every clinician at once and the on-call page to the clinician named on the rota. This change can stop the older one, but only for an event whose on-call page has actually been made and whose paged clinician can actually be reached. If that cannot be shown, the older notice is sent, exactly as today.

What it does not change: the emergency guidance the patient sees, the emergency contact notice, amber ("review needed") levels, every other kind of emergency, the abnormal screening result pathway, what a Free patient gets, and any page already open.

## The four versions

| Version | What it does | Needs |
|---|---|---|
| 1 | **Parallel run.** Nothing changes for anyone. Every event records whether and how fast its page arrived. | Nothing. Switch this on first and leave it on until you have enough real events to judge. |
| 2 | Stops the older message for blood pressure red events and glucose emergencies' RED level, once the page is confirmed. Emergency-level events keep their older message. | A version 1 run of at least 7 days that measured at least 20 real events (the database refuses otherwise and tells you the numbers). |
| 3 | As 2, and also stops the older message for a blood pressure crisis and a glucose emergency. | The same. |
| 4 | Tells the Care Circle about the new unified pages (neutral check-in notice). Retires nothing. | Unified red-event paging switched on separately. |

Only one version is live at a time. To combine (for example 2 and 4) a new version is needed: ask for it.

## Before you start

1. A rota covers the next hours with a primary and a backup who each have a working push subscription and a verified email (the same checklist as the unified paging pack).
2. `process-events` is running (the rota screen shows its heartbeat).
3. Test **Member** patients, a test **Free** patient, one test patient with a **Care Circle** member who allows red alerts, and one who is **pregnant** (profile flag) with a circle member who allows red alerts.
4. For glucose rows: the `glucose_care_triage` rules signed (otherwise glucose is correctly never held: row 13).
5. All versions OFF (the hub line reads "(off)").

Words: **older message** = every clinician gets the "red flag" or "emergency" notification and nobody is named. **page** = the on-call primary's console rings.

## Part 1: parallel run (version 1)

| # | Do this | Expected |
|---|---|---|
| 1 | Switch version 1 on. Log blood pressure 170 over 95 for a test Member. | Older message to every clinician AND the on-call page, as today. The hub table shows one blood pressure red event, with the page seen and a lag in seconds. |
| 2 | Log 210 over 110 (a crisis). | Both, as today. The table shows one blood pressure emergency event. |
| 3 | Log blood pressure 150 over 90. | Older "review needed" message only, as today. **Not** in the table. |
| 4 | Log 170 over 95 for the Free patient. | Nothing for a clinician, as today. **Not** in the table. |
| 5 | Leave it running on test traffic for as long as you want evidence. | The table fills in: how many events had their page, how many pages arrived before the older message, how many arrived with a reachable primary, the median and slowest 5% in seconds. |

## Part 2: stop the older message (version 2)

Switch version 1 off, then version 2 on.

| # | Do this | Expected |
|---|---|---|
| 6 | Log 170 over 95 for a test Member with a reachable primary. | The alert opens and the primary is paged. The older message does **not** go to everyone. The table shows it as suppressed, usually within a few seconds. |
| 7 | Stop `process-events` (or use a patient whose page cannot be made) and log 170 over 95. | The older message arrives after the hold time (60 seconds, plus up to 15), identical to today's, and the table shows it as sent late with the reason. |
| 8 | Disable the primary's push subscription and unverify their email, then log 170 over 95. | The older message goes out **at once**: nobody waits for a page that cannot be received. |
| 9 | Take primary and backup off the rota, then log 170 over 95. | The older message goes out at once (no cover). |
| 10 | Log 210 over 110 (a crisis). | The older message **still** goes to everyone (version 2 keeps emergency messages). |
| 11 | Log 150 over 90, then 170 over 95 for the Free patient. | Same as today. |
| 12 | With a red event held, press **Switch OFF**. | The held message is sent at once. The line reads "(off)". |
| 13 | Log glucose 2.5 for a test Member while `glucose_care_triage` is still a draft. | The older message goes out at once (no page can be expected). |

## Part 3: emergencies too (version 3)

| # | Do this | Expected |
|---|---|---|
| 14 | Switch version 3 on (glucose rules signed). Log 210 over 110. | Page to the primary; the older emergency message is not sent to everyone; the patient still sees the emergency guidance and the emergency contact is told. |
| 15 | Log glucose 2.5. | Same, through the glucose page. |
| 16 | Log an AI coach or exposure emergency. | The older message to every clinician, as before. Not touched. |
| 17 | Press **Switch OFF**. | Held messages sent at once; back to today's behaviour. |

## Part 4: Care Circle (version 4, with unified paging on)

| # | Do this | Expected |
|---|---|---|
| 18 | With version 4 **off** and unified paging on: log oxygen 91 for the circle patient. | The on-call page. The circle member gets **nothing**, and the member's "open requests" list shows nothing. |
| 19 | Switch version 4 on. Log oxygen 91 again for a new patient with a circle member who allows red alerts. | The member gets the neutral check-in notice (no reading, no condition, no name) and sees one open request; acknowledging it marks it. |
| 20 | The same for a circle member who does **not** allow red alerts. | Nothing. |
| 21 | Log a chest pain symptom, severity 8, for the **pregnant** patient. | The on-call page is made. The circle member is told **nothing** and sees nothing. |
| 22 | The same for a non-pregnant patient. | The circle member is told. |
| 23 | Log a testicular pain symptom, severity 9. | The circle member is told **nothing**. |
| 24 | Pause check-in requests for a patient, then log oxygen 91. | Nothing to the circle (the patient's own pause wins). |
| 25 | Log oxygen 91 for the Free patient. | No page and nothing to the circle. |
| 26 | A blood pressure page for a patient with a circle member. | The circle member is told, exactly as before this change. |

## Rollback

1. Hub line "Older clinician-message retirement": **Switch OFF**. Takes effect for the next event; every held message with no confirmed page is sent at once.
2. If the hub cannot be reached: an admin or you can run `select public.switch_off_legacy_notice_retirement();`.
3. Pages already open are never touched.

## What this pack cannot prove

A page that is made but never received (a clinician's phone off) is only partly covered: the primary must have a push subscription or a verified email, and the page then runs the ordinary ladder (backup at 5 minutes, lead at 10, expiry alarm, an ops person phoning). That is the same safety net as every other page. Real-patient evidence cannot exist yet; only the parallel run on live traffic produces it.

## Sign-off

Scenarios run on: ____________  Result: all as expected / exceptions noted below

Exceptions: ______________________________________________

CMO name: ____________________  Signature: ____________________  Date: ____________
