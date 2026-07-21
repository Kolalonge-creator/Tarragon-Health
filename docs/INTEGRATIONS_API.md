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

## Outbound (TarragonHealth → your platform)

If your platform exposes an API for us to call (order status, result
delivery, etc.), a TarragonHealth admin registers your base URL + credential
under `/admin/settings/integrations` → "Outbound partner connections", and a
"Test connection" ping verifies reachability. Contact us with your API docs
to design the specific calls.
