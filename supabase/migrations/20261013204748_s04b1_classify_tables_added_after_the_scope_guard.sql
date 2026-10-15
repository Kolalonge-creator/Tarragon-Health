-- S04b-1 follow-up: classify patient-keyed tables that reached production AFTER 20261013183512 installed the under-18
-- dependant scope guard (found 2026-10-13 by the standing proof minor_dependant_table_policy_complete).
--
-- Counted first (live): public.free_red_events was the only patient_id table not in minor_dependant_table_policy.
-- It records a Free-tier red event: a safety record that must always be writable, like emergency_events, so it is
-- EXEMPT rather than guarded. Any other unlisted patient_id table is guarded by the same loop the first migration used,
-- so this migration is idempotent and safe to replay.

insert into public.minor_dependant_table_policy (table_name, policy, reason)
select 'free_red_events', 'exempt', 'safety: a red event must always be recordable'
where to_regclass('public.free_red_events') is not null
on conflict (table_name) do update set policy = 'exempt', reason = excluded.reason;

-- On a fresh replay the first migration already guarded it (it sorts after the two-tier migrations); make both paths agree.
do $$
begin
  if to_regclass('public.free_red_events') is not null then
    drop trigger if exists "00_minor_dependant_scope" on public.free_red_events;
  end if;
end $$;

do $$
declare
  r record;
begin
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public'
       and (c.column_name = 'patient_id'
            or (c.column_name = 'profile_id'
                and c.table_name in ('booking_requests', 'risk_assessment_responses', 'prevention_risk_scores', 'ai_conversations')))
       and not exists (select 1 from public.minor_dependant_table_policy p where p.table_name = c.table_name)
  loop
    perform private.guard_minor_dependant_table(r.table_name, r.column_name);
  end loop;
end $$;
