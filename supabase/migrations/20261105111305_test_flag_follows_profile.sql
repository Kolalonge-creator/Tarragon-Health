-- A person's records follow their test flag when it changes later (founder decision 2026-11-05).
--
-- Problem: about 155 tables carry their own is_test, copied from the patient's (or staff member's) profile when the row is
-- written. Readers that cannot see the patient column rely on that copy (the Written questions badge since #1728, the S22
-- clinical-lead notice, the finance console through analytics_clean). When an admin marks a profile as a test account AFTER
-- it has records, every copy stays false: the records keep counting as real until the nightly purge removes them, and for
-- an account with a test_keep_reason they never stop counting. Unmarking a profile had the mirror-image problem.
--
-- Fix: an AFTER UPDATE OF is_test trigger on profiles calls private.restamp_test_flag_for_profile, which copies the new flag
-- onto every row of that person, in one step:
--   * every public table with an is_test column and a patient_id column (matched on patient_id), and every one with is_test and
--     profile_id but no patient_id (matched on profile_id: clinical_staff, clinician_applications, ops desk rows, ...);
--   * the finance tables, which carry no patient column, are re-checked with their own existing predicates
--     (payment_transaction_is_test, revrec_source_is_test, finance_source_is_test). Only towards test: a posted entry is never
--     turned back into real money by an unflag, matching how those stamps only ever OR in "test".
-- The step runs with session_replication_role = replica (SET LOCAL, put back before returning), so row triggers do not fire
-- for this one column change: no notification, commission, event or projection fires, and append-only tables accept the flag.
-- Chosen by the founder over "normal triggers" (append-only tables would refuse; side-effect triggers would fire) and over
-- "purge on flag" (kept accounts keep the gap). The profile change is itself audited by audit_row_change; one extra audit_log
-- row records which tables were re-stamped and how many rows. A re-stamp that fails raises, so the profile change is refused
-- rather than half-applied.
--
-- Data change at apply time: none to existing rows beyond a one-off reconcile of rows whose copy already disagrees with their
-- person's profile today (counted in the closing NOTICE).

create or replace function private.restamp_test_flag_for_profile(p_profile uuid, p_is_test boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n bigint;
  v_counts jsonb := '{}'::jsonb;
  v_prev text := current_setting('session_replication_role');
begin
  if p_profile is null or p_is_test is null then
    raise exception 'restamp_test_flag_for_profile needs a profile and a flag' using errcode = '22023';
  end if;

  -- Not a function-level SET clause: on Supabase the postgres role may change this parameter only through a SET statement
  -- (supautils), not a proconfig entry. A SET LOCAL lasts to the end of the transaction, so it is put back below; if this
  -- function errors, the enclosing statement fails and the transaction or savepoint undoes the setting with it.
  set local session_replication_role = replica;

  for r in
    select c.relname,
           case when exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'patient_id' and not a.attisdropped)
                then 'patient_id' else 'profile_id' end as col
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition and c.relname <> 'profiles'
       and exists (select 1 from pg_attribute a join pg_type t on t.oid = a.atttypid
                    where a.attrelid = c.oid and a.attname = 'is_test' and not a.attisdropped and t.typname = 'bool')
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname in ('patient_id', 'profile_id') and not a.attisdropped)
     order by c.relname
  loop
    execute format('update public.%I set is_test = $1 where %I = $2 and is_test is distinct from $1', r.relname, r.col)
      using p_is_test, p_profile;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_counts := v_counts || jsonb_build_object(r.relname, v_n);
    end if;
  end loop;

  -- Finance: no patient column; re-run the existing "is this test money" checks, towards test only.
  if p_is_test then
    update public.payment_transactions pt set is_test = true
     where not pt.is_test and private.payment_transaction_is_test(pt);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_counts := v_counts || jsonb_build_object('payment_transactions', v_n); end if;

    update public.revenue_recognition_schedules s set is_test = true
     where not s.is_test and private.revrec_source_is_test(s.source_kind::text, s.source_id, s.payment_transaction_id);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_counts := v_counts || jsonb_build_object('revenue_recognition_schedules', v_n); end if;

    -- A reversal follows its parent, so repeat until nothing more changes (chains are short). A posted entry in a month that
    -- is no longer open (finance_periods.status <> 'open') is never re-stamped: that would change a closed month's reports.
    -- Such entries are counted under finance_journal_entries_in_closed_periods so the trigger can alert finance.
    loop
      update public.finance_journal_entries e set is_test = true
       where not e.is_test
         and not exists (select 1 from public.finance_periods fp where fp.period_month = e.period_month and fp.status <> 'open')
         and (private.finance_source_is_test(e.source, e.source_ref, e.created_by)
              or coalesce((select p.is_test from public.finance_journal_entries p where p.id = e.reversal_of), false));
      get diagnostics v_n = row_count;
      exit when v_n = 0;
      v_counts := jsonb_set(v_counts, '{finance_journal_entries}',
                            to_jsonb(coalesce((v_counts ->> 'finance_journal_entries')::bigint, 0) + v_n));
    end loop;
    select count(*) into v_n from public.finance_journal_entries e
     where not e.is_test
       and exists (select 1 from public.finance_periods fp where fp.period_month = e.period_month and fp.status <> 'open')
       and private.finance_source_is_test(e.source, e.source_ref, e.created_by);
    if v_n > 0 then v_counts := v_counts || jsonb_build_object('finance_journal_entries_in_closed_periods', v_n); end if;
  end if;

  execute format('set local session_replication_role = %s', quote_literal(v_prev));
  return v_counts;
end;
$$;

revoke all on function private.restamp_test_flag_for_profile(uuid, boolean) from public, anon, authenticated;

create or replace function private.profiles_test_flag_follows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counts jsonb;
begin
  v_counts := private.restamp_test_flag_for_profile(new.id, new.is_test);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result, subject_patient_id)
  values (new.organisation_id, (select auth.uid()), 'test_flag_restamp', 'profiles', new.id,
          jsonb_build_object('is_test', new.is_test, 'rows_by_table', v_counts),
          case when new.is_test then 'profile marked as a test account' else 'profile marked as a real account' end,
          'success', case when new.role = 'patient' then new.id end);

  -- Finance is never reversed automatically (a test stamp there may come from another party or a manual correction), so an
  -- unmark, or test money sitting in a closed month, is raised to the operations wall rather than left silent.
  if not new.is_test then
    perform private.ops_alert_incident('test-flag-unmarked:' || new.id::text,
      'A profile was marked as a real account: check its finance rows',
      'Clinical and account records for this person were turned back to real. Payments, revenue schedules and ledger entries '
      || 'already marked as test were not changed. Review them in the finance console.', 'sev3');
  elsif coalesce((v_counts ->> 'finance_journal_entries_in_closed_periods')::bigint, 0) > 0 then
    perform private.ops_alert_incident('test-flag-closed-period:' || new.id::text,
      'Test money found in a closed finance month',
      (v_counts ->> 'finance_journal_entries_in_closed_periods') || ' ledger entries in a closed month belong to an account now '
      || 'marked as test. They were left as they are so the closed month does not change. Decide whether to reopen it.', 'sev3');
  end if;
  return null;
end;
$$;

revoke all on function private.profiles_test_flag_follows() from public, anon, authenticated;

drop trigger if exists profiles_zz_test_flag_follows on public.profiles;
create trigger profiles_zz_test_flag_follows
  after update of is_test on public.profiles
  for each row when (old.is_test is distinct from new.is_test)
  execute function private.profiles_test_flag_follows();

-- One-off reconcile: rows whose copy already disagrees with their person's profile (flagged or unflagged before this trigger
-- existed). Towards the profile's current value, finance towards test only, same as the trigger.
do $$
declare
  p record;
  v_total bigint := 0;
  v_counts jsonb;
  v_people int := 0;
  r record;
begin
  -- Find disagreeing people table by table (cheap: indexed patient_id on almost every table), then re-stamp each person once.
  create temp table restamp_people (id uuid primary key, is_test boolean) on commit drop;
  for r in
    select c.relname,
           case when exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'patient_id' and not a.attisdropped)
                then 'patient_id' else 'profile_id' end as col
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition and c.relname <> 'profiles'
       and exists (select 1 from pg_attribute a join pg_type t on t.oid = a.atttypid
                    where a.attrelid = c.oid and a.attname = 'is_test' and not a.attisdropped and t.typname = 'bool')
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname in ('patient_id', 'profile_id') and not a.attisdropped)
  loop
    execute format(
      'insert into restamp_people (id, is_test)
         select distinct pr.id, pr.is_test from public.%I t join public.profiles pr on pr.id = t.%I
          where t.is_test is distinct from pr.is_test
       on conflict (id) do nothing', r.relname, r.col);
  end loop;

  for p in select * from restamp_people loop
    v_counts := private.restamp_test_flag_for_profile(p.id, p.is_test);
    select v_total + coalesce(sum(value::bigint), 0) into v_total from jsonb_each_text(v_counts);
    v_people := v_people + 1;
  end loop;

  raise notice 'test_flag_follows_profile: reconciled % rows for % people', v_total, v_people;
end $$;
