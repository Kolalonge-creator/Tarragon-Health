# Part C conformance audit (S87)

Date: 2026-10-07. Tree: `origin/main-dev` at `e1e7db3d1`. Method: (1) the standing scan `packages/shared/src/part-c-scan` over `apps/*/src`, `packages/*/src`, `supabase/functions` and every `package.json`; (2) read-only counts on the live project `koiplnmbgnqnbywhpjlf`; (3) the existing removal proofs in `packages/db/tests` (`remove_whatsapp.sql`, `oq261_remove_home_delivery.sql`, `care_vouchers.sql`). A line scan proves "no hits", not absence. Nothing was deleted. Status words: CLEAN, CONFLICT (live behaviour breaks Part C), DORMANT (present but unreachable or empty), RESOLVED (decided, spec row to match).

## C.1 Contraindicated

| Item | Status | Evidence | Open question |
|---|---|---|---|
| Cycle-based contraception | CONFLICT | A fertile window is shown with no "Not contraception" label in 6 files (web cycle calendar, ring, tracker, `cycle-reading.ts`, `cycle-thermal-shift.ts`; mobile `cycle-screen.tsx`). Allowlisted in the scan until 2026-11-06. | OQ-12 decided 2026-09-30; D2 wording drafted, unsigned |
| Automated dose changes | CLEAN | Drafts only, a prescriber signs (`care-plan-changes-panel.tsx`) | none |
| In-app ads, pharma content | CLEAN | No ad SDK in any `package.json` (scan rule `ad-sdk`); cookie page says no trackers | none |
| Sale of identifiable data | CLEAN | no hits | none |
| Public feeds, profiles, maps, leaderboards | CLEAN | scan rule `public-social`: 0 hits. Marketing `partner-map.tsx` shows partner sites; not checked for patient data | none |
| Intermittent fasting timers | CLEAN | scan rule `fasting-timer`: 0 hits. Ramadan safety guidance only | none (S50 builds a guarded fasting module, OFF) |
| AI as therapy or crisis handling | CLEAN | therapy page is a practitioner directory, crisis notice first | OQ-16 |
| Skin-cancer risk scores, face or voice scores | CLEAN | no hits | none |
| Auto-renewing trials and billing | DORMANT | Copy is clean (scan rule `auto-renew`: 0 hits). Webhook still handles `subscription`, `add_on`, `sponsored_subscription`. Live: `subscriptions` 0 rows, `subscription_add_ons` 0, `subscription_plans` 13 | OQ-97, OQ-312 |
| Employer visibility of reproductive, pregnancy or mental health data | NOT VERIFIED | Institution aggregate helpers exist; not read for category exclusion in this pass | OQ-312 |

## C.2 Removed by founder decision

| Item | Status | Evidence | Open question |
|---|---|---|---|
| Health Wallet, stored balance, Platform Credit | CLEAN in code | Tables gone. The webhook refund branch for a retired `platform_credit_topup` charge was deleted 2026-10-27 (live evidence: 0 rows, OQ-309 decided); a stray charge now fails loudly as an unrecognised kind. `payment_provider` enum still has `wallet` and `stripe` labels | OQ-309, OQ-312 |
| WhatsApp | CLEAN in code | scan rule `whatsapp`: 0 hits (comments excluded). Immutable consent text still names it; `escalation_slas` ladder still names it, normalised to email at read time | OQ-29, OQ-31 |
| SMS beyond codes and paging | CONFLICT | 5 code paths (list in `allowlist.ts`): emergency-contact SMS, dependent-claim SMS, virtual-review link, broadcast channel, employer roster invite. Live: 57 SMS rows in 30 days across 4 templates | OQ-32, OQ-48, OQ-92, OQ-310; D3 drafted, unsigned |
| Virtual ward | CLEAN | no hits | none |
| Pharmacy delivery | DORMANT | Removed from code (#1017) and database (#1023). `logistics_partners` 1 row stays dormant; enum labels `delivery`, `delivery_failed`, `delivery_unavailable` remain | OQ-261, OQ-281, OQ-312 |
| Therapist matching | CLEAN, dormant schema | alphabetical directory, no ranking | OQ-16 |
| Discreet care lines | CLEAN | only a notification privacy toggle | none |
| Subscriptions at launch | DORMANT | as auto-renewing row | OQ-97 |
| Name "Helemed" | CLEAN | scan rule `removed-name`: 0 hits | none |
| Patient-facing AI scribe | NOT VERIFIED | scribe is clinician-side; patient-visibility of the summary not confirmed | OQ-210, OQ-211, OQ-312 |
| Salaried clinicians | RESOLVED | spec row to match the 2026-09-30 decision; code stays | OQ-311, `DECISIONS.md` S87-1 |

## S87 extension, 2026-10-27 (branch `s87/scan-rules-sms-allowlist`)

Status of the SMS finding: the paystack-webhook Termii reservation-invite SMS is removed (the sponsor already shares the claim link from `/patient/supporting`). The widened `patient-sms` rule now sees every Termii send and `send...Sms(` helper. It still finds the clinician-paging SMS and voice code in `abnormal-result-handler` and `send-pending-notifications` (OQ-727, allowlisted to 2026-11-26). The auth hook (`auth-send-sms-hook`, verification codes) and the status page key check are exempt by path, with the reason in the rule.

New rules (all start clean unless noted; each has a sabotage case in `part-c-scan-extension.test.ts`):

| Rule | What it fails on | Status |
|---|---|---|
| `tracker-sdk` | analytics, ad or tracking SDK in any `package.json` (allowlist `TRACKER_ALLOWLIST`, empty) | CLEAN (only `@sentry/nextjs`, error monitoring) |
| `tracker-script` | tag-manager, pixel or third-party `<script src>` / `<Script src>` in source | CLEAN |
| `analytics-health-field` | `reading`, `bp`, `glucose`, `condition`, `diagnosis`, `medication` in a `track`/`logEvent`/`analytics.*` call | CLEAN (no analytics call exists) |
| `ai-label` | a listed AI surface that does not render the shared `AiLabel` (web) or `AI_LABEL_TEXT` (phone), or any `.tsx` that types "AI-drafted" by hand | CLEAN after wiring 10 surfaces (`AI_SURFACES` in `scan.ts`) |
| `marketing-claim` | cure, guaranteed outcome, FDA or NAFDAC approved, instant doctor, free healthcare in marketing pages and `packages/i18n` copy (negation and debunking copy pass) | CLEAN; OQ-728 for implied claims |
| `doctor-led-headline` | "doctor-led" in marketing or copy (retired 2026-07-18) | CLEAN |
| `testimonial-hardcoded` | a `quote: "..."` literal in marketing code (testimonials may come only from consent-gated `patient_testimonials`) | CLEAN |
| `trial-copy` | "free trial" or "then charged" in marketing or copy unless negated | CLEAN |
| `paystack-recurring` | Paystack plan or subscription creation, `subscription.create` handler | 1 allowlisted: dormant webhook handler, OQ-97, to 2026-11-26 |

Also: `exit-paths-reachable.test.ts` proves account deletion, a refund request and the cancellation statements are reachable from the app's own navigation (OQ-729: no gap, wording point only). The `stored-balance` allowlist entry is gone (OQ-309 decided with live evidence). Not checked by any rule: the NAFDAC claim has no verified-registration constant to exempt, so any such claim fails by design.

## What now guards this

`packages/shared/src/part-c-scan/part-c-scan.test.ts` fails CI on (a) any new hit outside `allowlist.ts`, (b) an allowlist entry that no longer matches (fixed, so remove it), (c) an expired entry, (d) an entry whose open question is not written in `docs/OPEN-QUESTIONS.md`. A sabotage run (an injected banned string in a real source file) failed the suite as intended and was removed.

## Not done in S87

A live-schema SQL proof for the dormant objects (counts are stated above, not asserted in CI); the employer-report and scribe-visibility checks; the removal migrations (OQ-312). Each needs a founder decision first.
