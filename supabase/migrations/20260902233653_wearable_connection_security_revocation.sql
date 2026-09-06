-- Tarragon Health — Device & Data Operations (Modules 51-55), part 1/6: connection revocation.
--
-- Scope note: 2026-08-02 founder decision (CLAUDE.md "Device & Wearable Integration") is that
-- Tarragon never owns/imports/bundles a physical device fleet — patients buy their own BP
-- cuff/glucometer and either log manually or pair it if it's a curated BLE model, and wearable
-- sync is patients connecting their own Oura/WHOOP/Garmin/Fitbit/Dexcom/Apple Health/Health
-- Connect account. "Device fleet" in this codebase therefore means the FLEET OF CONNECTIONS
-- (wearable_connections + patient_devices), not a warehouse of owned hardware — this migration
-- and its five siblings build the 55.10-55.19 operations layer for that connection fleet only;
-- 55.1-55.9's inventory/procurement/logistics/warranty sections do not apply and are not built.
--
-- 55.18 "Device security" already has identity (wearable_connections.id / patient_devices.id +
-- provider/ble_device_id), authentication (OAuth tokens / BLE pairing), and secure communication
-- (webhook HMAC verification, connection-tokens.ts) shipped. Two gaps remain: revocation and audit
-- history. This migration closes revocation. (20260829021609, next in sequence, closes audit
-- history by extending the existing generic audit trigger to these two tables.)
--
-- Revocation gap, confirmed live in the codebase before writing this: a patient's "Disconnect"
-- button (wearable-connect-card.tsx) only flips wearable_connections.status to 'disconnected' —
-- it never revokes or clears the stored OAuth access_token/refresh_token, and no provider-side
-- revocation call exists anywhere in lib/wearables/ (confirmed by reading token-exchange.ts,
-- connection-tokens.ts, webhook-auth.ts in full). A "disconnected" connection's credentials
-- therefore sit live in the database indefinitely. public.revoke_wearable_connection() below is a
-- strict hardening of that same action: same authorisation (the connection's own patient, or org
-- staff), but now nulls the stored credentials and stamps who/why. The existing raw
-- `update wearable_connections set status = ...` UI action should be migrated to call this RPC
-- instead (app-layer follow-up, not this migration).
--
-- patient_devices (BLE clinical devices) has no equivalent gap to close the same way: a patient
-- unpairing their own device is already a plain, patient-writable `status = 'unpaired'` update
-- (full CRUD grant, RLS-gated by patient_id = auth.uid() OR is_org_staff — unchanged here), and
-- there is nothing analogous to an OAuth token to null. What patient_devices lacks is
-- accountability: who unpaired it and why. private.stamp_patient_device_unpair() below adds that
-- the same way clinician_alerts' stamp_lifecycle trigger derives resolved_by/closed_by — the
-- server always stamps who/when on the active->unpaired transition, never trusting a client-
-- supplied value, while still accepting a free-text reason from the caller (matching how
-- snooze_reason/resolution_action are trusted free text elsewhere in this codebase).

alter table public.wearable_connections
  add column revoked_at        timestamptz,
  add column revoked_by        uuid references public.profiles (id) on delete set null,
  add column revocation_reason text;

comment on column public.wearable_connections.revoked_at is
  'Set only by public.revoke_wearable_connection() — never directly writable by any authenticated role (deliberately absent from every column-level UPDATE grant on this table, patient and staff alike). A plain patient-initiated "Disconnect" that has not gone through the revoke RPC leaves this null.';

-- Deliberately SELECT-only for authenticated (transparency: a patient/staff member can see a
-- connection was revoked and why) — no UPDATE grant on these three columns for any authenticated
-- role. Only the SECURITY DEFINER RPC below (which runs as table owner) can set them.
grant select (revoked_at, revoked_by, revocation_reason) on public.wearable_connections to authenticated;

-- A table-level `grant update` (from this table's original migration) implicitly covers every
-- column, present and future — adding the three columns above would otherwise silently hand
-- authenticated direct UPDATE on revoked_at/revoked_by/revocation_reason too, defeating the point
-- of routing revocation exclusively through the RPC below. Revoke the table-level grant and
-- re-grant the explicit column list every other write path on this table actually needs.
revoke update on public.wearable_connections from authenticated;
grant update (
  status, access_token, refresh_token, token_expires_at, last_sync_error, last_synced_at,
  sync_cursor, consent_activity, consent_heart_rate, consent_sleep, consent_weight,
  connected_at, created_at, external_id, id, organisation_id, patient_id, provider
) on public.wearable_connections to authenticated;

alter table public.patient_devices
  add column unpaired_at     timestamptz,
  add column unpaired_by     uuid references public.profiles (id) on delete set null,
  add column unpaired_reason text;

create or replace function private.stamp_patient_device_unpair()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'unpaired' and old.status = 'active' then
    new.unpaired_at := now();
    new.unpaired_by := (select auth.uid());
    -- unpaired_reason is trusted free text from the caller (patient self-report, e.g. "lost
    -- phone", or a staff-entered reason) — only who/when are server-derived, never client-settable.
  elsif old.status = 'unpaired' then
    -- Already unpaired; an unrelated later edit must not re-stamp or clear the original record.
    new.unpaired_at := old.unpaired_at;
    new.unpaired_by := old.unpaired_by;
    new.unpaired_reason := old.unpaired_reason;
  end if;
  return new;
end;
$$;

comment on function private.stamp_patient_device_unpair() is
  'BEFORE UPDATE on patient_devices. Server-derives unpaired_at/unpaired_by on the active->unpaired transition (never client-supplied, never re-stamped by a later edit); unpaired_reason stays caller-supplied free text. Same "RLS admits broadly, a trigger stamps accountability" shape as private.stamp_clinician_alert_lifecycle().';

create trigger patient_devices_stamp_unpair
  before update on public.patient_devices
  for each row execute function private.stamp_patient_device_unpair();

-- ---------------------------------------------------------------------------
-- Revocation RPC — the connection's own patient, or org staff, may revoke.
-- Nulls the stored OAuth credentials (the actual security effect — see header
-- for why the existing "Disconnect" UI action does not already do this) and
-- stamps revoked_at/revoked_by/revocation_reason.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_wearable_connection(p_connection_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid;
  v_patient  uuid;
  v_reason   text;
begin
  select organisation_id, patient_id into v_org, v_patient
  from public.wearable_connections
  where id = p_connection_id
  for update;

  if v_org is null then
    raise exception 'wearable connection % not found', p_connection_id;
  end if;

  if not (v_patient = (select auth.uid()) or private.is_org_staff(v_org)) then
    raise exception 'not authorised: only the connection''s own patient or org staff may revoke it';
  end if;

  v_reason := coalesce(
    nullif(p_reason, ''),
    case when v_patient = (select auth.uid()) then 'Patient-initiated disconnect' else 'Revoked by care team' end
  );

  update public.wearable_connections
  set status              = 'disconnected',
      access_token        = null,
      refresh_token       = null,
      token_expires_at    = null,
      revoked_at          = now(),
      revoked_by          = (select auth.uid()),
      revocation_reason   = v_reason,
      last_sync_error     = null
  where id = p_connection_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_org, (select auth.uid()), 'wearable_connections.revoked', 'wearable_connections', p_connection_id,
    jsonb_build_object('reason', v_reason, 'self_revoked', v_patient = (select auth.uid()))
  );
end;
$$;

comment on function public.revoke_wearable_connection(uuid, text) is
  '55.18 revocation capability. Callable by the connection''s own patient or org staff. Disconnects AND nulls the stored OAuth access/refresh tokens (a real hardening over the plain status-flip the patient dashboard''s "Disconnect" button currently performs — see this migration''s header) and stamps who/why via audit_log.';

revoke all on function public.revoke_wearable_connection(uuid, text) from public;
revoke all on function public.revoke_wearable_connection(uuid, text) from anon;
grant execute on function public.revoke_wearable_connection(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'wearable_connections' and column_name = 'revoked_at'
  ) then
    raise exception 'wearable_connections.revoked_at was not created';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'patient_devices' and column_name = 'unpaired_at'
  ) then
    raise exception 'patient_devices.unpaired_at was not created';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'patient_devices_stamp_unpair'
      and tgrelid = 'public.patient_devices'::regclass and not tgisinternal
  ) then
    raise exception 'patient_devices_stamp_unpair trigger was not created';
  end if;
  if has_function_privilege('anon', 'public.revoke_wearable_connection(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.revoke_wearable_connection';
  end if;
  if not has_function_privilege('authenticated', 'public.revoke_wearable_connection(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute public.revoke_wearable_connection';
  end if;
  if has_column_privilege('authenticated', 'public.wearable_connections', 'revoked_by', 'UPDATE') then
    raise exception 'FAIL: authenticated must not have direct UPDATE on wearable_connections.revoked_by';
  end if;
  raise notice 'PASS: revocation columns, unpair-stamp trigger, and revoke_wearable_connection() all in place';
end $$;
