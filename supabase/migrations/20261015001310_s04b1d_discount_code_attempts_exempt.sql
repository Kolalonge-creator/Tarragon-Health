-- S04b-1d: classify discount_code_attempts as exempt from the under-18 dependant scope guard (founder decision 2026-10-15).
--
-- S04b-1c (20261014233220) guarded it with the other late patient tables. It holds only organisation_id and patient_id, no health data, and is
-- written inside the quote RPCs (create_order and the price quote path) when a discount code fails, to rate-limit guessing. A guard there would
-- make a failed code raise for an under-18 buyer instead of being counted. Same precedent as free_red_events in S04b-1b: a system table that must
-- stay writable. The other eleven tables from S04b-1c stay guarded.
-- Idempotent. Declares no transaction of its own (the apply workflow wraps it).

insert into public.minor_dependant_table_policy (table_name, policy, reason)
select 'discount_code_attempts', 'exempt', 'system: rate-limit log of organisation and patient ids, no health data; written inside the quote RPCs when a discount code fails'
 where to_regclass('public.discount_code_attempts') is not null
on conflict (table_name) do update set policy = 'exempt', reason = excluded.reason
  where public.minor_dependant_table_policy.policy = 'guarded';

do $$
begin
  if to_regclass('public.discount_code_attempts') is not null then
    drop trigger if exists "00_minor_dependant_scope" on public.discount_code_attempts;
  end if;
  if exists (select 1 from private.minor_guard_gaps()) then
    raise exception 'S04b-1d: patient tables still escape the under-18 scope guard: %',
      (select string_agg(g.table_name || ' (' || g.problem || ')', ', ') from private.minor_guard_gaps() g);
  end if;
  if to_regclass('public.discount_code_attempts') is not null
     and not exists (select 1 from public.minor_dependant_table_policy p where p.table_name = 'discount_code_attempts' and p.policy = 'exempt') then
    raise exception 'S04b-1d: discount_code_attempts is not classified exempt';
  end if;
end $$;
