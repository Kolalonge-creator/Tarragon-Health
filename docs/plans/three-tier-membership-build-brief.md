# Build brief: three-tier annual-only pricing (Free / Membership / Membership Plus)

Paste this into a new Claude Code session on /Users/kolalonge/Documents/Tarragonhealth. Decision date 2026-10-21 (founder). Facts marked [verify] come from role-played reviewer agents reading files; confirm in the repo before relying on them.

## Decision (founder, 2026-10-21)
- Replace the single Member plan with three tiers, billed ANNUALLY ONLY (no monthly payment, no instalments, no auto-renew, no auto-debit):
  - Free: technology only, no doctor time. Unchanged.
  - Membership: NGN 84,000 per year (8,400,000 kobo). Everything in today's Member plan EXCEPT the annual blood panel.
  - Membership Plus: NGN 129,000 per year (12,900,000 kobo). Today's Member plan INCLUDING the annual blood panel.
- Mid-year upgrade Membership to Plus: flat difference NGN 45,000 (4,500,000 kobo), one new named order, one Paystack payment, end date unchanged, NO stored balance, no mid-year downgrade (downgrade only at renewal).
- Planning economics (all estimates): panel cost NGN 35,000, fees about 4.5%, doctor NGN 250 per minute at 10 minutes per Member-month. Membership contributes about NGN 38,200 (45%), Plus about NGN 46,200 (36%), panel step about NGN 8,000. FX break-even for the step is about 2,180 NGN/USD, so set a semiannual price review. Doctor cost per minute is disputed 2x; replace with payroll actuals.

## Hard rules (CLAUDE.md invariants plus panel rulings)
- Both paid tiers are "Member" for every safety purpose: same doctors, same monthly follow-up, same red-page and emergency handling. Price buys scope, never a lower standard of care (TT-5: Member means one thing). Plus differs only by the annual panel entitlement.
- Free tier safety floor is unchanged and is never a Plus benefit. No upgrade prompt in or after any acknowledged red or emergency guidance.
- No capitation, individual enrolment only, institutions aggregate-only, Paystack NGN only, no stored balance, no WhatsApp or USSD, no hardware sales. No USD price on marketing pages (naira only).
- 21-day refund applies to both tiers; a refund ends access at once. Reminders at 30, 14 and 7 days before the year ends; 14-day grace; then Free with the record kept; export free for life.
- Copy: warm, no countdowns, scarcity or fear, no strikethroughs, no "doctor-led", no ratios, no em dashes. Do not use Basic, Lite, Standard, Premium or Gold. State the single difference in the first line: "annual blood panel: no / no / yes".
- A clinically required test is never tier-gated. Never claim "validated", "clinically proven" or "controlled".

## Blockers that must be true BEFORE the lower tier is enabled (do not build around them)
1. Founder decision recorded in docs/DECISIONS.md (step 0 below). It supersedes the 2026-10-08 two-tier decision, the TT-11 scan test premise, the "no plan tiers" header in pricing.ts, and the 100k seat floor.
2. CMO-owned baseline-labs rule: no start or uptitration of a BP or glucose-lowering drug without baseline kidney function and potassium, glucose (HbA1c if diabetes), built as a prescribing check on the CMO sign-off hub. Membership includes doctor-ordered baseline labs at the member price, paid separately. An agent must never sign this; the independent CMO does.
3. An independent, non-founder CMO engaged; home BP target (135/85 home, 140/90 clinic, decision S75-1) signed.
4. One live Paystack payment and refund proven end to end and posted to the GL.
5. Order matters: the red-page canary, doctor-time capture and the money loop outrank this work.

## Build steps
0. In a worktree off origin/main-dev (never commit to main-dev), add the decision to docs/DECISIONS.md with a superseding note for the items in blocker 1.
1. Catalogue and prices: add catalog code `membership_plus` (decide whether the existing `membership_annual` becomes the Plus or the Membership code; renaming breaks e2e helpers, item-label, model.test and admin-search [verify]). Add versioned `public.prices` rows (never edit a closed price row) at 8,400,000 and 12,900,000 kobo. Update `commerce.membership_prices` and its mirror test.
2. Tier model: add `private.patient_membership_tier()`; keep `private.patient_is_member` true for BOTH tiers (it drives the Free red path and TT-1). Update the CHECK `catalog_items_only_membership_sellable` and the one-member rule (migration 20261013012331) to allow two member codes.
3. Panel gating: the annual panel (lab panel `membership_annual` v2 in `lab_panel_versions`) is ordered only for Plus. Auto-order on activation is not built yet (plan build item 9). Delete the cumulative-payment panel release rule; it was for instalments.
4. Checkout and `membership-shop`: three-card tier picker, naira annual only, "about NGN 7,000 a month" shown as framing only, 21-day refund beside the button, no preselected badge steering unless the pricing experiment says so.
5. Upgrade: new order kind `membership_upgrade` for exactly 4,500,000 kobo; refund window runs from the top-up date; balanced journals; no balance row.
6. Gifts and sponsors (S71): sponsor buys either tier for ONE named person; recipient accepts within 14 days or sponsor is refunded; refund and unclaimed-gift logic made tier-aware. Optional "gift the blood test" add-on at the Plus difference, only for a parent already on Membership. No bundle discount, no co-funding in v1.
7. Employer seats: org price per tier code with per-code floor and ceiling (today a single item code, flat floor 5M and ceiling 20M kobo, dormant behind `organisation_membership` [verify]). Employer buys ONE tier for all seats and must not see which tier an employee holds. Seat of NGN 110,000 prepaid maps to Plus; no Membership-only seats until doctor-minutes are measured and the CMO signs.
8. Marketing `/pricing` and `pricing.ts`: rewrite the TT-11 scan test to "exactly two member prices, no volume words, no other naira figure". Three equal cards; honest copy per the Trust Charter; Free red-reading guidance shown as the same on every plan.
9. Voucher layaway: `voucher-checkout.ts` and `care_voucher_payments.instalment_kobo` must reject Membership items (an instalment path in disguise).
10. Renewal reminders (30/14/7) and the 14-day grace follow-up become tier-aware. Finance: IFRS 15 treats the panel as a separate performance obligation, so Membership versus Plus changes deferred-revenue release; flag to the finance owner.
11. Grandfather any existing paid Member as Plus at the price paid until their end date (the last known count was zero paid [verify live]).

## Migrations (names only; generate timestamps at apply time, never hand-type; check list_migrations live first)
- membership_two_tier_ladder_catalogue_and_prices
- membership_tier_column_and_patient_tier_function
- panel_order_gated_to_plus
- organisation_prices_per_member_code
- membership_upgrade_order_kind
- legacy_membership_grandfather_tier_backfill
Rules: kobo for all amounts; new tables need `grant ... to authenticated`; revoke execute from public (not from anon); RLS proven with a simulated session plus a control; closing DO assertion block; ship code first, schema second; register proof scripts in packages/db/tests ci.manifest with a sabotage step.

## Regression tests required
1. A Membership holder cannot be ordered the panel; a Plus holder is ordered it exactly once.
2. `patient_is_member` and the Free red path treat both tiers as Member; a lapsed tier is Free.
3. Upgrade charges exactly 4,500,000 kobo, leaves the end date unchanged, posts balanced journals, leaves no balance row.
4. Price mirror: migration seed equals registry (8,400,000 and 12,900,000), one-member rule holds, no monthly or instalment route can create a Membership order.
5. Gift/sponsor and employer seat: tier carries through claim, unclaimed refund and seat invoice; price floor and ceiling hold per code.

## Rollout
- Feature flag: `v5_checkout` plus a new `membership_two_member_tiers` module, off by default. Do not enable until blockers 1 to 4 are met.
- Test prices sequentially, never concurrently on one audience. First experiment: randomise presentation only (default tier, itemised gap wording) at identical prices. Kill gates: revert to a single price if Membership share exceeds 70%, or median Plus doctor-minutes exceed Membership's by more than 2, or Free-to-paid lift is under 10%, or 30-day panel completion falls below 70%.
- Effort estimate: about 6 to 8 Claude-Code build sessions, excluding the CMO baseline-lab check.

## Open items (do not guess)
- Actual Synlab panel cost versus the 35,000 assumption; member price of the baseline-lab set.
- Refund after the panel is already delivered inside the 21 days (TT-6 has no carve-out; copy must say only what TT-6 says until decided).
- Counsel questions: voucher and gift stored-value classification, insurance and managed-care rules, FCCPA on two-tier annual prepay, Free-user duty of care.
- Investor dissent on record: launch a single NGN 120,000 price and test tiers after 100 paid Members. The founder chose the ladder; the kill gates above are the safety valve.

Full reasoning: TARRAGON-FINAL-PLAN.md (Downloads folder).
