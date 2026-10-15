# Unified red-event paging: CMO test pack

For the Chief Medical Officer. Run this in staging with **test patients** before switching "Unified red-event paging" on at the sign-off hub (`/clinician/clinical-signoff`). Nothing in this pack touches a real patient. Nothing switches itself on: the switch is yours, and it asks you to confirm you ran this pack.

What the switch does, in one paragraph: today only a blood pressure red event pages the clinician on call. A very low oxygen reading, a dangerous heart rate, a high temperature, a red-flag symptom and an emergency event for a Member instead notify every clinician at once, with no one named, no acknowledgement and no backup. Switched on, those events page the clinician on call through the same ladder as blood pressure (backup at 5 minutes, clinical lead at 10), and the notify-everyone step is skipped for that event. If a page cannot be made, or nobody is on cover, the old notification still runs.

What it does not change: the emergency guidance the patient sees, the emergency contact notice, amber ("review needed") levels, blood pressure, mental health crisis follow-up, the abnormal screening result pathway, and what a Free patient gets.

## Before you start

You need, in staging:

1. A test **Member** patient for each scenario (or reuse one and wait 30 minutes between scenarios 3 to 7, because repeat events inside 30 minutes join one page by design). Test patients are marked `is_test`, so their pages go to the **test** on-call rota.
2. A test **Free** patient (no membership).
3. A test on-call rota with a **primary** and a **backup**, both clinicians who have passed a test page from the On call screen, each with the console open. A third clinician who is not on call, and a second test clinician who is a **relative** of one test patient (conflict declared).
4. Unified red-event paging **OFF** (the hub shows "Unified red-event paging (off)").

Expected results use these words: **page** = the on-call clinician's console rings and shows a red event page; **old notice** = every clinician gets the "red flag" notification and nobody is named.

## Part 1: baseline with the switch OFF

| # | Do this | Expected |
|---|---|---|
| 1 | As a test Member, log an oxygen reading of 91 | Every clinician gets the old notice. **No page.** An alert is open in the clinician list. |
| 2 | Log a heart rate of 130, a temperature of 39.5, and a chest pain symptom at 7 out of 10 (one test patient each) | The same in each case: old notice to every clinician, no page. |

## Part 2: switch it on

At the hub: open the line, tick that you ran this pack and that you understand, press **Switch unified red-event paging on**. The line then reads "ON (switch off here)".

## Part 3: each source, with the switch ON (Member patients)

| # | Do this | Expected |
|---|---|---|
| 3 | Oxygen reading 91 | The **primary** is paged (console alarm, push, email; never an SMS). The old notice does **not** go to everyone. The alert is still open in the list. |
| 4 | Heart rate 130 | The same. |
| 5 | Temperature 39.5 | The same. |
| 6 | Chest pain symptom, severity 7 | The same. |
| 7 | Oxygen reading 85, then heart rate 30 (emergency level) | The primary is paged. The patient still sees the emergency guidance and must acknowledge it. The emergency contact is notified as before. The old "emergency" notice to everyone does **not** go out. |
| 8 | Log an emergency event of another kind from the app (for example the danger-symptom checklist) | The primary is paged. |
| 9 | Oxygen reading 93, heart rate 110, temperature 38.0, a symptom at severity 5 (amber levels) | The old notice to every clinician, **no page**. Amber is not red. |
| 10 | Blood pressure 190 over 120 for a test patient, and a blood pressure emergency event | Behaves exactly as it did before the switch (blood pressure already has its own page). Nothing new. |

Check on every page above: the page names only a fixed neutral message (no reading value); opening the chart is possible **only after** the paged clinician acknowledges.

## Part 4: the ladder and the safety rules

| # | Do this | Expected |
|---|---|---|
| 11 | Page a test patient, do not acknowledge for 5 minutes | The **backup** is paged at 5 minutes. At 10 minutes the clinical lead and ops are alerted. |
| 12 | Log oxygen 91, then heart rate 130, then temperature 39.5 for the **same** patient within a few minutes | **One** page for the primary, not three. The page shows merged events. |
| 13 | Acknowledge that page, then log a new chest pain symptom at 7 for the same patient | A **new** page rings (a new red event after someone acknowledged is never lost). |
| 14 | Take the primary and backup off the rota, then log oxygen 91 | A page with "no cover" goes to the clinical lead, a priority task opens, an ops incident is raised, **and** the old notice still goes to every clinician. |
| 15 | Make a test clinician a relative of the patient and put them on call | They are **not** paged and cannot acknowledge. The backup is paged instead. |
| 16 | Log oxygen 91 for the **Free** patient, then oxygen 85 | No page, no clinician alert. The patient sees the guidance and a self-care suggestion. For 85 the emergency guidance and emergency contact notice still happen. |
| 17 | A test patient with a Care Circle member who allowed red alerts: log oxygen 91 | The Care Circle member gets their check-in notice, as they do for a blood pressure page. **Confirm with the DPO that this is within what the patient consented to under "red alerts".** If not, do not switch on. |

## Part 5: roll back mid-stream

| # | Do this | Expected |
|---|---|---|
| 18 | With a page open and unacknowledged, press **Switch unified red-event paging OFF** at the hub | The open page stays open, still rings and still escalates at its timers. Nothing is closed. |
| 19 | Log oxygen 91 for a new test patient | Old notice to every clinician, no page: back to the old path. |
| 20 | Switch it back on and repeat scenario 3 | Works again. |

## Rollback steps (if anything in this pack, or live, looks wrong)

1. Sign-off hub, "Unified red-event paging is ON": press **Switch OFF**. It takes effect for the next event, immediately. Pages already open are left alone.
2. If the hub cannot be reached: an admin or you can run `select public.switch_off_unified_red_paging();` (the audit log records who and when).
3. To close pages you no longer want open, use the normal page screen (acknowledge, then close). Switching off never closes a page for you.
4. If you want the page AND the old notice side by side for a while (to compare), ask for a new version of the setting with `suppress_legacy_clinician_notice` set to 0; the setting is never edited in place.

## What this pack cannot prove

A page-creation **failure** (the fallback to the old notice) cannot be staged safely. It is proved in the database test `s19d_unified_red_paging.sql`, which breaks page creation on purpose and checks the old notification runs and the failure is audited. Native mobile delivery receipts do not exist yet; a clinician reachable only through the mobile app stays on the 5 and 10 minute timers.

## Sign-off

Scenarios run on: ____________  Result: all as expected / exceptions noted below

Exceptions: ______________________________________________

CMO name: ____________________  Signature: ____________________  Date: ____________
