create table public.record_corrections (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid references public.organisations (id) on delete set null,
  table_name       text not null,
  entity_id        uuid not null,
  patient_id       uuid references public.profiles (id) on delete set null,
  changed_columns  text[] not null,
  old_values       jsonb not null,
  new_values       jsonb,
  reason           text,
  corrected_by     uuid references public.profiles (id) on delete set null,
  corrected_at     timestamptz not null default now()
);

comment on column public.record_corrections.new_values is
  'Null specifically means the row was DELETED (nothing to show as "new") -- distinct from an empty object, which would mean the changed columns'' new values were all null.';

create index record_corrections_entity_idx on public.record_corrections (table_name, entity_id, corrected_at desc);
create index record_corrections_patient_idx on public.record_corrections (patient_id, corrected_at desc);
create index record_corrections_org_idx on public.record_corrections (organisation_id);

create trigger record_corrections_no_update
  before update on public.record_corrections
  for each row execute function private.reject_mutation();
create trigger record_corrections_no_delete
  before delete on public.record_corrections
  for each row execute function private.reject_mutation();

alter table public.record_corrections enable row level security;

create or replace function private.can_read_record_correction(
  p_table_name      text,
  p_organisation_id uuid,
  p_patient_id      uuid,
  p_corrected_by    uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.is_admin()
    or (p_corrected_by is not null and p_corrected_by = (select auth.uid()))
    or (p_patient_id is not null and (
      p_patient_id = (select auth.uid())
      or private.can_read_clinical(p_patient_id)
    ))
    or (p_table_name in ('profiles', 'lab_result_documents')
        and p_patient_id is not null
        and private.is_lab_liaison()
        and p_organisation_id is not null
        and p_organisation_id = private.current_org_id())
    or (p_table_name = 'clinical_staff'
        and p_organisation_id is not null
        and p_organisation_id = private.current_org_id())
    or (p_organisation_id is not null and private.is_org_staff(p_organisation_id));
$$;

comment on function private.can_read_record_correction(text, uuid, uuid, uuid) is
  'Read-access predicate for record_corrections, verified against the LIVE pg_policies of every covered table rather than assumed. See 20260827195333_record_corrections_platform_wide.sql for the per-clause justification.';

create policy record_corrections_select on public.record_corrections
  for select to authenticated
  using (private.can_read_record_correction(table_name, organisation_id, patient_id, corrected_by));

grant select on public.record_corrections to authenticated;
revoke all on public.record_corrections from anon;

create or replace function private.capture_record_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row        jsonb;
  v_old        jsonb;
  v_new        jsonb;
  v_changed    text[];
  v_patient_id uuid;
  v_actor      uuid;
  v_old_slice  jsonb;
  v_new_slice  jsonb;
  v_reason     text;
begin
  if tg_op = 'DELETE' then
    v_old := to_jsonb(OLD);
    v_row := v_old;
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_old) where value is not null;
    if v_changed is null then
      return OLD;
    end if;
    select jsonb_object_agg(t.k, v_old -> t.k) into v_old_slice from unnest(v_changed) as t(k);
    v_new_slice := null;
  else
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_row := v_new;
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_new) n
      where key <> 'updated_at'
        and n.value is distinct from (v_old -> n.key);
    if v_changed is null then
      return NEW;
    end if;
    select jsonb_object_agg(t.k, v_old -> t.k) into v_old_slice from unnest(v_changed) as t(k);
    select jsonb_object_agg(t.k, v_new -> t.k) into v_new_slice from unnest(v_changed) as t(k);
  end if;

  v_reason := nullif(current_setting('app.change_reason', true), '');
  if tg_table_name in ('patient_conditions', 'patient_allergies') and v_reason is null then
    raise exception
      'a correction reason is required when changing %.% -- set app.change_reason before this statement (select set_config(''app.change_reason'', ''...'', true))',
      tg_table_name, coalesce(v_row ->> 'id', 'unknown');
  end if;

  v_patient_id := nullif(v_row ->> 'patient_id', '')::uuid;
  if v_patient_id is null and tg_table_name = 'profiles' and (v_row ->> 'role') = 'patient' then
    v_patient_id := (v_row ->> 'id')::uuid;
  end if;

  v_actor := coalesce(
    auth.uid(),
    nullif(current_setting('app.audit_actor_id', true), '')::uuid
  );

  insert into public.record_corrections
    (organisation_id, table_name, entity_id, patient_id, changed_columns,
     old_values, new_values, reason, corrected_by)
  values (
    nullif(v_row ->> 'organisation_id', '')::uuid,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_patient_id,
    v_changed,
    v_old_slice,
    v_new_slice,
    v_reason,
    v_actor
  );

  if tg_op = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

comment on function private.capture_record_correction() is
  'AFTER UPDATE OR DELETE trigger: records the OLD/(NEW or null-if-deleted) values of exactly the columns that changed (never the whole row) into public.record_corrections. Read access is private.can_read_record_correction(), mirroring each covered table''s real live policy -- see migration header. Reason is mandatory (raises) for patient_conditions/patient_allergies, optional elsewhere via the app.change_reason GUC.';

do $$
declare
  t text;
  tables text[] := array[
    'vitals_readings', 'medications', 'medication_logs', 'medication_reviews',
    'screening_results', 'lab_result_documents', 'lab_analyte_readings', 'clinician_alerts',
    'escalations', 'care_plans', 'profiles', 'emergency_events', 'patient_risk_scores',
    'referrals', 'vaccination_records', 'clinical_staff', 'care_messages', 'case_briefs',
    'wearable_readings', 'patient_hospital_admissions', 'symptoms'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists capture_record_correction_trg on public.%I', t);
    execute format(
      'create trigger capture_record_correction_trg '
      'after update or delete on public.%I '
      'for each row execute function private.capture_record_correction()',
      t
    );
  end loop;
end $$;

do $$
declare
  t text;
  tables text[] := array[
    'vitals_readings', 'medications', 'medication_logs', 'medication_reviews',
    'screening_results', 'lab_result_documents', 'lab_analyte_readings', 'clinician_alerts',
    'escalations', 'care_plans', 'profiles', 'emergency_events', 'patient_risk_scores',
    'referrals', 'vaccination_records', 'clinical_staff', 'care_messages', 'case_briefs',
    'wearable_readings', 'patient_hospital_admissions', 'symptoms'
  ];
  v_count int;
begin
  foreach t in array tables loop
    select count(*) into v_count
      from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t
        and tg.tgname = 'capture_record_correction_trg' and not tg.tgisinternal;
    if v_count <> 1 then
      raise exception 'capture_record_correction_trg missing or duplicated on public.%: found %', t, v_count;
    end if;
  end loop;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'record_corrections' and policyname = 'record_corrections_select'
  ) then
    raise exception 'FAIL: record_corrections_select policy is missing';
  end if;

  raise notice 'PASS: record_corrections_platform_wide -- table, trigger, and 21 attachments installed';
end $$;
