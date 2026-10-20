# Device lab runbook (S06x-c and S08x-3, decision D8)

**Status: the harness is built. No phone has ever been measured.** Nothing in this repository claims a cold start, a size, a memory figure, a
latency or a reminder result as met. Every number below is produced only when someone runs this on real hardware. Until then the right words are
"not measured".

The budgets (cold start, installed size, memory, logging speed, reconnect flush, probe cost) are PROPOSED values in
`packages/shared/src/proposed-config/registry.ts` under `device_lab.budgets`. They are **REPORT ONLY**: the harness writes them next to the
measured number and says PASS or FAIL for the person reading, but never fails a build, a pull request or a release. Change a budget by publishing a
new versioned entry there, not by editing a script.

## What you need

| Item | Notes |
|---|---|
| Two Android floor phones | One Tecno or Infinix, one itel. Android 10 or later (Android 11 or later lets the harness toggle airplane mode over adb). 2 GB RAM is the floor; the checklist says 4 GB class per DG-1, record what the phone really has. |
| One iPhone | iOS 16 or later. It cannot be driven from the harness (no adb, no airplane-mode automation); you time it by hand and enter the numbers. |
| A Mac or Linux machine | `pnpm install` done at the repo root. Android platform-tools (`adb`). Maestro (`curl -Ls "https://get.maestro.mobile.dev" | bash`, needs a JDK). |
| A test account | `is_test = true`, on the live project or a staging stack. Never a real patient. Set `MOBILE_E2E_EMAIL` and `MOBILE_E2E_PASSWORD` in your shell; the harness hands them to Maestro through the child's environment (`MAESTRO_` prefix, so they are not in `ps`) and never writes them to the report. Maestro keeps its own run logs under `~/.maestro/tests`, so use a throwaway test account and clear that folder when you are done. |
| A release build | See below. A development client or debuggable build is detected and gets no PASS or FAIL. |

## 1. Build the binary (once; needs the founder's EAS login)

`runtimeVersion` in `apps/mobile/app.json` is `0.1.0-native7` today. One fresh native build must exist for it. It carries SQLCipher, NetInfo,
the exact-alarm Kotlin module and the boot permission. An OTA update cannot deliver any of these.

```bash
cd apps/mobile
eas build --profile preview --platform android    # an installable, non-debuggable APK; download it from the EAS build page
eas build --profile preview --platform ios        # needs the iPhone registered for ad-hoc (eas device:create)
```

Do not use `--profile development` for measuring: it is a development client and its start-up and size mean nothing. The `production` Android
profile builds a store bundle that adb cannot install directly. Record the EAS build id; pass it as `--label`.

## 2. Prepare each Android phone

1. Settings, About phone: tap Build number seven times. Developer options: USB debugging on. Accept the key prompt on the phone.
2. `adb devices` shows the phone as `device` (not `unauthorized`).
3. Stay awake while charging: on. Disable any "adaptive battery" experiments you are not testing. Charge above 50 percent (a low battery changes timing).
4. Install the build: `adb install -r <file>.apk`, or pass `--apk <file>` to the harness.
5. Note the battery-manager state **before** the run (default, as the maker ships it). You will repeat the reminder tests after changing it.

## 3. Run the harness (one command)

```bash
MOBILE_E2E_EMAIL=... MOBILE_E2E_PASSWORD=... \
  scripts/device-lab/run.sh --label "eas build <id>" --note "fresh install, signed out then in by the flow"
```

Name an iPhone by model, not by owner (`--device-name "iPhone 12"`): the name goes into the committed file name. The full phone serial and simulator UDID are cut to their last four characters everywhere in the report.

Useful options: `--serial <id>` when more than one phone is attached, `--runs 5` (cold start runs; default comes from the budget config),
`--skip-flows` (no Maestro; only cold start and size), `--dry-run` (prints the plan and the budgets, touches nothing). `scripts/device-lab/run.sh --help`.

It writes `docs/device-lab/<date>-<maker>-<model>.md` and a `.json` next to it. Commit both. The phone serial is cut to its last four characters.

What it measures, and what each tag means:

| Metric | How | Notes |
|---|---|---|
| Cold start to first frame | `am force-stop`, then `am start -W`, 5 runs, median and p95 | Time to the first drawn frame. The budget is about a **usable screen**, which is later, so this is a *lower bound*: over budget is a proven FAIL, under budget is INCONCLUSIVE, never PASS. A run that is not reported as COLD is rejected and the metric becomes "not measured". With 5 runs p95 is the maximum. |
| Cold start to usable screen | Hand-timed | The only cold start that can PASS. Step 6. |
| Installed size, APK files | Sum of the installed APK files (base plus splits), decimal MB | A *lower bound* on installed size (extracted libraries, compiled code and data are not in it): FAIL if over, INCONCLUSIVE if under. |
| Installed size, Settings | Hand-read | The only size that can PASS. Step 6. |
| Memory | `dumpsys meminfo` total PSS after the flow logs 3 readings offline | Not the 1000-row case in the checklist; see manual step 7. No budget is set (`memory_mb_max` is null), so the verdict is NO BUDGET. |
| Reconnect flush | Maestro flows `prepare-offline-log.yaml` and `assert-flushed.yaml`; adb turns airplane mode off; `uiautomator dump` and `dumpsys window` check the screen before and after | Before reconnecting it must see the app in front with "waiting to send: 3"; after airplane mode goes off a ping must succeed (else "not measured", because a stuck queue on a phone with no network says nothing about the app); afterwards the notice must be gone with the app still in front. PASS also needs "Received by TarragonHealth." on screen; without it the verdict is capped at INCONCLUSIVE. A send failure on screen ("could not be saved", "not sent yet") is reported as REVIEW, not a timing result. Reported as an **upper bound** (it includes Maestro start-up, which the harness times on a do-nothing flow). PASS only when the upper bound is within budget; FAIL when even the estimate after removing start-up is over, or when the rows are still waiting after the harness waited past the budget; otherwise INCONCLUSIVE. It does **not** check that the server received the rows: confirm that on the dashboard. |
| Log a reading, probe cost | Not automatable here | Always "not measured" until you enter them (manual steps 6 and 7). |

The honesty rules, enforced in code and unit tests (`packages/shared/src/device-lab/`):

- A metric that was not measured has no number and no verdict.
- PASS or FAIL appear only for a real device with a release build. A simulator, an emulator or a debuggable build gives NOT EVALUATED; an
  unreadable build kind gives INCONCLUSIVE.
- If a step fails, is skipped or cannot confirm its own precondition (the phone was not offline, airplane mode did not switch off, the process was
  not cold), the metric is "not measured" with the reason. The report never states an overall pass and says "N of 9 measured (INCOMPLETE)" until all are.
- Whatever the numbers, the exit code is 0 once a report was written (REPORT ONLY).
- At the end the harness turns airplane mode off again (Android 11 command, then the older settings route), reads it back, and prints a WARNING if the phone may still be offline. Check the phone anyway. The `airplane-*` and `power-cut-*` flows turn it off in `onFlowComplete` even when they fail; `remote-wipe-lease-checklist.yaml` PHASE=prepare cannot, on purpose.

## 4. Manual steps the harness cannot do

Time these first if you can and pass them in the main run with `--manual <id>=<value>` (a manual value is tagged `manual`, fills only a gap, and never overrides one the harness measured). Otherwise run the harness a second time with `--skip-flows --manual ...`: a second run on the same day and phone writes a second file (`-2`) and never overwrites the first.

6. **Usable-screen cold start and Settings size.** Kill the app, tap the icon, stopwatch (or screen-record) to the first screen the patient could act on; median of 5; enter `cold_start_usable_ms`. Settings, Apps, TarragonHealth, Storage: the total in MB; enter `installed_size_settings_mb`. These two, not the harness's first-frame and APK figures, are what decide PASS against the cold start and size budgets.
6b. **Logging speed.** Screen-record the phone at 60 fps (`adb shell screenrecord` is 30 fps on many Transsion phones; use a second phone's slow-motion camera if needed). Tap Save reading ten times. From the frame of the tap to the frame where the store write is done is hard to see, so time tap to "Saved on this phone" visible (`log_visible_ms`, budget 300 ms). The store-write figure (`log_store_write_ms`, budget 50 ms) needs the in-app timing marker that does not exist yet; until it does, leave it "not measured" rather than guessing.
7. **Probe cost.** Log one reading offline, leave the app open and the network on but blocked (captive-portal Wi-Fi), and read the data meter or router log for an hour. Enter `probe_requests_per_minute`. Also check the captive-portal case: no flush while there is no real internet, a flush within a minute once there is.
8. **Memory with 1000 queued rows.** Seed 1000 rows (a test account and a debug-only script; not part of this harness), run the app five minutes on Vitals, read the profiler, enter `memory_after_offline_flow_mb` only if you want the 1000-row figure to replace the 3-row one.
9. **Power cut.** Run `apps/mobile/.maestro/flows/power-cut-restart-mid-queue.yaml`, then do it for real: log three readings offline, hold the power button, force a restart (or pull the battery on a phone that allows it), reopen. Expect the three rows still listed and flushing; no "tell support this code" notice.
10. **Throttled link.** Shape a hotspot to about 50 kbit/s, 400 ms latency, 3 percent loss (macOS Network Link Conditioner "Edge", or `tc netem`). Run `throttled-2g-sync.yaml -e THROTTLE_CONFIRMED=yes`.
11. **Reminder after reboot** (closes OQ-73 on this phone). Run `reminder-after-reboot.yaml` with `PHASE=prepare`, `adb reboot`, do not open the app, then `PHASE=check` after the dose time. The Maestro check is advisory: it sees only that a "Tarragon Health" entry is in the shade. The result is you reading the arrival time in the shade against the dose time and writing the minutes late. Repeat after the battery-manager steps below.
12. **Remote wipe and lease.** Follow `remote-wipe-lease-checklist.yaml` (phases prepare, verify_admin, verify_lease). Put the clock back afterwards.
13. **Encryption and migration** (once per phone). Follow "Encryption and migration" in `docs/S06X_DEVICE_CHECKLIST.md`: install the previous build with 20 queued readings, update to this build, expect all 20 still listed, no plain `tarragon-offline.db`, and `tarragon-secure-1.db` unreadable without the key; clear app data and restore from backup to see the `key_lost` notice with a code.

## 5. Battery-manager checklist (record per phone, before and after)

Open each screen and note whether TarragonHealth is allowed, restricted or unknown. The in-app "Keep reminders working" card links to these; verify
the link lands on the right screen on the real phone, and write down what the screen is called on that firmware.

| Maker | Screens to check |
|---|---|
| Tecno, Infinix, itel (HiOS, XOS, itelOS; one power manager) | Phone Master or Phone Manager, Power Manager or App Management, Auto-start (allow), Background activity / "Lock in recents", Battery optimisation (not optimised), Notifications (all on), Alarms and reminders (allowed). |
| Samsung | Settings, Battery and device care, Battery, Background usage limits: "Sleeping apps" and "Deep sleeping apps" must not list the app; "Never sleeping apps": add it. App info, Battery: Unrestricted. Alarms and reminders (Special access): allowed. |
| Any phone | App info, Notifications on; Special app access, Alarms and reminders on (Android 12 and later; this is the `SCHEDULE_EXACT_ALARM` switch the app asks for in context); Do not disturb exceptions; Battery saver off for the run. |

For each: reminder delivered on time with the app closed, delivered after reboot, delivered in Doze (screen off 30 minutes), and what the app's
"Reminders may be a few minutes late" line says. Take the exact times from the notification shade.

## 6. Where results go

1. Commit `docs/device-lab/<date>-<device>.md` and `.json` for each phone and the manual checks.
2. **S06x acceptance** (`docs/design/S06x.md` section on what is not measured, and `docs/S06X_DEVICE_CHECKLIST.md`): fill the table in the checklist from the reports. A cell is "met" only where the report says PASS on a real phone with a release build. Anything "not measured" stays UNMEASURED. Then append a dated entry to `docs/BUILD-PROGRESS.md` under S06x with the numbers and what was fixed.
3. **S08x acceptance and OQ-73** (`docs/design/S08x.md` section 4): OQ-73 closes only when the reminder-after-reboot and exact-alarm checks above pass on both Android floor phones, or the ones that fail are written up with the maker setting that fixes them. Record per phone: permission flow on that Android version, boot reschedule, Doze delivery, which maker screens exist.
4. Anything that misses a budget gets a follow-up item (the budgets are report only, so a miss is a finding to fix, not a blocked release). Anything that cannot be measured with this harness gets a line saying why.
5. The three founder-side items still open for this run: the phones (D8), the `eas build` for `0.1.0-native7`, and a test account.
