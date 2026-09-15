# Draft: Menstrual cycle bleeding-pattern flags

Paste-ready for `/admin/settings/protocols`. **Not clinically approved.**

---

**protocol_id**

```
womens_health_cycle_red_flags
```

**Title**

```
Menstrual cycle bleeding-pattern flags
```

**Change summary**

```
v1. First signed record of the four bleeding-pattern flags shown in the patient cycle tracker, live since 2026-09-03.
```

**Protocol content** — paste everything between the rules:

---

## Scope

Governs the bleeding-pattern flags raised by the patient-facing cycle tracker
(`/patient/cycle`). These describe patterns in what a patient logged about her
own body. They are **not diagnoses**, they are never fed into risk or
escalation scoring, and none of them creates a clinician alert or pages a
doctor. Each one surfaces text to the patient recommending she raise it with
her care team.

Cycle predictions themselves (next period, ovulation, fertile window) are
calendar estimates and are outside this protocol. They carry their own
patient-facing disclaimer that they are not a contraceptive method.

## Flags

### 1. Bleeding after menopause — URGENT

**Fires when:** the patient's recorded life stage is `menopausal` and any
bleeding episode is logged.

**Patient sees:** "Bleeding after menopause always needs to be checked… This
is not usually serious, but it is always investigated. Please contact your care
team now," with a link to in-app messaging.

**Basis:** postmenopausal bleeding is investigated as endometrial carcinoma
until proven otherwise. This is the only flag in the set rated urgent, and the
only one that uses the clinical red treatment in the UI.

**Note for review:** the trigger is the patient's *self-reported* life stage,
not a verified menopause date. A woman who has set her stage to menopausal and
then logs a period will see this. That is deliberate — the false-positive cost
is one alarming message, the false-negative cost is a missed cancer — but it is
a judgement worth confirming.

### 2. No period for 90 days — DISCUSS

**Fires when:** life stage is `menstruating` and 90 or more days have passed
since the last logged period start.

**Patient sees:** "Three months or more without a period has a lot of possible
causes, from pregnancy to thyroid or hormonal changes. Worth a conversation
with your care team."

**Basis:** secondary amenorrhoea, conventionally 3 months. Deliberately does
**not** fire for `pregnant`, `postpartum`, `perimenopausal` or `menopausal`
stages, where absent periods are expected.

### 3. Cycles outside 24–38 days — DISCUSS

**Fires when:** the patient's average cycle length over at least 3 logged
cycles is below 24 days (frequent) or above 38 days (infrequent).

**Patient sees:** for short cycles, that cycles under 24 days are worth
mentioning "especially if this is new for you"; for long cycles, that cycles
over 38 days are "common with conditions like PCOS and thyroid changes".

**Basis:** FIGO/ACOG normal range for menstrual frequency. Requires 3 cycles so
a single unusual month cannot trigger it.

### 4. Bleeding longer than 8 days — DISCUSS

**Fires when:** any logged bleeding episode has a recorded end date more than 8
days after its start.

**Patient sees:** "Periods lasting over a week can lead to low iron over time.
Worth mentioning to your care team so they can check."

**Basis:** FIGO normal duration of menses is up to 8 days.

### 5. Repeated very heavy flow — DISCUSS

**Fires when:** the patient has logged the heaviest flow level ("Very heavy",
stored as `flooding`) on 2 or more days.

**Patient sees:** "Heavy periods are common and very treatable, but they can
cause low iron. Your care team can check your blood count and talk through
options."

**Basis:** heavy menstrual bleeding is subjective; the platform uses the
patient's own top-of-scale selection as the proxy. Requires 2 days so a single
heavy day does not trigger it.

### 6. Variable cycle length — INFORMATIONAL ONLY

**Fires when:** the difference between shortest and longest recent cycle
exceeds 9 days.

**Patient sees:** "Some variation is completely normal. Keep logging, and
mention it at your next review if it bothers you or is new."

**Basis:** FIGO 2018 regularity criterion (shortest-to-longest variation ≤ 7–9
days is regular). Rated informational, not "discuss", because variation alone
is common and not itself a finding.

## What is deliberately excluded

- **Intermenstrual and postcoital bleeding** are not detected. The daily log
  records flow per day but does not distinguish bleeding between periods from a
  period itself, so the platform cannot currently tell them apart. Both are
  cervical-pathology red flags. **This is a known gap and the most likely
  candidate for v2.**
- **No flag creates a clinician alert.** Every one is patient-facing text
  recommending contact. A patient who ignores all of them generates no clinical
  signal.
- **Sexual activity is not collected at all**, so nothing here can be
  correlated with it.

## Review triggers

Re-review if: intermenstrual bleeding detection is added; any flag is upgraded
to create a `clinician_alerts` row; or the urgent postmenopausal flag is
changed to require a verified rather than self-reported menopause date.

---

## Provenance (not part of the pasted content)

Every threshold above is implemented in
`apps/web/src/lib/rules/cycle-prediction.ts` as named exported constants, and
covered by `cycle-prediction.test.ts`:

| Flag | Constant | Value |
|---|---|---|
| Cycle frequency | `NORMAL_CYCLE_MIN_DAYS` / `NORMAL_CYCLE_MAX_DAYS` | 24 / 38 |
| Regularity | `REGULAR_VARIATION_MAX_DAYS` | 9 |
| Bleeding duration | `NORMAL_PERIOD_MAX_DAYS` | 8 |
| Amenorrhoea | `AMENORRHOEA_DAYS` | 90 |
| Heavy flow | inline in `computeFlags` | ≥ 2 days at `flooding` |

Flag severities (`urgent` / `discuss` / `info`) are the `CycleFlagSeverity`
union in the same file. The urgent flag's red UI treatment is in
`cycle-tracker.tsx`'s `FlagCard`.
