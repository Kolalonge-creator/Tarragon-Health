# Device hardware test plan (S70b)

Status: a PLAN. Nothing in it has been run. Bluetooth, HealthKit and Health Connect code has never executed on a physical phone (CLAUDE.md, Device and Wearable Integration; `docs/design/S70a.md` section 4). Do not tell patients, the CMO or a partner that any device "works" until the pass/fail table at the bottom is filled in with evidence.

Who runs it: one person with both phones and the cuffs below, about a day. A clinician does not need to be present; nobody here is a patient.

Use a TEST account only (`is_test = true`), on a build pointed at a non-production environment or a production test account that is purged afterwards. Never use a real patient's data.

## 0. What you need

| Item | Notes |
|---|---|
| Android phone, mid-range | A Tecno (for example a Spark or Camon class handset) on Android 13 or newer, with Google Play services and the Health Connect app (built in from Android 14, a Play Store install on 13). Note the exact model and Android version. |
| iPhone | iOS 17 or newer, a physical phone. The iOS Simulator cannot run Bluetooth, and `expo-background-task` cannot run in it. |
| A&D UA-651BLE | Upper-arm BP cuff with standard Bluetooth BP profile. |
| Roche Accu-Chek Guide (or Guide Me) | Glucose meter with standard glucose profile, plus test strips and a control solution (do NOT prick a person for this test; use control solution). |
| An Omron upper-arm cuff that pairs with Omron Connect | Any Omron model sold locally that Omron Connect supports. Record the model number. |
| Omron Connect app | On both phones. Needs an Omron account made by the tester. |
| Tester's own arm | For cuff readings only. Take readings seated and rested, as the in-app guide says. |
| EAS development build | A development client build of `apps/mobile` for each phone (see section 6). Expo Go cannot run any of this. |
| Screen recording | Both phones. Turn it on before each case. |

Before each case: charge the phone and the device, remove old pairings in system Bluetooth settings, sign in to the test account, open Settings in the app and note the app version, build number and `runtimeVersion` (currently `0.1.0-native8` in `apps/mobile/app.json`).

## 1. How to record a result

For every case, fill one row of the table in section 7:

- Result: PASS, FAIL or BLOCKED (could not run, say why).
- Evidence file name (screen recording or screenshot, see section 5).
- Notes: anything odd, even if it passed.

A PASS needs all the "expected" steps. Anything short of that is a FAIL, with the failing step written down. Do not retry silently: if you retry, write down both attempts.

## 2. Bluetooth clinical devices (both phones)

Go to the Devices tab and use Add a device.

### B1. A&D UA-651BLE, pairing
1. Put the cuff in pairing mode (hold the Bluetooth button until it blinks, per the A&D manual).
2. In the app choose blood pressure cuff, then Scan.
Expected: the cuff appears by name, the person can pick it, a "paired" state is shown, and the paired device is listed on the Devices tab.
Evidence: recording of the scan and the paired list.

### B2. A&D UA-651BLE, reading arrives
1. Take a reading on your own arm. Note systolic, diastolic and pulse from the cuff screen.
2. Open the app (cold start the app first on one attempt, backgrounded on another).
Expected: one new blood pressure row, values identical to the cuff screen, source shows as a device reading (not "manual", not "wearable estimate"), time within a minute of the measurement. No duplicate row.
Evidence: photo of the cuff display next to a screenshot of the saved reading.

### B3. A&D UA-651BLE, shared phone
1. Pair the same cuff for a second person (a second test profile).
2. Take a reading.
Expected: the app asks whose reading it is before saving. Choose the second person. It appears under that person only.

### B4. A&D UA-651BLE, an implausible value is held
Do NOT fake a reading on the cuff. Skip this case; it is covered by `packages/db/tests/s70a_device_core.sql`. Record "covered by DB proof" in the table.

### B5. Accu-Chek Guide, pairing
1. Turn on Bluetooth on the meter (menu, Wireless, On). Note the pairing PIN printed on the meter.
2. In the app choose glucose meter, Scan, pick the meter, type the PIN when the phone asks.
Expected: paired state shown. If the phone never asks for a PIN or the meter never appears, that is a FAIL; write down what the meter screen said.

### B6. Accu-Chek Guide, reading arrives
1. Apply control solution to a strip, as the meter manual describes. This stores a control-solution result; the meter marks it as a control. 
2. Open the app and sync.
Expected: write down what happens. A control result must NOT appear as a real patient glucose value. If it does, that is a FAIL and a safety finding: report it the same day.
3. If you have a clinician-approved way to produce a real reading for a consenting tester, repeat. Otherwise mark the real-reading half BLOCKED.

### B7. Reconnect after the device sleeps
Leave the cuff or meter untouched for 30 minutes. Take a reading.
Expected: the reading still arrives without re-pairing, or the app shows a clear "reconnect" message. Silent loss is a FAIL.

## 3. Phone health stores

### H1. Health Connect permission (Android Tecno)
1. Devices tab, Health Connect card, Connect.
2. Grant blood pressure, glucose, weight, heart rate and steps in the permission sheet, then deny one on a second attempt.
Expected: the sheet opens, granted types sync, a denied type is not read, and the card says which are on.
Evidence: recording of the sheet and the card.

### H2. Health Connect, a reading written by another app arrives
1. In the Health Connect app add a blood pressure record by hand (this is a test, label it).
2. In Tarragon, sync.
Expected: the record arrives once. It is saved with a source that the app treats as a wearable estimate for blood pressure (by design, a Health Connect sample cannot be told from a watch; see `docs/design/BP-wearable-estimates.md`). Confirm the Vitals screen says "Wearable estimate" and the home-check average does NOT include it.

### H3. HealthKit permission (iPhone)
Same as H1 on the Apple Health card. Evidence: recording.

### H4. HealthKit, a record written by another app arrives
Add a blood pressure sample in the Health app, sync in Tarragon. Same expected result as H2.

### H5. Background sync (both phones)
1. Connect, then close the app fully and lock the phone.
2. Add a new record in the health store.
3. Wait 2 hours (iOS and Android both decide when background work runs; it may take longer).
Expected: record: write down WHEN it arrived, or that it did not by the next morning. This is measurement, not pass/fail on a number. Report "did not arrive overnight" as a FAIL.

## 4. Omron Connect, does it reach the phone health stores?

This is a research question, not a feature. Omron cuffs pair with the Omron Connect app and may lock out standard Bluetooth. Whether Omron Connect writes its readings into Health Connect (Android) and Apple Health (iPhone) is not confirmed anywhere in this repo.

### O1. Omron Connect to Health Connect (Tecno)
1. Pair the Omron cuff to Omron Connect (not to Tarragon).
2. In Omron Connect settings, turn on its Health Connect sharing if the option exists. Write down the exact menu path and wording, or write "no such option".
3. Take a reading. Check the Health Connect app: is a blood pressure record present, and which app is listed as the source?
4. Sync in Tarragon.
Expected result to record: yes or no for each of (a) Omron Connect offers the option, (b) the record reached Health Connect, (c) it reached Tarragon, (d) values match the cuff screen, (e) time is right.

### O2. Omron Connect to Apple Health (iPhone)
Same, with Apple Health and the Health app. Also check whether the pulse arrives with the blood pressure.

### O3. Can Tarragon pair the Omron cuff directly?
In Tarragon Add a device, scan with the Omron cuff in its pairing mode.
Expected: record whether it appears, whether pairing finishes, and whether a reading arrives. Most Omron models are expected NOT to work this way; a clear "no" is a useful result.

What the answers decide: if O1 and O2 are yes, "use Omron Connect, then share to your phone's health app" is a supported route and the Devices guide can say so. If they are no, Omron cuffs are manual-entry (or photo-confirmed) only, and nothing should suggest otherwise. Either way, the CMO owns the recommended device list (S70-5); this plan only reports facts.

## 5. Evidence to capture (every case)

- A screen recording of the whole case, starting before the first tap.
- A photo of the device display for every reading, with the phone clock visible if possible.
- The saved reading as shown in the app, and, for a developer, the row id (Settings, About, tap the version five times only if that menu exists; otherwise note the time and the account).
- For failures: the Bluetooth/OS log. Android: `adb logcat -d` right after the failure. iPhone: the Console app on a Mac with the phone attached.
- Phone model, OS version, app version, build number, `runtimeVersion`.
- Names of files go in the table in section 7. Store the files in a private folder, never in the repo, and delete test accounts after the run.

No real patient name, number or reading may appear in any file.

## 6. Prerequisite: the photo-reading recogniser needs a new native build

The photo reading screen (S70a, 18.3) ships without an on-device text recogniser. `apps/mobile/src/lib/photo-capture.ts` exposes a seam, `registerTextRecogniser()`. Until a recogniser is registered the person sees their photo and empty boxes and types the numbers; they confirm every digit either way.

To test a real recogniser:
1. Choose an on-device text-recognition package (for example an ML Kit text recognition library; the exact package is NOT confirmed, OQ-S70B-2). It must not send the image anywhere (INV-01, and the privacy statement on the screen).
2. Adding it is a NATIVE change. An OTA update cannot carry it. Bump `runtimeVersion` in `apps/mobile/app.json` (currently `0.1.0-native8`, next would be `0.1.0-native9`) in the same commit that adds the package.
3. Build with EAS for each phone (`eas build --profile development` for the test; a `preview` or `production` build before any real use), install it, and only then publish any OTA to that runtime. The auto-publisher (`.github/workflows/mobile-ota-publish.yml`) skips pushes that touch native files, so the new build must exist first.
4. Test on the Tecno in poor light, glare on the display, and a seven-segment display (most cuffs); and on the iPhone. Record how often the suggested digits are wrong. The person confirming every digit is the safety net; the recogniser is a convenience.

Nothing in this runbook was done for that step. The runtimeVersion was NOT bumped.

## 7. Pass/fail table (blank)

| Case | Device and phone | Result | Evidence file | Notes |
|---|---|---|---|---|
| B1 UA-651BLE pairing | Tecno | | | |
| B1 UA-651BLE pairing | iPhone | | | |
| B2 reading arrives | Tecno | | | |
| B2 reading arrives | iPhone | | | |
| B3 shared phone asks whose | Tecno | | | |
| B3 shared phone asks whose | iPhone | | | |
| B4 implausible value held | both | covered by DB proof | | |
| B5 Accu-Chek pairing | Tecno | | | |
| B5 Accu-Chek pairing | iPhone | | | |
| B6 Accu-Chek control result is not a patient value | Tecno | | | |
| B6 Accu-Chek control result is not a patient value | iPhone | | | |
| B7 reconnect after sleep | Tecno | | | |
| B7 reconnect after sleep | iPhone | | | |
| H1 Health Connect permission | Tecno | | | |
| H2 Health Connect record arrives, shown as estimate | Tecno | | | |
| H3 HealthKit permission | iPhone | | | |
| H4 HealthKit record arrives, shown as estimate | iPhone | | | |
| H5 background sync, hours to arrive | Tecno | | | |
| H5 background sync, hours to arrive | iPhone | | | |
| O1 Omron Connect to Health Connect | Tecno | | | |
| O2 Omron Connect to Apple Health | iPhone | | | |
| O3 Tarragon pairs Omron directly | both | | | |
| P1 photo recogniser (only after the new build) | Tecno | | | |
| P1 photo recogniser (only after the new build) | iPhone | | | |

## 8. After the run

- File the filled table and evidence with the CMO (device list is theirs, S70-5) and in `docs/BUILD-PROGRESS.md`.
- Any FAIL on B6 or on a wrong value (B2, H2, H4) is a safety finding: stop, tell the founder, and do not enable `device_recommended_list` or any pairing path for patients.
- Only after B1 to B7 pass on real hardware may the pairing screen show a "supported devices" list (CLAUDE.md, Device and Wearable Integration).
- Delete the test accounts and the recordings that show account details.

## 9. In-app connection test

Not built. A diagnostic button that pairs, reads and reports needs the same hardware to be trustworthy, and a wrong "all good" message would be worse than none. The Data connections screen (S70b) shows per-source status and last sync, which is enough to watch the tests above.
