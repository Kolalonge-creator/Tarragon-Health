# TarragonHealth mobile app (`@tarragon/mobile`)

Expo (SDK 54) app, fully native screens (the embedded WebView was removed
2026-09-07; every patient section is a React Native screen talking to
Supabase directly or to the bearer-authenticated `/api/mobile/*` routes):

- **Home / Vitals / Meds / Messages / More** — the patient platform, native.
- **Devices** (under More) — the Bluetooth layer (the one thing web can't
  do): pair a BP cuff, glucometer, scale, thermometer, or pulse oximeter,
  live-decode readings via the shared GATT parsers, and POST them to
  `/api/mobile/device-readings`. Apple Health (iOS) syncs through the
  HealthKit bridge. **Android Health Connect is built but switched off for
  the first Play release** — see `src/lib/health-connect.ts`'s
  `HEALTH_CONNECT_ENABLED` comment for why and how to turn it back on.

Because `react-native-ble-plx` is a native module, this app **cannot run in
Expo Go** — it needs a real build via EAS. Everything below is already
configured; the only prerequisites are the accounts.

## Versions: `version` vs `runtimeVersion` (read before bumping either)

- `expo.version` in `app.json` is the store-facing number (Play Console /
  App Store). It was reset to **0.1.0** on 2026-09-08 for the first public
  release; earlier "0.2.0"/"0.3.0" builds were internal only.
- `expo.runtimeVersion` is the **native-compatibility label** for OTA
  updates, not a marketing number. An OTA update only reaches binaries with
  the exact same runtimeVersion, so it must change on every native-affecting
  change (new native module, plugin, permission) and must **never be reused**
  for a binary with a different native set: plain "0.1.0" was already used by
  the August internal APKs (a different native set), so the store release
  uses "0.1.0-native2". Publishing JS built for one native set to a runtime
  shared with an older binary crashes that binary on launch.
- `versionCode` (Android) / build number (iOS) is managed remotely by EAS
  (`appVersionSource: remote`, `autoIncrement` on the production profile).

## Google Play submission

`store-assets/android-submission/` holds the listing assets;
`docs/PLAY_STORE_SUBMISSION.md` (repo root `docs/`) holds the Data safety
form answers, the category, the account-deletion URL, and the pre-upload
checklist.

## One-time account setup (owner)

1. **Expo account** (free): <https://expo.dev/signup>
2. **Apple Developer Program** ($99/yr, needed for any iPhone install):
   <https://developer.apple.com/programs/enroll/>
3. **Google Play Console** ($25 one-time, only needed for Play Store
   distribution — a `preview` APK installs on any Android phone without it):
   <https://play.google.com/console/signup>

## First build (after the accounts exist)

```bash
cd apps/mobile
pnpm install               # installs eas-cli locally — no global/sudo install needed
pnpm exec eas login        # the Expo account from step 1
pnpm exec eas init         # links the project, writes extra.eas.projectId into app.json
pnpm exec eas update:configure  # wires OTA updates (uses the runtimeVersion policy already set)

# Android — no Google account needed, installs directly on any phone:
pnpm build:preview:android    # produces an .apk you download & install

# iPhone — needs the Apple Developer account; EAS walks you through
# certificates automatically:
pnpm build:dev:ios            # internal build, install via the QR/link EAS prints
```

`eas-cli` is a devDependency of this workspace (not a global install), so `pnpm build:*`
scripts and `pnpm exec eas ...` always resolve the version pinned in `package.json` — no
`npm install -g eas-cli` needed. Running that global-install form yourself can fail with an
`EACCES: permission denied` error on a stock macOS/Homebrew Node setup, because npm's default
global prefix (often `/usr/local/lib/node_modules`) isn't writable by your user; `sudo npm
install -g` "fixes" it but then mixes root- and user-owned global installs, which is how the
`Cannot find module 'fast-glob'` / stale-eas-cli-link error shows up on a later build. If you
ever do need a one-off `eas` command outside this workspace, use `pnpm dlx eas-cli@latest
<command>` instead of a global npm install — it always runs a clean, current copy without
touching global state.

Commit the `app.json` changes `eas init` makes.

## Day-to-day

- **JS-only changes to this app** (screens, styling, logic) ship
  over-the-air: pushes to `main-dev` auto-publish to the `preview` channel
  (`.github/workflows/mobile-ota-publish.yml`); `production` is published
  manually with `pnpm update:prod "<message>"` — installed apps pick it up
  on next launch, no store review.
- **Server-side changes** (`/api/mobile/*` routes, RLS, RPCs) ship with
  normal web deploys; the native screens read from them live.
- **Native changes** (new native modules, permissions, app icons) need a
  new `eas build` (+ store submission for production).

## Configuration notes

- Build-time env lives in `eas.json` (`build.base.env`). These are all
  client-safe publishable values (the Supabase **anon** key is the same key
  every web page already ships to browsers; RLS is the security boundary —
  see CLAUDE.md). Real secrets must never go in `eas.json`.
- For local development against a dev server instead, put overrides in
  `apps/mobile/.env.local` (see the root `.env.example` catalogue).
- Store identity: iOS bundle id `com.tarragonhealth.mobile`; Android package
  `com.tarragonhealth.app` (it must match the app already created in the Play
  Console, which rejects a first upload under any other package name). Guard
  Leaf icon/adaptive-icon/splash in `assets/`.

## Tests

```bash
pnpm --filter @tarragon/mobile test        # or `pnpm test` at the repo root, via turbo
```

`jest-expo` (the preset Expo SDK 54 pins in its own `bundledNativeModules.json`)
plus a small set of in-memory stand-ins for the native modules —
`src/test/mocks/`, wired up in `jest.setup.ts`. Scope is **pure logic only**:
the clinical classifiers, the two offline queues, the BLE service/parser
wiring, and `api.ts`'s auth and retry policy. Screens are not rendered here;
device paths are verified on real hardware (see CLAUDE.md's Device & Wearable
Integration section).

Note the preset for SDK 54 is built against the Jest 29 line, so this package
runs Jest 29 while `apps/web` and `packages/shared` run 30. Turbo invokes each
package's own `test` script, so the two runners never meet.

Two kinds of test here are load-bearing and should not be "simplified" away:

- `bp-classification.test.ts` / `glucose-red-flags.test.ts` / `threshold-sync.test.ts`
  import the **web** copies of the same rules directly and compare them
  value-for-value across the whole plausible input range. These files exist
  because the mobile classifiers are hand-maintained duplicates of the web
  ones (which are themselves duplicates of the DB triggers) — the imports are
  what makes a drift fail a test instead of shipping.
- Tests whose name starts with `FINDING:` pin behaviour that is currently
  **wrong but deliberately unchanged**, because fixing it is a product
  decision rather than a bug fix. Each one carries the reasoning in a comment
  above it. If you fix the behaviour, delete the test — do not adjust it to
  keep passing.
