# Health Education Pathway — Planning + Build Spec

> **Status: BUILT** (branch `claude/health-education-pathway`, off `main-dev`, explicit ask).
> This is an **engagement/feature layer**, not a clinical action and not a standalone plan —
> the same bucket as the (planned) lifestyle-coaching layer. Entitlement-gated to the same
> tiers. This doc captures the locked decisions and the shipped shape.

## 1. What it is (and is NOT)

The founder's sketch was a linear funnel:

```
Patient condition → Personalised education → Videos → Articles → Behaviour change → Knowledge assessment
```

We deliberately did **not** build that as a straight line. The value is the loop, not the funnel:

```
condition + risk + what they haven't learnt yet
        → surface the next best content item
        → optional knowledge check
        → marks it understood / needs-review
        → picks the next item
```

**Locked positioning decisions:**

1. **Engagement layer, not a clinical touchpoint.** Nothing here is doctor-attributed per patient,
   nothing feeds risk scoring or escalation. A knowledge-check score is engagement telemetry, never
   a clinical assessment.
2. **"Behaviour change" is NOT a schema concept.** We do not store a "behaviour changed" flag — that
   would be an unverifiable claim. Whether education moved the needle is read from the **observable
   proxies we already collect**: adherence check-in responses, missed-dose alerts, vitals-logging
   cadence. No new table asserts behaviour change.
3. **Condition-anchored personalisation** keys off the patient's **active `care_plans` conditions**
   (primary) and their **latest `patient_risk_scores.risk_level`** (secondary refinement) — real
   platform data, not a generic library dump.
4. **Clinician-reviewed at the LIBRARY level, not per-patient.** Content carries a
   `clinician_reviewed` quality flag → a generic "Reviewed by our clinical team" badge. It is **never**
   rendered as "Dr X reviewed this for you" — that would trip the per-touchpoint attribution rule
   (`docs/CLINICAL_TRUST_MODEL_SPEC.md` §2/§9). Attribution null-gating is respected by simply not
   making a per-patient attribution claim at all.
5. **Entitlement:** included in **`complete`**, **`family`**, and **ParentCare** tiers, **plus a
   `health-education` à-la-carte add-on for `essential`** — identical gating to the lifestyle layer
   (mirrors the `extra-family-member` add-on precedent). The Free tier's existing generic `'education'`
   feature (static Health Passport, reminders) is untouched and distinct — see §5.

## 2. Free `education` vs paid `health_education` — the honest split

The `free` plan already advertises `'education'` in `features[]` ("Self-tracking, reminders, education,
Health Passport"). We did **not** remove or weaken that. Two distinct feature codes:

| code | tier | what it means |
|---|---|---|
| `education` (existing) | Free + up | Static, universal: Health Passport, reminders, general info. Not personalised. |
| `health_education` (new) | complete / family / parentcare / essential-add-on | The **personalised, condition-driven, clinician-reviewed pathway** with knowledge checks and next-item sequencing. |

This keeps the Free promise intact while making the personalised engine a real paid capability.

## 3. What already exists (reuse, do not rebuild)

| Artifact | State | Role here |
|---|---|---|
| `care_plans` (`condition`, `status` active) | built | Primary personalisation key — which conditions to teach for |
| `patient_risk_scores` (`risk_level` enum) | built | Secondary key — gate higher-tier content to higher risk |
| `care_plan_condition` enum (htn/diabetes/obesity/ckd/cardiovascular/other) | built | Content `condition` tag domain |
| `risk_level` enum (low/moderate/high/very_high, ordered) | built | Content `min_risk_level` tag; enum ordinality lets `>=` work |
| `has_feature_access(feature)` RPC + `RequiresEntitlement`/`UpgradePrompt` | built | The `health_education` gate |
| `subscription_plans.features[]` / `add_ons` / `subscription_add_ons` | built | Entitlement plumbing — no new billing code, only data |
| `private.is_org_staff` / `current_org_id` / `is_admin` / `set_updated_at` | built | RLS + trigger helpers, reused verbatim |
| catalogue-without-`organisation_id` pattern (`lifestyle_programmes`, `chronic_condition_programmes`) | built | `health_education_content` is a global catalogue, same shape |
| adherence-checkin / medication-review React Query + card patterns | built | Copied for the feed card + knowledge-check interaction |

## 4. Shipped schema (`20260717150000_health_education.sql`)

Two tables only. **No behaviour-change table. No parallel source of truth.**

- **`health_education_content`** — GLOBAL catalogue (no `organisation_id`, like `lifestyle_programmes`):
  - `code` (unique), `title`, `summary`, `body` (markdown), `content_type` (`article` | `video`),
    `video_url` (nullable), `estimated_minutes`.
  - `condition` (`care_plan_condition`, **nullable** = applies to everyone), `min_risk_level`
    (`risk_level`, nullable = no risk floor).
  - `clinician_reviewed` (bool) + `reviewed_by_name` (text, admin-entered display name) +
    `reviewed_at` — a **library-level** quality badge, never a per-patient clinical attribution.
  - `knowledge_check` (jsonb, nullable) — array of `{question, options[], answer_index}`. Optional.
  - `sort_order`, `is_active`.
  - RLS: authenticated read of `is_active` rows (or admin); admin-only write. Same as `lifestyle_programmes`.
- **`health_education_progress`** — patient-owned per-item state:
  - `organisation_id`, `patient_id`, `content_id`, unique `(patient_id, content_id)`.
  - `status` (`health_education_status` enum: `seen` | `understood` | `needs_review`).
  - `check_score` / `check_total` (nullable, from the last knowledge check), `last_viewed_at`.
  - RLS: patient self-manages own rows; org staff read (engagement visibility). Patient-owner + `is_org_staff`.
- **`public.health_education_feed()`** — security-definer RPC resolving for `auth.uid()`. Returns the
  ranked feed: active content where `condition IS NULL OR condition IN (my active care-plan conditions)`
  **AND** `min_risk_level IS NULL OR min_risk_level <= my latest risk_level` (or content with no floor),
  left-joined to my progress. Ordering: `needs_review` first, then un-started, then `understood` last;
  within a bucket by `sort_order`. This is the "picks the next item" engine — one SQL source of truth,
  keyed to the caller, no spoofing surface (same pattern as `has_feature_access`).

## 5. Entitlement (`20260717151000_health_education_entitlement.sql` + seed)

- Idempotently `array_append`s `health_education` to `features[]` of `complete`, `complete_yearly`,
  `family` (+ `_usd`/`_gbp` variants) and every `parentcare*` plan — guarded so re-runs don't duplicate.
- Inserts a `health-education` add-on (NGN + `_usd`/`_gbp`) `restricted_to_plan_code` = the essential
  variants, `features = array['health_education']`, `is_active=false` until synced to Paystack/Stripe
  (same activation gate as every other add-on — an **ops step**, flagged below).
- `supabase/seed/seed.sql` updated to match for fresh environments.

## 6. UI

- **Patient** (`/patient`, gated by `RequiresEntitlement feature="health_education"` →
  `UpgradePrompt` fallback): `HealthEducation` card driven by `health_education_feed()`. Shows the next
  items for the patient's conditions, the library-level "Reviewed by our clinical team" badge when set,
  an optional inline knowledge check that writes a `health_education_progress` row (`understood` if all
  correct, else `needs_review`) and advances to the next item. "Mark as understood" without a check is
  also allowed. No fear-based copy; brand voice throughout.
- **Admin** (`/admin/settings/health-education`): list catalogue rows, toggle `is_active`, edit the
  review badge. Content authoring itself (body/knowledge-check) is seed/SQL for now — the admin surface
  is management, not a full CMS (deliberate thin slice).

## 7. Guardrails carried into build

- **Not doctor-attributed per patient.** Library-level review badge only; never "Dr X reviewed this for you".
- **Knowledge check ≠ clinical assessment.** Score never touches `patient_risk_scores`/escalation.
- **No behaviour-change claim in schema.** Impact measured via existing adherence/vitals signals.
- **No fear-based urgency** (brand voice) — "Understanding your blood pressure", never "The silent killer".
- **RLS + `organisation_id`** on the patient-owned progress table; global catalogue is admin-write only.
- **WhatsApp/SMS is not involved** — this is a pull surface, no reminder cron in v1 (can be added later).

## 8. Verification

- `pnpm typecheck` / `lint` / `test` (web 218, shared 35) + full production build green (new jest
  test for the knowledge-check scoring helper).
- Migrations applied via `apply_migration` (recorded in `schema_migrations`); `get_advisors` clean;
  feed RPC + RLS confirmed via rolled-back live SQL.
- **Real-browser click-through** (worktree dev server + Chrome, as a parentcare-tier patient): the
  card rendered the exact condition+risk-gated feed, `seen`/`understood` re-ranking worked live, and
  a completed knowledge check persisted a real progress row (2/2, status=understood). No console errors.

## 9. Status + deferred (explicit ask required for functional code)

- **Committed + PR #66 against `main-dev`; add-on synced.** The `health-education` add-on is live +
  active across NGN (Paystack) / USD / GBP (Stripe, test-mode), so `essential` patients can attach it.
- Real content library: v1 seeds a handful of HTN/diabetes/general articles as honest placeholders —
  a clinician-vetted, Nigeria-relevant library (then asthma/CKD) is the real, unglamorous cost.
- A full authoring CMS (rich body + knowledge-check editor in-app), reminder cron ("you have new
  learning"), wearable/adherence-driven content triggers — all deferred, not built.
