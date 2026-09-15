# TarragonHealth Integrations API

Partner-facing specification for pushing data into TarragonHealth
server-to-server. Hand this document to a device vendor or partner platform;
the admin side (issuing keys, registering outbound connections and webhook
endpoints, and a live catalogue + health dashboard covering uptime,
latency, failed/auth-failed requests, and the outbound delivery queue —
spec §33.8/§33.9) lives at `/admin/settings/integrations`.

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

### Sandbox vs live

A key issued for certification carries the `th_test_` prefix instead of
`th_live_` and is a **sandbox** credential — it behaves identically to a
live key (same endpoints, same validation) but is a structurally separate
credential family, so a sandbox key pasted into a production config fails
authentication immediately rather than silently writing test data into a
live record. Certify an integration against sandbox before switching to a
live key (§33.17).

### Rate limits

Every key carries a per-minute request ceiling (120/min by default,
adjustable per key by an admin). Exceeding it returns `429` with a
`Retry-After`-style message; this is a fair-use limit, not a security
boundary — it exists so one partner's retry storm can't degrade the
platform for everyone else.

### Idempotency

Any inbound gateway request may carry an `Idempotency-Key` header (any
stable string you choose, 8–200 characters). A repeated request with the
same key and the same body within 24 hours replays the original response
instead of re-running the request — safe to retry after a timeout or a
dropped connection. Reusing a key with a **different** body returns `409
Conflict` rather than silently discarding the difference.

| Scope | Grants |
|---|---|
| `device_readings:write` | POST /api/integrations/device-readings |
| `patients:read` | GET /api/v1/patients |
| `protocol_api:classify` | POST /api/protocol-api/v1/{bp-triage,diabetes-risk,cv-risk} |

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

## `/api/v1` — the versioned gateway

Every request under `/api/v1` runs through one shared pipeline
(authenticate → authorise → idempotency check → validate → rate limit →
log), so a new endpoint added here inherits the same key handling,
idempotency, rate limiting, and request logging as every other one for
free (spec §33.2). The three routes above predate this and keep their
existing behaviour unchanged — `/api/v1` is where new integrations land
going forward. Every response carries an `X-Request-Id` header; quote it
when asking us to look into a specific call.

### `GET /api/v1/me`

Key self-test — works for any valid, unrevoked, unexpired key regardless
of its scopes.

```json
{ "ok": true, "organisation": "Tarragon Health", "environment": "live", "scopes": ["patients:read"] }
```

### `GET /api/v1/patients?patient_number=TH-000123`

Patient demographics lookup (§33.3 Patient category), scoped to
`patients:read`. Deliberately minimal (§33.7 data minimisation) — identity
and demographics only, never clinical fields:

```json
{
  "patient_number": "TH-000123",
  "full_name": "Adaeze Okafor",
  "date_of_birth": "1988-04-12",
  "sex": "female",
  "phone": "+2348012345678"
}
```

404 if the patient number doesn't belong to your organisation.

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

## Outbound: partner-called APIs (TarragonHealth → your platform, request/response)

If your platform exposes an API for us to call (order status, result
delivery, etc.), a TarragonHealth admin registers your base URL + credential
under `/admin/settings/integrations` → "Outbound partner connections", and a
"Test connection" ping verifies reachability. Contact us with your API docs
to design the specific calls.

## Webhooks (TarragonHealth → your platform, event push)

A TarragonHealth admin registers one or more webhook endpoints for your
organisation under `/admin/settings/integrations` → "Webhook endpoints",
choosing which event types you subscribe to and getting back a signing
secret (shown once, like an API key).

### Event types

`result.available` · `result.amended` · `lab_order.created` ·
`lab_order.cancelled` · `appointment.booked` · `appointment.cancelled` ·
`appointment.rescheduled` · `prescription.created` ·
`prescription.cancelled` · `dispense.completed` · `patient.registered` ·
`patient.consent_changed` · `payment.settled` · `payment.refunded` ·
`claim.status_changed`

### Payload

```
POST <your endpoint>
Content-Type: application/json
X-Tarragon-Signature: sha256=<hex hmac>
X-Tarragon-Event-Id: <uuid>
X-Tarragon-Event-Type: result.available

{ "event_id": "<uuid>", "event_type": "result.available", "data": { ... } }
```

**Verify the signature before trusting a delivery**: compute
`HMAC-SHA256(your secret, raw request body)` and compare it (as
`sha256=<hex>`) against `X-Tarragon-Signature` — a timing-safe comparison,
not a plain string equality. A payload never carries more than your
subscribed event needs (§33.7 data minimisation is applied at the point we
build the event, not left to you to filter).

### Retries and idempotency

Return any `2xx` to acknowledge. Anything else — including a timeout — is
retried with exponential backoff (30s, 1m, 2m, 4m, 8m, 16m, 32m, capped at
1h) for up to 8 attempts before we stop and flag it for our own ops to
investigate (§33.10/§33.11) — a temporary outage on your side never loses
the underlying event, it just arrives late. Because of this, **the same
`event_id` may arrive more than once**; use it to deduplicate on your side
exactly as you'd expect us to deduplicate a repeated send from you (§33.12
cuts both ways).
