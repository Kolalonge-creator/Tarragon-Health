# S06x device lab checklist

Status: **NOT RUN.** Every budget below is UNMEASURED until someone fills this in on real phones (decision D8: who owns the devices is still open). Nothing in the code or the PR claims these numbers as met.

Devices: two Android floor phones (one Tecno or Infinix, one itel; Android 10+, 4 GB class per DG-1) and one iPhone (iOS 16+). Build: the `0.1.0-native6` EAS build (SQLCipher, NetInfo). Release profile, not dev client.

| # | Check | Budget | Tecno/Infinix | itel | iPhone |
|---|---|---|---|---|---|
| 1 | Cold start to first usable screen, app killed, 5 runs, median | under 3 s | | | |
| 2 | Installed size (Settings, App info) | under 40 MB | | | |
| 3 | Memory after 5 minutes on Vitals with 1000 outbox rows (Android Studio profiler / Xcode) | note value; no budget set | | | |
| 4 | Log a reading: tap save to "Saved on this phone", median of 10 | under 50 ms store write, under 300 ms visible | | | |
| 5 | Reconnect flush: airplane mode, log 3 readings, turn airplane mode off, time to "Sent" | within 1 minute | | | |
| 6 | Same with wifi on a captive portal (no internet) | no flush; flush within 1 minute of real internet | | | |
| 7 | Probe cost: watch the data meter for an hour with 1 row waiting | under 1 request per minute | | | |

Encryption and migration (once per phone, from an install of the previous build with queued rows):
1. Install the previous build, log 20 readings offline, do NOT sync.
2. Update to the native6 build. Open the app. Expect all 20 still listed, no notice.
3. Pull the app data (Android: `adb run-as`, iOS: Xcode container). Expect no file named `tarragon-offline.db`, and `tarragon-secure-1.db` unreadable with `sqlite3` without the key (`file is not a database`).
4. Settings, clear app data on Android, restore from backup: expect the `key_lost` notice with a code, app still usable.

Remote wipe (needs the migration live and a test account):
1. Open the app signed in, wait for one sync. Note the phone in `offline_device_leases`.
2. Log a reading offline, then call `request_offline_device_wipe` for that device as the account.
3. Turn the network on. Expect: one last upload (reading arrives), then the store is cleared, the "cleared" notice shows with a count, `confirm_offline_device_wipe` recorded.
4. Offline wipe: set the phone clock 31 days forward with airplane mode on, open the app. Expect the lease-expired notice. Put the clock back after.

Android reminder reliability (shares the S08x-3 matrix): exact-alarm permission asked in context, boot reschedule, Transsion and Samsung battery-saver steps. Record per phone.

Record results in `docs/BUILD-PROGRESS.md` under S06x and fix what misses.
