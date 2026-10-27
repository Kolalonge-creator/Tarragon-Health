Status: TBD
Runtime version: TBD

# Real-device results (copy to docs/device-lab/release-results/<runtimeVersion>.md)

Change the first line to `Status: COMPLETE` and the second to the runtime version only when every cell below holds a real
measured value or an honest "not measured: <reason>". Replace every TBD. A cell is PASS only for a real phone on a release build.
Budgets are PROPOSED values in `packages/shared/src/proposed-config/registry.ts` (`device_lab.budgets`); targets marked "own target"
come from `docs/research/S85-S90-competitor-gap-analysis-2026-10-22.md` section 3.4 and are suggestions, not Google numbers.

## Run details

| Item | Value |
|---|---|
| Date | TBD |
| Person who ran it | TBD |
| EAS build id and kind (preview APK / TestFlight) | TBD |
| Runtime version tested | TBD |
| Test account (is_test = true) used | TBD |
| Phones (maker, model, RAM, Android/iOS version) | TBD |

## 1. Cold start (own target: p90 under 4 s to a usable screen on a 2 GB phone)

| Phone (RAM) | Runs (5) usable-screen ms | Median ms | p90 ms | First-frame ms from harness | Verdict |
|---|---|---|---|---|---|
| 2 GB Android Go-class | TBD | TBD | TBD | TBD | TBD |
| Tecno / Infinix | TBD | TBD | TBD | TBD | TBD |
| itel | TBD | TBD | TBD | TBD | TBD |
| iPhone | TBD | TBD | TBD | TBD | TBD |

p90 of 5 runs is the slowest run; do 10 runs on the 2 GB phone if you can and take the 9th fastest.

## 2. Push on battery-killer phones (critical alerts must also be in the in-app inbox)

| Phone | Battery manager state | Push arrives, app force-closed (minutes late) | Push arrives after 12 h idle (minutes late) | Reminder after reboot (minutes late) | In-app inbox shows it |
|---|---|---|---|---|---|
| Tecno | default | TBD | TBD | TBD | TBD |
| Tecno | app allowed in Phone Master | TBD | TBD | TBD | TBD |
| Infinix | default | TBD | TBD | TBD | TBD |
| Infinix | app allowed | TBD | TBD | TBD | TBD |
| itel | default | TBD | TBD | TBD | TBD |
| itel | app allowed | TBD | TBD | TBD | TBD |

Send each test push with the app force-closed from the app switcher. Record "never arrived" rather than a number if it did not.

## 3. Offline queue idempotency (exactly one row per logged reading)

| Phone | Method | Readings logged | Rows on the server | Duplicates | Verdict |
|---|---|---|---|---|---|
| TBD | Airplane mode on, log 3, kill network mid-send, retry three times (harness flow `airplane-offline-logging-reconnect-flush`) | TBD | TBD | TBD | TBD |
| TBD | Power cut mid-queue (`power-cut-restart-mid-queue`) | TBD | TBD | TBD | TBD |
| TBD | Throttled link 50 kbit/s, 400 ms, 3 percent loss (`throttled-2g-sync`) | TBD | TBD | TBD | TBD |

Count rows in the dashboard or the database for the test account after each. One reading must be one row.

## 4. Crashes and ANRs (Google Play vitals thresholds: user-perceived crash 1.09 percent, ANR 0.47 percent)

| Phone | Session length | Flows exercised | Crashes | ANRs | Notes (logcat tag, screen) |
|---|---|---|---|---|---|
| TBD | TBD | login, vitals log, medicines, messages, consultation room | TBD | TBD | TBD |

Check `adb logcat -b crash` and `adb shell dumpsys activity exit-info ng.tarragon` (Android 11 and later) after the session.

## 5. Other lab items

| Item | Result |
|---|---|
| Installed size, Settings (MB) | TBD |
| Memory after offline flow (MB) | TBD |
| Health Connect / HealthKit sync, one reading of each | TBD |
| Mobile consultation room join | TBD |
| Exact alarms permission flow | TBD |
| Maestro flows run (list) | TBD |

## 6. Findings and follow-ups

TBD
