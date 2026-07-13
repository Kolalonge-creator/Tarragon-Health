# Device Integration — Session Handoff

Branch: `claude/tarragon-medical-device-integration-cn8e82`. **Nothing is
committed yet** — all work below is in the working tree (`git status --short`
shown at bottom). Delete this file once you've read it; it's a handoff note,
not permanent repo documentation.

## What this session was building

CLAUDE.md flags device/wearable integration as "Phase 3, planned, not yet
built." The user asked to build it. Scoped to the **Bluetooth clinical
device path** (BP cuff, glucometer) per `FULL_SPECIFICATION_V4.md` — core
tier, sold as device bundles, matches "blood sugar/blood pressure" directly.
Consumer wearable cloud sync (Apple Health/Oura/WHOOP/etc.) is explicitly
Phase 3/diaspora-only and untouched this session.

Key architectural decision (from CLAUDE.md's own wording, not guessed):
device readings must land in the **same `vitals_readings` table** manual
entry already uses (tagged `source='device'`), not a parallel table — "no
dual source-of-truth," same downstream BP-control ML assessment / escalation
pipeline regardless of source.

## What's built and verified

### 1. DB migration (written, **NOT yet applied to remote Supabase**)
`supabase/migrations/20260713210000_patient_devices_and_vitals_source.sql`
- New `patient_devices` table (paired BLE peripherals: `device_type` enum
  `bp_cuff`/`glucometer`/`scale`, `ble_device_id`, `status`, RLS matching
  house style: patient owns row or org staff, four explicit policies).
- `vitals_readings` gains `source` (`manual`/`device`), `device_id` FK,
  `external_reading_id`, plus a partial unique index on
  `(device_id, external_reading_id)` for idempotent resync.
- Supabase MCP tools were flaky/disconnecting all session (kept
  connecting/disconnecting) — I could never reliably call
  `apply_migration`. **You need to apply this migration** (via Supabase CLI
  `supabase db push` or MCP) against project `koiplnmbgnqnbywhpjlf`, then
  regenerate types properly (I hand-patched
  `packages/shared/src/database.types.ts` to match what the migration
  *should* produce — verify it against the real generated output once
  applied, in case I mistyped a column).

### 2. Shared package (`packages/shared/`) — tested, passing
- `src/device-readings.ts`: real Bluetooth SIG GATT parsers — IEEE
  11073-20601 SFLOAT decoder, Blood Pressure Measurement (0x2A35), Glucose
  Measurement (0x2A18) characteristic parsers, base64 decode helper (no
  `atob`/`Buffer` dependency, works under Jest and Hermes alike).
- `src/device-readings.test.ts`: 14 tests, all passing — round-trip SFLOAT
  encode/decode, full BP/glucose payload parsing, kg/L vs mol/L glucose
  unit conversion, negative time offsets, NaN/Infinity sentinels.
- Exported from `src/index.ts`.

### 3. Web app (`apps/web/`) — tested, passing
- Extracted `assessBpControlBestEffort` out of
  `patient/actions.ts` into `src/lib/ml/assess-bp-control.ts`, **refactored
  to accept the caller's own Supabase client as a parameter** instead of
  constructing a cookie-based one internally — this was a real bug I caught
  before shipping: the bearer-token mobile route would have silently
  no-op'd (RLS returns nothing under an unauthenticated cookie client).
  Both `logVital` (web) and the new device route now pass their own client.
- `src/lib/validation/device-reading.ts` (+ test): Zod schema for
  BLE-sourced readings (blood_pressure/glucose/weight), reusing
  `GLUCOSE_RANGE`/`GLUCOSE_UNITS` from the existing `vitals.ts`.
- `src/lib/supabase/bearer.ts`: bearer-JWT-authenticated Supabase client
  (RLS-scoped, not service-role) for the mobile app, which has no Next.js
  cookie session.
- `src/app/api/mobile/device-readings/route.ts`: the ingestion choke point.
  Bearer auth → validates device ownership → inserts into `vitals_readings`
  with `source: "device"` → dedupes on `23505` unique-violation (idempotent
  retry) → calls `assessBpControlBestEffort` for BP readings → updates
  `patient_devices.last_synced_at`.
- All of `pnpm turbo run typecheck lint test --filter=@tarragon/web
  --filter=@tarragon/shared` passed clean at the point these were finished
  (156 web tests + 35 shared tests, 0 lint warnings) — **before** the mobile
  app was added to the workspace. See the unresolved issue below.

### 4. Mobile app (`apps/mobile/`) — scaffolded, typechecks, **NOT verified against real hardware**
New Expo/React Native workspace package (SDK 51, RN 0.74, React 18.2 — no
`apps/mobile` existed before this session, fully greenfield):
- `App.tsx` — minimal state-machine navigation (no react-navigation/
  expo-router by design, to keep dependency surface small): auth →
  device list → sync screen.
- `src/lib/supabase.ts` — SecureStore-backed session persistence.
- `src/lib/ble.ts` — `react-native-ble-plx` wrapper: scan for BP/Glucose
  GATT services, connect + subscribe to measurement characteristics,
  decode via the shared parsers.
- `src/lib/api.ts` — posts decoded readings to the web app's
  `/api/mobile/device-readings` route with the mobile session's bearer
  token.
- `src/screens/login-screen.tsx` (sign-in only — signup stays on
  web/app onboarding per CLAUDE.md), `devices-screen.tsx` (list paired +
  scan/pair flow), `sync-screen.tsx` (live readings, confirm/save, glucose
  requires a fasting/random/post-meal prompt since the GATT characteristic
  itself carries no such concept).
- **Known scope gap**: `patient_device_type` includes `scale`, but I did
  not implement a Weight Scale (0x2A9D) GATT parser — its resolution
  depends on a separate Weight Scale Feature characteristic I didn't want
  to hand-wave. `SyncScreen` shows a "not supported yet" message for
  `scale` devices rather than guessing.
- `pnpm --filter @tarragon/mobile exec tsc --noEmit` passed clean against
  the **actually installed** Expo/RN/BLE types (real `pnpm install`, not
  just eyeballed) — genuine verification, not a guess.
- **Never run in a simulator/on a device** — no Android/iOS environment
  here. The BLE/GATT logic is unit-tested (in `packages/shared`), the
  screens are not.

### 5. Env / docs
- `.env.example` updated with `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL`.
- **CLAUDE.md's "Current Sprint" section was NOT updated yet** — do this
  before/when you commit, per the project's own convention (every sprint
  update goes there).

## Unresolved problem at cutoff — a real, reproducible bug

Adding `apps/mobile` to the pnpm workspace (`react-native@0.74.5` has a
direct dependency on `jest-environment-node@29.7.0`, an older major than the
`jest@30.4.2` used by `apps/web`/`packages/shared`) broke **all** Jest test
runs repo-wide with:

```
TypeError: this._moduleMocker.clearMocksOnScope is not a function
  at Runtime.resetModules (jest-runtime@30.4.2/build/index.js:3784)
```

Confirmed via a full clean reinstall (removed all `node_modules` + `.turbo`,
fresh `pnpm install`) that this is **not** transient/cache-related — it
reproduces every time with `apps/mobile` in the workspace. I was mid-trace
(checking whether `jest-runtime@30.4.2`'s own `jest-mock` symlink is correct
— it is, confirmed 30.4.1 — so the mismatch is happening somewhere in how
Jest's environment/module-mocker gets constructed at runtime, likely via
some other jest-internal package that isn't as cleanly isolated as
`jest-runtime` itself) when I was asked to stop and hand off.

**This needs to be fixed before you trust `pnpm test` output again.**
Approaches to try, roughly in order of how surgical they are:
1. Find exactly which jest-internal package is loading `jest-mock@29.7.0`'s
   `ModuleMocker` instead of `30.4.1`'s (I got as far as confirming
   `jest-runtime` and `jest-environment-node`'s own symlinks are both
   correct in isolation — the leak is happening somewhere I hadn't found
   yet, possibly `jest-circus`, `@jest/core`, or `jest-cli`'s own
   resolution of `jest-environment-node` when given a project config from
   a workspace root that also contains `react-native`'s conflicting version).
2. A `pnpm.overrides` entry in the root `package.json` pinning
   `jest-environment-node`/`jest-mock` to `30.x` repo-wide (react-native
   only needs it for internal test helpers you're not using, so forcing
   30.x there should be harmless — but verify `apps/mobile` still
   typechecks/installs after doing this).
3. Worst case: keep `apps/mobile`'s `package.json` out of the same pnpm
   workspace glob (give it its own lockfile / install boundary) so its
   dependency graph can never influence `apps/web`/`packages/shared`'s
   resolution. This is the most robust long-term fix if (1)/(2) turn out
   to be whack-a-mole, but it's a bigger structural change (mobile would
   need `pnpm install` run from inside `apps/mobile/` directly, and
   `@tarragon/shared` would need to be consumed differently since
   `workspace:*` wouldn't resolve across separate lockfiles).

Until this is fixed, re-verify `packages/shared` and `apps/web`'s test
suites (they were 100% passing before mobile was added — see above) before
trusting any new test output.

## Also not done
- Migration not applied to remote Supabase (see above).
- No PR opened (user didn't ask for one).
- CLAUDE.md Current Sprint not updated.
- Nothing committed — everything is workspace-dirty (see `git status`
  below).

## Current `git status --short`
```
 M .env.example
 M apps/web/src/app/(dashboard)/patient/actions.ts
 M packages/shared/src/database.types.ts
 M packages/shared/src/index.ts
 M pnpm-lock.yaml
?? apps/mobile/
?? apps/web/src/app/api/
?? apps/web/src/lib/ml/
?? apps/web/src/lib/supabase/bearer.ts
?? apps/web/src/lib/validation/device-reading.test.ts
?? apps/web/src/lib/validation/device-reading.ts
?? packages/shared/src/device-readings.test.ts
?? packages/shared/src/device-readings.ts
?? supabase/migrations/20260713210000_patient_devices_and_vitals_source.sql
```
