# TarragonHealth Integrations API

Partner-facing specification for pushing data into TarragonHealth
server-to-server. Hand this document to a device vendor or partner platform;
the admin side (issuing keys, registering outbound connections) lives at
`/admin/settings/integrations`.

Base URL: the platform deployment origin (currently
`https://tarragon-health-web.vercel.app`).

## Authentication

Every request carries an organisation-scoped API key issued by a
TarragonHealth admin:

```
Authorization: Bearer th_live_<64 hex characters>
```

(`X-API-Key: th_live_…` is also accepted.) Keys are scoped, revocable at any
time, and only a hash is stored on our side — if a key is lost, revoke it
and issue a new one. All requests must be HTTPS.

| Scope | Grants |
|---|---|
| `device_readings:write` | POST /api/integrations/device-readings |
| `patients:read` | reserved for future read endpoints |
| `protocol_api:classify` | POST /api/protocol-api/v1/{bp-triage,diabetes-risk,cv-risk} |
| `fhir:import` | POST /api/integrations/fhir/import |

## `GET /api/integrations/me`

Key self-test. Returns the organisation name and scopes; use it as the
first call in any onboarding.

```json
{ "ok": true, "organisation": "Tarragon Health", "scopes": ["device_readings:write"] }
```

## `POST /api/integrations/device-readings`

Push one measurement. The patient is identified by their TarragonHealth
patient number (visible to the patient in their app; format `TH-000123`),
the device by your stable serial/cloud id — we auto-register it against the
patient on first use, and it appears in their device list.

Common fields (all readings):

| Field | Type | Notes |
|---|---|---|
| `patient_number` | string | `TH-NNNNNN` |
| `device.type` | enum | `bp_cuff` \| `glucometer` \| `scale` \| `thermometer` \| `pulse_oximeter` |
| `device.serial` | string | your stable device identifier |
| `device.model` | string? | optional display name |
| `external_reading_id` | string | **your stable id for this measurement** — retries with the same id are deduplicated, so always retry safely |
| `taken_at` | ISO 8601 | when the measurement was taken |
| `vital_type` | enum | selects the value fields below |

Per-vital value fields:

| `vital_type` | Fields |
|---|---|
| `blood_pressure` | `systolic` (60–200), `diastolic` (40–130), `pulse_bpm?` |
| `glucose` | `glucose_value`, `glucose_unit` (`mmol_l`\|`mg_dl`), `glucose_context` (`fasting`\|`random`\|`post_meal`) |
| `weight` | `weight_kg` (20–300) |
| `temperature` | `temperature_c` (30–45) |
| `spo2` | `spo2_pct` (50–100), `pulse_bpm?` |

Example:

```bash
curl -X POST "$BASE/api/integrations/device-readings" \
  -H "Authorization: Bearer th_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "patient_number": "TH-000123",
    "device": { "type": "bp_cuff", "serial": "OMRON-9871234", "model": "Omron M7" },
    "external_reading_id": "meas-55021",
    "taken_at": "2026-07-21T08:30:00Z",
    "vital_type": "blood_pressure",
    "systolic": 152, "diastolic": 96, "pulse_bpm": 78
  }'
```

Responses:

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ "success": true }` | stored; clinical pipeline ran |
| 200 | `{ "success": true, "deduped": true }` | already ingested (safe retry) |
| 400 | `{ "error": "…" }` | validation failure |
| 401 | `{ "error": "…" }` | missing/invalid/revoked key |
| 403 | `{ "error": "…" }` | key lacks the scope |
| 404 | `{ "error": "…" }` | patient number not in the key's organisation |

Readings land in the same clinical record as the patient's own entries and
run the same downstream review/escalation pipeline — an abnormal
device-pushed blood pressure gets clinical attention exactly like one typed
into the app.

## `POST /api/integrations/fhir/import`

Push a FHIR R4 Bundle for one patient (an HMO's or hospital's record for
someone already using TarragonHealth). **Nothing you send becomes part of
the patient's clinical record automatically.** Each recognised resource
lands in a review queue and only becomes an active reading, allergy,
medication, or vaccination once a TarragonHealth clinician confirms it.
Expect a delay between this call succeeding and the data appearing in the
patient's record.

This request shape (a `patient_number` + a Bundle, rather than a bare
Bundle with an embedded `Patient` identifier) is provisional and may change
once we've seen a real partner's export payload — tell us what your
platform actually emits and we'll adjust to fit it, rather than the other
way round.

| Field | Type | Notes |
|---|---|---|
| `patient_number` | string | `TH-NNNNNN` |
| `source_system` | string? | free-text label shown to the reviewing clinician |
| `bundle` | object | a FHIR R4 `Bundle` (any `type`); up to 200 `entry` items |

**v1 supports only these resource types** — anything else in the Bundle is
recorded (so nothing is silently dropped) but not staged for review:

| `resourceType` | Lands as (once confirmed) |
|---|---|
| `Observation` (vital-sign LOINC codes only) | a vitals reading |
| `AllergyIntolerance` | an allergy |
| `MedicationStatement` / `MedicationRequest` | a medication (inline `medicationCodeableConcept` only — a `medicationReference` is not supported) |
| `Immunization` | a vaccination record, matched to our vaccine catalogue by name/CVX code — an unmatched vaccine cannot be confirmed until a clinician resolves it |

Example:

```bash
curl -X POST "$BASE/api/integrations/fhir/import" \
  -H "Authorization: Bearer th_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "patient_number": "TH-000123",
    "source_system": "Example HMO EMR",
    "bundle": {
      "resourceType": "Bundle",
      "type": "collection",
      "identifier": { "value": "example-hmo-export-2026-08-07" },
      "entry": [
        {
          "resource": {
            "resourceType": "Observation",
            "id": "obs-1",
            "status": "final",
            "code": { "coding": [{ "system": "http://loinc.org", "code": "29463-7" }] },
            "effectiveDateTime": "2026-08-01T09:00:00Z",
            "valueQuantity": { "value": 71.4, "unit": "kg" }
          }
        }
      ]
    }
  }'
```

Responses:

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ "success": true, "batch_id": "...", "proposed": { "Observation": 1 }, "skipped": [] }` | Bundle recorded, recognised resources staged for clinician review |
| 200 | `{ "success": true, "deduped": true, "batch_id": "..." }` | this exact Bundle (by `bundle.identifier.value` or `bundle.id`) was already ingested (safe retry) |
| 400 | `{ "error": "..." }` | validation failure (bad `patient_number`, malformed Bundle, empty or oversized `entry`) |
| 401 | `{ "error": "..." }` | missing/invalid/revoked key |
| 403 | `{ "error": "..." }` | key lacks the `fhir:import` scope |
| 404 | `{ "error": "..." }` | patient number not in the key's organisation |

## FHIR export (informational — not partner-called)

Any TarragonHealth patient can download their own record as a FHIR R4
`Bundle` from `/patient/health-passport` in the app ("Download as FHIR
(JSON)"), authenticated as themselves rather than via an API key. This is
the other half of the interoperability promise: a patient can take their
record and hand it to any system that accepts FHIR, including yours. There
is no partner-facing pull endpoint for another organisation's patients in
v1 — only the patient's own self-service download.

## Protocol API — licensed classifiers (no patient tenant required)

For a partner clinic, state PHC, or NGO that wants Tarragon's validated
clinical decision-support logic without becoming a Tarragon patient-serving
tenant: three **stateless** endpoints, each wrapping the exact pure
function this platform's own patients and clinicians run through (BP triage
mirrors the DB red-flag trigger, FINDRISC is the platform's own onboarding
diabetes screen, CV-risk stratification is the same engine behind the
Medical-Director-signed cardiovascular module — running here on the
honestly-labelled provisional defaults, since a licensee never sees
Tarragon's live signed config).

**Genuinely stateless: no patient record is created, read, or written on
this platform by any of the three calls below, and no clinical values are
persisted anywhere — only the fact that a call happened (organisation,
key, endpoint, timestamp) is logged, for usage visibility only.** A
partner never has to hand over patient data to use these.

A TarragonHealth admin adds your organisation and issues a
`protocol_api:classify`-scoped key at `/admin/settings/protocol-api`.

### `GET /api/protocol-api/v1/me`

Key self-test, same shape as `/api/integrations/me`.

### `POST /api/protocol-api/v1/bp-triage`

```json
{ "systolic": 168, "diastolic": 98 }
```

```json
{
  "level": "red",
  "label": "High — urgent review",
  "note": "Thanks. This reading is high. Please rest for 5 minutes and re-check, then reply. Your care team is being notified.",
  "advisory": true,
  "disclaimer": "Advisory triage guidance only, not a diagnosis — confirm clinically before acting on an urgent/emergency band."
}
```

`level` is one of `green` | `amber` | `red` | `emergency` | `unknown`.

### `POST /api/protocol-api/v1/diabetes-risk`

FINDRISC (Finnish Diabetes Risk Score, validated in Nigeria):

```json
{
  "age_years": 52, "bmi": 29.4, "waist_cm": 98, "sex": "male",
  "physically_active": false, "eats_vegetables_fruit_daily": true,
  "on_bp_medication": true, "history_of_high_glucose": false,
  "family_history": "first_degree"
}
```

```json
{
  "score": 14, "band": "moderate", "approx_ten_year_risk": "about 1 in 6",
  "recommend_blood_test": true, "advisory": true,
  "disclaimer": "Advisory screening guidance only, not a diagnosis — a moderate-or-higher band should proceed to a diagnostic blood test (FPG or HbA1c)."
}
```

### `POST /api/protocol-api/v1/cv-risk`

Every field is optional (all fields except `diabetes`/`on_lipid_lowering_therapy`
default to `null`; those two default to `false`) — the engine degrades
gracefully with thin data, same as the platform's own onboarding flow.

```json
{
  "age": 58, "sex": "male", "ldl_mg_dl": 145, "non_hdl_mg_dl": 175,
  "ten_year_risk_pct": 14, "ten_year_risk_level": "high",
  "diabetes": false,
  "cv_profile": {
    "established_ascvd": false, "prior_mi": false, "prior_stroke_tia": false,
    "prior_pad": false, "prior_revascularisation": false,
    "familial_hypercholesterolaemia": false
  },
  "on_lipid_lowering_therapy": false
}
```

```json
{
  "prevention_category": "primary",
  "risk_category": "high",
  "ldl_target_mg_dl": 100,
  "non_hdl_target_mg_dl": 130,
  "at_target": false,
  "statin_recommendation": "primary_risk_based_recommended",
  "escalations": [],
  "config_signed": false,
  "population_note": "10-year CVD risk is estimated with SCORE2 (European-derived) and is not validated for Sub-Saharan African populations; treat it as a guide and confirm clinically.",
  "rationale": ["10-year CVD risk 14% ≥ 10% threshold — statin is a lifestyle-first clinician conversation, not an automatic trigger."],
  "advisory": true,
  "disclaimer": "Advisory risk stratification only, never a prescription — this engine never recommends a specific medication or dose, and a high-risk/secondary-prevention classification always means 'flag for clinician review', never 'treat automatically'."
}
```

**This engine never prescribes and never auto-treats.** A
secondary-prevention/high-risk classification is structurally a flag for a
human clinician to review, never an instruction to start a medication — the
same guarantee this platform enforces for its own patients.

## Outbound (TarragonHealth → your platform)

If your platform exposes an API for us to call (order status, result
delivery, etc.), a TarragonHealth admin registers your base URL + credential
under `/admin/settings/integrations` → "Outbound partner connections", and a
"Test connection" ping verifies reachability. Contact us with your API docs
to design the specific calls.
