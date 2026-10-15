#!/usr/bin/env bash
# ============================================================================
# S10x: real two-connection contention on the event bus claim (closes the gap recorded in the S10 note: the S10 lease proof is
# sequential, one psql session cannot race itself).
#
# Two real database sessions call public.claim_event_deliveries at overlapping moments. Session A claims inside a transaction it
# keeps open for 3 seconds; session B starts one second later and claims while A's rows are locked.
#
# WHAT IT PROVES
#  1. FOR UPDATE SKIP LOCKED: 30 pending deliveries, A takes 20 and holds them, B takes the other 10 WITHOUT WAITING (B finishes
#     while A is still open), no delivery is handed to both, and the union is all 30.
#  2. Ordering under contention (event type opted in to ordering): 10 patient/aggregate chains of 3 events, both sessions claim at
#     once. Exactly the 10 chain heads are claimed, none twice, and no chain has two deliveries in flight.
#  3. SABOTAGE (control): a picker with FOR UPDATE but no SKIP LOCKED, run through the same harness, must BLOCK until A commits.
#     If it does not, the harness is not producing real contention and checks 1 and 2 prove nothing, so the script fails as VACUOUS.
#
# SAFETY. It commits fixtures (event types, subscribers, events prefixed s10x.cont) and removes them with an EXIT trap, using
# session_replication_role = replica because events are append only. It refuses to run unless $DATABASE_URL looks local.
# ============================================================================
set -uo pipefail

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ALLOW_REMOTE_PHRASE="yes-i-know-this-is-disposable"
if [[ "$DB_URL" != *"127.0.0.1"* && "$DB_URL" != *"localhost"* && "$DB_URL" != *"host=/"* \
      && "${S10X_ALLOW_REMOTE:-}" != "$ALLOW_REMOTE_PHRASE" ]]; then
  echo "s10x_bus_contention: refusing to run -- \$DATABASE_URL does not look local." >&2
  echo "Got: $DB_URL" >&2
  echo "This proof commits fixtures. If this really is a throwaway stack, set S10X_ALLOW_REMOTE=$ALLOW_REMOTE_PHRASE." >&2
  exit 1
fi

WORK="$(mktemp -d)"
TAG="$$-$(date +%s)"
psql_q() { psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }

cleanup() {
  psql_q <<'SQL' >/dev/null 2>&1
set session_replication_role = replica;   -- local, disposable database: events are append only, so delete without their triggers
drop function if exists public.s10x_claim_naive();
delete from public.domain_event_delivery_attempts where subscriber_key like 's10x.cont%';
delete from public.event_effects where delivery_id in (select id from public.domain_event_deliveries where subscriber_key like 's10x.cont%');
delete from public.domain_event_deliveries where subscriber_key like 's10x.cont%';
delete from public.domain_events where event_type like 's10x.contention%';
delete from public.event_subscribers where subscriber_key like 's10x.cont%';
delete from public.event_type_versions where event_type like 's10x.contention%';
delete from public.event_types where event_type like 's10x.contention%';
SQL
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() { echo "FAIL | $1" >&2; exit 1; }
PASS_LINES=()
pass() { PASS_LINES+=("PASS | $1"); }

# --- fixtures (committed) -----------------------------------------------------------------------------------------
psql_q <<SQL || fail "could not create fixtures"
do \$\$
declare v_org uuid; i integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into public.event_types (event_type, description, ordered) values
    ('s10x.contention', 'S10x contention proof', false), ('s10x.contention_ord', 'S10x contention proof', true);
  insert into public.event_type_versions (event_type, version, required_keys) values
    ('s10x.contention', 1, array['thing_id']), ('s10x.contention_ord', 1, array['thing_id']);
  insert into public.event_subscribers (subscriber_key, event_type, handler_key) values
    ('s10x.cont', 's10x.contention', 'bus.noop'), ('s10x.cont_ord', 's10x.contention_ord', 'bus.noop');
  for i in 1..30 loop
    perform public.emit_domain_event('s10x.contention', v_org, jsonb_build_object('thing_id', i::text), 'cc-$TAG-' || i);
  end loop;
end \$\$;
SQL
pending=$(psql_q -c "select count(*) from public.domain_event_deliveries where subscriber_key in ('s10x.cont') and status = 'pending'")
[[ "$pending" -eq 30 ]] || fail "fixture: expected 30 pending deliveries, got $pending"

# One round: session A claims inside a transaction it holds open for 3 s, session B starts 1 s later.
#   $1 = SQL fragment B runs (must print one id per row), $2 = SQL fragment A runs
round() {
  local a_sql=$1 b_sql=$2
  rm -f "$WORK"/A.* "$WORK"/B.*
  {
    printf "begin;\n"
    printf "select 'A_claim|' || x from (%s) q(x);\n" "$a_sql"
    printf "select pg_sleep(3);\n"
    printf "select 'A_end|' || extract(epoch from clock_timestamp());\n"
    printf "commit;\n"
  } > "$WORK/A.sql"
  {
    printf "select 'B_claim|' || x from (%s) q(x);\n" "$b_sql"
    printf "select 'B_end|' || extract(epoch from clock_timestamp());\n"
  } > "$WORK/B.sql"
  psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -f "$WORK/A.sql" > "$WORK/A.out" 2>&1 &
  local pa=$!
  sleep 1
  psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -f "$WORK/B.sql" > "$WORK/B.out" 2>&1 &
  local pb=$!
  wait "$pa" || fail "session A errored: $(cat "$WORK/A.out")"
  wait "$pb" || fail "session B errored: $(cat "$WORK/B.out")"
  grep '^A_claim|' "$WORK/A.out" | cut -d'|' -f2 | sort > "$WORK/A.ids"
  grep '^B_claim|' "$WORK/B.out" | cut -d'|' -f2 | sort > "$WORK/B.ids"
  A_END=$(grep '^A_end|' "$WORK/A.out" | cut -d'|' -f2)
  B_END=$(grep '^B_end|' "$WORK/B.out" | cut -d'|' -f2)
  [[ -n "$A_END" && -n "$B_END" ]] || fail "a session produced no end time (A: $(cat "$WORK/A.out") B: $(cat "$WORK/B.out"))"
}

# --- 1. SKIP LOCKED: A holds 20, B takes the other 10 without waiting ------------------------------------------------
CLAIM="select delivery_id::text from public.claim_event_deliveries(20, false) where subscriber_key in ('s10x.cont')"
round "$CLAIM" "$CLAIM"
na=$(wc -l < "$WORK/A.ids" | tr -d ' '); nb=$(wc -l < "$WORK/B.ids" | tr -d ' ')
overlap=$(comm -12 "$WORK/A.ids" "$WORK/B.ids" | wc -l | tr -d ' ')
[[ "$na" -eq 20 ]] || fail "round 1: session A expected 20 claims, got $na"
[[ "$nb" -eq 10 ]] || fail "round 1: session B expected the other 10, got $nb"
[[ "$overlap" -eq 0 ]] || fail "round 1: $overlap deliveries were handed to both sessions"
processing=$(psql_q -c "select count(*) from public.domain_event_deliveries where subscriber_key in ('s10x.cont') and status = 'processing'")
[[ "$processing" -eq 30 ]] || fail "round 1: database shows $processing processing, expected 30"
if ! awk -v a="$A_END" -v b="$B_END" 'BEGIN { exit !(b < a - 0.5) }'; then
  fail "round 1: session B was not finished before A committed (A_end=$A_END B_end=$B_END), so it waited on A's locks"
fi
pass "SKIP LOCKED: A took 20 and held them, B took the other 10 while A was still open, 0 handed to both, 30 in flight"

# --- 2. ordering under contention ----------------------------------------------------------------------------------------
# The ordered chains are created only now: claim_event_deliveries claims across every subscriber, so creating them earlier would let
# round 1's second session pick up chain heads too and leave nothing for this round.
psql_q <<SQL || fail "could not create the ordered fixtures"
do \$\$
declare v_org uuid; i integer; c integer; v_agg uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  for c in 1..10 loop
    v_agg := gen_random_uuid();
    for i in 1..3 loop
      perform public.emit_domain_event('s10x.contention_ord', v_org, jsonb_build_object('thing_id', c || '-' || i), 'cco-$TAG-' || c || '-' || i,
        null, 'thing', v_agg, 'normal', null, null, now() - make_interval(secs => (4 - i) * 10));
    end loop;
  end loop;
end \$\$;
SQL
ORD="select delivery_id::text from public.claim_event_deliveries(50, false) where subscriber_key in ('s10x.cont_ord')"
round "$ORD" "$ORD"
cat "$WORK/A.ids" "$WORK/B.ids" | sort > "$WORK/all.ids"
total=$(wc -l < "$WORK/all.ids" | tr -d ' ')
distinct=$(sort -u "$WORK/all.ids" | wc -l | tr -d ' ')
[[ "$total" -eq 10 && "$distinct" -eq 10 ]] || fail "ordered round: expected 10 distinct chain heads, got $total claims / $distinct distinct"
heads=$(psql_q -c "select count(*) from public.domain_event_deliveries d join public.domain_events e on e.id = d.event_id
                    where d.subscriber_key in ('s10x.cont_ord') and d.status = 'processing' and e.payload ->> 'thing_id' like '%-1'")
[[ "$heads" -eq 10 ]] || fail "ordered round: the in-flight deliveries are not the 10 chain heads (got $heads)"
dupchain=$(psql_q -c "select count(*) from (select e.aggregate_id from public.domain_event_deliveries d join public.domain_events e on e.id = d.event_id
                       where d.subscriber_key in ('s10x.cont_ord') and d.status = 'processing' group by 1 having count(*) > 1) x")
[[ "$dupchain" -eq 0 ]] || fail "ordered round: $dupchain chains have two deliveries in flight"
pass "ordering under contention: exactly the 10 chain heads in flight, none twice, no chain with two in flight"

# --- 3. SABOTAGE control: no SKIP LOCKED must block until A commits ------------------------------------------------------
psql_q <<'SQL' || fail "could not create the naive picker"
create or replace function public.s10x_claim_naive() returns setof text language sql security definer set search_path = '' as $$
  select id::text from (
    select d.id from public.domain_event_deliveries d
     where d.subscriber_key in ('s10x.cont') and d.status = 'pending' order by d.created_at limit 5 for update   -- no SKIP LOCKED
  ) q;
$$;
SQL
psql_q <<SQL || fail "could not create control fixtures"
do \$\$ declare v_org uuid; i integer; begin
  select id into v_org from public.organisations order by created_at limit 1;
  for i in 1..10 loop
    perform public.emit_domain_event('s10x.contention', v_org, jsonb_build_object('thing_id', 'n' || i), 'ccn-$TAG-' || i);
  end loop;
end \$\$;
SQL
round "$CLAIM" "select public.s10x_claim_naive()"
if awk -v a="$A_END" -v b="$B_END" 'BEGIN { exit !(b < a - 0.5) }'; then
  fail "VACUOUS: a lock-without-SKIP-LOCKED picker finished while A still held its rows, so this harness does not create real contention"
fi
pass "control: a picker without SKIP LOCKED waited for A's commit (B_end >= A_end - 0.5), so the contention is real"

printf '%s\n' "${PASS_LINES[@]}"
