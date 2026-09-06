# TarragonHealth mobile app (`@tarragon/mobile`)

Expo (SDK 51) app with two tabs:

- **Home** — the live web platform rendered in a WebView
  (`EXPO_PUBLIC_PLATFORM_URL`, defaults to the production Vercel
  deployment). Every web deploy updates this tab automatically — no app
  store release needed for platform features.
- **Devices** — the native Bluetooth layer (the one thing web can't do):
  pair a BP cuff or glucometer, live-decode readings via the shared GATT
  parsers, and POST them to `/api/mobile/device-readings` on the platform.

Because `react-native-ble-plx` is a native module, this app **cannot run in
Expo Go** — it needs a real build via EAS. Everything below is already
configured; the only prerequisites are the accounts.

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

- **Platform features** ship with normal web deploys — the Home tab is the
  live site; nothing to do on mobile.
- **JS-only changes to this app** (screens, styling, logic) ship
  over-the-air with `pnpm update:prod "<message>"` — installed apps pick
  them up on next launch, no store review.
- **Native changes** (new native modules, permissions, app icons) need a
  new `eas build` (+ store submission for production).

## Configuration notes

- Build-time env lives in `eas.json` (`build.base.env`). These are all
  client-safe publishable values (the Supabase **anon** key is the same key
  every web page already ships to browsers; RLS is the security boundary —
  see CLAUDE.md). Real secrets must never go in `eas.json`.
- For local development against a dev server instead, put overrides in
  `apps/mobile/.env.local` (see the root `.env.example` catalogue).
- Store identity is already set: `com.tarragonhealth.mobile` (iOS bundle id
  and Android package), Guard Leaf icon/adaptive-icon/splash in `assets/`.

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
