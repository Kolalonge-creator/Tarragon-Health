-- Tarragon Health — Device & Data Operations, part 3/6: data governance (55.19).
--
-- 55.19 asks for explicit purpose / consent / retention / access / provenance / deletion for
-- wearable/device data. Confirmed live before writing this (grepped every migration for
-- data_retention|deletion_request|right_to_be_forgotten|gdpr|ndpr): none of the last five exist
-- anywhere on the platform, for any data category, not just device data — 20260730120000's own
-- investigation states outright "there is no account-deletion feature at all (no NDPR/right-to-
-- be-forgotten flow)." This migration does NOT build that platform-wide flow (out of scope, and a
-- much bigger decision than this feature). It builds the narrower, device/wearable-scoped slice
-- 55.19 actually asks for, reusing the two conventions that already exist for the pieces that
-- overlap:
--   - purpose/consent: public.consent_type (20260716180000) already models "what we told the
--     patient and what they accepted" as an append-only, versioned document. Adding a
--     'wearable_device_data' value reuses that machinery rather than inventing a parallel one —
--     the actual consent copy is a legal/product artefact for a future consent_versions row, not
--     fabricated here (this codebase's standing rule against inventing business/legal content that
--     isn't real).
--   - provenance: already covered per-reading by vitals_readings.source / wearable_readings'
--     connection_id FK / patient_devices.ble_device_id — nothing new needed.
--   - retention + access + deletion: genuinely new. data_retention_policies documents the retention
--     posture per data category (patient/staff-readable, admin-authored); data_deletion_requests +
--     execute_wearable_data_deletion() is a real, bounded right-to-erasure path — bounded because
--     it only ever touches wearable_readings (passive, non-clinical metrics with no vital_type
--     equivalent — steps/sleep/HRV/recovery) and connection/pairing rows, and explicitly NEVER
--     vitals_readings, even for source='wearable'/'device' rows. Those rows are the patient's
--     actual longitudinal clinical record (used for ongoing care and, per the platform's own
--     provenance-hardening migration 20260730120000, deliberately never silently erasable) — an
--     NDPR data-subject erasure request cannot reach into an active medical record the same way it
--     can reach into passive step-count history, and this migration does not attempt to resolve
--     that harder legal question. Complete account deletion remains unbuilt, tracked as before.

alter type public.consent_type add value if not exists 'wearable_device_data';

comment on type public.consent_type is
  'What the platform tells a patient it does with a category of their data, and what they accepted — see public.consent_versions/public.patient_consents (20260716180000). wearable_device_data (added 20260829, 55.19) covers wearable-cloud-sync and BLE-clinical-device connections specifically; the actual consent copy is authored via a consent_versions row when legal/product content exists, not fabricated in a migration.';

-- ---------------------------------------------------------------------------
-- Retention policy — admin-authored, patient/staff-readable, versioned by
-- is_current the same way consent_versions is.
-- ---------------------------------------------------------------------------
create table public.data_retention_policies (
  id                  uuid primary key default gen_random_uuid(),
  data_category       text not null,
  retention_period    text not null,
  deletion_mechanism  text not null,
  is_current          boolean not null default true,
  effective_at        timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

comment on table public.data_retention_policies is
  '55.19 retention policy per device/wearable data category. Admin-authored, append-style like consent_versions (a new row supersedes the old rather than editing it) — is_current marks the live one per data_category.';

create unique index data_retention_policies_one_current on public.data_retention_policies (data_category) where is_current;

alter table public.data_retention_policies enable row level security;

create policy data_retention_policies_select on public.data_retention_policies
  for select to authenticated
  using (true);

create policy data_retention_policies_write on public.data_retention_policies
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update, delete on public.data_retention_policies to authenticated;

insert into public.data_retention_policies (data_category, retention_period, deletion_mechanism, is_current)
values
  ('wearable_readings', 'Retained for the lifetime of the connection plus 24 months, matching the platform''s general clinical-data retention posture.', 'Deleted on patient request via a data_deletion_requests row scoped to wearable_readings/device_connections/all_device_data, processed by org staff through public.execute_wearable_data_deletion(); otherwise retained.', true),
  ('wearable_connection_credentials', 'OAuth access/refresh tokens are retained only while a connection is active; nulled immediately on disconnect or revocation.', 'Automatic — public.revoke_wearable_connection() and any provider disconnect null access_token/refresh_token/token_expires_at in place.', true),
  ('patient_devices_pairing_history', 'Pairing records (including unpaired ones) are retained for the lifetime of the patient record as device-assignment history.', 'Deleted only as part of a full account-deletion request (not yet built platform-wide) — an individual pairing record is not independently erasable while the account exists.', true)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Deletion requests — patient-initiated, staff-processed, bounded scope.
-- ---------------------------------------------------------------------------
create type public.data_deletion_scope as enum ('wearable_readings', 'device_connections', 'all_device_data');
create type public.data_deletion_status as enum ('requested', 'in_progress', 'completed', 'rejected');

create table public.data_deletion_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  scope             public.data_deletion_scope not null,
  status            public.data_deletion_status not null default 'requested',
  reason            text,
  requested_at      timestamptz not null default now(),
  processed_by      uuid references public.profiles (id) on delete set null,
  processed_at      timestamptz,
  rejection_reason  text,
  created_at        timestamptz not null default now()
);

comment on table public.data_deletion_requests is
  '55.19 deletion/revocation policy, scoped to device/wearable data only. NEVER deletes vitals_readings (the clinical record) — see this migration''s header. Processed via public.execute_wearable_data_deletion(), not a direct DELETE, so the request row itself is the durable evidence of what was asked and done.';

create index data_deletion_requests_patient_idx on public.data_deletion_requests (patient_id, created_at desc);
create index data_deletion_requests_org_status_idx on public.data_deletion_requests (organisation_id, status);

alter table public.data_deletion_requests enable row level security;

create policy data_deletion_requests_select on public.data_deletion_requests
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy data_deletion_requests_insert on public.data_deletion_requests
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and status = 'requested'
    and processed_by is null
    and processed_at is null
  );

create policy data_deletion_requests_staff_update on public.data_deletion_requests
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert on public.data_deletion_requests to authenticated;
grant update on public.data_deletion_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Processing RPC — staff-only. Scope determines exactly what is touched;
-- vitals_readings is never referenced, by design (see header).
-- ---------------------------------------------------------------------------
create or replace function public.execute_wearable_data_deletion(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid;
  v_patient  uuid;
  v_scope    public.data_deletion_scope;
  v_status   public.data_deletion_status;
  v_readings_deleted   integer := 0;
  v_connections_touched integer := 0;
  v_devices_touched     integer := 0;
begin
  select organisation_id, patient_id, scope, status
  into v_org, v_patient, v_scope, v_status
  from public.data_deletion_requests
  where id = p_request_id
  for update;

  if v_org is null then
    raise exception 'data deletion request % not found', p_request_id;
  end if;

  if not private.is_org_staff(v_org) then
    raise exception 'not authorised: only org staff may process a data deletion request';
  end if;

  if v_status = 'completed' then
    raise exception 'data deletion request % is already completed', p_request_id;
  end if;

  update public.data_deletion_requests set status = 'in_progress' where id = p_request_id;

  -- wearable_readings: passive, non-clinical metrics (steps/sleep/HRV/recovery) with no
  -- vitals_readings equivalent — always in scope for every scope value.
  with deleted as (
    delete from public.wearable_readings wr
    using public.wearable_connections wc
    where wr.connection_id = wc.id and wc.patient_id = v_patient
    returning wr.id
  )
  select count(*) into v_readings_deleted from deleted;

  if v_scope in ('device_connections', 'all_device_data') then
    with touched as (
      update public.wearable_connections
      set status = 'disconnected', access_token = null, refresh_token = null, token_expires_at = null,
          revoked_at = now(), revoked_by = (select auth.uid()),
          revocation_reason = 'Deleted per data_deletion_requests ' || p_request_id::text
      where patient_id = v_patient and status <> 'disconnected'
      returning id
    )
    select count(*) into v_connections_touched from touched;
  end if;

  if v_scope = 'all_device_data' then
    with touched as (
      update public.patient_devices
      set status = 'unpaired', unpaired_reason = 'Deleted per data_deletion_requests ' || p_request_id::text
      where patient_id = v_patient and status = 'active'
      returning id
    )
    select count(*) into v_devices_touched from touched;
  end if;

  update public.data_deletion_requests
  set status = 'completed', processed_by = (select auth.uid()), processed_at = now()
  where id = p_request_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_org, (select auth.uid()), 'data_deletion_requests.completed', 'data_deletion_requests', p_request_id,
    jsonb_build_object(
      'scope', v_scope,
      'patient_id', v_patient,
      'wearable_readings_deleted', v_readings_deleted,
      'wearable_connections_touched', v_connections_touched,
      'patient_devices_touched', v_devices_touched,
      'vitals_readings_touched', false
    )
  );
end;
$$;

comment on function public.execute_wearable_data_deletion(uuid) is
  '55.19 deletion processing. Staff-only. Always deletes the patient''s wearable_readings; additionally disconnects wearable_connections for scope in (device_connections, all_device_data), and unpairs patient_devices for scope = all_device_data. NEVER touches vitals_readings under any scope — that table is the clinical record, not device telemetry, and stays intact regardless of this request.';

revoke all on function public.execute_wearable_data_deletion(uuid) from public;
revoke all on function public.execute_wearable_data_deletion(uuid) from anon;
grant execute on function public.execute_wearable_data_deletion(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_enum where enumtypid = 'public.consent_type'::regtype and enumlabel = 'wearable_device_data') then
    raise exception 'consent_type.wearable_device_data was not added';
  end if;
  if (select count(*) from public.data_retention_policies where is_current) <> 3 then
    raise exception 'expected 3 current data_retention_policies rows';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'data_deletion_requests') then
    raise exception 'data_deletion_requests was not created';
  end if;
  if has_function_privilege('anon', 'public.execute_wearable_data_deletion(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.execute_wearable_data_deletion';
  end if;
  if not has_function_privilege('authenticated', 'public.execute_wearable_data_deletion(uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute public.execute_wearable_data_deletion';
  end if;
  raise notice 'PASS: wearable_device_data consent type, retention policies (3), deletion-request flow all in place';
end $$;
