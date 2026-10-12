-- ===========================================================================
-- Verification: SR2c 20261012181102_sr2c_hot_table_indexes_and_policy_initplan
--
-- Proves:
--   * the 25 foreign-key indexes exist, are valid, and every foreign key on the hot tables (except the deliberately
--     skipped organisation_id) is now covered by some index;
--   * the duplicate async_consults index is gone and the kept one remains;
--   * the five rewritten policies carry no bare auth.uid() and still discriminate: the owner sees their own
--     user_known_devices row, a different signed-in user sees none (simulated sessions, CONTROL included);
--   * SABOTAGE: with the wrapped policy replaced by a permissive `true`, the stranger sees the row, so the
--     stranger-sees-nothing check can fail.
-- BEGIN/ROLLBACK; fixtures are rolled back.
-- ===========================================================================
begin;
create temporary table p(check_name text, observed text, expected text, verdict text) on commit drop;
grant all on pg_temp.p to public;

-- 1. Indexes exist and are valid.
insert into p
select 'foreign keys on hot tables without a covering index (organisation_id excluded)',
  count(*)::text, '0', case when count(*) = 0 then 'PASS' else 'FAIL' end
from pg_constraint c
cross join lateral (select string_agg(a.attname, ',') cols
   from unnest(c.conkey) k(attnum) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) q
where c.contype = 'f' and c.connamespace = 'public'::regnamespace
  and c.conrelid::regclass::text in ('clinical_tasks','task_claims','clinical_task_transitions','pages','notifications',
      'vitals_readings','encounters','clinical_encounters','entitlements','lab_orders','audit_log','clinician_alerts','emergency_events')
  and q.cols <> 'organisation_id'
  and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indisvalid
                  and (i.indkey::int2[])[0:array_length(c.conkey,1)-1] @> c.conkey);

insert into p
select 'all _fk_idx indexes from the migration are valid',
  count(*) filter (where i.indisvalid)::text, '25', case when count(*) filter (where i.indisvalid) = 25 then 'PASS' else 'FAIL' end
from pg_class c join pg_index i on i.indexrelid = c.oid
where c.relname like '%\_fk\_idx' escape '\' and c.relnamespace = 'public'::regnamespace
  and c.relname in (
   'clinical_encounters_actor_clinical_staff_id_fk_idx','clinical_encounters_actor_profile_id_fk_idx','clinical_task_transitions_actor_id_fk_idx',
   'clinical_tasks_fee_schedule_version_id_fk_idx','clinical_tasks_lead_clinician_id_fk_idx','clinical_tasks_priority_override_by_fk_idx',
   'clinical_tasks_triage_event_id_fk_idx','clinical_tasks_type_version_fk_idx','clinician_alerts_backup_clinician_id_fk_idx',
   'clinician_alerts_closed_by_fk_idx','clinician_alerts_monitoring_schedule_item_id_fk_idx','clinician_alerts_resolved_by_fk_idx',
   'clinician_alerts_snoozed_by_fk_idx','emergency_events_acknowledged_by_fk_idx','emergency_events_clinician_alert_id_fk_idx',
   'emergency_events_followed_up_by_fk_idx','emergency_events_logged_by_profile_id_fk_idx','emergency_events_vital_reading_id_fk_idx',
   'encounters_service_purchase_id_fk_idx','encounters_task_id_fk_idx','lab_orders_partner_cost_provider_id_fk_idx',
   'lab_orders_rejected_by_fk_idx','task_claims_clinician_id_fk_idx','vitals_readings_triage_event_id_fk_idx','vitals_readings_validated_by_fk_idx');

-- 2. Duplicate dropped, original kept.
insert into p values
 ('duplicate async_consults_patient_month_idx is dropped', (to_regclass('public.async_consults_patient_month_idx') is null)::text, 'true',
  case when to_regclass('public.async_consults_patient_month_idx') is null then 'PASS' else 'FAIL' end),
 ('the kept async_consults_patient_idx remains', (to_regclass('public.async_consults_patient_idx') is not null)::text, 'true',
  case when to_regclass('public.async_consults_patient_idx') is not null then 'PASS' else 'FAIL' end);

-- 3. No bare auth.uid() left in the five rewritten policies.
insert into p
select 'rewritten policies with a bare auth.uid()', count(*)::text, '0', case when count(*) = 0 then 'PASS' else 'FAIL' end
from pg_policies x
where x.schemaname = 'public'
  and x.policyname in ('clinical_staff_attestations_insert','emergency_cards_lookups_select','emergency_cards_select','user_known_devices_select','patient_result_explanations_select')
  and regexp_count(coalesce(x.qual,'') || ' ' || coalesce(x.with_check,''), 'auth\.uid\(\)')
    > regexp_count(coalesce(x.qual,'') || ' ' || coalesce(x.with_check,''), '\( ?SELECT auth\.uid\(\) AS uid\)');

-- 4. Behaviour: owner sees the row, stranger does not.
create temporary table fx(owner uuid, stranger uuid, org uuid) on commit drop;
grant all on pg_temp.fx to public;
insert into fx select (select id from public.profiles order by id limit 1), (select id from public.profiles order by id offset 1 limit 1), (select id from public.organisations limit 1);
insert into public.user_known_devices (profile_id, organisation_id, device_fingerprint) select owner, org, 'sr2c-proof' from fx;

create temporary table seen(who text, n int) on commit drop;
grant all on pg_temp.seen to public;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select owner::text from pg_temp.fx), true);
insert into pg_temp.seen select 'owner', count(*) from public.user_known_devices where device_fingerprint = 'sr2c-proof';
select set_config('request.jwt.claim.sub', (select stranger::text from pg_temp.fx), true);
insert into pg_temp.seen select 'stranger', count(*) from public.user_known_devices where device_fingerprint = 'sr2c-proof';
reset role;

insert into p select 'CONTROL: the owner sees their own device row', n::text, '1', case when n = 1 then 'PASS' else 'FAIL' end from seen where who = 'owner';
insert into p select 'a different signed-in user sees none', n::text, '0', case when n = 0 then 'PASS' else 'FAIL' end from seen where who = 'stranger';

-- 5. Sabotage: open the policy, the stranger must now see the row.
alter policy user_known_devices_select on public.user_known_devices using (true);
set local role authenticated;
select set_config('request.jwt.claim.sub', (select stranger::text from pg_temp.fx), true);
insert into pg_temp.seen select 'stranger_sabotaged', count(*) from public.user_known_devices where device_fingerprint = 'sr2c-proof';
reset role;
insert into p select 'SABOTAGE: an opened policy lets the stranger in (test discriminates)', n::text, '1', case when n = 1 then 'PASS' else 'FAIL' end from seen where who = 'stranger_sabotaged';

select * from p order by 1;
do $$ begin
  if exists (select 1 from pg_temp.p where verdict <> 'PASS') then raise exception 'sr2c: one or more checks failed'; end if;
end $$;
rollback;
