# On-call device setup

Who this is for: every clinician who is on the on-call rota, and the ops person who onboards them.
Why it exists: an urgent page that never reaches a phone is the failure that hurts most, and on many Android phones the maker's battery manager is the usual cause. Plan: `docs/plans/S16-S20-review-and-build-plan.md` decisions 10 and 15. Screen: `/clinician/device-check`.

A page reaches you by notification, in the app and by email. There is no SMS and no WhatsApp for pages. If none of these three reaches you, a named person at the ops desk phones you (`docs/runbooks/ops-desk-resilience.md`).

## What you do, once, before your first shift

1. Open **Device check** (`/clinician/device-check`) on the phone you will carry on call.
2. Follow the steps for your phone brand on that screen (Tecno, Infinix, Samsung, Xiaomi). They are the steps the phone makers publish. They have not been tested on every handset, and menu names change between Android versions.
3. Press **Send me a test page**. It arrives like a real page: a notification, in the app and by email. Acknowledge it. The screen records that you did.
4. Repeat steps 1 to 3 after any phone update, after a factory reset, and after you change phone.

Being put on the rota later needs a working notification set-up, a confirmed email address, the phone checklist ticked, and a test page you acknowledged in the last 7 days. The 7 days is a PROPOSED value (`paging.delivery_rules`, CMO to confirm).

## The usual causes, in the order to check

| Symptom | Likely cause | Fix |
|---|---|---|
| The test page never shows on the lock screen | Battery manager closed the app | Brand steps on the Device check screen: battery or power saving set to no restrictions, auto-start on, app locked in recent apps |
| Notification arrives minutes late | Doze or app standby | Same steps; also make sure data saver is off for the app |
| Notification arrives but is silent | Do Not Disturb, or the channel is muted | Allow Tarragon Health through Do Not Disturb; set the notification to make sound |
| No notification at all, email arrives | Notifications blocked, or the browser or app is not signed in | Allow notifications in system settings; sign in again |
| Nothing arrives, no email | Email address not confirmed, or the mail is in spam | Confirm the address in your profile; mark the sender as not spam |

## Power and data

- Carry a charged power bank on every on-call shift. Power cuts are common.
- Keep mobile data on as well as Wi-Fi. If the Wi-Fi router loses power your phone must still be reachable.
- Do not use battery saver mode while on call.

## What the fire drills are

About once a month, at an unannounced time during the day, the system sends each on-call clinician a test page. How fast you acknowledge it is recorded and shown to the clinical lead as a median and a 95th percentile by clinician, hour of day, route and device, against a target of 90 percent within 5 minutes (PROPOSED). A drill measures the route, not the person. It is for information only: it is never used for pay or for removing anyone from the rota. If a drill reveals a problem, the fix is a phone setting or a spare device.

## For the ops person onboarding a clinician

- Sit with them for the Device check and watch the test page arrive. Do not accept "I did it".
- Record the phone brand and Android version in the onboarding notes.
- If the clinician only uses an iOS phone: the iOS app has no Critical Alerts entitlement yet (`docs/runbooks/ios-critical-alerts-entitlement.md`), so a page can be silenced by a Focus mode. Tell them to allow Tarragon Health in every Focus they use, and ask for a second device that is an Android phone or a laptop with the console open.
- Clinicians who reach pages only through the mobile app cannot yet pass the test-page gate, because the app does not record delivered receipts (the web console does). That is a known gap; until it is closed they use the web console on the same phone.

## Limits we know about

- The web console can only see its own notification permission and service worker. It cannot see the phone's battery manager. The test page is the real check.
- Delivered receipts come from the client. They show the route works; they are not proof against someone who wants to bypass the check.
