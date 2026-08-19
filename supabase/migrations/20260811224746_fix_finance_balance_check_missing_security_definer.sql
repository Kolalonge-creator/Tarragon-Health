-- Fixes a pre-existing bug in the finance/voucher subsystem, found while
-- verifying the new patient screening-completion self-report feature (which
-- flips a screening_schedules row to 'completed' and, via the EXISTING
-- screening_schedules_reward trigger from 20260723195211, cascades into
-- issuing a prevention-reward care_voucher and posting a finance journal
-- entry). That reward chain already existed and is exercised by ANY event
-- that completes a screening_schedules row — including the pre-existing
-- clinician-facing refresh_screening_schedule_on_result path — not just this
-- new one.
--
-- Root cause: private.finance_assert_entry_balanced backs a DEFERRABLE
-- INITIALLY DEFERRED constraint trigger on finance_journal_lines
-- (20260725225616), so it fires at COMMIT time, after every SECURITY
-- DEFINER function in the posting chain (finance_post_journal,
-- finance_post_reward_voucher_issued, prevention_reward, ...) has already
-- returned and its elevated privilege scope has ended. Unlike every sibling
-- function in this exact subsystem, finance_assert_entry_balanced was never
-- marked SECURITY DEFINER — so at commit it runs as the REAL session role
-- (authenticated, for any patient/clinician-initiated transaction), which
-- holds no grant on finance_journal_entries/finance_journal_lines (only
-- postgres and service_role do — see 20260725225616). Confirmed live via
-- pg_trigger: finance_journal_lines_balanced is tgdeferrable/tginitdeferred
-- true, and finance_assert_entry_balanced was prosecdef=false while every
-- other finance/voucher trigger function in this call chain is
-- prosecdef=true, owner postgres.
--
-- Fix: SECURITY DEFINER (search_path already locked down), matching every
-- other function this table's triggers use. It only ever reads to validate
-- debits=credits and raises a generic "unbalanced" exception — no data is
-- returned to the caller, so elevating it exposes nothing new.
create or replace function private.finance_assert_entry_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid := coalesce(new.entry_id, old.entry_id);
  v_unbalanced int;
begin
  -- Entry may have been deleted (cascade) — nothing to check.
  if not exists (select 1 from public.finance_journal_entries where id = v_entry) then
    return null;
  end if;
  select count(*) into v_unbalanced
  from (
    select currency, sum(debit_minor) d, sum(credit_minor) c
    from public.finance_journal_lines
    where entry_id = v_entry
    group by currency
    having sum(debit_minor) <> sum(credit_minor)
  ) x;
  if v_unbalanced > 0 then
    raise exception 'finance journal entry % is unbalanced (debits <> credits)', v_entry
      using errcode = 'check_violation';
  end if;
  return null;
end; $$;

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'finance_assert_entry_balanced' and p.prosecdef
  ) then
    raise exception 'finance_assert_entry_balanced was not made SECURITY DEFINER';
  end if;
end $$;
