# Red alert handset matrix (manual test for the founder and QA)

Written 2026-10-13 (S13 R4). **Nobody has run this yet.** The build session that wrote it cannot hold a phone, so every row below is a test to run, not a result. Until a row is filled in, treat the handset as untested. Do not copy results into patient-facing copy until they exist.

## What this proves
That a red alert reaches a real person's phone, in time, with generic wording, and that the "notifications not arriving?" card tells the truth. A red alert is a push on the `urgent` channel (high priority, kept for 24 hours), an email, and an in-app notice, all with the fixed words "A safety message is waiting for you" (nothing about the reading or condition).

## Before you start
1. Use a **test account** (`is_test`). Never a real patient. A Member account, so the red alert is not the Free path.
2. Install the current build. Sign in. Allow notifications when asked. Open Settings, Notifications on the app card, and confirm the "Notifications not arriving?" card is visible.
3. Note the date, the build number, the phone make and model, the Android or iOS version, the network (Wi-Fi, MTN, Airtel, Glo, 9mobile) and whether Data Saver or battery saver is on.
4. Have a second person or a laptop signed in as the on-call clinician (or the clinical lead) to watch the on-call page and the task queue.

## The matrix
Run every test below on each handset. Record PASS, FAIL or NOT RUN, and the minutes it took.

| Handset | OS | Maker battery manager to check first |
|---|---|---|
| Tecno (Camon or Spark) | HiOS | Phone Master: Auto-start, App Booster, Power Marathon, "screen off push block" |
| Infinix (Hot or Note) | XOS | Phone Master / Settings, same switches as Tecno |
| Itel | itel OS | Phone Manager: Auto-start, App launch, battery use |
| Samsung (A series) | One UI | Settings, Battery, Background usage limits, "Put unused apps to sleep" |
| Xiaomi / Redmi | MIUI or HyperOS | Security app, Autostart, Battery saver set to "No restrictions" |
| iPhone | iOS | Settings, Notifications, Focus modes, Time Sensitive |

Maker steps change between models and versions. The wording the app shows for Tecno, Infinix and Itel comes from phone-maker guidance and the community site dontkillmyapp.com and is [NV] until this table has results.

## Tests (each one on each handset)
**T1. Test alert, app open.** On the card, tap "Send me a test alert". Expect the in-app notice within seconds and, with the app in the foreground, a banner. Record seconds.

**T2. Test alert, app in the background (just pressed Home).** Tap the button, press Home immediately. Expect a push on the lock screen within 60 seconds with the title "Tarragon Health" and the words "This is a test alert from Tarragon Health. Nothing is wrong." Record seconds. Look: does it make a sound, vibrate, show on the lock screen?

**T3. Test alert, app swiped away (force-stopped from recents).** Repeat T2 after swiping the app away. This is where Tecno, Infinix and Itel most often fail. PASS only if the push arrives.

**T4. Test alert, screen off for 20 minutes.** Lock the phone, leave it flat on the table for 20 minutes (Doze), then send the test alert from another signed-in browser on the same account (the card button on a second device, or ask the lead). Record whether it arrived and how long it took.

**T5. Silent mode and Do Not Disturb / Focus.** Put the phone on silent, then on Do Not Disturb (Android) or a Focus (iPhone). Send the test alert. Expect: Android `urgent` channel still shows (it will not make a sound under Do Not Disturb unless the person allowed it); iPhone "time-sensitive" breaks through Focus only if Time Sensitive is allowed for the app. Record what happened. A critical alert (breaks through silent) is not expected until Apple grants the entitlement.

**T6. Real red path, on a Member test account.** Log a red-range test reading in the app (on a test account only). Expect, in this order: the on-screen "This may be a medical emergency" guidance; a push, an email and an in-app notice with the fixed words, and no number or condition anywhere on the lock screen or in the email subject. Then do NOT open the notice for 30 minutes (leave the guidance unacknowledged). Expect: a "Call the patient" task for the clinician on call and an alert to them. Open the notice on the phone instead and expect the task to be cancelled if nobody had taken it. Record the minutes.

**T7. Receipt error.** Sign in on a second phone, sign out of the first phone's app data (or uninstall it) so its push token dies, then raise a red alert. Expect the call-the-patient task earlier than 30 minutes: the receipt check starts after 2 minutes, runs every 5 minutes, and the call is due 5 minutes after the error, with the sweep running every 5 minutes, so roughly 12 to 20 minutes. Record the minutes; if it is slower than 30, that is a bug.

**T8. "I could not get care".** On the guidance screen tap "I could not get care" with the phone in aeroplane mode. Expect "Saved on your phone". Switch the network back on. Expect the on-call page to show "Patient says: could not get care" within a minute or two, and the page to stay unacknowledged until the clinician acknowledges it.

**T9. Discreet mode.** Turn on discreet mode in settings and repeat T2 and T6. Expect "Urgent message" / "Open the app now." and an email with no brand or detail.

**T10. Email.** On the same account, open the red alert email on the phone mail app. Expect the subject "A message is waiting for you" and one short body. Forward it to another address and confirm nothing in it names a reading.

## What to write down for each handset
Make, model, OS version, which maker battery settings were already changed, T1 to T10 results with minutes, and a screenshot of the lock screen for T2 and T6 with the account name blurred. If a test fails, write what you changed to make it pass (for example "set battery to No restrictions and allowed Auto-start"); that sentence is the text to put into the card's steps for that maker.

## Where results go
Add a dated section under each handset here. After at least one pass per maker, the lead updates `notif.diag.steps_transsion` and `notif.diag.steps_android` in `packages/i18n/src/en.ts` with the steps that worked, and the CMO decides whether the 30 minute red timer needs a different value (the registry value is PROPOSED).

## Apple Critical Alerts
Not testable until Apple grants the entitlement. Request it at `https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement/` (health and safety use, state the red alert path). After approval: set the build env `IOS_CRITICAL_ALERTS_ENTITLEMENT=1` for a new `eas build`, bump `runtimeVersion`, set the edge secret `IOS_CRITICAL_ALERTS_ENABLED=true`, then run T5 on an iPhone: a red should now sound through silent. Until then reds are "time-sensitive".
