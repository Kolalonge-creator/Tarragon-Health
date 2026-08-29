# Vendor frameworks — present as of 2026-08-27

All 11 vendor `.framework` bundles are now in this directory, pulled from
`ios-sdk-master/swift_5.10/SDK包/` in the founder's Drive (the `swift_5.10`
variant, matching a current Xcode toolchain — confirmed from the framework's
own `.swiftinterface`: built with `Apple Swift version 6.0.3 effective-5.10`,
targeting `arm64-apple-ios9.0`, device-only, no simulator slice — matches the
vendor doc's "the SDK does not provide the simulator version, because BLE
cannot be debugged on the simulator").

`YuchengBand.podspec` vendors `Frameworks/*.framework` (a glob), so nothing
else needs to change — `pod install` from `apps/mobile/ios/` should pick all
11 up automatically.

## What's here

`YCProductSDK.framework` (the main SDK) plus its 10 dependency frameworks —
`DFUnits`, `JL_BLEKit`, `JLAV2Lib`, `JL_AdvParse`, `JL_OTALib`,
`RTKLEFoundation`, `RTKOTASDK`, `JLDialUnit`, `JL_HashPair`, `ZipZap`. All of
them were dropped in together (not trimmed to a minimal subset the way the
Android side was — see `../../android/libs/README.md`) since there's no way
to inspect a `.framework`'s Mach-O binary for its real link-time
dependencies without a real Xcode build, which this environment (no macOS)
cannot run. If binary size ever matters enough to bother, Xcode's own
"Undefined symbols"/"framework not found" errors on a build with only
`YCProductSDK.framework` present would tell you exactly which of the other
10 are actually needed.

## Still true: this has never been built

Placing the files here only gets you past the "the import doesn't resolve"
failure mode. `pod install` and an actual Xcode build have not been run
against this — no macOS/Xcode exists in the environment that assembled this
integration. That's the next real step, and it needs a machine that can run
Xcode.
