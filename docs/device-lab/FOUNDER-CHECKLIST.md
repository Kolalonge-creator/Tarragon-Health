# Device lab: one-sitting founder checklist (S88d)

About half a day with the phones in hand. Detail and reasons live in `docs/device-lab/RUNBOOK.md`; this is the order to do things in.
Nothing here has been run yet. Needs your go-ahead on the native build (DG-6) and the phones (D8).

## Before the sitting (30 minutes)

- [ ] Phones: one 2 GB Android Go-class, one Tecno or Infinix, one itel, one iPhone. Charged above 50 percent.
- [ ] A test account with `is_test = true`. `export MOBILE_E2E_EMAIL=... MOBILE_E2E_PASSWORD=...`
- [ ] `pnpm install` at the repo root; `adb` and Maestro installed (`maestro --version`).
- [ ] Build exists for the current runtimeVersion: `node -p "require('./apps/mobile/app.json').expo.runtimeVersion"`, then `cd apps/mobile && eas build --profile preview --platform android` (and iOS). Note the build id.
- [ ] Copy the template: `mkdir -p docs/device-lab/release-results && cp docs/device-lab/RESULTS-TEMPLATE.md docs/device-lab/release-results/<runtimeVersion>.md`

## Per Android phone (about 45 minutes each)

1. [ ] Developer options and USB debugging on; `adb devices` shows `device`. Install the APK. Note the battery manager state before you touch it.
2. [ ] `scripts/device-lab/run.sh --label "eas build <id>"` (cold start, size, memory, offline flush). Commit the generated file under `docs/device-lab/`.
3. [ ] Hand-time usable-screen cold start, 5 runs (10 on the 2 GB phone); fill section 1 of the results file.
4. [ ] Offline idempotency: the three flows in section 3; count rows on the server; fill section 3.
5. [ ] Push test with the app force-closed, then leave the phone idle and unplugged for 12 hours (do this last, overnight) and send another; fill section 2. Repeat with the maker's battery manager set to allow the app.
6. [ ] Reminder after reboot (`reminder-after-reboot.yaml`, phases prepare and check); fill section 2.
7. [ ] Use the app for 20 minutes across login, vitals log, medicines, messages and the consultation room. Then `adb logcat -b crash` and `adb shell dumpsys activity exit-info ng.tarragon`; fill section 4.
8. [ ] Health Connect: log one reading in Health Connect and confirm it appears. Exact alarms permission prompt appears in context. Section 5.

## iPhone (about 30 minutes)

- [ ] Install the TestFlight or ad-hoc build. Hand-time the cold start, 5 runs. HealthKit permission and one synced reading. Push with the app swiped away. Consultation room join. Fill the iPhone rows.

## After the sitting

- [ ] Replace every `TBD` in the results file with a value or "not measured: <reason>". Set line 1 to `Status: COMPLETE` and line 2 to `Runtime version: <runtimeVersion>`.
- [ ] `scripts/device-lab/check-release-results.sh` prints "OK".
- [ ] Commit the results file. For a release, run the "Device lab results gate" workflow with require set to true.
- [ ] Anything over budget becomes a finding in section 6 and a follow-up item; budgets are report only and do not block.
- [ ] Append a dated entry to `docs/BUILD-PROGRESS.md` with the numbers.
