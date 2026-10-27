# Audio fallback: measuring on a real handset

Purpose: replace the PROPOSED `video.audio_fallback` values (version 2: 3 poor samples to drop to audio, 6 good to offer video back, 10 percent audio loss, 600 ms round trip, one sample every 3 s) with numbers measured on the handsets and networks patients really have. This tool collects the evidence and writes a CANDIDATE value. It never changes the signed configuration: the CMO or founder decides and the change goes through the versioned configuration.

## Who and what
A tester (the CMO, a doctor or an ops person) with the handsets and conditions to cover, and a second person on a call with them. Per condition at least 5 runs, on at least 2 different handset models. Conditions: 3G throttled, 2G/Edge, power saving mode on, Wi-Fi with added packet loss, and 4G normal as the baseline.

## Steps (about 10 minutes a run)
1. Put `scripts/audio-fallback-measure/probe.html` on any HTTPS static host (or send the file to the handset and open it; it works from a file). It is one page, no account, nothing is sent anywhere: it stays on the page until you download or copy the result.
2. On the handset, in the condition under test: fill in your name, the handset model, the condition, and tick power saving if it is on.
3. Run the link timing (30 small requests). Failed or slow requests are a rough stand-in for packet loss.
4. Start a real call in the app. Use the Join stopwatch: Start when you tap Join, Stop when you can hear or see the other person.
5. Add loss in steps (a router, Network Link Conditioner, or a lossy hotspot): 0, 5, 10, 15, 20, 30 percent. At each step tap how the speech was: clear, choppy but understood, cannot understand, or dropped.
6. Make the connection bad at a moment you start the stopwatch; stop it when the app shows audio only.
7. Tap Download file. You now have one JSON per run. Collect them in one folder.

## Make the report
`node scripts/audio-fallback-measure/report.mjs <folder> --out report-dir`
- prints a table per condition: join time, time from a bad link to the audio-only screen, the lowest loss at which speech broke, round trip, failed requests
- with too little evidence it says exactly what is missing and writes no candidate (exit code 3)
- with enough it writes `video.audio_fallback.candidate.json` (status proposed, unsigned) and findings, including a warning if the ladder is more than twice as slow on a handset as the configured values imply

## Then
Take the report to the CMO. To try the candidate against the profiles first: `pnpm --filter @tarragon/web audio-fallback-table <profiles.json>` (the existing simulation tool) with the candidate's values. Signing is a configuration change with the usual sign-off; this tool and this runbook do not do it.
