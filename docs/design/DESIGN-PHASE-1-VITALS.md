# Design Phase 1: the Vitals screen (2026-10-03)

First screen moved onto the kit (design Phase 0, decisions DG-1 to DG-6). Audit findings addressed here: F2 (typography), F3 (motion and feedback), F4 (no trend visual), F5 (accessibility), F7 (thin kit), F9 (i18n).

## What the patient sees
- **Latest reading first**: the newest blood pressure as the biggest thing on the screen, an "At target" or "Above target" badge (icon and words, never colour alone), when it was taken, "Waiting to send" if it is still on the phone, and the 7 day average.
- **A trend chart** (Skia): systolic and diastolic over 7 or 30 days, dashed lines at the app's own above-target levels (the same thresholds the server classifier uses, kept in step by `threshold-sync`), tap or drag to read any reading, a light haptic as the selection moves. It never says a trend is improving or worsening: that is a clinician's judgement.
- **Log a reading** with labelled fields (the label never disappears into a placeholder), calm inline errors, a saved toast with a success haptic, or "saved on this phone" when offline.
- **Log another vital** with chips, a unit control for glucose, the same toast.
- **Recent readings** as one card of rows with status badges; skeleton placeholders while loading; a proper empty state.
- The heavy monitoring-cover card moved down, below the readings: the vitals come first.

## What did not change (behaviour kept)
Offline outbox and drafts, the on-device emergency guidance and urgent banner (still raised before the save, and kept if the save fails), glucose unit preference, acting for someone else, the symptom flow, the threshold sync. The entry limits are unchanged and are now in `lib/vitals-entry.ts`, with a test that the server accepts every limit the phone allows.

## Built and tested
- `lib/bp-trend.ts` (pure): windowing, scales, reference lines, nearest point, descriptive summary. 15 tests.
- `lib/vitals-entry.ts` (pure): validation extracted from the screen. 27 tests, including every phone limit run through the web server's own schema.
- `lib/vitals-i18n.test.ts`: every key the screen builds at run time exists in English and Pidgin (27 cases).
- Kit additions: Badge, Chip, SegmentedControl, InlineAlert, TrendChart. SyncBanner moved onto the kit (it also appears on Medications).
- 66 new strings (en, pcm), all text on the screen through `packages/i18n`.
- Lint ratchet: `vitals-screen.tsx` and `sync-banner.tsx` are listed as moved, so raw colours, literal font sizes and the legacy theme and component imports are errors there.

## Checked on the simulator (iOS build with the new native modules)
Rendering with sample readings: ivory canvas, Sora headline, the hero number, badge, pending marker, the Skia chart drawing in, tap-to-inspect (point enlarges, guide line, "148/94 mmHg, 28 Sep at 18:44"), chips, segmented control, status badges with icons. The sample readings were a temporary local fixture and are not in the code; nothing was saved.

## Not checked
- A real Android device, dark mode (the switch stays off until the flagship screens have moved), a screen reader pass (VoiceOver and TalkBack), large text sizes, a real long history, and the offline path in the new layout.
- Saving a real reading from the redesigned form (the simulator account was not mine to write to).
- The two rows that depend on screen layout in Pidgin (label widths).

## Left for the founder
- The monitoring-cover card's own wording is unchanged: its headline reads as alarming against the house voice (no fear-based urgency) and its body has an em dash. It carries a legal-accuracy rule ("never imply an uncovered patient is unmonitored"), so the wording is a product and legal decision (OQ-64), not a styling one.
- The Pidgin strings need native review (OQ-63).
