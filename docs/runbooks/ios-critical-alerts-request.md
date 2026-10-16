# iOS Critical Alerts: request text and switch-on steps (clinician pages only)

Status: NOT requested, NOT granted. The build flag is wired and stays OFF. Written 2026-10-16 (S19e).
Only the Apple Developer Account Holder can file this request; an agent cannot. Companion documents: `docs/runbooks/ios-critical-alerts-entitlement.md` (checklist and why) and `docs/runbooks/apple-critical-alerts-request.md` (an earlier text that also names patients; **use the text below instead**, because the CMO plan limits Critical Alerts to on-call clinicians and the in-app permission request here is made only on the clinician screen).

## What is already in the repo (all OFF)

| Piece | Where | State |
|---|---|---|
| Entitlement key `com.apple.developer.usernotifications.critical-alerts` | `apps/mobile/app.config.js`, added only when the build env has `IOS_CRITICAL_ALERTS_ENTITLEMENT=1` | off |
| Run-time flag `extra.iosCriticalAlerts` | same file, set only with that env var; read by `apps/mobile/src/lib/paging/critical-alerts.ts` | off |
| Permission request `allowCriticalAlerts` | `apps/mobile/src/lib/push-registration.ts`, only for a clinician and only when the flag is on | off |
| Sender sends `interruptionLevel: "critical"` | edge secret `IOS_CRITICAL_ALERTS_ENABLED=true` on `send-pending-notifications` | unset (sends `time-sensitive`) |

A build with the entitlement key but no Apple grant is rejected at signing, which is why the flag is never on by default.

## 1. File the request (Account Holder)

1. Sign in at https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement/
2. Use these values.

| Field | Value |
|---|---|
| App name | TarragonHealth |
| Bundle ID | com.tarragonhealth.mobile |
| Team ID | (from the Apple Developer membership page) |
| Entitlement | Critical Alerts (`com.apple.developer.usernotifications.critical-alerts`) |

3. Paste this use case:

> TarragonHealth is a clinical care-coordination app used by registered doctors and by patients in Nigeria. We are asking for the Critical Alerts entitlement for one purpose only: to page the registered doctor who is on call when an urgent clinical event has not been acknowledged by a doctor.
>
> Who receives it: only a named, registered doctor who is currently on call in our on-call rota. Patients never receive a Critical Alert from this app.
>
> Why a normal notification is not enough: a doctor on call may have the phone on silent or in a Focus mode, for example overnight. A page that is silenced can delay care for a patient in danger. The page also goes out by push, in the app and by email, and a person at our operations desk telephones the doctor if nobody answers, but the first alert needs to be audible.
>
> How it is limited: the alert text is fixed and generic ("New priority case. Open your worklist.") and contains no patient name, reading or condition, so it is safe on a lock screen. It is sent only for an urgent page and for the alert that nobody has answered it. It is never used for marketing, reminders, messages or routine updates. It stops as soon as a doctor acknowledges the page. Doctors can run a test page from the app at any time and we measure acknowledgement times in monthly drills.
>
> Contact: the Chief Medical Officer and the founder (see the support page in the app).

Provide on request: the privacy policy link, a TestFlight build showing the On call screen, a screenshot of the Device check screen.

## 2. After Apple grants it (human steps, in this order)

1. The CMO confirms which events may be critical (proposed: an unacknowledged page and its expiry, to on-call clinicians only).
2. Enable the capability for the App ID in the developer portal and regenerate the provisioning profile (EAS does this on the next build).
3. Make a new build with `IOS_CRITICAL_ALERTS_ENTITLEMENT=1` (EAS build env). Bump `runtimeVersion` in `apps/mobile/app.json` (a new native build is needed).
4. Only after that build is out and a clinician has accepted the permission prompt: set the edge secret `IOS_CRITICAL_ALERTS_ENABLED=true` (`supabase secrets set`; it affects every urgent Expo push, so also confirm with the CMO that patient safety messages should or should not be critical; today the sender cannot limit it to clinicians, see open item below).
5. Run test T5 in `docs/runbooks/red-alert-handset-matrix.md` on an iPhone on silent and in a Focus.

## Open item to settle before step 4

`expoUrgencyFields` applies `critical` to every safety push, including a patient's red-event message, not only to a page. If the CMO wants clinicians only (as the request text promises Apple), add a template check (page and test page only) to the sender before setting the secret. Apple can refuse or later revoke an entitlement that is used more widely than described.
