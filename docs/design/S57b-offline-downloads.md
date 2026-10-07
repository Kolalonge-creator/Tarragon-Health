# S57b design note: offline audio downloads on the phone

Status: built, behind a feature flag that is OFF, NOT run on a real device, NEEDS A NEW NATIVE BUILD. Nothing was bumped or published.

## What exists
- `apps/mobile/src/lib/offline-downloads/manager.ts`: the policy, pure over three ports (files, network, clock). Unit tested with an in-memory file system (17 tests, with sabotage runs: integrity check removed, flag check removed, expiry check removed each fail a test).
- `apps/mobile/src/lib/offline-downloads/index.ts`: the real adapters (`expo-file-system/legacy`, `expo-network`), the manifest call (`media_offline_manifest`), the flag read (`my_feature_flags`), and `purgeAllDownloads`.
- Wired in two places only: the calm and sleep library card calls `refreshMediaDownloads()` when opened; `App.tsx` calls `purgeAllDownloads()` on `SIGNED_OUT`.
- Flag: `mobile_offline_downloads` (registered OFF by migration `20261007203712_s57b_mobile_offline_downloads_flag.sql`).

## Rules enforced in code
Wi-Fi only (unknown network counts as not Wi-Fi); per-item and per-pack byte caps from PROPOSED config `media_library.config` (5 MB, 50 MB), checked before the fetch; integrity = the file on disk must be exactly the size the server listed (and match a SHA-256 when one is listed; `media_library` has no hash column yet, so size is the only check today: OQ-S57b-05); a failed or wrong-size file is deleted and never indexed; an item past its date is deleted on every launch and refresh, even offline, and is never handed out; a failed manifest read never empties the pack; everything is deleted on sign-out regardless of the flag; ids that could escape the directory are refused.

## Why a new native build is required (do this before turning the flag on)
`expo-file-system` and `expo-network` are native modules and are now direct dependencies of `apps/mobile` (`~19.0.23`, `~8.0.8`, the SDK 54 bundled versions). An installed binary built before this change does not contain them. The adapters load them lazily inside try/catch, so an over-the-air update carrying this JavaScript to an old binary finds no module and the feature is simply absent (no crash). To make it work:
1. Founder or release owner bumps `runtimeVersion` in `apps/mobile/app.json` (currently `0.1.0-native5`) to the next native value. NOT done here, per instruction.
2. Run a new `eas build` for iOS and Android with the new runtimeVersion, install on a real phone, and test: Wi-Fi download, cellular refusal, airplane-mode expiry deletion, sign-out wipe, a corrupt file.
3. Only after the build is out and real, reviewed audio exists, switch the flag on (Admin, Feature flags). The mobile OTA workflow skips publishing when native-affecting files change; this change touches `package.json` dependencies, so it will correctly refuse to auto-publish.
Playback of a downloaded file needs an audio engine (also native); that is OQ-S57-04 and is NOT part of this.

## S55 integration seam
S55's learning-pack code is not on this branch. When it lands, create a second manager with `namespace: "learning"` and the learning caps, map the learning manifest to `DownloadItem` (`id`, `bytes`, `expires_on`, `updated_at`, `url`), call `refresh` / `purgeExpired` at launch, and add the manager's namespace to `purgeAllDownloads` (which already removes the whole `offline-downloads/` root, so no change is needed for sign-out). `planPackRefresh` and `downloadDecision` in `packages/shared` are the shared rules both packs use.
