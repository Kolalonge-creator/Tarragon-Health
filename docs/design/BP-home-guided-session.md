# Design note: the guided home blood pressure session

Written 2026-10-16 on `pr3/home-bp-guided-session` (stacked on the acknowledgement and wearable-estimate PRs). Invariants: INV-01 (pure rules, no model), INV-14 (guards born off), INV-16 (every number from versioned configuration). It changes no live alert, grades nothing and uses no draft triage band.

## The brief asked for a new governed config `home_bp_protocol`. It already exists.
S07x (`docs/design/S07x.md`, migration `20261013182514_s07x_home_bp_programme.sql`) already shipped exactly that, and building a second one would give the CMO two sign-offs for one protocol and two sets of numbers that can drift. So this PR **reuses** it, and says so:

| Brief | Where it already lives |
|---|---|
| governed, versioned, UNSIGNED, INACTIVE | `home_bp_programme_signoffs` v1 (`is_active = false`, no `approved_by`); signed by `sign_home_bp_programme()` |
| go-live guard born OFF | `go_live_guards` key `home_bp_programme` (and `bp_pattern_flag`) |
| appears on the CMO sign-off hub | `_signoff-panels/home-bp-programme-panel.tsx`, `CONFIG_PANELS` |
| duplicate readings 1 to 2 minutes apart | `protocol.readingsPerSession = 2`, `protocol.minGapMinutes = 1` |
| morning and evening | `protocol.morningHours [4,12)`, `eveningHours [17,24)` |
| 7 days, minimum reading count | `targetDays 7`, `minDays 3`, `minReadings 12` |
| average of the qualifying readings | `assessHomeCheck` (TypeScript) and `private.home_bp_assess` (SQL, the server recounts), 35 parity cases |
| cuff or manual readings only | server: manual and device only; phone: now the same, via the wearable-estimate rule (previous PR) |
| offline first | readings counted from the S06 mirror and outbox; the guided step needs no network |

## What this PR adds (the part that was missing)
1. **`planSession`** (`packages/clinical/src/home-bp-session.ts`), pure, 100% branch coverage enforced by the package's coverage gate (added to `collectCoverageFrom`): from the readings already saved and the clock it says which step is next: outside a window (and which one comes next), rest first, wait out the gap (seconds), take reading n of N, or done (with the session mean). It reads the same signed configuration as the check, so a CMO edit changes it with no code change.
2. **A guided panel** (`home-check-session.tsx`) in the existing home check card on the Vitals screen, shown only when the `home_bp_programme` guard is open and a check is running. It tells the person what to do in words and counts the wait. It **does not save or grade anything**: the reading is typed into the one existing blood pressure form below it, so on-device triage, the emergency guidance (INV-06) and the offline outbox are exactly what they were. The card now refreshes after every saved reading so the step advances.
3. English copy in the `hc.session.*` namespace (outside the reviewed-strings ledger, like `hc.*`).

## Decisions that are not mine to make (stopped, in OPEN-QUESTIONS)
- **Discard day 1** (OQ-HBP-1). The brief proposed dropping day 1. The CMO pack C1 offered it as option (b) and recommended (a), "average every reading", which keeps the S11 decision. Doing (b) means changing the counting rule in three places that must not drift (TypeScript, SQL `home_bp_assess_readings`, the 35-case parity fixture) and is the CMO's call at signing. Not built; the config row is unsigned so (b) can still be chosen.
- **"Before your medicines"** (OQ-HBP-2). ESH-2023 says measure before taking medicines; the approved C1 text does not. The rest step says it as PROPOSED copy for the CMO to confirm or strike.
- **Classification of the average** (OQ-67 context, OQ-HBP-3). The panel shows only the session mean as two numbers. It names no band for it. The C2 bands for a complete 7-day average stay in the existing card behind the signed row, and nothing here uses the draft `bp_care_triage` bands. Classification of an average still awaits the CMO.
- **Gap upper bound.** ESH says "1 to 2 minutes apart"; the configuration has only a minimum gap. The panel says "wait N seconds" and never rejects a later second reading.

## Not run
No device. The panel was exercised only through the pure function, the wording test and a clean type check; the countdown (a one-second timer) and the card refresh need a run on a phone, with the `home_bp_programme` guard opened for a test account, before any claim that it works on a handset.
