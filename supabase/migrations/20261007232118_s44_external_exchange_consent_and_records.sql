-- S44 (Module 2, interoperability), part 1 of 3: consent for exchange with outside systems, external_records, and an atomic, consent-checked FHIR import.
-- Spec 2.10, 2.11, 2.13; INV-02 (nothing from outside is the record until a clinician files it), INV-07, INV-10, INV-12, INV-13.
--
-- Live counts before this migration: fhir_import_batches 0, fhir_import_proposed_resources 0 (the import route has never received a real bundle).
--
-- What this adds:
--   1. external_exchange_consents: a person's per-system consent to receive records from, or send records to, an outside system.
--      The wording is NOT written here. consent_text_key names a placeholder that counsel replaces (S42's consent matrix may absorb this table).
--   2. external_records: one immutable row per FHIR resource received from an outside system, with provenance (source system, batch, consent).
--      It is evidence, not the record. Filing a value into the record still needs a clinician (fhir_import_proposed_resources, unchanged).
--   3. public.fhir_import_accept(): the one atomic writer for an import. Consent is checked INSIDE the database, so no caller can skip it.
--      An import without a consent in force is refused and stores nothing (no batch, no proposal, no external record) and the refusal is audited.
--      It also supersedes an older still-proposed row for the same source resource (the old route would have hit the unique index and failed).
--   4. consent_in_force(): the check the device-local health-store route uses for wearable_device_data (2.13).
--   5. Two read paths for external_records: the person's own, and an audited, tied staff read (INV-10, INV-12).

-- ---------------------------------------------------------------------------
-- 1. Event
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('external_record.imported', 'Records from an outside system were received and wait for review', 'S44', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('external_record.imported', 1, array['batch_id'])
on conflict (event_type, version) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Consent to exchange records with an outside system
-- ---------------------------------------------------------------------------
create table public.external_exchange_consents (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  source_system    text not null check (source_system = lower(btrim(source_system)) and char_length(source_system) between 2 and 120),
  direction        text not null check (direction in ('import', 'export', 'both')),
  -- A KEY, never the wording. The approved text is counsel's to supply (founder rule: no invented legal wording).
  consent_text_key text not null default 'consent.external_exchange.v1_placeholder',
  granted_at       timestamptz not null default now(),
  withdrawn_at     timestamptz,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  check (withdrawn_at is null or withdrawn_at >= granted_at)
);
create unique index external_exchange_consents_one_active on public.external_exchange_consents (patient_id, source_system) where withdrawn_at is null;
create index external_exchange_consents_patient_idx on public.external_exchange_consents (patient_id, granted_at desc);

alter table public.external_exchange_consents enable row level security;
create policy external_exchange_consents_select_own on public.external_exchange_consents
  for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.external_exchange_consents from anon, authenticated;
grant select on public.external_exchange_consents to authenticated;

comment on table public.external_exchange_consents is
  'A person''s consent to receive records from, or send records to, one named outside system. Written only by the patient functions below. Wording is a placeholder key pending counsel.';

create or replace function private.external_source_key(p_source text) returns text
language sql immutable set search_path = ''
as $$ select nullif(lower(btrim(p_source)), '') $$;
revoke all on function private.external_source_key(text) from public, anon, authenticated;

create or replace function private.external_exchange_consent_id(p_patient uuid, p_source text, p_direction text) returns uuid
language sql stable security definer set search_path = ''
as $$
  select c.id from public.external_exchange_consents c
   where c.patient_id = p_patient and c.source_system = private.external_source_key(p_source)
     and c.withdrawn_at is null and c.direction in (p_direction, 'both')
   limit 1
$$;
revoke all on function private.external_exchange_consent_id(uuid, text, text) from public, anon, authenticated;

create or replace function public.grant_external_exchange_consent(p_source text, p_direction text default 'import')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_src text := private.external_source_key(p_source);
  v_org uuid;
  v_test boolean;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if v_src is null or char_length(v_src) < 2 or char_length(v_src) > 120 then raise exception 'a source name is required' using errcode = '22023'; end if;
  if p_direction not in ('import', 'export', 'both') then raise exception 'direction must be import, export or both' using errcode = '22023'; end if;
  select organisation_id, is_test into v_org, v_test from public.profiles where id = v_uid and role = 'patient';
  if v_org is null then raise exception 'this action is for patients' using errcode = '42501'; end if;

  -- one active consent per system: changing the direction withdraws the old row and writes a new one, so the history stays
  update public.external_exchange_consents set withdrawn_at = now()
   where patient_id = v_uid and source_system = v_src and withdrawn_at is null and direction <> p_direction;
  select id into v_id from public.external_exchange_consents where patient_id = v_uid and source_system = v_src and withdrawn_at is null;
  if v_id is null then
    insert into public.external_exchange_consents (organisation_id, patient_id, source_system, direction, is_test)
    values (v_org, v_uid, v_src, p_direction, coalesce(v_test, false)) returning id into v_id;
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
    values (v_org, v_uid, 'external_exchange.consent_granted', 'external_exchange_consent', v_id,
            jsonb_build_object('source_system', v_src, 'direction', p_direction), v_uid);
  end if;
  return jsonb_build_object('id', v_id, 'source_system', v_src, 'direction', p_direction);
end;
$$;

create or replace function public.withdraw_external_exchange_consent(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  c public.external_exchange_consents%rowtype;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  update public.external_exchange_consents set withdrawn_at = now()
   where id = p_id and patient_id = v_uid and withdrawn_at is null returning * into c;
  if not found then raise exception 'consent not found' using errcode = 'P0002'; end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (c.organisation_id, v_uid, 'external_exchange.consent_withdrawn', 'external_exchange_consent', c.id,
          jsonb_build_object('source_system', c.source_system), v_uid);
  return jsonb_build_object('withdrawn', true);
end;
$$;

create or replace function public.my_external_exchange_consents()
returns table (id uuid, source_system text, direction text, consent_text_key text, granted_at timestamptz, withdrawn_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.source_system, c.direction, c.consent_text_key, c.granted_at, c.withdrawn_at
    from public.external_exchange_consents c where c.patient_id = (select auth.uid()) order by c.granted_at desc
$$;

revoke all on function public.grant_external_exchange_consent(text, text) from public, anon;
revoke all on function public.withdraw_external_exchange_consent(uuid) from public, anon;
revoke all on function public.my_external_exchange_consents() from public, anon;
grant execute on function public.grant_external_exchange_consent(text, text) to authenticated;
grant execute on function public.withdraw_external_exchange_consent(uuid) to authenticated;
grant execute on function public.my_external_exchange_consents() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. external_records: immutable evidence with provenance
-- ---------------------------------------------------------------------------
create table public.external_records (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  source_system      text not null check (source_system = lower(btrim(source_system))),
  fhir_resource_type text not null check (char_length(fhir_resource_type) between 2 and 64),
  fhir_id            text,
  payload            jsonb not null,
  imported_at        timestamptz not null default now(),
  batch_id           uuid not null references public.fhir_import_batches (id) on delete restrict,
  proposal_id        uuid references public.fhir_import_proposed_resources (id) on delete set null,
  consent_id         uuid not null references public.external_exchange_consents (id) on delete restrict,
  -- proposed: a clinician can file it. stored_only: no filing path exists for this resource type yet (it is kept as evidence, never shown as record).
  disposition        text not null check (disposition in ('proposed', 'stored_only')),
  superseded_at      timestamptz,
  is_test            boolean not null default false
);
create unique index external_records_one_current on public.external_records (patient_id, source_system, fhir_resource_type, fhir_id)
  where superseded_at is null and fhir_id is not null;
create index external_records_patient_idx on public.external_records (patient_id, imported_at desc);
create index external_records_batch_idx on public.external_records (batch_id);
create index external_records_consent_idx on public.external_records (consent_id);

alter table public.external_records enable row level security;
create policy external_records_select_own on public.external_records
  for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.external_records from anon, authenticated;
grant select on public.external_records to authenticated;

create or replace function private.external_records_immutable() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'external_records_immutable' using errcode = '42501'; end if;
  if (new.id, new.patient_id, new.organisation_id, new.source_system, new.fhir_resource_type, new.fhir_id, new.payload, new.imported_at,
      new.batch_id, new.consent_id, new.disposition, new.is_test)
     is distinct from
     (old.id, old.patient_id, old.organisation_id, old.source_system, old.fhir_resource_type, old.fhir_id, old.payload, old.imported_at,
      old.batch_id, old.consent_id, old.disposition, old.is_test)
     or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at) then
    raise exception 'external_records_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.external_records_immutable() from public, anon, authenticated;
create trigger external_records_no_change before update or delete on public.external_records
  for each row execute function private.external_records_immutable();

comment on table public.external_records is
  'One immutable row per FHIR resource received from an outside system, with its source, batch and the consent it was received under. Evidence, never the clinical record: filing a value needs a clinician through fhir_import_proposed_resources.';

-- ---------------------------------------------------------------------------
-- 4. The atomic, consent-checked import writer (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.fhir_import_accept(
  p_org uuid, p_api_key uuid, p_patient uuid, p_source text, p_bundle_identifier text,
  p_raw_bundle jsonb, p_counts jsonb, p_skips jsonb, p_resources jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_src text := private.external_source_key(p_source);
  v_prof public.profiles%rowtype;
  v_consent uuid;
  v_batch uuid;
  v_existing record;
  r jsonb;
  v_prop uuid;
  v_proposed integer := 0;
  v_stored integer := 0;
begin
  if v_src is null then return jsonb_build_object('status', 'source_required'); end if;
  select * into v_prof from public.profiles where id = p_patient and organisation_id = p_org and role = 'patient';
  if not found then return jsonb_build_object('status', 'patient_not_found'); end if;

  v_consent := private.external_exchange_consent_id(p_patient, v_src, 'import');
  if v_consent is null then
    -- refused: nothing is stored, the attempt is on the audit trail
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result, subject_patient_id)
    values (p_org, null, 'fhir_import.refused_no_consent', 'patient', p_patient,
            jsonb_build_object('source_system', v_src, 'api_key_id', p_api_key), 'denied', p_patient);
    return jsonb_build_object('status', 'consent_required');
  end if;

  if p_bundle_identifier is not null then
    select id, resource_counts, skip_reasons into v_existing from public.fhir_import_batches
     where organisation_id = p_org and fhir_bundle_identifier = p_bundle_identifier;
    if found then
      return jsonb_build_object('status', 'ok', 'batch_id', v_existing.id, 'already_processed', true,
                               'resource_counts', v_existing.resource_counts, 'skip_reasons', v_existing.skip_reasons);
    end if;
  end if;

  insert into public.fhir_import_batches (organisation_id, api_key_id, patient_id, source_system, fhir_bundle_identifier, raw_bundle, resource_counts, skip_reasons)
  values (p_org, p_api_key, p_patient, v_src, p_bundle_identifier, p_raw_bundle, coalesce(p_counts, '{}'::jsonb), coalesce(p_skips, '[]'::jsonb))
  returning id into v_batch;

  for r in select * from jsonb_array_elements(coalesce(p_resources, '[]'::jsonb)) loop
    v_prop := null;
    if r -> 'normalized_payload' is not null and jsonb_typeof(r -> 'normalized_payload') = 'object' then
      -- a corrected re-send replaces a proposal nobody has acted on yet
      update public.fhir_import_proposed_resources set status = 'superseded'
       where patient_id = p_patient and status = 'proposed' and resource_type = (r ->> 'resource_type')::public.fhir_import_resource_type
         and fhir_resource_id is not null and fhir_resource_id = r ->> 'fhir_resource_id';
      insert into public.fhir_import_proposed_resources
        (batch_id, organisation_id, patient_id, resource_type, fhir_resource_id, raw_resource, normalized_payload, parse_warnings, parser_version)
      values (v_batch, p_org, p_patient, (r ->> 'resource_type')::public.fhir_import_resource_type, r ->> 'fhir_resource_id', r -> 'raw_resource',
              r -> 'normalized_payload', coalesce(r -> 'parse_warnings', '[]'::jsonb), coalesce((r ->> 'parser_version')::integer, 1))
      returning id into v_prop;
      v_proposed := v_proposed + 1;
    else
      v_stored := v_stored + 1;
    end if;

    update public.external_records set superseded_at = now()
     where patient_id = p_patient and source_system = v_src and fhir_resource_type = r ->> 'fhir_resource_type'
       and fhir_id is not null and fhir_id = r ->> 'fhir_resource_id' and superseded_at is null;
    insert into public.external_records
      (organisation_id, patient_id, source_system, fhir_resource_type, fhir_id, payload, batch_id, proposal_id, consent_id, disposition, is_test)
    values (p_org, p_patient, v_src, r ->> 'fhir_resource_type', r ->> 'fhir_resource_id', r -> 'raw_resource', v_batch, v_prop, v_consent,
            case when v_prop is null then 'stored_only' else 'proposed' end, v_prof.is_test);
  end loop;

  perform private.emit_domain_event('external_record.imported', p_org, jsonb_build_object('batch_id', v_batch),
    'external_record.imported:' || v_batch::text, p_patient, 'fhir_import_batch', v_batch);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result, subject_patient_id)
  values (p_org, null, 'fhir_import.accepted', 'fhir_import_batch', v_batch,
          jsonb_build_object('source_system', v_src, 'proposed', v_proposed, 'stored_only', v_stored), 'success', p_patient);

  return jsonb_build_object('status', 'ok', 'batch_id', v_batch, 'already_processed', false, 'proposed_count', v_proposed,
                            'stored_only_count', v_stored);
exception when unique_violation then
  -- two identical bundles raced: the other one won, answer as the idempotent retry it is
  select id, resource_counts, skip_reasons into v_existing from public.fhir_import_batches
   where organisation_id = p_org and fhir_bundle_identifier = p_bundle_identifier;
  if found then
    return jsonb_build_object('status', 'ok', 'batch_id', v_existing.id, 'already_processed', true,
                              'resource_counts', v_existing.resource_counts, 'skip_reasons', v_existing.skip_reasons);
  end if;
  raise;
end;
$$;
revoke all on function public.fhir_import_accept(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.fhir_import_accept(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Reads of external_records
-- ---------------------------------------------------------------------------
-- The person's own records from outside, with a plain source label. No staff path here: staff use the audited function below.
create or replace function public.my_external_records(p_limit integer default 100)
returns table (id uuid, source_system text, fhir_resource_type text, fhir_id text, payload jsonb, imported_at timestamptz, disposition text, superseded_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.source_system, e.fhir_resource_type, e.fhir_id, e.payload, e.imported_at, e.disposition, e.superseded_at
    from public.external_records e where e.patient_id = (select auth.uid())
   order by e.imported_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;
revoke all on function public.my_external_records(integer) from public, anon;
grant execute on function public.my_external_records(integer) to authenticated;

create or replace function public.read_patient_external_records_audited(p_patient uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if not private.can_staff_read_clinical(p_patient, 'medical_history'::public.care_access_category) then
    perform private.audit_chart_read(p_patient, array['external_records'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;
  perform private.audit_chart_read(p_patient, array['external_records'], p_reason, 'success');
  return jsonb_build_object('status', 'ok', 'records', coalesce((
    select jsonb_agg(to_jsonb(x)) from (
      select id, source_system, fhir_resource_type, fhir_id, payload, imported_at, disposition, proposal_id, superseded_at
        from public.external_records where patient_id = p_patient order by imported_at desc limit 500) x), '[]'::jsonb));
end;
$$;
revoke all on function public.read_patient_external_records_audited(uuid, text) from public, anon;
grant execute on function public.read_patient_external_records_audited(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. consent_in_force: the latest consent row for a type decides (accepted and not later withdrawn); a tie in time counts as withdrawn (fail closed). Service role only.
--    Used by the device-local health-store route (2.13) before it opens a connection or stores a sample.
-- ---------------------------------------------------------------------------
create or replace function public.consent_in_force(p_patient uuid, p_type public.consent_type) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select pc.action = 'accepted' from public.patient_consents pc
                    where pc.patient_id = p_patient and pc.consent_type = p_type order by pc.created_at desc, (pc.action = 'withdrawn') desc limit 1), false)
$$;
revoke all on function public.consent_in_force(uuid, public.consent_type) from public, anon, authenticated;
grant execute on function public.consent_in_force(uuid, public.consent_type) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('external_records', 'external_exchange_consents')
              and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')) then
    raise exception 'S44 assertion: a client role can write external_records or external_exchange_consents directly';
  end if;
  if has_function_privilege('anon', 'public.fhir_import_accept(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fhir_import_accept(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE') then
    raise exception 'S44 assertion: fhir_import_accept is callable by a client role';
  end if;
  if not exists (select 1 from public.event_types where event_type = 'external_record.imported') then
    raise exception 'S44 assertion: event type missing';
  end if;
end $$;
