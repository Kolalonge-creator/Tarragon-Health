# Vendor SDK — what's here and why

`ycbtsdk-release-4.0.11.aar` only, pulled from the vendor's Android SDK
release (package `com.yucheng.ycbtsdk`).

The vendor's own demo app (`YCBleSdkDemo`) bundles five more libraries
alongside this one: `AliAgent-*.aar`, `BmpConvert-*.aar`, `JL_Watch-*.aar`,
`jl_bt_ota-*.aar`, `jl_rcsp-*.aar`, plus native `libEcgAnaly.so` /
`libRtkAesJni.so` per ABI. None of those are here, deliberately:

- Decompiling `ycbtsdk-release-4.0.11.aar`'s `classes.jar` (`unzip` + `strings`)
  found **no bytecode references** into any of those packages — the core SDK
  does not statically depend on them. They're used by the demo app's own
  extra screens (OTA firmware update, custom watch-face upload, on-device
  ECG waveform analysis), not by `YCBTClient` itself.
- This module's JS API surface (`../index.ts`) never calls OTA, watch-face,
  or ECG methods — it's scoped to connect/disconnect/scan, device info, and
  pulse/SpO2 history — so there was nothing here that would need them.
- `AliAgent` in particular is an unexplained third-party cloud-agent SDK
  (likely Alibaba Cloud IoT) with no documentation of what it sends or to
  where — leaving it out of a health app's dependency tree by default is the
  safer call until someone actually needs the feature it's for and can
  answer that question.

If a future feature genuinely needs one of these (e.g. OTA firmware update),
add it back deliberately — don't restore the whole set "just in case."

One thing worth knowing even with just this one `.aar`: its own
`AndroidManifest.xml` (merged into the app's final manifest automatically by
the Android Gradle Plugin — this is not something app.json's permissions
list controls) declares `INTERNET`, `WRITE_EXTERNAL_STORAGE`,
`READ_EXTERNAL_STORAGE`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
and a bundled `DfuService`/`NotificationActivity` (for OTA) — present in the
manifest because it's compiled into the SDK, even though nothing in this
module's API calls that code path. `INTERNET`/location were already present
in the app via `react-native-ble-plx`'s own plugin; the storage permissions
are new. Worth a mention if this ever comes up in a Play Store data-safety
review.
