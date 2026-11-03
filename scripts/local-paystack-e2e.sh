#!/usr/bin/env bash
# Turn a fresh LOCAL Supabase stack into one where a test patient can buy a Membership through
# Paystack TEST mode, end to end, without touching production.
#
#   supabase start && supabase db reset
#   PAYSTACK_SECRET_KEY=sk_test_... scripts/local-paystack-e2e.sh
#   scripts/local-paystack-e2e.sh --teardown
#
# What it does, in order (the recipe is in apps/web/e2e-browser/README.md, "Paystack test mode, locally"):
#   1. reads the local stack's URL/keys from `supabase status -o env`; refuses a non-local Supabase URL
#      and any PAYSTACK_SECRET_KEY that does not start with sk_test_
#   2. seeds what a fresh `db reset` lacks: active membership catalogue items, a price each, a 10% test discount
#      code (LOCALTEST10), the two checkout guards, the two checkout modules (attribution columns filled; guard triggers skipped)
#   3. creates a test patient and a test doctor through the admin auth API, with the clinical_staff and
#      competency rows that make `private.lead_candidates` return a row (else create_order raises no_capacity)
#   4. writes a chmod-600 env file for the edge functions in a temp dir, then starts
#      `supabase functions serve` and `next dev -p 3100` in the background
#   5. prints the test login, the URL and the curl one-liners for process-events / order-reconcile
#
# Nothing here is a secret: the only secret, the Paystack test key, arrives from the environment.
# Every row is is_test and lives in a throwaway local database.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${LOCAL_PAYSTACK_E2E_STATE_DIR:-${TMPDIR:-/tmp}/tarragon-local-paystack-e2e}"
APP_PORT="${APP_PORT:-3100}"
APP_URL="http://localhost:${APP_PORT}"
PATIENT_EMAIL="${PATIENT_EMAIL:-local.paystack.patient@tarragonhealth.ng}"   # never @tarragon.test: Paystack rejects that TLD
DOCTOR_EMAIL="${DOCTOR_EMAIL:-local.paystack.doctor@tarragonhealth.ng}"
TEST_PASSWORD="${TEST_PASSWORD:-Local-paystack-pw-1!}"
ORG_ID="00000000-0000-0000-0000-000000000001"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- teardown ----------
kill_tree() { # TERM a process and every descendant (no setsid on macOS, so no process group to lean on)
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill -TERM "$pid" 2>/dev/null || true
}
teardown() {
  local f pid
  for f in "$STATE_DIR"/functions.pid "$STATE_DIR"/next.pid; do
    [ -f "$f" ] || continue
    pid="$(cat "$f")"
    if kill -0 "$pid" 2>/dev/null; then
      kill_tree "$pid"
      echo "stopped $(basename "$f" .pid) (pid $pid)"
    else
      echo "$(basename "$f" .pid) (pid $pid) was not running"
    fi
    rm -f "$f"
  done
  rm -f "$STATE_DIR"/functions.env
  echo "Logs kept in $STATE_DIR (functions.log, next.log). The local database is untouched; \`supabase db reset\` clears it."
}
if [ "${1:-}" = "--teardown" ]; then teardown; exit 0; fi
[ -z "${1:-}" ] || die "unknown argument: $1 (only --teardown is accepted)"

# ---------- 0. tooling ----------
for bin in supabase psql curl jq openssl pnpm; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin is not installed"
done

# ---------- 1. local stack + test key ----------
say "1/5 Reading the local Supabase stack"
STATUS="$(cd "$ROOT" && supabase status -o env 2>/dev/null)" || die "supabase status failed; is the local stack up? (supabase start && supabase db reset)"
val() { printf '%s\n' "$STATUS" | sed -n "s/^$1=\"\(.*\)\"$/\1/p" | head -n1; }
API_URL="$(val API_URL)"; ANON_KEY="$(val ANON_KEY)"; SERVICE_ROLE_KEY="$(val SERVICE_ROLE_KEY)"; DB_URL="$(val DB_URL)"
[ -n "$API_URL" ] && [ -n "$ANON_KEY" ] && [ -n "$SERVICE_ROLE_KEY" ] && [ -n "$DB_URL" ] || die "could not read API_URL/ANON_KEY/SERVICE_ROLE_KEY/DB_URL from supabase status"

is_local() { case "$1" in http://127.0.0.1:*|http://localhost:*|http://\[::1\]:*|http://*.localhost:*) return 0 ;; *) return 1 ;; esac; }
is_local "$API_URL" || die "supabase status gave a non-local API_URL ($API_URL); this script only ever runs against a local stack"
if [ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ] && ! is_local "$NEXT_PUBLIC_SUPABASE_URL"; then
  die "NEXT_PUBLIC_SUPABASE_URL is set to a non-local project ($NEXT_PUBLIC_SUPABASE_URL). Unset it; this script exports the local stack's values itself"
fi
case "$DB_URL" in postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;; *) die "DB_URL is not local ($DB_URL)" ;; esac

case "${PAYSTACK_SECRET_KEY:-}" in
  sk_test_*) ;;
  sk_live_*) die "PAYSTACK_SECRET_KEY is a LIVE key. This script refuses it; use the test key from the Paystack dashboard" ;;
  "") die "PAYSTACK_SECRET_KEY is not set (export the sk_test_... key from the Paystack dashboard)" ;;
  *) die "PAYSTACK_SECRET_KEY does not look like a Paystack secret key (expected sk_test_...)" ;;
esac
echo "API_URL=$API_URL  DB=${DB_URL##*@}  key=sk_test_…${PAYSTACK_SECRET_KEY: -4}"

sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -X -q -At "$@"; }

# ---------- 2. seed the catalogue, prices, guards, modules ----------
say "2/5 Seeding the catalogue, prices, guards and modules"
# session_replication_role = replica skips the guard triggers that block direct writes to these tables.
# The attribution columns (changed_by, enabled_by, ...) are CHECK constraints, so they are filled.
# Attribution points at the first profile in the database; if there is none yet the doctor created in
# step 3 is used instead (see the second seed block).
sql <<'SQL'
set session_replication_role = replica;
begin;
update public.catalog_items set active = true
 where code in ('membership_annual', 'membership_annual_no_panel', 'membership_upgrade_plus');

-- one open price per item: close a differing open row (same now() so the ranges touch without overlapping), add the wanted one
with wanted(code, kobo) as (values ('membership_annual', 12900000::bigint), ('membership_annual_no_panel', 8400000), ('membership_upgrade_plus', 4500000)),
     closed as (
       update public.prices p set valid_to = now()
         from public.catalog_items ci join wanted w on w.code = ci.code
        where p.catalog_item_id = ci.id and p.valid_to is null and p.amount_kobo <> w.kobo
        returning p.catalog_item_id)
insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, valid_from, reason)
select ci.organisation_id, ci.id, w.kobo, '{}'::jsonb, now(), 'local Paystack test-mode stack (scripts/local-paystack-e2e.sh): mirrors the 2026-10-21 prices'
  from public.catalog_items ci join wanted w on w.code = ci.code
 where not exists (select 1 from public.prices p where p.catalog_item_id = ci.id and p.valid_to is null
                     and tstzrange(p.valid_from, coalesce(p.valid_to, 'infinity')) @> now())
    or ci.id in (select catalog_item_id from closed);

-- a 10% test discount code so the quoting path can be exercised (a fresh reset has none)
insert into public.discount_codes (organisation_id, code, kind, percent, item_codes, max_total_uses, max_uses_per_person, valid_from, valid_to, status, note, is_test)
select '00000000-0000-0000-0000-000000000001', 'LOCALTEST10', 'percent', 10,
       array['membership_annual', 'membership_annual_no_panel', 'membership_upgrade_plus'], 1000, 100, now(), now() + interval '1 year', 'active',
       'local Paystack test-mode stack (scripts/local-paystack-e2e.sh)', true
 where not exists (select 1 from public.discount_codes where code = 'LOCALTEST10');
commit;
SQL
echo "catalogue active, prices: $(sql -c "select string_agg(ci.code||'='||p.amount_kobo/100, ' ' order by ci.code) from public.prices p join public.catalog_items ci on ci.id = p.catalog_item_id where p.valid_to is null and ci.code like 'membership%'")"

# ---------- 3. test patient + test doctor through the admin auth API ----------
say "3/5 Creating the test patient and test doctor"
admin_user() { # email full_name -> user id (creates, or finds an existing one)
  local email="$1" name="$2" resp id
  resp="$(curl -sS -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
    -d "$(jq -cn --arg e "$email" --arg p "$TEST_PASSWORD" --arg n "$name" \
          '{email:$e, password:$p, email_confirm:true, user_metadata:{full_name:$n}, app_metadata:{signup_exempt:"true"}}')")"
  id="$(printf '%s' "$resp" | jq -r '.id // empty')"
  if [ -z "$id" ]; then
    id="$(sql -c "select id from auth.users where email = '$email'")"
    [ -n "$id" ] || die "could not create $email: $resp"
    echo "  $email already exists ($id)" >&2
  else
    echo "  created $email ($id)" >&2
  fi
  # the profiles row is provisioned by a trigger on auth.users; wait for it
  local i; for i in $(seq 1 20); do
    [ -n "$(sql -c "select 1 from public.profiles where id = '$id'")" ] && break
    sleep 0.5
  done
  [ -n "$(sql -c "select 1 from public.profiles where id = '$id'")" ] || die "profiles row for $email never appeared"
  printf '%s' "$id"
}
PATIENT_ID="$(admin_user "$PATIENT_EMAIL" "Local Paystack Patient")"
DOCTOR_ID="$(admin_user "$DOCTOR_EMAIL" "Local Test Doctor")"

sql -v patient="$PATIENT_ID" -v doctor="$DOCTOR_ID" -v org="$ORG_ID" <<'SQL'
set session_replication_role = replica;
begin;
update public.profiles
   set role = 'patient', organisation_id = :'org', is_test = true, is_active = true,
       onboarding_completed_at = coalesce(onboarding_completed_at, now()),
       date_of_birth = coalesce(date_of_birth, date '1985-05-05'), sex = coalesce(sex, 'female')
 where id = :'patient';
update public.profiles
   set role = 'clinician', organisation_id = :'org', is_test = true, is_active = true,
       onboarding_completed_at = coalesce(onboarding_completed_at, now())
 where id = :'doctor';

-- senior doctor, employed, credentialing level 2, indemnity exempt BY ANOTHER profile (self-exemption is a CHECK)
insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
    license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
select :'org', :'doctor', 'Local Test Doctor', 'MDCN', 'LOCAL-PAYSTACK-1', true, 'active',
       now(), :'patient', 'senior_medical_officer', 'employed', 2, true, :'patient', true
 where not exists (select 1 from public.clinical_staff where profile_id = :'doctor');

-- the competencies private.lead_candidates demands (lead_rule('required_competencies')), else create_order raises no_capacity
insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
select :'org', cs.id, k, :'patient', true
  from public.clinical_staff cs, unnest(array['lead_clinician', 'hypertension']) k
 where cs.profile_id = :'doctor'
   and not exists (select 1 from public.clinician_competencies c where c.clinical_staff_id = cs.id and c.competency_code = k and c.revoked_at is null);

-- the two checkout guards and the two checkout modules, attributed to the test patient
update public.go_live_guards
   set is_on = true, held_reason = null, changed_at = now(), changed_by = :'patient',
       change_note = 'local throwaway stack: Paystack test-mode round trip (scripts/local-paystack-e2e.sh)'
 where key in ('checkout_enabled', 'membership_billing_enabled') and not is_on;
update public.platform_modules
   set is_enabled = true, enabled_at = now(), enabled_by = :'patient',
       activation_note = 'local throwaway stack: Paystack test-mode round trip (scripts/local-paystack-e2e.sh)'
 where key in ('v5_checkout', 'membership_two_member_tiers') and not is_enabled;
commit;
SQL

GUARDS="$(sql -c "select string_agg(key||'='||is_on, ' ') from public.go_live_guards where key in ('checkout_enabled','membership_billing_enabled')")"
MODULES="$(sql -c "select string_agg(key||'='||is_enabled, ' ') from public.platform_modules where key in ('v5_checkout','membership_two_member_tiers')")"
CANDIDATES="$(sql -c "select count(*) from private.lead_candidates('$PATIENT_ID')")"
echo "  guards: $GUARDS"
echo "  modules: $MODULES"
echo "  lead candidates for the patient: $CANDIDATES"
[ "$CANDIDATES" -ge 1 ] || die "private.lead_candidates returns nothing for the patient; create_order would raise no_capacity"

# ---------- 4. edge functions + app ----------
say "4/5 Starting the edge functions and the app"
mkdir -p "$STATE_DIR"
if [ -f "$STATE_DIR/functions.pid" ] || [ -f "$STATE_DIR/next.pid" ]; then
  echo "  a previous run left pid files; stopping it first"; teardown
fi
ENV_FILE="$STATE_DIR/functions.env"
umask 077
# SUPABASE_URL / keys are deliberately absent: the CLI injects the local stack's own.
# PAYSTACK_WEBHOOK_SECRET is the same key: the webhook function fails closed without it.
cat > "$ENV_FILE" <<ENV
PAYSTACK_SECRET_KEY=$PAYSTACK_SECRET_KEY
PAYSTACK_WEBHOOK_SECRET=$PAYSTACK_SECRET_KEY
ORDER_RETURN_URL=$APP_URL/patient/membership/paid
PROCESS_EVENTS_SECRET=$(openssl rand -hex 24)
ORDER_RECONCILE_SECRET=$(openssl rand -hex 24)
ENV
chmod 600 "$ENV_FILE"
umask 022
PROCESS_EVENTS_SECRET="$(sed -n 's/^PROCESS_EVENTS_SECRET=//p' "$ENV_FILE")"
ORDER_RECONCILE_SECRET="$(sed -n 's/^ORDER_RECONCILE_SECRET=//p' "$ENV_FILE")"

# exec inside the subshell so the recorded pid is the server itself, and redirect the subshell too so a caller that pipes this
# script (… | tee) gets EOF when the script ends rather than waiting on the servers' inherited stdout
(cd "$ROOT" && exec supabase functions serve --env-file "$ENV_FILE" --no-verify-jwt) >"$STATE_DIR/functions.log" 2>&1 < /dev/null &
echo $! > "$STATE_DIR/functions.pid"

(cd "$ROOT/apps/web" && \
 NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
 NEXT_PUBLIC_SITE_URL="$APP_URL" PAYSTACK_SECRET_KEY="$PAYSTACK_SECRET_KEY" PAYSTACK_WEBHOOK_SECRET="$PAYSTACK_SECRET_KEY" \
 exec pnpm exec next dev -p "$APP_PORT") >"$STATE_DIR/next.log" 2>&1 < /dev/null &
echo $! > "$STATE_DIR/next.pid"

echo -n "  waiting for the functions"
for i in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/functions/v1/order-reconcile" -H "x-order-reconcile-secret: wrong")"
  case "$code" in 2*|4*) break ;; esac
  sleep 1; echo -n .
done; echo
echo -n "  waiting for the app on $APP_URL"
for i in $(seq 1 120); do
  case "$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/login")" in 2*|3*) break ;; esac
  sleep 1; echo -n .
done; echo
case "$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/login")" in 2*|3*) ;; *)
  echo "  the app has not answered yet; tail $STATE_DIR/next.log (a Next 16 dev lock held by another worktree's dev server is the usual cause)" ;;
esac

# ---------- 5. hand-over ----------
say "5/5 Ready"
cat <<OUT
Sign in:        $APP_URL/login
  email         $PATIENT_EMAIL
  password      $TEST_PASSWORD
  (doctor: $DOCTOR_EMAIL, same password)
Membership:     $APP_URL/patient/membership  -> discount code LOCALTEST10 (10%, seeded here), Pay, choose "Success" on Paystack's test page
Check locally:  psql "$DB_URL" -c "select state, amount_kobo, created_at from public.orders order by created_at desc limit 3"
                psql "$DB_URL" -c "select state, tier, starts_at, ends_at from public.patient_memberships order by created_at desc limit 3"

Assign the lead clinician (the process-events queue, not a trigger):
  curl -sS -X POST $API_URL/functions/v1/process-events -H "x-process-events-secret: $PROCESS_EVENTS_SECRET"
Close a declined attempt and release its discount code (every 5 min live):
  curl -sS -X POST $API_URL/functions/v1/order-reconcile -H "x-order-reconcile-secret: $ORDER_RECONCILE_SECRET"

Logs:           $STATE_DIR/functions.log  $STATE_DIR/next.log
Stop:           scripts/local-paystack-e2e.sh --teardown
OUT
