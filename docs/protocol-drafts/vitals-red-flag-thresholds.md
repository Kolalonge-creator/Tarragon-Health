# Draft: Vitals red-flag thresholds

Paste-ready for `/admin/settings/protocols`. **Not clinically approved.**

This is the highest-consequence unsigned logic on the platform: it decides
which patient-logged reading produces emergency guidance and which pages a
clinician.

---

**protocol_id**

```
vitals_red_flag_thresholds
```

**Title**

```
Vitals red-flag thresholds (BP, glucose, SpO2, temperature, pulse)
```

**Change summary**

```
v1. First signed record of the green/amber/red/emergency bands applied to patient-logged vitals, live and unsigned since launch.
```

**Protocol content** — paste everything between the rules:

---

## Scope

Governs the deterministic bands applied to every patient-logged vital. The same
bands drive three separate consequences, which is why they are signed together:

1. **Patient-facing guidance** — an emergency band shows acknowledge-gated "go
   to the nearest hospital now" guidance and offers to notify the emergency
   contact. This happens on **every plan, including free**.
2. **Clinician escalation** — a red or emergency band raises a
   `clinician_alerts` row. This is **gated to paid plans** by the
   `vitals_red_flag_doctor_escalation` feature flag.
3. **Dashboard colour** — the band sets the status colour on the patient's
   tiles and trends.

The split at (2) is a deliberate commercial decision, not a clinical one: the
safety net is universal, a doctor's time is not.

## Blood pressure (mmHg)

Thresholds version `2026-09-01.1`. A reading takes the **highest** band either
number qualifies for.

| Band | Systolic | Diastolic | Label shown |
|---|---|---|---|
| Emergency | ≥ 200 | ≥ 120 | Crisis range |
| Red | ≥ 160 | ≥ 100 | High (urgent review) |
| Amber | ≥ 135 | ≥ 85 | Above target |
| Green | below | below | At target |

**For review:** the amber floor of 135/85 is tighter than the 140/90 commonly
used for a clinic diagnosis of hypertension. That is intentional — these are
home readings, which run lower than clinic readings — but it is a Tarragon
choice and it sets how often patients are told they are above target.

## Blood glucose (mmol/L)

| Threshold | Value | Consequence |
|---|---|---|
| Severe hypoglycaemia | < 3.0 | Emergency. If confused or unable to swallow: nothing by mouth, emergency care now |
| Hypoglycaemia alert | ≥ 3.0 and < 3.9 | Same-day: 15/15 rule, same-day review of glucose-lowering drugs / insulin |
| DKA-relevant high | ≥ 11.0 with raised ketones | Emergency: hospital now, do not delay, never stop insulin |
| Very high | ≥ 20.0 | Same-day contact to confirm DKA/HHS symptoms and guide ketone testing |
| Persistent high | > 14.0 on ≥ 3 recent readings | Priority review; consider therapy change |
| Ketones high | ≥ 3.0 mmol/L | DKA workflow, urgent doctor, do not delay |
| Ketones moderate | ≥ 1.5 and < 3.0 mmol/L | Review; recheck and watch for DKA features |

**For review:** the "very high ≥ 20.0" path fires even with **no ketone
reading at all**, because most patients have no home ketone testing. The
resulting message tells the care team to guide the patient on where to test.
Confirm that is the behaviour you want rather than suppressing until ketones
are known.

## Oxygen saturation (SpO2, %)

| Band | Value |
|---|---|
| Emergency | < 90 |
| Red | 90 – 92 |
| Amber | 93 – 94 |
| Green | ≥ 95 |

## Temperature (°C)

| Band | Value |
|---|---|
| Emergency | ≥ 40.0 **or** < 35.0 |
| Red | ≥ 39.0 |
| Amber | ≥ 38.0 |
| Green | 35.0 – 37.9 |

Hypothermia below 35.0 is treated as an emergency equal to hyperpyrexia.

## Pulse (bpm, resting)

| Band | Bradycardia | Tachycardia |
|---|---|---|
| Emergency | ≤ 35 | ≥ 150 |
| Red | ≤ 39 | ≥ 121 |
| Amber | ≤ 49 | ≥ 101 |

**For review:** these are single-reading bands with no context for age,
fitness or medication. A trained athlete with a resting pulse of 45 gets an
amber tile. This is accepted as a false-positive-tolerant design, but confirm.

## Cross-cutting rules

- **Bands are applied to a single reading**, not a trend. Persistent
  hyperglycaemia is the only rule requiring repeat readings (3).
- **Manual and device readings are treated identically.** `vitals_readings.source`
  records the difference but no threshold varies by it.
- **Basal body temperature is excluded** from the fever bands. It is stored on
  the cycle daily log, not `vitals_readings`, precisely so a normal
  post-ovulation 37.1 °C never pages a clinician.
- **No band constitutes a clinical all-clear.** A green reading is never
  presented as reassurance about anything other than that number.

## Review triggers

Re-review if: any band is moved; a band is made age- or condition-specific; the
plan gate on clinician escalation changes; or trend-based rules are added
alongside single-reading bands.

---

## Provenance (not part of the pasted content)

| Vital | File | Constant |
|---|---|---|
| BP | `lib/rules/bp-classification.ts` | `BP_THRESHOLDS`, version `BP_THRESHOLDS_VERSION` |
| Glucose | `lib/vitals/glucose-red-flags.ts` | `GLUCOSE_THRESHOLDS`, `PERSISTENT_HIGH_MIN_COUNT` |
| SpO2 | `lib/rules/spo2-classification.ts` | inline |
| Temperature | `lib/rules/temperature-classification.ts` | inline |
| Pulse | `lib/rules/pulse-classification.ts` | inline |

Plan gating: migration
`20260810120000_gate_vitals_red_flag_escalation_to_paid_plans.sql`, feature key
`vitals_red_flag_doctor_escalation`, enforced by
`private.patient_has_feature_access`.
