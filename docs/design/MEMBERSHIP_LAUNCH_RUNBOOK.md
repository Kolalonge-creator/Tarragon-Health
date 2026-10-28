# Membership launch runbook (three plans: Free, Membership, Membership Plus)

Everything here is switched on by a person, in this order. Nothing in the code turns a money switch on by itself, and no agent signs the clinical rule.
State checked live on 2026-10-27: payments 0 rows, refunds 0 rows, and `checkout_enabled`, `membership_billing_enabled`, `v5_checkout`, `membership_two_member_tiers` all OFF.

## 1. Sign the baseline-labs rule (CMO, on the hub)
1. Merge the baseline-labs PR (it applies its migration, nothing is active yet).
2. Open `/clinician/clinical-signoff`, find "Baseline labs before a start or a dose increase", read the rule, tick the box, sign.
3. Before signing, remember the live database holds no lab results yet: after signing, a doctor starting or raising a covered medicine needs recent labs on file, or records a documented override (emergency, results pending, or labs not obtainable), which is audited and puts a pending lab item due in 48 hours.

## 2. Disable the leftover Paystack plans (founder, Paystack dashboard, Products, Plans)
Disable every plan below. The six subscription plans are the ones the guard names; the six add-on plans belong to retired add-ons, so disable them too.
- Subscription plans: `PLN_vyshgwwcbbwfvju` (prevent), `PLN_5euwee2v1dn7xu9` (prevent yearly), `PLN_a35fb7jxpcjhfwk` (essential), `PLN_x6qurpjgg3f0nn6` (essential yearly), `PLN_xx6p9lxvoca2p41` (complete), `PLN_rrnr23wcfk8kbra` (complete yearly)
- Add-on plans: `PLN_jppdmrk7k81zijj` (annual review), `PLN_54tnaxtc3j5h5vn` (care coordinator), `PLN_m1d5wnd1rrgkg4s` (expedited response), `PLN_14u2o6ng52vjh6r` (health education), `PLN_63vhto3wwjr0qvf` (lifestyle coaching), `PLN_ykxc346sa2zx2g3` (prevention screening)

## 3. Prove a payment and a refund with the founder test key (founder)
1. Put the Paystack TEST secret key in the environment used for the test run (never in chat, a PR or a file in the repo).
2. As a test patient (is_test account, so the checkout guards let it through before launch), buy Membership and Membership Plus, once each, by card, once by bank transfer and once by USSD (the three channels the guard names).
3. Check each order: state paid, a `payments` row, the ledger posting, the 21-day refund window, the receipt.
4. Refund one of them end to end. Check the order state, the ledger reversal and that Member access ends straight away.
5. Pay the Membership then upgrade it to Membership Plus (the 45,000 difference) and check the end date does not change.
6. Record in the go-live note what you tried and the order references.

## 4. Turn the switches on, in this order (admin, `/admin/go-live` and `/admin/settings/platform-modules`)
1. `v5_checkout` (platform module).
2. `checkout_enabled` (go-live guard): conditions are v5 checkout open, an active priced patient item, the three channels tried, a refund tested, admin confirmation.
3. `membership_billing_enabled` (go-live guard): conditions are a current price, checkout open, the plan codes disabled, a Membership refund tested, admin confirmation.
4. `membership_two_member_tiers` (platform module): lets Membership (84,000) and the upgrade be bought. Membership Plus (129,000) is the existing item.
5. Activate the Membership catalogue items in the catalogue admin.

## 5. Show the three plans on the website
Only after steps 1 to 4: take PR "make the Membership ladder public" out of draft and merge it (the homepage, /pricing and /gift then show Free, Membership and Membership Plus).

## Do not
- Do not switch on `checkout_enabled` before step 3, or the website before step 4: the site would advertise a plan that cannot be bought.
- Do not turn automatic renewal on as part of this launch (separate switch, separate checklist in `docs/design/MEMBERSHIP_AUTO_RENEW.md`).
