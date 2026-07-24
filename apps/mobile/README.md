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
npm install -g eas-cli
cd apps/mobile
eas login                 # the Expo account from step 1
eas init                  # links the project, writes extra.eas.projectId into app.json
eas update:configure      # wires OTA updates (uses the runtimeVersion policy already set)

# Android — no Google account needed, installs directly on any phone:
pnpm build:preview:android    # produces an .apk you download & install

# iPhone — needs the Apple Developer account; EAS walks you through
# certificates automatically:
pnpm build:dev:ios            # internal build, install via the QR/link EAS prints
```

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
