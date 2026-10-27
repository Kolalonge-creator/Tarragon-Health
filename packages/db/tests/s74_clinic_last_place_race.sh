#!/usr/bin/env bash
# ============================================================================
# S74 proof: two (here, twenty) patients cannot both take the last place of a clinic slot, even when they ask at the same moment.
#
# WHY A .sh PROOF. patient_hold_clinic_slot locks the slot row (select ... for update) so the count of live places and the insert
# happen as one step. One psql session cannot race itself, so a BEGIN/ROLLBACK .sql proof cannot show that the lock works. This
# script commits its fixtures, starts 20 real sessions behind a start barrier (each sleeps to the same wall-clock instant), and checks.
#
# WHAT IT PROVES
#  1. Capacity 1, 20 patients asking together: exactly 1 hold is returned, 19 are refused with slot_full (22023) and no other error,
#     and exactly 1 live reservation exists (never 2).
#  2. Capacity 3, 20 patients: exactly 3 holds, 17 refused, 3 live reservations.
#  3. SABOTAGE (control): a deliberately lock-free copy of the hold, run through the same harness against a fresh capacity-1 slot,
#     must over-subscribe the slot. If it does not, the harness is not producing real contention and checks 1 and 2 prove nothing, so
#     the script fails as VACUOUS.
#
# SAFETY. It commits fixtures, switches the provider_org_platform module on while it runs and creates a test-only function, so it
# refuses to run unless $DATABASE_URL looks local (same guard and override phrase as s41_cohort_max_uses_concurrent.sh). An EXIT trap
# removes the fixtures and puts the module back as it found it.
# ============================================================================
set -uo pipefail

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ALLOW_REMOTE_PHRASE="yes-i-know-this-is-disposable"
if [[ "$DB_URL" != *"127.0.0.1"* && "$DB_URL" != *"localhost"* && "$DB_URL" != *"host=/"* \
      && "${S74_ALLOW_REMOTE:-}" != "$ALLOW_REMOTE_PHRASE" ]]; then
  echo "s74_clinic_last_place_race: refusing to run -- \$DATABASE_URL does not look local." >&2
  echo "Got: $DB_URL" >&2
  echo "This proof commits fixtures. If this really is a throwaway stack, set S74_ALLOW_REMOTE=$ALLOW_REMOTE_PHRASE." >&2
  exit 1
fi

N=20
WORK="$(mktemp -d)"
TAG="s74race$$x$(date +%s)"
psql_q() { psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }

if [[ "$(psql_q -c "select to_regprocedure('public.patient_hold_clinic_slot(uuid)') is not null")" != "t" ]]; then
  echo "SKIPPED | patient_hold_clinic_slot(uuid) does not exist on this database. Not a pass."
  rm -rf "$WORK"
  exit 0
fi

PRIOR_MODULE="$(psql_q -c "select is_enabled::text || '|' || coalesce(enabled_by::text, '') || '|' || coalesce(enabled_at::text, '') from public.platform_modules where key = 'provider_org_platform'")"

cleanup() {
  psql_q <<SQL >/dev/null 2>&1
set session_replication_role = replica;   -- local, disposable database: delete without guard triggers
drop function if exists public.s74_naive_hold(uuid);
delete from public.clinic_slot_reservations where slot_id in (select id from public.clinic_booking_slots where clinic_partner_id in (select id from public.provider_organisations where legal_name like '$TAG%'));
delete from public.clinic_booking_slots where clinic_partner_id in (select id from public.provider_organisations where legal_name like '$TAG%');
delete from public.provider_organisations where legal_name like '$TAG%';
delete from public.audit_log where actor_id in (select id from public.profiles where full_name like '$TAG%');
delete from auth.users where id in (select id from public.profiles where full_name like '$TAG%');
delete from public.profiles where full_name like '$TAG%';
delete from public.organisations where name like '$TAG%';
update public.platform_modules set is_enabled = false, enabled_at = null, enabled_by = null where key = 'provider_org_platform';
SQL
  if [[ "${PRIOR_MODULE%%|*}" == "true" ]]; then
    psql_q -c "update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = nullif(split_part('$PRIOR_MODULE', '|', 2), '')::uuid where key = 'provider_org_platform'" >/dev/null 2>&1
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() { echo "FAIL | $1" >&2; exit 1; }
PASS_LINES=()
pass() { PASS_LINES+=("PASS | $1"); }

# --- fixtures (committed) -----------------------------------------------------------------------------------------
psql_q <<SQL || fail "could not create fixtures"
do \$\$
declare v_org uuid; v_cl uuid := gen_random_uuid(); v_u uuid; v_adm uuid := gen_random_uuid(); i integer;
begin
  select id into v_org from public.organisations where type <> 'provider_org' order by created_at limit 1;
  insert into public.organisations (id, name, type) values (v_cl, '$TAG clinic', 'provider_org');
  insert into public.provider_organisations (organisation_id, org_type, legal_name, onboarding_status, is_operational, activated_at)
    values (v_cl, 'clinic', '$TAG clinic Ltd', 'active', true, now());
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_adm, '$TAG-adm@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
    values (v_adm, v_org, 'admin', '$TAG admin', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), date '1980-01-01', true)
  on conflict (id) do update set role = 'admin', full_name = excluded.full_name, is_active = true;
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_adm, activation_note = '$TAG' where key = 'provider_org_platform';
  for i in 1..$N loop
    v_u := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (v_u, '$TAG-pat-' || i || '@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
      values (v_u, v_org, 'patient', '$TAG pat ' || lpad(i::text, 2, '0'), '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), date '1980-01-01', true)
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name,
      phone = excluded.phone, is_test = true, is_active = true;
  end loop;
end \$\$;
-- the lock-free control: the real hold without its slot lock
create function public.s74_naive_hold(p_slot uuid) returns uuid language plpgsql security definer set search_path = '' as \$f\$
declare v_uid uuid := (select auth.uid()); s public.clinic_booking_slots%rowtype; pr public.profiles%rowtype; v_taken integer; v_id uuid;
begin
  select * into pr from public.profiles where id = v_uid and role = 'patient';
  select * into s from public.clinic_booking_slots where id = p_slot;                      -- no FOR UPDATE
  select count(*) into v_taken from public.clinic_slot_reservations r where r.slot_id = s.id and (r.state = 'confirmed' or (r.state = 'held' and r.hold_expires_at > now()));
  if v_taken >= s.capacity then raise exception 'slot_full' using errcode = '22023'; end if;
  perform pg_sleep(0.05);
  insert into public.clinic_slot_reservations (slot_id, organisation_id, patient_id, state, hold_expires_at, is_test)
  values (s.id, pr.organisation_id, v_uid, 'held', now() + interval '10 minutes', pr.is_test) returning id into v_id;
  return v_id;
end \$f\$;
grant execute on function public.s74_naive_hold(uuid) to authenticated;
SQL

PATS=(); while IFS= read -r line; do [[ -n "$line" ]] && PATS+=("$line"); done < <(psql_q -c "select id from public.profiles where full_name like '$TAG pat %' order by full_name")
[[ ${#PATS[@]} -eq $N ]] || fail "fixture count wrong (${#PATS[@]} patients)"
CLINIC="$(psql_q -c "select id from public.provider_organisations where legal_name = '$TAG clinic Ltd'")"

new_slot() { # $1 = capacity, $2 = hours ahead
  psql_q -c "insert into public.clinic_booking_slots (clinic_partner_id, starts_at, ends_at, capacity, is_test) values ('$CLINIC', now() + interval '$2 hours', now() + interval '$2 hours' + interval '1 hour', $1, true) returning id"
}

race() { # $1 = hold function, $2 = slot id; writes $WORK/out.<i>: a uuid when it got the place, else the sqlstate / message tail
  local fn=$1 slot=$2 i t0
  rm -f "$WORK"/out.*
  t0=$(python3 -c 'import time; print(time.time() + 4)')
  for ((i = 0; i < N; i++)); do
    (
      printf "begin;\nselect set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true);\nset local role authenticated;\nselect pg_sleep(greatest(0, %s - extract(epoch from clock_timestamp())));\nselect %s('%s');\ncommit;\n" \
        "${PATS[$i]}" "$t0" "$fn" "$slot" | psql "$DB_URL" -X -q -t -A 2>&1 | grep -E '^ERROR:|^[0-9a-f]{8}-[0-9a-f]{4}-' | tail -n 1 > "$WORK/out.$i"
    ) &
  done
  wait
}

summarise() { # prints: held full other
  cat "$WORK"/out.* | awk '/^[0-9a-f]{8}-[0-9a-f]{4}-/ { h++; next } /slot_full/ { f++; next } { o++ } END { printf "%d %d %d\n", h, f, o }'
}

live() { psql_q -c "select count(*) from public.clinic_slot_reservations where slot_id = '$1' and state in ('held', 'confirmed')"; }

# --- 1. capacity 1, 20 patients ------------------------------------------------------------------------------------
S1="$(new_slot 1 30)"
race "public.patient_hold_clinic_slot" "$S1"
read -r held full other < <(summarise)
[[ "$other" -eq 0 ]] || fail "round 1: $other callers got an error other than slot_full: $(cat "$WORK"/out.* | sort | uniq -c | tr '\n' ';')"
[[ "$held" -eq 1 ]] || fail "round 1: expected exactly 1 hold, got $held"
[[ "$full" -eq $((N - 1)) ]] || fail "round 1: expected $((N - 1)) slot_full, got $full"
[[ "$(live "$S1")" -eq 1 ]] || fail "round 1: expected 1 live reservation, found $(live "$S1")"
pass "capacity 1, $N concurrent patients: exactly 1 hold, $((N - 1)) slot_full, 1 live reservation"

# --- 2. capacity 3 -------------------------------------------------------------------------------------------------
S3="$(new_slot 3 31)"
race "public.patient_hold_clinic_slot" "$S3"
read -r held full other < <(summarise)
[[ "$other" -eq 0 && "$held" -eq 3 && "$full" -eq $((N - 3)) ]] || fail "round 2: expected 3 holds / $((N - 3)) refused / 0 other, got $held / $full / $other"
[[ "$(live "$S3")" -eq 3 ]] || fail "round 2: expected 3 live reservations, found $(live "$S3")"
pass "capacity 3, $N concurrent patients: exactly 3 holds, $((N - 3)) slot_full, 3 live reservations"

# --- 3. SABOTAGE control -------------------------------------------------------------------------------------------
SN="$(new_slot 1 32)"
race "public.s74_naive_hold" "$SN"
n_live="$(live "$SN")"
if [[ "$n_live" -le 1 ]]; then
  fail "VACUOUS: the lock-free control did not over-subscribe a one-place slot (live=$n_live), so the harness is not producing real contention"
fi
pass "SABOTAGE: the lock-free control over-subscribed the one-place slot ($n_live live reservations), so the harness does produce a real race"

printf '%s\n' "${PASS_LINES[@]}"
