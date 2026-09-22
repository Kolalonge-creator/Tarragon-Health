#!/usr/bin/env bash
# ============================================================================
# Verification: 20260922183130_care_voucher_cancellation_reversal_race
#
# WHY THIS IS A .sh PROOF, NOT A .sql ONE (see scripts/run-db-proofs.sh's own
# header, and packages/db/tests/finance_reversal_concurrent_lock.sh's, which
# this follows closely). The bug this migration fixes is specifically a race
# between TWO overlapping transactions: an independent external reversal of a
# payment's journal entry (a finance officer reversing it for an unrelated
# reason, or an approved journal_reversal request against it) racing against
# public.cancel_care_voucher for the voucher that same payment backs. One
# psql session cannot hold a row lock against itself to prove a second,
# independent session actually blocks on it, so this launches real,
# concurrent psql connections against $DATABASE_URL.
#
# WHAT IT PROVES:
#  1. FIXED: an external public.finance_reverse_journal reversal of a
#     voucher's payment entry, racing against public.cancel_care_voucher for
#     that same voucher, blocks the cancellation's entry lookup (proving real
#     concurrency via wall-clock elapsed >= 1s) and then completes the
#     cancellation cleanly -- voucher cancelled, refund queued, no error --
#     rather than raising 'entry already reversed' and aborting the whole
#     cancellation.
#  2. SABOTAGE: temporarily redeploying cancel_care_voucher's exact pre-fix
#     body (20260830103626 -- a plain, unlocked select of the target entry)
#     against a fresh voucher/entry reopens the race: the challenger's whole
#     transaction aborts with 'entry already reversed', the voucher is left
#     NOT cancelled, and nothing was queued for refund -- proving check 1 was
#     discriminating on the fix, not on scheduling luck.
#
# SAFETY. The sabotage phase temporarily deploys a KNOWN-BROKEN, pre-fix body
# of the function that cancels a voucher and queues real refunds. That is
# only acceptable against a throwaway/local stack, so this script refuses to
# run at all unless $DATABASE_URL looks local -- same two-layer guard as
# finance_reversal_concurrent_lock.sh (a cheap substring filter, then an
# authoritative inet_server_addr() check), for the same reasons: a URL can
# look local while a password, a multi-host conninfo, or a PGHOSTADDR
# override makes it connect somewhere real.
#
# Fixtures (an org-scoped admin actor per role, a prepaid_service voucher
# with one applied payment and its real finance_journal_entries row) are
# built by this script itself, not borrowed from any existing tenant data --
# it runs against a fresh `supabase db reset` and is registered in
# ci.manifest, not ci.excluded.
# ============================================================================
set -uo pipefail

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION_FILE="$SELF_DIR/../../../supabase/migrations/20260922183130_care_voucher_cancellation_reversal_race.sql"

ALLOW_REMOTE_PHRASE="yes-i-know-this-is-disposable"
if [[ "$DB_URL" != *"127.0.0.1"* && "$DB_URL" != *"localhost"* && "$DB_URL" != *"host=/"* \
      && "${CVCCR_ALLOW_REMOTE:-}" != "$ALLOW_REMOTE_PHRASE" ]]; then
  echo "care_voucher_cancellation_concurrent_reversal: refusing to run -- \$DATABASE_URL does not look local." >&2
  echo "This proof's sabotage phase temporarily deploys a pre-fix, race-prone cancel_care_voucher body." >&2
  echo "Got: $DB_URL" >&2
  echo "If this really is a throwaway/local stack, re-run with CVCCR_ALLOW_REMOTE=$ALLOW_REMOTE_PHRASE." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is not installed; cannot run this proof." >&2
  exit 1
fi
if [[ ! -f "$MIGRATION_FILE" ]]; then
  echo "care_voucher_cancellation_concurrent_reversal: expected migration file not found at $MIGRATION_FILE" >&2
  exit 1
fi

SERVER_LOCALITY="$(psql "$DB_URL" -X -q -t -A -c \
  "select case when inet_server_addr() is null then 'local' \
               when inet_server_addr() <<= '127.0.0.0/8'::inet then 'local' \
               when inet_server_addr() = '::1'::inet then 'local' \
               else 'remote' end;" 2>&1)"
if [[ "$SERVER_LOCALITY" != "local" && "${CVCCR_ALLOW_REMOTE:-}" != "$ALLOW_REMOTE_PHRASE" ]]; then
  echo "care_voucher_cancellation_concurrent_reversal: refusing to run -- the server itself does not report a local address." >&2
  echo "inet_server_addr() check returned: $SERVER_LOCALITY" >&2
  echo "If this really is a throwaway/local stack, re-run with CVCCR_ALLOW_REMOTE=$ALLOW_REMOTE_PHRASE." >&2
  exit 1
fi

PSQL_SETUP=(psql "$DB_URL" -X -q -v ON_ERROR_STOP=1)
PSQL_READ=(psql "$DB_URL" -X -q -t -A)

WORK="$(mktemp -d)"

FAIL_COUNT=0
RESULTS=()
record() { # name observed expected
  local name="$1" observed="$2" expected="$3" verdict="FAIL"
  [[ "$observed" == "$expected" ]] && verdict="PASS"
  [[ "$verdict" == "FAIL" ]] && FAIL_COUNT=$((FAIL_COUNT + 1))
  RESULTS+=("$name | observed=$observed | expected=$expected | $verdict")
}

# Re-applies the migration file verbatim to restore the fixed function body.
# Every statement in it is idempotent (CREATE OR REPLACE FUNCTION; the DO
# block only asserts). -1/--single-transaction so a mid-restore failure can
# never leave the pre-fix body deployed with the transaction half-applied.
restore_fixed_function() {
  local out
  if ! out="$("${PSQL_SETUP[@]}" -1 -f "$MIGRATION_FILE" 2>&1)"; then
    echo "CRITICAL: restore_fixed_function failed -- the pre-fix (vulnerable) cancel_care_voucher body may still be deployed on \$DATABASE_URL." >&2
    echo "$out" >&2
    return 1
  fi
  return 0
}

ORG_ID=""
ACTORS_CREATED=0
SABOTAGE_DEPLOYED=0
VOUCHERS_CREATED=()

cleanup() {
  local ec=$?
  if [[ ${#RESULTS[@]} -gt 0 ]]; then
    printf '%s\n' "${RESULTS[@]}"
    echo
    if [[ $FAIL_COUNT -gt 0 ]]; then
      echo "care_voucher_cancellation_concurrent_reversal: $FAIL_COUNT check(s) FAILED"
    else
      echo "care_voucher_cancellation_concurrent_reversal: all checks passed"
    fi
  fi
  if [[ $SABOTAGE_DEPLOYED -eq 1 ]]; then
    restore_fixed_function || ec=1
  fi
  if [[ ${#VOUCHERS_CREATED[@]} -gt 0 ]]; then
    local vids
    vids="$(printf "'%s'," "${VOUCHERS_CREATED[@]}")"
    vids="${vids%,}"
    # Order matters for FKs: voucher_refund_queue -> care_voucher_payments is
    # ON DELETE RESTRICT (must go first); the original + contra
    # finance_journal_entries are unrelated to care_vouchers by FK at all
    # (must be deleted explicitly, reversal_of is ON DELETE SET NULL not
    # CASCADE); care_vouchers cascades to care_voucher_payments and
    # care_voucher_events; payment_transactions must go last, since
    # care_voucher_payments (just cascaded away) referenced it with no
    # cascade of its own.
    local out
    if ! out="$("${PSQL_SETUP[@]}" <<SQL
delete from public.voucher_refund_queue where voucher_id in ($vids);
with targets as (
  select id from public.payment_transactions
  where organisation_id = '$ORG_ID' and provider_event_id like 'cvccr-%'
),
originals as (
  select e.id from public.finance_journal_entries e, targets t
  where e.source = 'payment' and e.source_ref = t.id::text
)
delete from public.finance_journal_entries
where id in (select id from originals) or reversal_of in (select id from originals);
delete from public.care_vouchers where id in ($vids);
delete from public.payment_transactions
where organisation_id = '$ORG_ID' and provider_event_id like 'cvccr-%';
SQL
    )"; then
      echo "CRITICAL: fixture cleanup (vouchers/payments/journal entries) failed -- residue may remain on \$DATABASE_URL." >&2
      echo "$out" >&2
      ec=1
    fi
  fi
  if [[ $ACTORS_CREATED -eq 1 ]]; then
    local out
    if ! out="$("${PSQL_SETUP[@]}" \
      -v officer="$OFFICER" -v canceller="$CANCELLER" -v beneficiary="$BENEFICIARY" 2>&1 <<'SQL'
delete from public.finance_journal_entries where created_by in (:'officer'::uuid, :'canceller'::uuid);
delete from public.profiles where id in (:'officer'::uuid, :'canceller'::uuid, :'beneficiary'::uuid);
delete from auth.users where id in (:'officer'::uuid, :'canceller'::uuid, :'beneficiary'::uuid);
SQL
    )"; then
      echo "CRITICAL: fixture actor cleanup failed -- test actors and/or journal entries may remain on \$DATABASE_URL." >&2
      echo "$out" >&2
      ec=1
    fi
  fi
  rm -rf "$WORK"
  exit "$ec"
}
trap cleanup EXIT

# ============================================================================
# 0. FIXTURES -- an organisation-scoped admin actor per role. A finance
#    officer doing an UNRELATED reversal, and an admin cancelling the
#    voucher, are deliberately different profiles: the scenario this proves
#    is a race against someone ELSE's reversal, not a second cancel attempt
#    on the same voucher (which this function's own top-level `select ...
#    for update` on care_vouchers already fully serialises -- see the
#    migration header).
# ============================================================================
ORG_ID="$("${PSQL_READ[@]}" -c "select id from public.organisations limit 1;")"
if [[ -z "$ORG_ID" ]]; then
  echo "no organisation available -- cannot run this test" >&2
  exit 1
fi
BUNDLE_ID="$("${PSQL_READ[@]}" -c "select id from public.panel_bundles limit 1;")"
if [[ -z "$BUNDLE_ID" ]]; then
  echo "no panel_bundles row available -- cannot run this test" >&2
  exit 1
fi

GENERATED=()
while IFS= read -r line; do
  GENERATED+=("$line")
done < <("${PSQL_READ[@]}" -c "select gen_random_uuid() from generate_series(1,3);")
OFFICER="${GENERATED[0]}"; CANCELLER="${GENERATED[1]}"; BENEFICIARY="${GENERATED[2]}"

"${PSQL_SETUP[@]}" \
  -v org="$ORG_ID" -v officer="$OFFICER" -v canceller="$CANCELLER" -v beneficiary="$BENEFICIARY" <<'SQL'
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  (:'officer'::uuid,     'cvccr-officer@example.invalid',     'x', now(), '{}', '{}'),
  (:'canceller'::uuid,   'cvccr-canceller@example.invalid',   'x', now(), '{}', '{}'),
  (:'beneficiary'::uuid, 'cvccr-beneficiary@example.invalid', 'x', now(), '{}', '{}')
on conflict (id) do nothing;

insert into public.profiles (id, organisation_id, role, full_name)
values
  (:'officer'::uuid,     :'org'::uuid, 'admin',   'CVCCR Officer'),
  (:'canceller'::uuid,   :'org'::uuid, 'admin',   'CVCCR Canceller'),
  (:'beneficiary'::uuid, :'org'::uuid, 'patient', 'CVCCR Beneficiary')
on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
SQL
if [[ $? -ne 0 ]]; then echo "fixture actor setup failed" >&2; exit 1; fi
ACTORS_CREATED=1

# make_voucher amount_minor -> prints "voucher_id|entry_id"
# Builds a real prepaid_service voucher with exactly one applied payment and
# the finance_journal_entries row finance_post_from_payment would really
# have posted for it (source='payment', source_ref=payment_transaction_id),
# by direct INSERT rather than the purchase_care_voucher() flow -- this
# proof only needs the shape cancel_care_voucher itself reads/writes, not
# the pricing/checkout path.
make_voucher() {
  local amount="$1"
  local evt="cvccr-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  "${PSQL_SETUP[@]}" -v org="$ORG_ID" -v bundle="$BUNDLE_ID" -v beneficiary="$BENEFICIARY" \
    -v amount="$amount" -v evt="$evt" -v officer="$OFFICER" -F'|' -t -A <<'SQL'
with txn as (
  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload, processed_at)
  values (:'org'::uuid, 'paystack', :'evt', 'charge.success', :amount::bigint, 'NGN', '{}'::jsonb, now())
  returning id
),
v as (
  insert into public.care_vouchers
    (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id,
     panel_bundle_id, sku_code, face_value_kobo, amount_paid_kobo, status, activated_at)
  values (:'org'::uuid, :'evt', 'prepaid_service', :'beneficiary'::uuid, :'beneficiary'::uuid,
     :'bundle'::uuid, 'CVCCR-FIXTURE', :amount::bigint, :amount::bigint, 'active', now())
  returning id
),
cvp as (
  insert into public.care_voucher_payments
    (organisation_id, voucher_id, payer_profile_id, amount_minor, currency, instalment_kobo, provider, pending_provider_ref, status, payment_transaction_id)
  select :'org'::uuid, v.id, :'beneficiary'::uuid, :amount::bigint, 'NGN', :amount::bigint, 'paystack', :'evt', 'applied', txn.id
  from v, txn
  returning voucher_id
),
je as (
  select private.finance_post_journal(current_date, 'NGN'::public.currency, 'payment', txn.id::text, 'CVCCR fixture payment',
    jsonb_build_array(
      jsonb_build_object('account_code', '1020', 'debit_minor', :amount::bigint, 'credit_minor', 0, 'organisation_id', :'org'::uuid),
      jsonb_build_object('account_code', '2100', 'debit_minor', 0, 'credit_minor', :amount::bigint, 'organisation_id', :'org'::uuid)
    ), :'officer'::uuid) as entry_id
  from txn
)
select v.id, je.entry_id from v, je;
SQL
}

# ============================================================================
# Templates for the two concurrent sessions.
# HOLD: the external, unrelated reversal of the voucher's payment entry.
# CHALLENGE: the voucher cancellation, racing against it.
# ============================================================================
cat > "$WORK/hold.sql" <<'SQL'
begin;
set local lock_timeout = '15s';
select set_config('request.jwt.claims', json_build_object('sub', :'actor', 'role', 'authenticated')::text, true);
select public.finance_reverse_journal(:'entry'::uuid, 'cvccr concurrent lock test - external officer reversal');
select pg_sleep(2);
commit;
SQL
cat > "$WORK/challenge.sql" <<'SQL'
begin;
set local lock_timeout = '15s';
select set_config('request.jwt.claims', json_build_object('sub', :'actor', 'role', 'authenticated')::text, true);
select public.cancel_care_voucher(:'voucher'::uuid, 'cvccr concurrent lock test - voucher cancellation');
commit;
SQL

# race tag entry voucher -> sets RC_HOLD RC_CHALLENGE CHALLENGER_ELAPSED, writes $WORK/<tag>_{hold,challenge}.log
race() {
  local tag="$1" entry="$2" voucher="$3"
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v actor="$OFFICER" -v entry="$entry" \
    -f "$WORK/hold.sql" > "$WORK/${tag}_hold.log" 2>&1 &
  local pid_hold=$!
  sleep 0.5
  SECONDS=0
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v actor="$CANCELLER" -v voucher="$voucher" \
    -f "$WORK/challenge.sql" > "$WORK/${tag}_challenge.log" 2>&1 &
  local pid_challenge=$!
  wait "$pid_hold"; RC_HOLD=$?
  wait "$pid_challenge"; RC_CHALLENGE=$?
  CHALLENGER_ELAPSED=$SECONDS
}

voucher_state() { # voucher -> prints "status|contra_count|is_reversed|refund_queue_count"
  "${PSQL_READ[@]}" -v voucher="$1" -F'|' <<'SQL'
with orig as (
  select e.id, e.is_reversed
  from public.finance_journal_entries e
  join public.care_voucher_payments cvp
    on cvp.payment_transaction_id::text = e.source_ref and e.source = 'payment'
  where cvp.voucher_id = :'voucher'::uuid
)
select
  (select status from public.care_vouchers where id = :'voucher'::uuid),
  (select count(*) from public.finance_journal_entries where reversal_of in (select id from orig)),
  (select bool_and(is_reversed) from orig),
  (select count(*) from public.voucher_refund_queue where voucher_id = :'voucher'::uuid);
SQL
}

# ============================================================================
# 1. FIXED: an external reversal of a voucher's payment entry, racing
#    against cancel_care_voucher for that voucher -- the cancellation must
#    block, then complete cleanly (not raise).
# ============================================================================
IFS='|' read -r VOUCHER1 ENTRY1 <<<"$(make_voucher 500000)"
if [[ -z "$VOUCHER1" || -z "$ENTRY1" ]]; then echo "check 1 fixture: could not build voucher/entry" >&2; exit 1; fi
VOUCHERS_CREATED+=("$VOUCHER1")

race check1 "$ENTRY1" "$VOUCHER1"
IFS='|' read -r STATUS1 CONTRA1 REV1 REFQ1 <<<"$(voucher_state "$VOUCHER1")"

record "check1: external reversal (holder) succeeds" "$RC_HOLD" "0"
record "check1: cancellation (challenger) succeeds, does not abort" "$RC_CHALLENGE" "0"
record "check1: challenger was actually blocked by the lock (>=1s wall-clock)" "$([[ $CHALLENGER_ELAPSED -ge 1 ]] && echo yes || echo no)" "yes"
record "check1: voucher ends up cancelled despite the concurrent external reversal" "$STATUS1" "cancelled"
record "check1: exactly one refund still queued for the voucher" "$REFQ1" "1"
record "check1: the payment entry is reversed exactly once (by the external officer, not doubled)" "$REV1" "t"
record "check1: no second (duplicate) contra entry was posted against it" "$CONTRA1" "1"
record "check1: challenger's log carries no unhandled error" "$(grep -qi 'ERROR' "$WORK/check1_challenge.log" && echo has_error || echo clean)" "clean"
if [[ "$RC_CHALLENGE" != "0" || "$STATUS1" != "cancelled" || "$REFQ1" != "1" ]]; then
  echo "--- check 1 diagnostics --- (challenger elapsed ${CHALLENGER_ELAPSED}s)"
  echo "holder log:"; cat "$WORK/check1_hold.log"
  echo "challenger log:"; cat "$WORK/check1_challenge.log"
fi

# ============================================================================
# 2. SABOTAGE: redeploy cancel_care_voucher's exact pre-fix (20260830103626)
#    body -- a plain, unlocked select of the target entry -- and re-run the
#    same race against a fresh voucher/entry. The challenger's whole
#    transaction should now abort with 'entry already reversed', leaving the
#    voucher NOT cancelled and nothing queued.
# ============================================================================
"${PSQL_SETUP[@]}" <<'SQL'
-- Exact pre-fix (live 20260830103626, before 20260922183130) body -- no
-- FOR UPDATE on either target finance_journal_entries lookup.
create or replace function public.cancel_care_voucher(p_voucher uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $body$
declare
  v_caller uuid := auth.uid();
  v_v public.care_vouchers%rowtype;
  v_cvp record;
  v_refund_count int := 0;
  v_entry uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if not (private.is_admin() or private.has_permission('vouchers.manage')) then
    raise exception 'not authorised to cancel a voucher' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  select * into v_v from public.care_vouchers where id = p_voucher for update;
  if not found then raise exception 'voucher not found'; end if;
  if v_v.status = 'redeemed' then raise exception 'a used voucher cannot be cancelled'; end if;

  update public.care_vouchers
     set status = 'cancelled', cancelled_at = now(), cancelled_reason = trim(p_reason)
   where id = p_voucher;

  insert into public.care_voucher_events
    (organisation_id, voucher_id, event_type, actor_profile_id, amount_kobo, note)
  values (v_v.organisation_id, p_voucher, 'cancelled', v_caller, v_v.amount_paid_kobo, trim(p_reason));

  for v_cvp in
    select * from public.care_voucher_payments
    where voucher_id = p_voucher and status = 'applied' and pending_provider_ref is not null
  loop
    insert into public.voucher_refund_queue
      (voucher_id, care_voucher_payment_id, provider, provider_reference, amount_minor, currency)
    values
      (p_voucher, v_cvp.id, v_cvp.provider, v_cvp.pending_provider_ref, v_cvp.amount_minor, v_cvp.currency::public.currency)
    on conflict (care_voucher_payment_id) do nothing;
    v_refund_count := v_refund_count + 1;

    if v_cvp.payment_transaction_id is not null then
      select id into v_entry from public.finance_journal_entries
        where source = 'payment' and source_ref = v_cvp.payment_transaction_id::text and is_reversed = false;
      if v_entry is not null then
        perform private.finance_reverse_entry(v_entry, 'Care voucher cancelled: ' || trim(p_reason), v_caller);
      end if;
    end if;
  end loop;

  if v_v.kind = 'reward_discount' then
    select id into v_entry from public.finance_journal_entries
      where source = 'voucher' and source_ref = 'reward:' || p_voucher::text and is_reversed = false;
    if v_entry is not null then
      perform private.finance_reverse_entry(v_entry, 'Reward voucher cancelled: ' || trim(p_reason), v_caller);
    end if;
  end if;

  perform private.log_audit('care_vouchers.cancelled', 'care_vouchers', p_voucher,
    jsonb_build_object('reason', p_reason, 'amount_paid_kobo', v_v.amount_paid_kobo, 'refunds_queued', v_refund_count));

  return jsonb_build_object('ok', true, 'refunds_queued', v_refund_count);
end;
$body$;
SQL
if [[ $? -ne 0 ]]; then echo "sabotage setup failed" >&2; exit 1; fi
SABOTAGE_DEPLOYED=1

IFS='|' read -r VOUCHER2 ENTRY2 <<<"$(make_voucher 500000)"
if [[ -z "$VOUCHER2" || -z "$ENTRY2" ]]; then
  echo "sabotage fixture: could not build voucher/entry" >&2
  restore_fixed_function && SABOTAGE_DEPLOYED=0
  exit 1
fi
VOUCHERS_CREATED+=("$VOUCHER2")

race sabotage "$ENTRY2" "$VOUCHER2"
IFS='|' read -r STATUS2 CONTRA2 REV2 REFQ2 <<<"$(voucher_state "$VOUCHER2")"

# Restore immediately, success or failure of the assertions below.
if ! restore_fixed_function; then
  echo "ABORTING: cannot safely continue without confirming cancel_care_voucher is restored." >&2
  exit 1
fi
SABOTAGE_DEPLOYED=0

HAS_ALREADY_REVERSED_ERR="$(grep -qi 'entry already reversed' "$WORK/sabotage_challenge.log" && echo yes || echo no)"

record "SABOTAGE: the external reversal itself still succeeds" "$RC_HOLD" "0"
record "SABOTAGE: the pre-fix challenger's WHOLE transaction now aborts" "$([[ $RC_CHALLENGE -ne 0 ]] && echo aborted || echo succeeded)" "aborted"
record "SABOTAGE: challenger's error is the unhandled 'entry already reversed' raise" "$HAS_ALREADY_REVERSED_ERR" "yes"
record "SABOTAGE: the voucher is left NOT cancelled (whole transaction rolled back)" "$STATUS2" "active"
record "SABOTAGE: nothing was left queued for refund (rolled back)" "$REFQ2" "0"
record "SABOTAGE: challenger was still genuinely blocked before it aborted (>=1s wall-clock)" "$([[ $CHALLENGER_ELAPSED -ge 1 ]] && echo yes || echo no)" "yes"
if [[ "$RC_CHALLENGE" == "0" || "$HAS_ALREADY_REVERSED_ERR" != "yes" || "$STATUS2" != "active" || "$REFQ2" != "0" ]]; then
  echo "VACUOUS TEST WARNING: sabotaging cancel_care_voucher did not reproduce the expected unhandled abort -- check 1 may be passing for an unrelated reason." >&2
  echo "--- sabotage diagnostics --- (challenger elapsed ${CHALLENGER_ELAPSED}s)"
  echo "holder log:"; cat "$WORK/sabotage_hold.log"
  echo "challenger log:"; cat "$WORK/sabotage_challenge.log"
fi

# ============================================================================
[[ $FAIL_COUNT -gt 0 ]] && exit 1
exit 0
