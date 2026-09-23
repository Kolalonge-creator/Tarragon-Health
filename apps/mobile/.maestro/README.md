# Mobile E2E (Maestro)

Nothing existed here before this pass — no Detox, no Maestro, no mobile UI-automation of any kind.
Maestro was chosen over Detox specifically because it drives an already-built app/binary via YAML
flows with no native test-runner integration required, which matters given this repo's real
constraint: `apps/mobile/ios/` is a committed, expo-prebuild-generated native project (not a pure
managed Expo app) — **`apps/mobile/android/` is NOT committed** (`apps/mobile/.gitignore` excludes
it explicitly, with its own comment noting this is deliberately unlike `ios/`), so every
UI-automation option here needs at minimum a real local `ios/` build regardless — Maestro at least
doesn't also need Detox's Xcode/Gradle test-target wiring on top of that.

## Platform scope: iOS only, for now

`login-to-overview.yaml`'s `appId: com.tarragonhealth.mobile` matches `app.json`'s iOS
`bundleIdentifier` only — Android's `package` is the different string
`com.tarragonhealth.app`. This flow was researched and (attempted to be) verified against the iOS
Simulator only; treat it as iOS-only until an Android variant is written and its own `appId`
confirmed, not as a flow that happens to also work on Android.

## Setup

```bash
# Install the CLI (needs a JDK — Maestro is JVM-based)
curl -Ls "https://get.maestro.mobile.dev" | bash
brew install openjdk   # if no JDK is already on PATH
```

Maestro drives an **already-installed, already-running app** — it does not build one. You need a
real build first:

```bash
cd apps/mobile
npx expo run:ios      # or: eas build --profile development --platform ios, then install the result
```

Then, with a Metro dev server running and the built app open on a simulator/device:

```bash
maestro test apps/mobile/.maestro/flows/login-to-overview.yaml \
  -e MOBILE_E2E_EMAIL=... -e MOBILE_E2E_PASSWORD=...
```

**Must be `-e` flags on the command line, not a plain shell `export`.** Maestro only resolves a
flow's `${VAR}` references from three places: the flow's own `env:` block, `-e VAR=value` on this
command, or a shell variable prefixed `MAESTRO_` — a bare `export MOBILE_E2E_EMAIL=...` does none
of those and the flow will not see it (confirmed against Maestro's own docs on
parameters/constants).

Credentials are read from these flags, never hardcoded in the flow file or this README — this repo
already has an established QA test-account roster (all `@tarragon.test`, one shared password, see
memory `project_qa_test_accounts_20260727`) for exactly this kind of manual/scripted click-through;
point `MOBILE_E2E_EMAIL`/`MOBILE_E2E_PASSWORD` at any patient account from it rather than inventing
new credentials, creating a new account, or writing a specific account's address into this
committed file (a real, working test-account email paired in the same paragraph with "the roster
shares one password" is attack-surface worth not adding, even for a low-value test account).

## What's covered

- **`login-to-overview.yaml`** — cold launch → email/password sign-in through the real login form →
  lands on the patient overview screen. This is the one flow every other authenticated mobile flow
  would build on, so it's the right first flow to get running, not an arbitrary pick.

This is intentionally a single smoke-test flow, not a rewrite of the audit's full "supported launch
path" list (sign-in, Today, Health Check, result upload, Track, Messages, service status, payment
hand-off, notification preference, privacy). Get this one running for real first — see the
verification gap below — before investing in more flows nobody has proven actually execute.

## Selectors: no testID convention exists

`grep -rn "testID=" apps/mobile/src/` returns **zero matches** anywhere in this codebase (confirmed
2026-09-23). Every selector in `login-to-overview.yaml` targets visible text or
`accessibilityLabel` instead — the only thing this app's components actually expose. If a future
flow needs to target something with no stable visible text (an icon-only button, one of several
identical-looking rows in a list), that's the point at which adding real `testID` props to the
mobile codebase stops being optional — Maestro (and any other UI-automation tool) has nothing else
reliable to grab onto here.

## A verification gap, stated plainly — this one is more serious than usual

Every other test suite in this repo added recently (`supabase/functions/paystack-webhook/index.test.ts`,
`apps/web/e2e-browser/`) was at minimum validated for syntax/types/lint even when it couldn't be
fully executed. This flow was validated the same way — `python3 -c "import yaml;
yaml.safe_load_all(...)"` confirms it parses as Maestro's two-document (config + commands) format —
**but three separate, real attempts to run it against a live Simulator + Metro in this session all
failed**, for reasons that turned out to be pre-existing environment instability, not anything
introduced by this work:

1. A previously-documented "blank white screen forever" hang
   (see memory: `project_blank_shell_hang_investigation_20260913`, recurrence logged
   `project_blank_shell_hang_recurred_20260923`) reproduced on the very first launch attempt.
2. The documented fix for that (reboot the simulator, no erase) did **not** resolve it this time —
   a change from the original investigation's findings.
3. A fully fresh Metro instance (cache cleared) connected to a freshly-rebooted simulator **still**
   hung blank, and Metro's own log showed zero bundle requests ever arrived — the app never even
   asked Metro for JS.
4. Along the way, `npx expo run:ios --binary <path>` — the exact reconnect command the original
   investigation recommended — crashed outright on an unrelated Expo CLI bug (a malformed-plist
   error while probing for physical USB devices), and one Metro instance crashed with an unrelated
   internal `RangeError` in its file-crawler.

**Update, same session:** since live verification wasn't possible, `/code-review high` was run on
the flow itself instead — and it found two real defects that WOULD have made every run fail
regardless of environment health, now fixed: the env-var substitution mechanism described above
(the first version relied on a plain `export`, which Maestro never reads), and the `appId`
Android-mismatch (see "Platform scope" above). So the honest state is more precise than "probably
fine, just unverified": this flow has already been proven wrong twice by review and corrected
without ever running once. Selectors themselves (`"Email"`, `"Password"`, `"Sign in"`, the Overview
subtitle text) were independently checked against current source and are accurate. Two known,
accepted limitations remain, not fixed:
- `launchApp: {clearState: true}` wipes the local App Lock preference along with everything else,
  so this flow structurally can never exercise (or accidentally get blocked by) the App Lock screen
  — by construction, not by accident.
- The final wait can time out on a transient post-login stats-fetch failure (a real, different
  screen state — a "couldn't load, tap to retry" card) that looks identical to a genuine login
  failure from the outside. Not hardened against here.

**Whoever runs this flow for the first time is still the first person to find out whether it
actually passes end-to-end.** Read a failure as plausibly-real signal about the flow, but check
simulator/Metro health first (per the memory entries above) before assuming the flow itself is
wrong.

## CI

**Real device execution is not wired into CI in this pass, deliberately.** Unlike the web Playwright
suite (which only needed a local Postgres via Docker), a mobile CI job that actually runs a flow
needs a `macos-latest` GitHub Actions runner, Xcode, CocoaPods, and either a real native build step
(slow, ~15-30+ min uncached) or a pre-built artifact from EAS — a meaningfully bigger lift than this
pass's scope, and not worth attempting blind given this session couldn't even get the flow running
*locally* to prove the approach first. Wire this up once `login-to-overview.yaml` has been confirmed
passing against a real build at least once.

**What IS wired in**: a YAML-syntax lint step on every flow file (`mobile-typescript` job in
`.github/workflows/ci.yml`) — needs no simulator, no macOS runner, nothing device-related. It's the
same `python3 -c "import yaml; yaml.safe_load_all(...)"` structural check used to validate this
flow by hand, now running on every PR so a future broken/malformed flow file (bad indentation, a
stray colon) is caught before merge instead of only being discovered the next time someone tries to
run Maestro locally.
