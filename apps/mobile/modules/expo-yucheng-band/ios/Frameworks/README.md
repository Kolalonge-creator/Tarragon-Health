# Vendor framework goes here — one manual step

This directory is intentionally empty in git. `YuchengBand.podspec` vendors
`Frameworks/*.framework` (a glob), so `pod install` will pick up whatever's
physically present here — nothing else needs to change once you do this.

## What to do

Your Google Drive has the real SDK under `ios-sdk-master/swift_5.10/SDK包/`
(use the `swift_5.10` variant, not `swift_5.7.1`, to match a current Xcode
toolchain — confirm against whatever Xcode version you're actually building
with). That folder contains `YCProductSDK.framework` plus its dependency
frameworks (`DFUnits`, `JL_BLEKit`, `JLAV2Lib`, `JL_AdvParse`, `JL_OTALib`,
`RTKLEFoundation`, `RTKOTASDK`, `JLDialUnit`, `JL_HashPair`, `ZipZap`).

1. In Drive, right-click `SDK包` → Download (downloads as one zip).
2. Unzip it and copy every `*.framework` folder it contains straight into
   this directory (`apps/mobile/modules/expo-yucheng-band/ios/Frameworks/`).
3. Run `pod install` from `apps/mobile/ios/`.

## Why this wasn't done automatically

The frameworks are Mach-O binaries (some multi-MB), and Drive only exposes
per-file downloads through the tool used to build the rest of this
integration — pulling ~10 framework bundles (each a directory of several
files: the binary itself, `Modules/*.swiftmodule/*.swiftinterface`,
`Headers/`, `Info.plist`) that way would mean dozens of individual binary
fetches with real risk of a corrupted or incomplete copy, for something a
single Drive folder-zip download does correctly in one step. Doing it by
hand here also means you're the one who confirms the Swift toolchain
version matches, which nobody else in this chain (vendor doc, this module's
author) could verify.

## Which of the 10 frameworks are actually required

Unknown — and deliberately not guessed. For the Android side of this same
SDK, `ycbtsdk-release.aar`'s own `classes.jar` was decompiled and inspected,
and it turned out to have **no** bytecode dependency on the equivalent
Android-side extra libraries (OTA/watch-face/ECG add-ons) — see
`../../android/libs/README.md`. There's no equivalent way to inspect a
`.framework`'s Mach-O binary for its real link-time dependencies without
the actual binary in hand, which is exactly what this environment doesn't
have. Two reasonable options once you've got the frameworks in place:

- Drop in the full set from `SDK包/` (all 10 + the main framework) and let
  it build — simplest, matches what the vendor's own demo project links
  against, costs some extra binary size for code this module's API surface
  never calls.
- Drop in just `YCProductSDK.framework` first and let the linker tell you
  what's missing — Xcode will fail with a clear "Undefined symbols" or
  "framework not found" error naming exactly what else is needed, which is
  a safe, self-diagnosing way to find the real minimal set if binary size
  matters enough to bother.
