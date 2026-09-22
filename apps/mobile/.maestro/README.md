# Mobile E2E (Maestro)

Nothing existed here before this pass — no Detox, no Maestro, no mobile UI-automation of any kind.
Maestro was chosen over Detox specifically because it drives an already-built app/binary via YAML
flows with no native test-runner integration required, which matters given this repo's real
constraint: `apps/mobile` has committed native `ios/`/`android/` directories (not a pure managed
Expo project), so every UI-automation option here needs a real compiled build regardless — Maestro
at least doesn't also need Detox's Xcode/Gradle test-target wiring on top of that.

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
export MOBILE_E2E_EMAIL=patient.free.test@tarragon.test      # or any account from the existing
export MOBILE_E2E_PASSWORD=...                                # QA test-account roster (see memory)
maestro test apps/mobile/.maestro/flows/login-to-overview.yaml
```

Credentials are read from environment variables, never hardcoded in the flow file — this repo
already has an established QA test-account roster (all `@tarragon.test`, one shared password) for
exactly this kind of manual/scripted click-through; point `MOBILE_E2E_EMAIL`/`MOBILE_E2E_PASSWORD`
at any patient account from it rather than inventing new credentials or a new account.

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

None of this is a defect in `login-to-overview.yaml` itself, as far as could be determined — it's
grounded in real, current source (`apps/mobile/src/screens/login-screen.tsx`,
`apps/mobile/src/screens/sections/overview-screen.tsx`, `apps/mobile/App.tsx`'s cold-start gate),
not guessed. But "grounded in real source" and "proven to work" are different claims, and only the
first one can honestly be made here. **Whoever runs this flow for the first time is the first
person to find out whether it actually passes.** Read a failure as plausibly-real signal about the
flow, but check simulator/Metro health first (per the memory entries above) before assuming the
flow itself is wrong.

## CI

**Not wired into CI in this pass, deliberately.** Unlike the web Playwright suite (which only needed
a local Postgres via Docker), a mobile CI job needs a `macos-latest` GitHub Actions runner, Xcode,
CocoaPods, and either a real native build step (slow, ~15-30+ min uncached) or a pre-built artifact
from EAS — a meaningfully bigger lift than this pass's scope, and not worth attempting blind given
this session couldn't even get the flow running *locally* to prove the approach first. Wire this up
once `login-to-overview.yaml` has been confirmed passing against a real build at least once.
