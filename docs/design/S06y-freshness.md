# S06y design note, part 2: how old is the offline copy (PR 2 of 2)

Part 1 (`docs/design/S06y.md`, PR 1) moves the plaintext upload queues into the encrypted store. This part is independent of it (separate branch off `main-dev`, no shared files except the progress log). JS only: no native module, no config plugin, no `runtimeVersion` change, no SQL migration, no AI.

## 1. Data

- **Where "last updated" comes from.** `offline-store.ts` now writes `lastpull:<account>:<person>` into the mirror's `sync_state` table at the END of a `pullChanges` run that finished without going offline, holding the time the pull STARTED (the copy is only as new as the start). A pull that stopped offline, failed for any other reason (a denied or missing table, a 5xx), ran out of page budget with pages left, or found drift it could not repair (`PullResult.incomplete`) writes nothing, so a stale copy can never look fresh. `readMirrorLastPulledAt(subjectId)` reads it, scoped to the signed-in account, never throws, and returns null when there is no signed-in account, no pull yet, or the mirror was cleared (`clearLocalMirror` already empties `sync_state` at sign-out).
- **Emergency card.** It does not use the read mirror. It keeps its own saved copy in the keychain (`emergency-card-cache-v1`), stamped `cachedAt` each time it was fetched. That stamp is the card's "last updated" time.
- **Emergency card bug found and fixed on the way.** `loadEmergencyFacts` ignored every query error: with no signal it returned an EMPTY card and wrote it over the saved copy, stamped as just fetched, so the offline path (and any label on it) was false. It now throws when any query fails, so the screen shows the saved copy and the label reflects when that copy was really saved. A failed choices query also no longer falls back to defaults that could show what the person chose to hide. Regression test in `emergency.test.ts`.
- **Threshold.** New PROPOSED registry key `offline.freshness` = `{ stale_after_hours: 24 }` (`packages/shared/src/proposed-config/registry.ts`, status proposed, owner Founder). Read through `loadFreshnessConfig()`; there is no literal in app code (the registry guard pattern fails the scan test if one appears). 24 hours is a starting point, not a clinical rule: nothing is signed and the CMO or founder can change it by adding a new version.
- **Logic.** `apps/mobile/src/lib/freshness.ts`, pure and unit tested: `assessFreshness(lastUpdatedAt, nowMs, config)` returns `recent | stale | unknown`, the label (just now, N minutes, hours or days ago, or "cannot tell") and, only when stale or unknown, the notice. A time more than 5 minutes in the future (the phone clock moved) is unknown, not "just now". A missing or unreadable time is unknown.

## 2. Screens

A small shared component, `ui/freshness-note.tsx`, shown only where the screen is displaying the saved copy (never on live data):

| Surface | When shown | Time used |
|---|---|---|
| Emergency card | the card loaded from its saved copy (the app was offline), below the existing "last saved copy" line | the card's `cachedAt` |
| Medicines list (the dose checklist on the Medicines screen) | `loadTodaysDoses` answered from the phone (`fromPhone`) | `readMirrorLastPulledAt` |
| Today (tasks and doses) | `loadToday` reports `fromPhone` (tasks from the mirror, or doses from the phone) | `readMirrorLastPulledAt` |

Below the threshold: one quiet caption, "Last updated 5 hours ago." At or past it (or when the time cannot be told): the caption plus one information note, "This may be out of date. Connect to the internet to refresh it." (or "Connect to the internet to refresh it." after "We cannot tell when this copy was last updated."). Information tone, no warning colour, no urgency words, no exclamation marks, English only (`packages/i18n/src/en.ts`, keys `freshness.*`), no em dashes, no "your doctor". Screen readers get the caption as "Saved copy on this phone. Last updated 5 hours ago." Status is words, never colour alone. One 60 second timer while the note is mounted (so a copy that crosses the threshold gets its note), no images, no new dependency (low data, 2 GB phones). A malformed config value cannot crash the host screen: the note then says the age cannot be told.

## 3. Safety rules

- The label never claims a copy is newer than it is: only a pull that completed records a time, and the START time is stored.
- A cleared mirror, a signed-out phone and a read error all read as "unknown", which is worded as cautiously as "old".
- The notice never changes what the app does or shows: no data is hidden, no dose or medicine is blocked, nothing is routed to clinical staff. It is information only.
- No AI. No PROPOSED value is written as confirmed. No go-live guard flipped.

## 4. Not verified on a device

Nothing ran on a phone or a simulator. The component is exercised only through its pure logic and text (Jest has no renderer for these screens); layout, font scaling, TalkBack and VoiceOver reading, and the real offline emergency card path need a device run. Whether 24 hours is the right threshold, and whether the emergency card should use a different one, is an open question for the CMO (it is a read-only notice, so the stakes are low).

## 5. Follow-ups

- Surface `offline.freshness` in the founder review list (`apps/web/src/lib/clinical/s06-s10-signoff-model.ts`) next to `offline.trust`.
- Other screens that read the mirror (vitals history, symptoms) could show the same note.
