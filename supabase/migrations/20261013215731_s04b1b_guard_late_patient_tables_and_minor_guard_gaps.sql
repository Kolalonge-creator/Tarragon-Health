-- S04b-1b: close the under-18 scope guard on patient tables that reached production after 20261013183512, and give
-- production a check that cannot be forgotten.
--
-- Counted first (live, 2026-10-13): 11 public tables keyed by patient_id are not in minor_dependant_table_policy, so a
-- dependant under 18 is not blocked from holding rows in them: followup_offer_slots, followup_offers,
-- medication_prn_flags, medication_prn_limits, member_followup_entitlements, member_review_notes, poc_ecg_recordings,
-- poc_measurements, poc_result_items, poc_results, testing_event_bookings (two-tier and S08x migrations that sort after
-- the original guard). Founder rule: a dependant under 18 holds immunisation and preventive tracking only, so all 11 are
-- guarded. No under-18 dependant exists live (0 rows), so there is nothing to convert.
--
-- 1. private.minor_guard_gaps(): the single definition of "a patient table the guard misses", used by the proof, by the
--    self-check at the end of this migration, and by scripts/release-integrity/check-minor-guard-gaps.mjs against production.
-- 2. Guard every table the function reports (idempotent, via private.guard_minor_dependant_table), then fail the
--    migration if any gap is left.

create or replace function private.minor_guard_gaps()
returns table (table_name text, problem text)
language sql
stable
security definer
set search_path = ''
as $$
  with scoped as (
    -- catalogs, not information_schema: the latter hides tables the current role has no privilege on
    select distinct cl.relname::text as table_name
      from pg_attribute a
      join pg_class cl on cl.oid = a.attrelid and cl.relkind in ('r', 'p')
      join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
     where not a.attisdropped
       and (a.attname = 'patient_id'
            or (a.attname = 'profile_id'
                and cl.relname in ('booking_requests', 'risk_assessment_responses', 'prevention_risk_scores', 'ai_conversations')))
  ),
  has_trigger as (
    select c.relname::text as table_name
      from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and g.tgname = '00_minor_dependant_scope' and not g.tgisinternal
  )
  select s.table_name, 'not in minor_dependant_table_policy'
    from scoped s left join public.minor_dependant_table_policy p on p.table_name = s.table_name
   where p.table_name is null
  union all
  select p.table_name, 'listed guarded but has no 00_minor_dependant_scope trigger'
    from public.minor_dependant_table_policy p
   where p.policy = 'guarded' and exists (select 1 from scoped s where s.table_name = p.table_name)
     and not exists (select 1 from has_trigger h where h.table_name = p.table_name)
  union all
  select p.table_name, 'listed ' || p.policy || ' but is guarded'
    from public.minor_dependant_table_policy p
   where p.policy <> 'guarded' and exists (select 1 from has_trigger h where h.table_name = p.table_name);
$$;
revoke all on function private.minor_guard_gaps() from public, anon, authenticated;

comment on function private.minor_guard_gaps() is
  'S04b-1b: patient tables the under-18 dependant scope guard misses (unclassified, guarded without trigger, or classified but guarded). Empty means complete. Checked in CI by minor_dependant_table_policy_complete and against production by scripts/release-integrity/check-minor-guard-gaps.mjs. Runbook: docs/runbooks/minor-guard-gaps.md.';

-- Classify the safety table first, so applying this before 20261013204748 never guards it: a Free-tier red event must
-- always be recordable.
insert into public.minor_dependant_table_policy (table_name, policy, reason)
select 'free_red_events', 'exempt', 'safety: a red event must always be recordable'
 where to_regclass('public.free_red_events') is not null
on conflict (table_name) do update set policy = 'exempt', reason = excluded.reason
  where public.minor_dependant_table_policy.policy = 'guarded';
do $$
begin
  if to_regclass('public.free_red_events') is not null then
    drop trigger if exists "00_minor_dependant_scope" on public.free_red_events;
  end if;
end $$;

do $$
declare
  r record;
  v_col text;
begin
  -- a table classified allowed/exempt that is also guarded is NOT auto-fixed here (that would weaken protection silently):
  -- the self-check below fails the migration so a person decides.
  -- unclassified tables are guarded (never silently exempted); the column is patient_id except for the four profile_id tables
  for r in select g.table_name from private.minor_guard_gaps() g where g.problem = 'not in minor_dependant_table_policy' loop
    v_col := case when r.table_name in ('booking_requests', 'risk_assessment_responses', 'prevention_risk_scores', 'ai_conversations')
                  then 'profile_id' else 'patient_id' end;
    perform private.guard_minor_dependant_table(r.table_name, v_col);
  end loop;
  -- a guarded-listed table that lost its trigger gets it back
  for r in select g.table_name from private.minor_guard_gaps() g where g.problem like 'listed guarded but has no%' loop
    v_col := case when r.table_name in ('booking_requests', 'risk_assessment_responses', 'prevention_risk_scores', 'ai_conversations')
                  then 'profile_id' else 'patient_id' end;
    perform private.guard_minor_dependant_table(r.table_name, v_col);
  end loop;

  if exists (select 1 from private.minor_guard_gaps()) then
    raise exception 'S04b-1b: patient tables still escape the under-18 scope guard: %',
      (select string_agg(g.table_name || ' (' || g.problem || ')', ', ') from private.minor_guard_gaps() g);
  end if;
  -- the eleven named by the founder are guarded now
  if exists (
    select 1 from unnest(array['followup_offer_slots','followup_offers','medication_prn_flags','medication_prn_limits',
        'member_followup_entitlements','member_review_notes','poc_ecg_recordings','poc_measurements','poc_result_items',
        'poc_results','testing_event_bookings']) t(name)
     where to_regclass('public.' || t.name) is not null
       and not exists (select 1 from public.minor_dependant_table_policy p where p.table_name = t.name and p.policy = 'guarded'))
  then
    raise exception 'S04b-1b: one of the eleven late patient tables is not guarded';
  end if;
  if has_function_privilege('anon', 'private.minor_guard_gaps()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.minor_guard_gaps()', 'EXECUTE') then
    raise exception 'S04b-1b: minor_guard_gaps is callable by an API role';
  end if;
end $$;
