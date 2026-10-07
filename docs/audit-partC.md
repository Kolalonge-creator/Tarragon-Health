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
| Health Wallet, stored balance, Platform Credit | DORMANT | Tables gone. Webhook keeps a refund branch for a retired `platform_credit_topup` charge (`paystack-webhook/handler.ts:756`, allowlisted). `payment_provider` enum still has `wallet` and `stripe` labels | OQ-309, OQ-312 |
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

## What now guards this

`packages/shared/src/part-c-scan/part-c-scan.test.ts` fails CI on (a) any new hit outside `allowlist.ts`, (b) an allowlist entry that no longer matches (fixed, so remove it), (c) an expired entry, (d) an entry whose open question is not written in `docs/OPEN-QUESTIONS.md`. A sabotage run (an injected banned string in a real source file) failed the suite as intended and was removed.

## Not done in S87

A live-schema SQL proof for the dormant objects (counts are stated above, not asserted in CI); the employer-report and scribe-visibility checks; the removal migrations (OQ-312). Each needs a founder decision first.
