-- S42 (v5 Module 1, part 2): the privacy centre, spec functions 1.15 (export and deletion) and the module events.
-- Design: docs/design/S42.md. Not applied to production by this session.
--
-- Counted first (live, 2026-10-07): data_export_requests and data_deletion_requests are admin-reviewed workflows (founder
-- 2026-09-07, OQ-50: kept as they are). There is no anonymiser: "deletion" has been a manual, case by case process. Retention:
-- data_retention_policies governs six categories; clinical, trail, financial, consent and communications tables are retained
-- (no confirmed statutory period yet), so nothing in them may be deleted by a patient's request.
--
-- What this adds:
--   1. data_export_requests.artifact_path / artifact_generated_at: stamped when an admin fulfils a request. The path is the
--      logical key of the export (data-exports/<patient>/<request>); the JSON and PDF are rendered from the live record at
--      download time by the patient's own session (no copy of a person's record is parked in storage).
--   2. private.table_is_retained(): the retention policy as code. The anonymiser consults it before touching any table.
--   3. private.anonymise_patient_account(): removes identity and every non-retained personal row, keeps the retained record
--      (pseudonymised: the rows stay, the person's identifiers do not). public.complete_account_deletion(): admin only, one
--      approved request, one result, written to the request and the audit log.
--   4. Module 1 events: account.created, account.phone_verified (never block a sign-up: a failure is a warning),
--      account.deleted. consent.changed is in the consent matrix migration.

-- ---------------------------------------------------------------------------
-- 1. Export artifact
-- ---------------------------------------------------------------------------
alter table public.data_export_requests add column artifact_path text;
alter table public.data_export_requests add column artifact_generated_at timestamptz;
comment on column public.data_export_requests.artifact_path is
  'S42: logical key of the fulfilled export (data-exports/<patient>/<request>). The JSON and PDF are rendered on download from the live record under the patient''s own session; no file is stored.';

create function private.stamp_export_artifact() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status = 'fulfilled' and old.status is distinct from 'fulfilled' then
    new.artifact_path := 'data-exports/' || new.patient_id::text || '/' || new.id::text;
    new.artifact_generated_at := now();
  end if;
  return new;
end $$;
revoke all on function private.stamp_export_artifact() from public, anon, authenticated;
create trigger data_export_requests_stamp_artifact before update on public.data_export_requests
  for each row execute function private.stamp_export_artifact();

-- Rows already fulfilled before this change get their logical key too.
update public.data_export_requests set artifact_path = 'data-exports/' || patient_id::text || '/' || id::text,
       artifact_generated_at = coalesce(fulfilled_at, now())
 where status = 'fulfilled' and artifact_path is null;

-- ---------------------------------------------------------------------------
-- 2. Retention as code
-- ---------------------------------------------------------------------------
create function private.table_is_retained(p_table text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.data_retention_policies r
                  where r.is_active and r.category <> 'marketing_and_analytics' and p_table = any (r.governing_tables))
$$;
revoke all on function private.table_is_retained(text) from public, anon, authenticated;

alter table public.data_deletion_requests add column anonymisation_summary jsonb;
comment on column public.data_deletion_requests.anonymisation_summary is
  'S42: what complete_account_deletion did: counts removed per table, tables kept under a retention category, and when.';

-- ---------------------------------------------------------------------------
-- 3. The anonymiser
-- ---------------------------------------------------------------------------
create function private.anonymise_patient_account(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles%rowtype;
  v_removed jsonb := '{}'::jsonb;
  v_kept text[] := '{}';
  v_n integer;
  t text;
  r record;
begin
  select * into p from public.profiles where id = p_patient;
  if not found or p.role <> 'patient' then raise exception 'anonymise_not_a_patient' using errcode = '22023'; end if;
  if p.full_name = 'Deleted account' then raise exception 'anonymise_already_done' using errcode = '23505'; end if;

  -- 3a. Rows that exist only to serve the person, outside every retention category: removed. Each is checked against the
  --     retention policy first, so a table added to a retention category later is skipped, not deleted.
  foreach t in array array['push_subscriptions', 'patient_notification_preferences', 'onboarding_answers', 'patient_devices'] loop
    if private.table_is_retained(t) then v_kept := v_kept || t; continue; end if;
    execute format('delete from public.%I where %s = $1', t, case when t = 'push_subscriptions' then 'profile_id' else 'patient_id' end) using p_patient;
    get diagnostics v_n = row_count;
    v_removed := v_removed || jsonb_build_object(t, v_n);
  end loop;

  if not private.table_is_retained('proxy_setups') then
    delete from public.proxy_setups where created_by_profile_id = p_patient or confirmed_profile_id = p_patient;
    get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('proxy_setups', v_n);
  end if;
  if not private.table_is_retained('care_circle_members') then
    delete from public.care_circle_members where patient_id = p_patient or supporter_id = p_patient;
    get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('care_circle_members', v_n);
    delete from public.care_circle_invites where patient_id = p_patient;
    get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('care_circle_invites', v_n);
  end if;
  -- Anyone who could see this record, or whose record this person could see, loses that link.
  delete from public.profile_access where profile_id = p_patient or grantee_user_id = p_patient;
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('profile_access', v_n);

  -- Connected-app tokens: disconnected and the secrets nulled (the readings themselves are clinical and stay).
  update public.wearable_connections set status = 'disconnected', access_token = null, refresh_token = null where patient_id = p_patient;
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('wearable_connections_tokens_cleared', v_n);

  -- 3b. Optional consents switch off (history stays: consent evidence is retained). Required cells cannot be withdrawn and
  --     do not need to be: the account is closed.
  for r in select data_type, purpose from public.consent_matrix_cells where not required_for_care loop
    perform private.record_consent_cell(p_patient, p.organisation_id, p.is_test, r.data_type, r.purpose, false, 'account_closure', null, p_patient);
  end loop;

  -- 3c. Identity. The clinical record is kept under its retention category but no longer says whose it is.
  update public.profiles set
      full_name = 'Deleted account', phone = null, avatar_url = null, state = null, city = null, area = null, lga = null,
      emergency_contact_name = null, emergency_contact_phone = null, emergency_contact_relationship = null,
      next_of_kin_name = null, next_of_kin_phone = null, emergency_contact_consent = false,
      date_of_birth = case when date_of_birth is null then null else make_date(extract(year from date_of_birth)::integer, 1, 1) end,
      metadata = '{}'::jsonb, marketing_opt_in = false, is_active = false
    where id = p_patient;

  -- Sign-in: the login is closed and cannot be recovered (no email, no phone, no password, no session).
  delete from auth.sessions where user_id = p_patient;
  delete from auth.identities where user_id = p_patient;
  update auth.users set email = 'deleted-' || p_patient::text || '@deleted.invalid', phone = null, encrypted_password = '',
         raw_user_meta_data = '{}'::jsonb, banned_until = 'infinity', email_change = '', phone_change = '',
         updated_at = now()
   where id = p_patient;

  return jsonb_build_object(
    'removed', v_removed,
    'skipped_as_retained', to_jsonb(v_kept),
    'retained_categories', (select coalesce(jsonb_agg(c.category order by c.category), '[]'::jsonb) from public.data_retention_policies c where c.is_active and c.category <> 'marketing_and_analytics'),
    'identity_removed', true,
    'at', now());
end $$;
revoke all on function private.anonymise_patient_account(uuid) from public, anon, authenticated;

create function public.complete_account_deletion(p_request uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  d public.data_deletion_requests%rowtype;
  v_summary jsonb;
begin
  if v_uid is null or not private.is_admin() then raise exception 'deletion_not_authorised' using errcode = '42501'; end if;
  select * into d from public.data_deletion_requests where id = p_request for update;
  if not found then raise exception 'deletion_request_not_found' using errcode = 'P0002'; end if;
  if d.status not in ('approved_full', 'approved_partial') then
    raise exception 'deletion_request_not_approved' using errcode = '23514';
  end if;
  v_summary := private.anonymise_patient_account(d.patient_id);
  update public.data_deletion_requests
     set status = 'completed', completed_by = v_uid, completed_at = now(), anonymisation_summary = v_summary
   where id = p_request;
  perform private.emit_domain_event('account.deleted', d.organisation_id, jsonb_build_object('request_id', p_request),
            'account.deleted:' || d.patient_id::text, null, 'data_deletion_request', p_request);
  perform private.log_audit('account.anonymised', 'data_deletion_request', p_request, v_summary - 'at');
  return v_summary;
end $$;
revoke all on function public.complete_account_deletion(uuid) from public, anon;
grant execute on function public.complete_account_deletion(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Module 1 events
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('account.created', 'A patient account was created (ids only)', 'S42', false),
  ('account.phone_verified', 'A patient confirmed their phone number (ids only)', 'S42', false),
  ('account.deleted', 'A patient account was anonymised after an approved deletion request (ids only)', 'S42', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('account.created', 1, array[]::text[]),
  ('account.phone_verified', 1, array[]::text[]),
  ('account.deleted', 1, array['request_id'])
on conflict do nothing;

create function private.emit_account_created() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.role = 'patient' and new.organisation_id is not null then
    begin
      perform private.emit_domain_event('account.created', new.organisation_id, '{}'::jsonb, 'account.created:' || new.id::text, new.id, 'profile', new.id);
    exception when others then
      raise warning 'account.created not emitted: %', sqlerrm;  -- a sign-up never fails because of an event
    end;
  end if;
  return new;
end $$;
revoke all on function private.emit_account_created() from public, anon, authenticated;
create trigger profiles_emit_account_created after insert on public.profiles
  for each row execute function private.emit_account_created();

create function private.emit_phone_verified() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid;
begin
  select organisation_id into v_org from public.profiles where id = new.id and role = 'patient';
  if v_org is not null then
    begin
      perform private.emit_domain_event('account.phone_verified', v_org, '{}'::jsonb, 'account.phone_verified:' || new.id::text || ':' || regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), new.id, 'profile', new.id);
    exception when others then
      raise warning 'account.phone_verified not emitted: %', sqlerrm;
    end;
  end if;
  return new;
end $$;
revoke all on function private.emit_phone_verified() from public, anon, authenticated;
create trigger auth_users_emit_phone_verified after update of phone_confirmed_at on auth.users
  for each row when (old.phone_confirmed_at is null and new.phone_confirmed_at is not null)
  execute function private.emit_phone_verified();

-- ---------------------------------------------------------------------------
-- 5. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.complete_account_deletion(uuid)', 'EXECUTE') then raise exception 'S42: anon can complete a deletion'; end if;
  if has_function_privilege('authenticated', 'private.anonymise_patient_account(uuid)', 'EXECUTE') then raise exception 'S42: anonymiser callable by a session'; end if;
  if not private.table_is_retained('vitals_readings') then raise exception 'S42: vitals_readings is not under a retention category'; end if;
  if private.table_is_retained('push_subscriptions') then raise exception 'S42: push_subscriptions unexpectedly retained'; end if;
end $$;
