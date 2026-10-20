# Dashboard steps after the 2026-10 sign-in work (do these yourself, in this order)

Nothing here can be done from code: they need your Supabase login. Each step says what breaks if it is skipped.

## A. SMS hook and the 72-hour recovery pause (PR #1171, merged)

1. Wait until the migration `20261016185844_s03b_auth_sms_hold.sql` is applied (check `supabase_migrations.schema_migrations`).
2. From a terminal with the Supabase CLI logged in: `supabase functions deploy auth-send-sms-hook`.
   If this runs BEFORE step 1, every SMS send fails closed with a 503.
3. Supabase dashboard, Authentication, Hooks, Send SMS: enable it, point it at `auth-send-sms-hook`, and set the secret `SEND_SMS_HOOK_SECRET`.
   If this is skipped, Auth uses its built-in provider and the recovery pause is not enforced at the Auth level.
4. Leave `SMS_PROVIDER` unset until the Termii sender ID is approved (OQ-44, OQ-46).

## B. Yearly proxy-access review (PR #1181)

1. After it merges: `supabase functions deploy send-pending-notifications` (new `proxy_review_due` renderer).
   Until then the person's email/push rows for that template fail; the in-app row still works.
2. Decision recorded 2026-10-19 (OQ-705): the proxy is told nothing (`tell_proxy = false`). To change it, add a new `proxy_review_config` version with `tell_proxy = true`.

## C. Optional passkeys (PR #1176), ships OFF

1. After it merges: `supabase functions deploy send-pending-notifications` (new `security.passkey_*` email templates). One deploy covers B and C.
2. Supabase dashboard, Authentication, Passkeys: enable it. Relying-party id `tarragonhealth.ng` (permanent: changing it later kills every passkey), display name "Tarragon Health", origins `https://app.tarragonhealth.ng` plus any other host serving `/login`.
3. In the SQL editor (service role): `select public.passkey_gate_ready();` must return true.
4. Test on a real phone and a laptop with a test patient account that has a password. The database refuses to store a passkey while the switch is off, so turn it on for the test window: `select public.set_platform_switch('passkeys', true, 'passkey test');` under an admin session (audited).
5. Only if the test passes, leave the switch on. To turn it off again: `select public.set_platform_switch('passkeys', false, 'reason');`.

## D. Checks after everything is live

- `select has_function_privilege('anon', 'public.answer_proxy_review(uuid,text,public.care_access_category[],boolean)', 'EXECUTE');` must be false.
- Confirm the cron job `proxy-access-review-daily` exists and is active in `cron.job`.
