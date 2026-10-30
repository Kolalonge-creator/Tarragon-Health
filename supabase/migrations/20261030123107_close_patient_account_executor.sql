-- OQ-S04b2-2: the reviewed "close account" step an admin runs from an approved, past-grace data_deletion_requests row.
-- Founder decision (option a): build it, using the S39d registry classes. The admin presses one button; nothing runs by itself.
--
-- What it does, in ONE transaction (a function body is one transaction, so a failure anywhere leaves the account exactly as it was):
--   1. Removes every row of the patient in a registry table whose class is 'operational' (reminders, preferences, Care Circle tasks and
--      check-ins, the home layout, ...). The registry is read, not copied: a table added to the registry as operational is picked up
--      with no change here. Any other class (clinical_record, mental_health, maternity, consent, financial, audit) is NEVER deleted:
--      the delete helper refuses by itself if it is ever asked to touch one, and also refuses a table under a data_retention_policies
--      category. Two operational tables are append-only by design (wellness_points_ledger, clinician_time_entries: a points ledger and a
--      staff time record). They are named below and left alone; the registry class of both is a question for the S39d reviewers.
--   2. Removes the account-level rows that are keyed on the profile, not the patient, so they are outside the registry: push
--      subscriptions, the list of signed-in devices, quiet-hours settings.
--   3. Ends device connections: paired devices are unpaired, wearable connections are disconnected and their tokens nulled. The
--      readings those devices sent are part of the clinical record (class clinical_record) and are kept.
--   4. Revokes sharing: Care Circle members and invites, profile_access grants (in both directions: those over this record and those
--      this person held over others), pending access requests, record share links, the emergency card, emergency access grants.
--      No notice is sent to the people who lose access (a "you were removed" message can cause conflict at home, see S29).
--   5. Removes contact details: phone, emergency contact, next of kin, photo, street-level area, and the sign-in itself (email, phone,
--      password, sessions, identities). The name and date of birth stay: they identify the retained clinical record.
--   6. For a request still in approved_full / approved_partial it then marks the request completed through the existing trigger
--      (private.enforce_data_deletion_request_attribution), which deactivates the profile, bans the login and writes a withdrawal row for
--      every consent still in force. This function never deletes a profile: patient_consents.patient_id and
--      data_deletion_requests.patient_id cascade from profiles, so a delete would erase the consent history and the deletion record the
--      privacy page promises to keep. purge_test_account stays the only function that removes a profile.
--   7. Writes one audit_log row (data_deletion.account_closed) holding the summary, which is also the idempotency marker, and the same
--      summary into data_deletion_requests.anonymisation_summary when it completes the request.
--   A final check inside the function raises (and so rolls everything back) if the profile is still active, the login is not banned,
--   or an active sharing grant is left: there is no half-closed account.
--
-- Also in this file (section 0): private.enforce_patient_consent_withdrawal() is put back to its S04b-2 definition. Live had been overwritten
-- by S42's older body, which makes the existing completion trigger (and so this function) fail on the first required consent it withdraws.
--
-- Refuses: a non-admin; a request that is not approved (or already completed); a request whose grace period has not ended
-- (grace_ends_at null = older than the grace feature = treated as ended, as the trigger does); a profile that is not a patient.
-- Idempotent: a second run on the same request returns the first summary and changes nothing. A request an admin completed by hand
-- (the old manual path) can be run through this once to finish the removal; it will not touch the request row.
--
-- NOTE for reviewers (not changed here): S42 already added public.complete_account_deletion / private.anonymise_patient_account. That
-- path renames the person "Deleted account", reduces the date of birth to a year and deletes patient_devices, which is the opposite of
-- the kept list on the privacy page and of OQ-262. Nothing in the app calls it. It is left untouched; OQ-S04b2-2 asks for it to be
-- retired once the founder confirms.
--
-- Counted first (live koiplnmbgnqnbywhpjlf, 2026-10-30): 19 operational registry tables; data_deletion_requests rows that are approved
-- and past grace: see OQ-S04b2-2. Nothing is run against real data by this migration: it only creates functions.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 0. Put the S04b-2 consent trigger back (found while dry-running this against live, 2026-10-30).
--    Live private.enforce_patient_consent_withdrawal() is the OLDER S42 body (20261007230822), not S04b-2's (20261013181937): the S42
--    migration was applied to production after S04b-2 and its create-or-replace overwrote it, although a fresh replay in file order ends
--    on S04b-2's. Live therefore (a) refuses EVERY signed-in withdrawal of a required consent with consent_required_for_care, which is
--    what the existing completion trigger does when an admin marks a deletion request completed (so that path fails today, and so would
--    this function), and (b) derives none of the receipt columns. The text below is S04b-2's function, verbatim from
--    20261013181937_s04b2_consent_receipts_withdrawal_rule_deletion_grace.sql; nothing in it is new.
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function private.enforce_patient_consent_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cv public.consent_versions%rowtype;
  v_current record;
  v_active boolean;
begin
  -- A request that arrives through the API (PostgREST runs it as role 'authenticated') may only act for the person themself or, for a
  -- dependant account, their guardian. Checked before any lookup, so a stranger learns nothing about someone else's consents from the
  -- error they get back. Migrations, proofs and the account-closing step below are not API requests.
  if v_uid is not null
     and coalesce(current_setting('role', true), '') in ('authenticated', 'anon')
     and v_uid <> new.patient_id
     and coalesce(current_setting('app.closing_account', true), '') <> 'on'
     and not (private.can_act_for(new.patient_id)
              and exists (select 1 from public.profiles d where d.id = new.patient_id and d.is_dependent_account)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- When: a signed-in session cannot choose the time (it decides which acceptance is in force and what the receipt shows).
  -- clock_timestamp(), not now(), so two choices in one transaction still order. A service or migration context keeps what it supplied.
  if v_uid is not null and coalesce(current_setting('role', true), '') in ('authenticated', 'anon') then
    new.created_at := clock_timestamp();
    new.accepted_at := new.created_at;
  end if;

  -- Who is acting, derived (never client-supplied), and the channel label that is believable for that actor.
  if v_uid is null then
    new.consented_by := null;
    new.consented_by_relation := 'system';
    new.channel := coalesce(new.channel, 'system');
  else
    new.consented_by := v_uid;
    if v_uid = new.patient_id then
      new.consented_by_relation := 'self';
    elsif private.can_act_for(new.patient_id)
          and exists (select 1 from public.profiles d where d.id = new.patient_id and d.is_dependent_account) then
      new.consented_by_relation := 'guardian';
    else
      new.consented_by_relation := 'staff';
    end if;
    if new.consented_by_relation = 'staff' then
      new.channel := 'staff_assisted';
    else
      new.channel := coalesce(new.channel, 'unknown');
      if new.channel not in ('web', 'mobile', 'unknown') then
        raise exception 'a patient or guardian can only record a choice made on the web or in the app' using errcode = '23514';
      end if;
    end if;
  end if;

  if new.action <> 'withdrawn' then
    -- The version row decides the version string and type; a mismatched or draft version cannot be accepted.
    select * into v_cv from public.consent_versions where id = new.consent_version_id;
    if not found or v_cv.consent_type <> new.consent_type then
      raise exception 'the consent version does not match the consent type' using errcode = '23514';
    end if;
    if v_cv.is_draft then
      raise exception 'drafted consent wording cannot be accepted' using errcode = '23514';
    end if;
    -- A signed-in person accepts the wording in force. If it changed while their screen was open they must read the new words.
    if v_uid is not null and coalesce(current_setting('role', true), '') in ('authenticated', 'anon') and not v_cv.is_current then
      raise exception 'this wording has been replaced; reload the page and read the current version' using errcode = '23514';
    end if;
    new.version := v_cv.version;
    new.text_sha256 := encode(sha256(convert_to(v_cv.title || E'\n' || v_cv.body, 'UTF8')), 'hex');
    return new;
  end if;

  -- The acceptance currently in force for this (patient, consent_type): the most recent 'accepted' row with no later
  -- 'withdrawn' row after it.
  select pc.consent_version_id, pc.version
  into v_current
  from public.patient_consents pc
  where pc.patient_id = new.patient_id
    and pc.consent_type = new.consent_type
    and pc.action = 'accepted'
    and not exists (
      select 1 from public.patient_consents pc2
      where pc2.patient_id = pc.patient_id
        and pc2.consent_type = pc.consent_type
        and pc2.action = 'withdrawn'
        and pc2.created_at > pc.created_at
    )
  order by pc.created_at desc
  limit 1;

  if v_current.consent_version_id is null then
    raise exception 'No currently-accepted % consent on file to withdraw', new.consent_type
      using errcode = '23514';
  end if;

  select * into v_cv from public.consent_versions where id = v_current.consent_version_id;

  -- OQ-53: a required consent is not withdrawable while the account is active. A signed-in person who wants to stop it
  -- closes the account (a data deletion request). A service or migration context (no auth.uid()) is not blocked.
  if v_uid is not null and not v_cv.is_optional and coalesce(current_setting('app.closing_account', true), '') <> 'on' then
    -- 'Closed' means a completed deletion request on a deactivated profile. is_active alone is not enough: a suspended patient is not a
    -- closed one.
    select coalesce(p.is_active, true) or not exists (
             select 1 from public.data_deletion_requests r where r.patient_id = new.patient_id and r.status = 'completed')
      into v_active from public.profiles p where p.id = new.patient_id;
    if coalesce(v_active, true) then
      raise exception 'A required consent cannot be withdrawn while your account is active. To stop it, close your account.'
        using errcode = '23514';
    end if;
  end if;

  new.consent_version_id := v_current.consent_version_id;
  new.version := v_current.version;
  new.accepted_at := coalesce(new.created_at, now());
  new.text_sha256 := encode(sha256(convert_to(v_cv.title || E'\n' || v_cv.body, 'UTF8')), 'hex');
  return new;
end;
$$;
revoke all on function private.enforce_patient_consent_withdrawal() from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. The only delete helper. It refuses anything that is not an operational registry table or a profile-keyed account table.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function private.close_account_remove_rows(p_table text, p_expr text, p_patient uuid) returns integer
language plpgsql security definer set search_path = '' as
$$
declare
  v_class text;
  v_n integer;
begin
  if to_regclass('public.' || quote_ident(p_table)) is null then
    raise exception 'close account: % is not a table (a stale registry row must be fixed, not skipped)', p_table using errcode = '42P01';
  end if;
  select retention_class into v_class from public.data_registry where table_name = p_table;
  if v_class is not null and v_class <> 'operational' then
    raise exception 'close account: refusing to delete from % (class %: kept)', p_table, v_class using errcode = '42501';
  end if;
  if private.table_is_retained(p_table) then
    raise exception 'close account: refusing to delete from % (under a retention category)', p_table using errcode = '42501';
  end if;
  execute format('delete from public.%I t where (%s) = $1', p_table, p_expr) using p_patient;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function private.close_account_remove_rows(text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. The executor
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.close_patient_account(p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := (select auth.uid());
  d public.data_deletion_requests%rowtype;
  p public.profiles%rowtype;
  -- Operational by registry class but append-only by design: a points ledger and a staff time record. Left alone, never deleted.
  v_left_alone constant text[] := array['wellness_points_ledger', 'clinician_time_entries'];
  v_removed jsonb := '{}'::jsonb;
  v_ended jsonb := '{}'::jsonb;
  v_prior jsonb;
  v_summary jsonb;
  v_note text;
  v_n integer;
  t text;
  r record;
begin
  if v_uid is null or not private.is_admin() then
    raise exception 'only an admin can close an account' using errcode = '42501';
  end if;

  select * into d from public.data_deletion_requests where id = p_request for update;
  if not found then raise exception 'no such deletion request' using errcode = 'P0002'; end if;

  -- Idempotent: a request already closed by this function returns what it did the first time and changes nothing.
  select a.event into v_prior from public.audit_log a
   where a.action = 'data_deletion.account_closed' and a.entity_type = 'data_deletion_request' and a.entity_id = p_request
   order by a.created_at limit 1;
  if v_prior is not null then
    return v_prior || jsonb_build_object('already_closed', true);
  end if;

  if d.status not in ('approved_full', 'approved_partial', 'completed') then
    raise exception 'this request must be approved before the account can be closed (it is %)', d.status using errcode = '23514';
  end if;
  if d.grace_ends_at is not null and now() < d.grace_ends_at then
    raise exception 'the patient''s waiting period has not ended; the account cannot be closed yet' using errcode = '23514';
  end if;

  select * into p from public.profiles where id = d.patient_id for update;
  if not found or p.role <> 'patient' then
    raise exception 'only a patient account can be closed here' using errcode = '22023';
  end if;

  -- 1. Operational rows, from the registry. Everything else in the registry is kept.
  for r in select table_name, patient_expr from public.data_registry
            where retention_class = 'operational' and not (table_name = any (v_left_alone))
            order by table_name loop
    v_n := private.close_account_remove_rows(r.table_name, r.patient_expr, d.patient_id);
    if v_n > 0 then v_removed := v_removed || jsonb_build_object(r.table_name, v_n); end if;
  end loop;

  -- 2. Account-level rows keyed on the profile (outside the registry, which lists patient_id tables).
  foreach t in array array['push_subscriptions', 'user_known_devices', 'notification_settings'] loop
    v_n := private.close_account_remove_rows(t, 'profile_id', d.patient_id);
    if v_n > 0 then v_removed := v_removed || jsonb_build_object(t, v_n); end if;
  end loop;

  -- 3. Device connections end. Readings already received are clinical records and stay.
  update public.patient_devices
     set status = 'unpaired', unpaired_at = coalesce(unpaired_at, now()), unpaired_by = coalesce(unpaired_by, v_uid),
         unpaired_reason = coalesce(unpaired_reason, 'Account closed')
   where patient_id = d.patient_id and status = 'active';
  get diagnostics v_n = row_count;
  if v_n > 0 then v_ended := v_ended || jsonb_build_object('patient_devices', v_n); end if;

  update public.wearable_connections
     set status = 'disconnected', access_token = null, refresh_token = null, token_expires_at = null, last_sync_error = null,
         revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, v_uid),
         revocation_reason = coalesce(revocation_reason, 'Account closed')
   where patient_id = d.patient_id
     and (status <> 'disconnected' or access_token is not null or refresh_token is not null);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_ended := v_ended || jsonb_build_object('wearable_connections', v_n); end if;

  -- 4. Sharing is revoked, in both directions, with no notice to the other person.
  update public.care_circle_members
     set state = 'revoked', revoked_at = now(), revoked_by = v_uid
   where state = 'active' and (patient_id = d.patient_id or supporter_id = d.patient_id);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_ended := v_ended || jsonb_build_object('care_circle_members', v_n); end if;

  update public.care_circle_invites set state = 'cancelled' where patient_id = d.patient_id and state = 'pending';
  get diagnostics v_n = row_count;
  if v_n > 0 then v_ended := v_ended || jsonb_build_object('care_circle_invites', v_n); end if;

  delete from public.profile_access where profile_id = d.patient_id or grantee_user_id = d.patient_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_ended := v_ended || jsonb_build_object('profile_access', v_n); end if;

  update public.care_access_requests set status = 'cancelled', responded_at = coalesce(responded_at, now())
   where status = 'pending' and (profile_id = d.patient_id or counterparty_user_id = d.patient_id);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_ended := v_ended || jsonb_build_object('care_access_requests', v_n); end if;

  update public.record_shares set is_active = false, revoked_at = coalesce(revoked_at, now()), pin_hash = null
   where patient_id = d.patient_id and (is_active or pin_hash is not null);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_ended := v_ended || jsonb_build_object('record_shares', v_n); end if;

  update public.emergency_cards set is_active = false, revoked_at = coalesce(revoked_at, now())
   where patient_id = d.patient_id and (is_active or revoked_at is null);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_ended := v_ended || jsonb_build_object('emergency_cards', v_n); end if;

  update public.emergency_access_grants set revoked_at = now(), revoked_by = v_uid
   where revoked_at is null and (profile_id = d.patient_id or grantee_user_id = d.patient_id);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_ended := v_ended || jsonb_build_object('emergency_access_grants', v_n); end if;

  -- 5. Contact details and the sign-in. Name and date of birth stay with the retained clinical record.
  update public.profiles
     set phone = null, avatar_url = null, area = null,
         emergency_contact_name = null, emergency_contact_phone = null, emergency_contact_relationship = null,
         next_of_kin_name = null, next_of_kin_phone = null, emergency_contact_consent = false, marketing_opt_in = false
   where id = d.patient_id;

  delete from auth.sessions where user_id = d.patient_id;
  delete from auth.identities where user_id = d.patient_id;
  update auth.users
     set email = 'closed-' || d.patient_id::text || '@closed.invalid', phone = null, encrypted_password = '',
         raw_user_meta_data = '{}'::jsonb, email_change = '', phone_change = '', updated_at = now()
   where id = d.patient_id;

  v_summary := jsonb_build_object(
    'closed', true,
    'request_id', p_request,
    'patient_id', d.patient_id,
    'removed', v_removed,
    'ended', v_ended,
    'contact_details_removed', true,
    'left_alone_append_only', to_jsonb(v_left_alone),
    'kept_classes', (select coalesce(jsonb_agg(distinct x.retention_class order by x.retention_class), '[]'::jsonb)
                       from public.data_registry x where x.retention_class <> 'operational'),
    'at', now());

  -- 6. Completing an approved request runs the existing trigger: deactivate the profile (never delete it), ban the login and
  --    withdraw every consent still in force. A request already completed by hand is not touched.
  if d.status in ('approved_full', 'approved_partial') then
    v_note := 'Your account was closed on ' || to_char(now() at time zone 'Africa/Lagos', 'DD Mon YYYY') ||
              '. Removed: your sign-in and contact details, your preferences and reminders, your device connections, and everything you shared with your Care Circle. ' ||
              'Kept: your posted clinical records, the audit log, financial ledger entries and your consent history.';
    update public.data_deletion_requests
       set status = 'completed',
           decision_note = nullif(btrim(concat_ws(' ', decision_note, v_note)), ''),
           anonymisation_summary = v_summary
     where id = p_request;
  end if;

  -- Nothing half-closed: if any of this is false, the whole call rolls back.
  if (select is_active from public.profiles where id = d.patient_id) then
    raise exception 'close account: the profile is still active' using errcode = '55000';
  end if;
  if not exists (select 1 from auth.users where id = d.patient_id and banned_until is not null and banned_until > now()) then
    raise exception 'close account: the login is not banned' using errcode = '55000';
  end if;
  if exists (select 1 from public.profile_access where profile_id = d.patient_id or grantee_user_id = d.patient_id)
     or exists (select 1 from public.care_circle_members where state = 'active' and (patient_id = d.patient_id or supporter_id = d.patient_id)) then
    raise exception 'close account: a sharing grant is still in force' using errcode = '55000';
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
    values (d.organisation_id, v_uid, 'data_deletion.account_closed', 'data_deletion_request', p_request, v_summary, d.patient_id);

  return v_summary || jsonb_build_object('already_closed', false);
end $$;
revoke all on function public.close_patient_account(uuid) from public, anon;
grant execute on function public.close_patient_account(uuid) to authenticated;

comment on function public.close_patient_account(uuid) is
  'OQ-S04b2-2: admin-only, one approved deletion request past its grace period. Removes operational registry rows, profile-keyed account rows, device connections, sharing and contact details; deactivates (never deletes) the profile; never touches clinical, audit or ledger rows. Idempotent; all or nothing.';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. Shape check (behaviour is proved in packages/db/tests/close_patient_account_executor.sql)
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.close_patient_account(uuid)', 'EXECUTE') then raise exception 'close account: anon can execute'; end if;
  if has_function_privilege('authenticated', 'private.close_account_remove_rows(text,text,uuid)', 'EXECUTE') then raise exception 'close account: the delete helper is callable by a session'; end if;
  if not has_function_privilege('authenticated', 'public.close_patient_account(uuid)', 'EXECUTE') then raise exception 'close account: admins cannot execute'; end if;
  if position('app.closing_account' in pg_get_functiondef('private.enforce_patient_consent_withdrawal()'::regprocedure)) = 0 then
    raise exception 'close account: the S04b-2 consent trigger is not in force';
  end if;
  if (select count(*) from pg_trigger t
       where not t.tgisinternal and t.tgname in ('wellness_points_ledger_append_only', 'clinician_time_entries_no_change')) < 2 then
    raise exception 'close account: the two left-alone tables no longer carry a guard trigger; re-decide the list';
  end if;
end $$;
