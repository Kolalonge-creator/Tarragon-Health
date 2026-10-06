# S25: Paystack test-mode payment and replay (run on your Mac, nothing touches production)

Goal: prove one real Paystack test payment end to end, one replayed webhook (still one entitlement), a declined card, and see what Paystack really sends for `requested_amount` and `fees` with fee pass-through on. Runs on a LOCAL Supabase stack with LOCAL functions and Paystack TEST keys. The production database, the live Paystack key and the deployed functions are never used.

Test card data is from paystack.com/docs/payments/test-payments (read 2026-10-06).

## 0. Before you start
1. Open the Paystack dashboard and switch the toggle to **Test mode**.
2. Settings, API Keys and Webhooks: copy the **Test Secret Key** (`sk_test_...`).
3. Settings, Preferences: make sure "Pass transaction fees to customers" is ON for test mode too (the live account has it on; this decides whether `requested_amount` differs from `amount`).
4. Other sessions run their own local stacks (`docker ps` shows `supabase_db_tarragon-s22c` and others). Do not run `supabase stop` or `db reset` on a stack you did not start.

## 1. Local stack (already set up for you on 2026-10-06; this section is how it was made)
The worktree's `supabase/config.toml` was edited locally (and marked `git update-index --skip-worktree`, never committed) to use project id `tarragon-s25`, API port 56321, DB port 56322, email confirmations off. That keeps it away from the other sessions' stacks. The stack was started with `npx supabase start`, which replayed every migration (the three S25 ones included) and the seed.
```bash
cd /Users/kolalonge/Documents/Tarragonhealth/.claude/worktrees/s25-commerce
npx supabase start
npx supabase db reset          # replays every migration, including the three S25 ones
npx supabase status -o env     # note API_URL, ANON_KEY, SERVICE_ROLE_KEY
```
If `start` reports a port clash with another session's stack, tell me and I will give you a second config on other ports.

## 2. Test secrets (kept outside the repo)
```bash
mkdir -p ~/s25test && chmod 700 ~/s25test
cat > ~/s25test/env <<'ENV'
PAYSTACK_SECRET_KEY=sk_test_PASTE_YOURS_HERE
PAYSTACK_WEBHOOK_SECRET=sk_test_PASTE_THE_SAME_VALUE_HERE
ORDER_RETURN_URL=https://example.com/paid
ENV
chmod 600 ~/s25test/env
```

## 3. Serve the functions locally (terminal 2)
```bash
cd /Users/kolalonge/Documents/Tarragonhealth/.claude/worktrees/s25-commerce
npx supabase functions serve --env-file ~/s25test/env
```
Functions answer at `http://127.0.0.1:56321/functions/v1/<name>`. `eval "$(npx supabase status -o env | sed 's/^/export /')"` sets `API_URL`, `ANON_KEY` for the later commands.

## 4. A test patient, with checkout open (terminal 1)
```bash
eval "$(npx supabase status -o env | sed 's/^/export /')"   # sets ANON_KEY, SERVICE_ROLE_KEY, API_URL
curl -s -X POST "$API_URL/auth/v1/signup" -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"s25-patient@example.com","password":"Test-pass-12345"}' > ~/s25test/signup.json
export JWT=$(python3 -c "import json;print(json.load(open('$HOME/s25test/signup.json'))['access_token'])")
```
Then in psql (`docker exec -i supabase_db_tarragon-s25 psql -U postgres`):
```sql
-- the patient (works whether or not a profile row already exists)
insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth)
select u.id, (select id from public.organisations order by created_at limit 1), 'patient', 'S25 Local Patient', '+2348011112222', date '1980-01-01'
  from auth.users u where u.email = 's25-patient@example.com'
on conflict (id) do update set role = 'patient', is_active = true;
-- an admin, only so the module row can record who opened it
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000025', 's25-admin@example.com', 'x', now(), '{}', '{}');
insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth)
values ('00000000-0000-4000-8000-000000000025', (select id from public.organisations order by created_at limit 1), 'admin', 'S25 Local Admin', '+2348033334444', date '1980-01-01');
-- open checkout and the Membership, locally only; no lead slot needed for this test
update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = '00000000-0000-4000-8000-000000000025', activation_note = 'S25 local test' where key = 'v5_checkout';
update public.catalog_items set active = true, grants_lead = false where code = 'membership_annual';
```

## 5. The payment (terminal 1)
```bash
curl -s -X POST "$API_URL/functions/v1/order-checkout" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"code":"membership_annual","client_key":"11111111-2222-4333-8444-555555555555"}' | tee ~/s25test/checkout.json
```
Expect `amount_kobo` 10000000, a `reference` starting `tho_` and a `checkout_url` on `checkout.paystack.com`. Open the URL in a browser and pay with:

| Card | 4084 0840 8408 4081 |
|---|---|
| Expiry | 10/27 |
| CVV | 408 |

Paystack shows the amount it will charge. **Write down the total on that page** (with pass-through on, expect about 10,160,000 kobo, that is 101,600 naira, for a local card). Paystack then sends you to `example.com/paid?reference=...`.

Ask our server whether it is paid (never trust the redirect):
```bash
REF=$(python3 -c "import json;print(json.load(open('$HOME/s25test/checkout.json'))['reference'])")
curl -s -X POST "$API_URL/functions/v1/order-verify" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d "{\"reference\":\"$REF\"}"
```
Expect `{"state":"paid","outcome":"paid"}`.

## 6. Check what was recorded (psql)
```sql
select state, amount_kobo, fee_kobo, total_kobo from public.orders;                      -- paid, 10000000, fee, total = amount + fee
select status, amount_kobo, fee_kobo, total_kobo, raw from public.payments;               -- one success row; raw has processor_fee_kobo
select kind, state, ends_at - starts_at as runs from public.entitlements;                 -- one, membership, 365 days
select source, state from public.patient_memberships;                                     -- one, purchase, active
select count(*) from public.domain_events where event_type = 'order.paid';                -- 1
select e.source_ref, l.account_code, l.debit_minor, l.credit_minor
  from public.finance_journal_entries e join public.finance_journal_lines l on l.entry_id = e.id where e.source_ref like 'order:%'; -- 1020 debit and 2000 credit, both 10000000
select source_kind, total_minor, period_end - period_start as days from public.revenue_recognition_schedules; -- order, 10000000, 365
select * from public.ops_incidents where external_reference like 'order-%';                -- none
```
The fee line is the one that matters: if `fee_kobo` is 0 while Paystack showed a higher total, or the order shows a mismatch incident, `requested_amount` is not what the docs say. Stop and send me the `payments.raw` row and `ops_incidents`.

## 7. Replay
Order verify again, then the same signed webhook three times (the body needs `amount`, `currency` and `metadata.kind`):
```bash
curl -s -X POST "$API_URL/functions/v1/order-verify" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d "{\"reference\":\"$REF\"}"   # outcome: replay
SK=$(grep ^PAYSTACK_SECRET_KEY ~/s25test/env | cut -d= -f2)
BODY="{\"event\":\"charge.success\",\"data\":{\"reference\":\"$REF\",\"amount\":10160000,\"currency\":\"NGN\",\"metadata\":{\"kind\":\"order\"}}}"
SIG=$(printf '%s' "$BODY" | openssl dgst -sha512 -hmac "$SK" | sed 's/^.* //')
for i in 1 2 3; do curl -s -X POST "$API_URL/functions/v1/paystack-webhook" -H "x-paystack-signature: $SIG" -d "$BODY"; echo; done
```
Expect `{"ok":true,"order":"replay"}` three times. Re-run the section 6 queries: **still one** payment, entitlement, membership, `order.paid` event, journal entry. That is safety case 24 against real Paystack data.

Wrong signature must be refused: repeat with `-H "x-paystack-signature: deadbeef"`; expect `invalid_signature` and no change.

## 8. Declined card (new order)
Pay a second time with a fresh key (`"client_key":"66666666-7777-4888-9999-000000000000"`, after `update public.patient_memberships set state='ended', ended_at=now(), end_reason='local test cleanup' where state='active';` so a second membership is allowed). On the Paystack page use the declined card `4084 0800 0000 5408`, expiry 10/27, CVV 001. Then `order-verify`: expect the order not paid and no new entitlement.

## 9. Optional: real webhook delivery and the dashboard replay
Needs a public URL for terminal 2:
```bash
brew install cloudflared
cloudflared tunnel --url http://127.0.0.1:54321
```
In the Paystack dashboard, still in Test mode, Settings, API Keys and Webhooks: set the **Test Webhook URL** to `https://<the-trycloudflare-address>/functions/v1/paystack-webhook`. Make a third payment (section 5 with another key and another reset of the membership), watch terminal 2 log the webhook, then in the dashboard open Transactions, the payment, Logs, and use **Resend** on the webhook delivery. Expect `replay` in the response and no new rows. Afterwards clear the Test Webhook URL.

## 10. Clean up
```bash
rm -rf ~/s25test
```
Stop terminal 2 (`Ctrl+C`). Switch the Paystack dashboard back to Live mode. Only stop the local stack with `npx supabase stop` if it is yours. Nothing in production changed.

## 11. Send back
The output of the section 6 queries after the first payment and after the replays, the `payments.raw` row, the total Paystack showed on its page, and the responses from sections 5, 7 and 8. With those I can confirm `requested_amount` and `fees`, and close OQ-174.
