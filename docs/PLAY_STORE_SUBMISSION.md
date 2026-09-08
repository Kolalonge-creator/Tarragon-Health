# Google Play submission: TarragonHealth Android app

> First public release: **v0.1.0** (Expo SDK 54, Android package `com.tarragonhealth.app`, iOS bundle id `com.tarragonhealth.mobile`), prepared
> 2026-09-08. Developer account: the Tarragon Gmail account (owner: founder). EAS project
> `@worldbest/tarragon-health`. This file is the single place the Play Console answers are
> written down so they can be re-entered consistently on every future release.

## Pre-upload checklist

1. Build from `main-dev` with `pnpm build:prod` (production profile, AAB, `versionCode`
   auto-incremented by EAS). Confirm the EAS build's `gitCommitHash` is the commit you mean.
2. Play Console state as checked on 2026-09-08 (Tarragon Health organisation account,
   ID 6966488686634021923, app ID 4974287240920684540): **no app bundle has ever been
   uploaded** (bundle explorer empty, the "Untitled" production draft has no artefact, no
   internal-testing releases), so there is no stale binary to replace, and the app-signing key
   choice is still open. The app record is already bound to the package name
   **`com.tarragonhealth.app`**, which is why `app.json`'s `android.package` was changed from
   `.mobile` to `.app` before the first build. Because it is an organisation account, the
   12-tester / 14-day closed-testing rule for new personal accounts does not apply.
   App content: 10 of 11 items done (privacy policy, sign-in, ads, content rating, target
   audience, Data safety, government apps, financial features, category = Medical, store
   listing, contact email privacy@tarragonhealth.ng). The one open item is the **Health apps**
   declaration; see the "Health apps declaration" section below before saving it.
3. Health Connect is **off** in this build (no `android.permission.health.*` in the manifest,
   `react-native-health-connect` excluded from autolinking). If the Play Console still shows a
   Health Connect declaration from an earlier upload, it should disappear once the new AAB
   replaces it; if it still asks, answer that the app does not use Health Connect.
4. Testers: not required for this organisation account, but an internal-testing release of
   the same AAB first (up to 100 testers, no review) is still the safest way to confirm the
   store build installs and signs in before promoting it to production.

## App content declarations

| Item | Answer |
| --- | --- |
| App category | **Medical** |
| Target audience | 18 and over (adults; a guardian enrols a dependant, the child never uses the app) |
| Ads | No ads |
| Privacy policy URL | `https://tarragonhealth.ng/privacy` |
| Account deletion URL (Data safety, "Delete account") | `https://tarragonhealth.ng/privacy#deleting-your-account` |
| In-app account deletion path | More, then Privacy & your data, then "Request deletion of your data" |
| Government apps / news / COVID contact tracing | No |
| Financial features | None (no loans, no crypto, no trading). Payments for a doctor's time go through Paystack checkout |
| Health apps declaration | Yes, health app: "Medical / health monitoring" (chronic disease monitoring, vitals logging, care-team messaging). No regulated medical-device claims. Not a clinical decision support tool for clinicians |
| Data safety: data encrypted in transit | Yes (TLS to Supabase and to `app.tarragonhealth.ng`) |
| Data safety: users can request deletion | Yes |

## Health apps declaration (open item, review before saving)

The form was found part-filled on 2026-09-08 and not saved by this pass. Recommended answers,
each tied to a feature that actually exists in v0.1.0:

| Feature | Tick? | Why |
| --- | --- | --- |
| Diseases and conditions management | Yes | Hypertension/diabetes monitoring is the core |
| Disease prevention and public health | Yes | Screening journey, vaccinations |
| Healthcare services and management | Yes | Bookings, care-team messaging, lab orders |
| Medication and treatment management | Yes | Medication list, dose logging, reminders |
| Medical reference and education | Yes | "Help me understand this" explanations, health education |
| Medical device apps | Yes | Pairs with Bluetooth BP cuffs, glucometers, scales, thermometers, oximeters |
| Period tracking | Yes | Women's health cycle tracking is in the app (it was unticked) |
| Reproductive and sexual health | Yes | Fertility assessment, STI risk check, sexual wellness screen (unticked) |
| Mental and behavioural health | Yes | Mental-health screening questionnaire (unticked) |
| Clinical decision support | **No** | That category is for tools clinicians use to make decisions; the mobile app is patient-facing (it was ticked) |
| Emergency and first aid | No | The "go to the nearest hospital" safety net is a prompt, not an emergency/first-aid service |
| Human subjects research, Other | No | |

Step 2 ("Regional requirements") asks about medical-device regulatory status per region; the
app is not a regulated medical device in Nigeria and should be declared as such.

## Data safety form: data collected

All data below is collected (stored off-device in Supabase Postgres, AWS **eu-west-1**,
Ireland). Nothing is shared with third parties for advertising, and **no data is sold**.
"Shared" below means a processor acting for Tarragon Health, not a data buyer.

| Data type | Collected | Shared | Required or optional | Purpose |
| --- | --- | --- | --- | --- |
| Name, email, phone number | Yes | No | Required | Account management, app functionality |
| Date of birth, sex, state / LGA of residence | Yes | No | Required | App functionality (clinical thresholds are age/sex aware) |
| Emergency contact (name, phone) | Yes | No | Optional | App functionality (emergency safety net) |
| Health info: blood pressure, glucose, weight, SpO2, temperature, pulse, symptoms, medications, screening and lab results, vaccinations, clinical notes, women's-health cycle data | Yes | Yes, with the patient's own care team, and a limited structured extract with Anthropic to draft a doctor-facing summary (never free-text notes) | Required for the features that use it | App functionality (care delivery), never advertising |
| Fitness info (steps, sleep, HRV) | Yes, on iOS via Apple Health only | No | Optional | App functionality. **Not collected on Android in v0.1.0** (Health Connect is off) |
| Photos | Yes, only when the user photographs a lab result | No | Optional | App functionality (lab-result upload) |
| Messages (care-team chat) | Yes | With the care team | Optional | App functionality |
| Payment info: Paystack payment references, purchase history | Yes | Paystack processes the payment | Optional | Payments. Card numbers are never stored by Tarragon |
| Device or other IDs: paired Bluetooth device make/model/serial | Yes | No | Optional | App functionality (device pairing) |
| App activity / diagnostics | Yes (audit log of record access, crash and sync diagnostics) | No | Required | Security, fraud prevention, analytics |
| Location | **No** (Bluetooth scanning uses `neverForLocation`; no location permission is requested) | | | |
| Contacts, calendar, files (other than the chosen photo), audio, web browsing | No | | | |

Data handling practices: all collected data is encrypted in transit; users can request
deletion (in-app request, reviewed and completed by an admin; see the privacy notice's
"Deleting your account" section); data is retained under clinical record-keeping obligations
after account deletion where the law requires it.

Data processors to name if asked: Supabase (database, auth, storage; eu-west-1), Vercel
(web/API hosting), Paystack (payments, Nigeria), Anthropic (AI summary drafting, structured
extract only), Meta WhatsApp Cloud API and Termii (reminder/alert delivery only, phone number
and message content).

## Permissions the binary declares, and why

| Permission | Why |
| --- | --- |
| `BLUETOOTH`, `BLUETOOTH_ADMIN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN` (`neverForLocation`) | Pair a BP cuff, glucometer, scale, thermometer, or pulse oximeter and read its measurements |
| `CAMERA`, media read | Photograph or pick a lab-result image to upload |
| `POST_NOTIFICATIONS` | Medication and reading reminders, care-team replies |
| `USE_BIOMETRIC` | App Lock (biometric unlock of the health record) |
| `INTERNET`, `RECEIVE_BOOT_COMPLETED`, foreground/background task | Sync, offline queue flush, reminder scheduling |

No `android.permission.health.*` and no location permission in v0.1.0.

## Store listing

- App name: **TarragonHealth**
- Short description (80 chars max): "Track your blood pressure and sugar, and stay connected to your care team."
- Assets: `apps/mobile/store-assets/android-submission/` (512x512 icon, 1024x500 feature
  graphic, four 1080x1920 screenshots captured on an Android emulator from the v0.3.0
  native build, which is the same UI as v0.1.0).
- Contact email: `support@tarragonhealth.ng` (confirm the mailbox exists before entering it).

## Push notifications (Android)

A Firebase project (`tarragonhealth-f19b3`, under the Tarragon Gmail account, Spark/free plan)
was created 2026-09-08 with an Android app registered under `com.tarragonhealth.app`.
`apps/mobile/google-services.json` is the client config (safe to commit — it carries only a
Firebase Web API key scoped by package name/SHA fingerprint, the same pattern as the Supabase
anon key already shipped). The FCM V1 service account key was uploaded to EAS and assigned to
this project's Push Notifications (FCM V1) slot (`eas credentials -p android`), so
`registerPushToken()` (`apps/mobile/src/lib/push-registration.ts`, called once per session from
`home-shell.tsx`) now reaches a real, working push pipeline end to end: device token ->
`push_subscriptions` -> `send-pending-notifications` Edge Function -> Expo push service -> FCM ->
device. Verify after the next production build actually installs on a device by checking
`push_subscriptions` for a fresh `expo_push_token` row, or by triggering a real notification
category from the clinician side.

SMS and WhatsApp were removed from the *patient-facing toggle* on the mobile Notification
settings screen (2026-09-08, on explicit founder ask) — Email and Push are now the only channels
a patient can choose there. This does not touch the underlying `sms_enabled`/`whatsapp_enabled`
columns (unedited, whatever they already held keeps flowing to `send-pending-notifications`) or
the platform-wide WhatsApp/SMS notification channel CLAUDE.md's Non-Negotiable Business Rules
describe — that stays live, including on the web app's own notification settings page.

## What is deliberately not in v0.1.0

- **Android Health Connect.** Built, never exercised on a device, ten health permissions
  including background and history read, and no permissions-rationale screen. Turned off
  (see `apps/mobile/src/lib/health-connect.ts`, `HEALTH_CONNECT_ENABLED`). Re-enable in
  0.4.0 only after: the rationale intent is handled by a real screen showing the privacy
  policy, the flow has run on a physical Android phone with Health Connect installed, the
  Health Connect declaration form in the Play Console has been filled, and `runtimeVersion`
  has been bumped for the native change.
- **Bluetooth pairing is labelled "in early testing"** on the Devices screen. The BLE path is
  built but has never paired a real cuff or glucometer; manual entry is the proven path.
  Remove the notice once pairing passes on real hardware (A&D UA-651BLE, Accu-Chek Guide).
