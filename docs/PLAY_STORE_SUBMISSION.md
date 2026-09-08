# Google Play submission: TarragonHealth Android app

> First public release: **v0.1.0** (Expo SDK 54, `com.tarragonhealth.mobile`), prepared
> 2026-09-08. Developer account: the Tarragon Gmail account (owner: founder). EAS project
> `@worldbest/tarragon-health`. This file is the single place the Play Console answers are
> written down so they can be re-entered consistently on every future release.

## Pre-upload checklist

1. Build from `main-dev` with `pnpm build:prod` (production profile, AAB, `versionCode`
   auto-incremented by EAS). Confirm the EAS build's `gitCommitHash` is the commit you mean.
2. Check the **Production** track in the Play Console for any earlier upload. A stale
   v0.1.0 binary (pre free-app pivot) was reportedly uploaded manually in August 2026; EAS has
   no record of it (`eas submit:list` is empty), so it was not sent through EAS. If a release
   with it exists in any state (draft, in review, rolled out), **discard or replace it** so
   the new AAB is the only artefact on the track. The new AAB's `versionCode` must be higher
   than whatever is there; EAS remote versioning is at 4+ so this should already hold.
3. Health Connect is **off** in this build (no `android.permission.health.*` in the manifest,
   `react-native-health-connect` excluded from autolinking). If the Play Console still shows a
   Health Connect declaration from an earlier upload, it should disappear once the new AAB
   replaces it; if it still asks, answer that the app does not use Health Connect.
4. Testers: if the developer account is a personal account created after 13 Nov 2023, Play
   requires a closed test with at least 12 testers opted in for 14 days before production
   access is granted. Use the `preview` EAS channel for those testers.

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
