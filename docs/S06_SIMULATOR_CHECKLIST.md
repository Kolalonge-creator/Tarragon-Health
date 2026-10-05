# S06 simulator checklist: offline logging and sync

Run by hand on the iOS simulator (or a real phone), signed in as the First Patient test account. About 10 minutes. This covers what the Node tests cannot: the real screens, the real database, and a real network cut. The simulator pass of 2026-10-02 confirmed a clean start, the home screen and the Vitals screen on the merged code, but could not go offline (see "Why this is manual").

## Before you start
- Use the **normal** values below. A red-flag reading or a high-severity symptom would page the care team.
- Go offline with **Network Link Conditioner** (100% Loss) or by turning the Mac's Wi-Fi off. Metro runs on localhost, so the app keeps loading.
- If the iOS Health permission sheet appears, tap Don't Allow, then OK. It is slow to render and unrelated to S06.

## Steps

1. **Online baseline.** Vitals tab: enter 124 / 82, tap Save reading.
   *Expect:* the reading appears at the top of Recent readings. No sync banner.

2. **Log a vital offline.** Go offline. Enter 126 / 84, tap Save reading.
   *Expect:* no error, the fields clear, the banner says "Saved on this phone, waiting to send: 1".
   *Known quirk:* the new reading does not appear in Recent readings while offline; the list shows synced data only, and the banner is the only sign of the queued one.

3. **Log a symptom and a dose offline.** Still offline. Symptoms: headache, severity 3. Meds: tick one dose.
   *Expect:* the symptom shows "Saved on this phone. It will send when you are back online." The dose ticks. The banner count goes up.

4. **Power cut.** Still offline. Type 130 in Systolic and 85 in Diastolic without saving, then kill the app (swipe it away in the app switcher) and reopen it.
   *Expect:* the typed numbers are back in the form. The banner still shows the queued items.

5. **Reconnect.** Go online and wait about 10 seconds. Nothing flushes on reconnect yet (known follow-up), so save one more normal reading (122 / 80); that triggers a flush of the whole queue.
   *Expect:* the banner disappears. Recent readings shows the offline reading with the time you logged it, not the time it synced. The ticked dose stays ticked.

6. **Server check.** Ask the build session to query production and confirm: one row per entry (no duplicates); `client_recorded_at` set; `received_at` later than the logged time; `time_basis = client_bounded`. Then remove the test rows through the app (never hard-delete).

## Not covered here
- Rejected rows are hard to trigger by hand and are covered by unit tests (`apps/mobile/src/lib/outbox.test.ts`).
- The stuck-row notice needs a 12 hour wait.

## Why this is manual
There is no safe way to cut the network from an agent session: turning off the Mac's Wi-Fi would also cut the agent's own connection, and blocking the server needs admin rights. Cold start, installed size and memory on a 2 GB Android phone are still unmeasured and need a device lab run.
