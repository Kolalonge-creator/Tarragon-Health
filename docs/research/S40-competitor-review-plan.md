# S40 competitor product review: findings, plan, and what was built

Scope: the 7 competitors from `reports/Nigeria healthtech competitor analysis.md`, reviewed on public pages only (design, functionality, observable front-end code). Per-company notes: `docs/research/S40-competitor-*.md`. Not the Stage 1 gate (`docs/v5-sessions/S40-stage-1-completion-gate.md` is untouched and still blocks Part B).

## Limits of the review (read before trusting any row)
- mDoc's website was blocked by Cloudflare (403) and was not reviewed; Play listing and secondary sources only. Rerun in a normal browser if it matters.
- MyMedicalBank's AI assistant page returned Access Denied; its flow is from the vendor's own blog only.
- Screenshots could not be saved to the repo (shared browser pane); several mobile and page-weight numbers are UNVERIFIED in the per-company files.
- Competitor source code is not available. "Code" means observable stack, headers, bundles and SEO only.

## Headline findings
1. Tarragon is ahead on the engineering/trust basics competitors are weakest on: CSP and security headers, JSON-LD and sitemap, no ad pixels or session replay, Naira-only statement, named no-capitation page, emergency notice on most marketing pages. Competitors: Presibo has only HSTS and a third-party IP lookup with no consent; MyMedicalBank records 100% of sessions with Mixpanel plus ad pixels; Medlitics and WellNation send no CSP; Avura puts payment key reads in browser code; Mobihealth ships a ~20 MB SPA with no JSON-LD.
2. Competitor claims drift fast (Medlitics rebuilt its site, dropped its percentage claims and moved to $14.99/$24.99; Mobihealth user counts changed). Do not copy a number from the older desk report.
3. No competitor shows a clinician sign-off on AI output. Tarragon's governed, doctor-read result upload is a real differentiator; keep it that way.

## Gaps verified against Tarragon's own code
| Gap | Evidence | Action |
|---|---|---|
| Condition and programme pages had no structured data (only org, breadcrumbs, FAQ, pricing did) | grep: no JSON-LD in diabetes/hypertension/obesity pages | **Built** |
| Pricing page, where booking starts, had no emergency notice (Mobihealth hides theirs in an FAQ) | `EmergencyNotice` absent from pricing/page.tsx | **Built** |
| No risk-reversal offer (Presibo 30-day refund) | no guarantee copy anywhere | Founder decision, not built |
| No Pidgin hook on marketing (Avura, mDoc) | pcm exists in `packages/i18n` for app only | Needs native-speaker copy, not built |
| No read-only SMS/USSD status surface (mDoc) | none | Assess only; Termii is verification/paging only (OQ-05) |
| Telco bundle landing in the free app (Mobihealth/Airtel) | none | Business development, not engineering |
| Assisted-vitals pilot at partner sites (mDoc NudgeHub) | none | Ops decision |

## Already shipped, so not repeated
Reputation engine, lab location reviews, offline resilience audit, condition pages, Naira-only message, no-capitation page, doctor-read result interpretation, caregiver consent graph.

## Do not copy (safety or regulatory)
AI lab interpretation without clinician sign-off; session replay or ad pixels on health pages; unsourced "24/7" or SOS promises; blanket HIPAA/GDPR/NDPR claims; USD consumer pricing; plan-gated safety alerts; hardware sales; capitation.

## Built in this branch
- `medicalWebPageJsonLd` (lib/marketing/structured-data.ts) rendered by `ProductPageTemplate`, so every programme and condition page emits a claim-free MedicalWebPage block. Returns null when title or description is missing. Unit tests added.
- `EmergencyNotice` on the pricing page.
- Verified: jest for structured-data (14 pass), `tsc --noEmit` clean.
Not run: Playwright or visual check of the two pages; no migration, so no RLS or DB test applies.

## Founder decisions needed (none are blocked on engineering)
1. Satisfaction guarantee on the first 12-week programme cycle: yes or no, and terms.
2. Native-speaker Pidgin hero line for the marketing site: who writes and signs off.
3. Whether a read-only SMS reminder or USSD status check is worth scoping.
4. Telco or employer bundle conversation: owner and timing.
