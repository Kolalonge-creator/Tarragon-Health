-- S04b-2: consent receipts, the database-level withdrawal rule, draft optional wording behind a go-live gate, and a grace
-- period with cancel on the existing account-deletion request table (OQ-49, OQ-50, OQ-53). Reuses patient_consents,
-- consent_versions, patient_consent_state, platform_modules, data_export_requests and data_deletion_requests. No third
-- request table. No clinical record is deleted by anything here.
--
-- Counted first (live koiplnmbgnqnbywhpjlf, 2026-10-13): 15 patient_consents rows (0 withdrawn), 0 data_export_requests,
-- 0 data_deletion_requests, 0 inactive patient profiles, 7 platform_modules. consent_versions: required types
-- data_processing / telehealth / terms_of_service (current), optional types research (current, applied live from another
-- branch) and sponsor_reporting (current live; S38e shipped it as a non-current draft), nothing for care_circle_sharing.
-- So: no backfill is needed, no existing row is changed, and the new columns are null on the 15 legacy rows (shown as
-- "not recorded" rather than guessed).
--
-- 1. Receipts. patient_consents gains channel, consented_by, consented_by_relation and text_sha256. All four are filled by the
--    trigger, never trusted from the client (channel is a label the app supplies; the rest are derived). The exact text a person
--    agreed to is protected: a consent_versions row that any consent points at can no longer have its text, type, version or
--    optionality changed (publish a new version instead).
-- 2. OQ-53. A REQUIRED consent cannot be withdrawn by a signed-in person while the account is active. The only way to stop a
--    required consent is to close the account. Optional purposes stay individually withdrawable. A service or migration
--    context (no auth.uid()) is not blocked, which is how an account closure can record the withdrawals.
-- 3. OQ-49. consent_versions.is_draft: wording pending approval. Drafts are invisible to patients and anon (RLS), cannot be
--    accepted (trigger), and can only be published by an admin through public.publish_consent_wording, which refuses unless the
--    platform module 'optional_consent_wording' has been switched on by a superadmin. Seeds ONE draft: care_circle_sharing.
--    research and sponsor_reporting already carry wording live and are left exactly as they are.
-- 4. OQ-50. data_deletion_requests gains grace_ends_at (7 to 30 days, 14 by default; the app passes the PROPOSED value from
--    privacy.deletion_grace), cancelled_at, cancelled_by and the status 'cancelled'. An admin cannot approve or complete a
--    request before its grace period ends; the patient can cancel until then, through public.cancel_my_data_deletion_request.
--    One open request per patient. Requests and cancellations are written to audit_log.
--
-- Completing a deletion request deactivates the profile (never deletes it) and withdraws every consent still in force.
-- Known limit, see OQ-S04b2-2: patient_consents.patient_id and data_deletion_requests.patient_id still cascade from profiles. Closing an
-- account must DEACTIVATE the profile (is_active = false), never delete it, or the consent history and the deletion record the privacy
-- page promises to keep would go with it. Test accounts are the only profiles purge_test_account removes.
--
-- Version pinned to this filename when applied. Not applied by the author: the owner applies after review.

-- ---------------------------------------------------------------------------
-- 1. consent_versions: draft marker and text protection
-- ---------------------------------------------------------------------------
alter table public.consent_versions add column if not exists is_draft boolean not null default false;
alter table public.consent_versions add column if not exists draft_note text;

comment on column public.consent_versions.is_draft is
  'S04b-2 (OQ-49): wording pending approval. A draft is invisible to patients, cannot be accepted, and is published only by public.publish_consent_wording (admin, and only while the optional_consent_wording module is on).';

alter table public.consent_versions drop constraint if exists consent_versions_draft_not_current;
alter table public.consent_versions add constraint consent_versions_draft_not_current check (not (is_draft and is_current));

alter table public.consent_versions drop constraint if exists consent_versions_draft_is_optional;
alter table public.consent_versions add constraint consent_versions_draft_is_optional check (not is_draft or is_optional);

insert into public.platform_modules (key, label, description, is_enabled)
values ('optional_consent_wording', 'Optional consent wording',
        'Switches on publishing of drafted optional consent wording (research, sponsor reporting, Care Circle sharing). Off until the founder has approved the exact wording (OQ-49). While off, drafts stay invisible to patients and cannot be published.',
        false)
on conflict (key) do nothing;

create or replace function private.protect_consent_version_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_draft and not new.is_draft then
    if not private.module_enabled('optional_consent_wording') then
      raise exception 'drafted consent wording cannot be published until the optional_consent_wording module is switched on'
        using errcode = '23514';
    end if;
    if coalesce(current_setting('app.publishing_consent_wording', true), '') <> 'on' then
      raise exception 'drafted consent wording is published through public.publish_consent_wording (approval note and audit entry), not by a direct update'
        using errcode = '42501';
    end if;
  end if;
  -- Once published (not a draft) the text, type, version and optionality are fixed: a receipt's exact words must be the words that
  -- were on screen, so a legal change is always a new version. A draft is editable until it is published.
  if (not old.is_draft or exists (select 1 from public.patient_consents pc where pc.consent_version_id = old.id))
     and (new.consent_type, new.version, new.title, new.body, new.is_optional, new.is_draft)
         is distinct from (old.consent_type, old.version, old.title, old.body, old.is_optional, old.is_draft)
     and not (old.is_draft and not new.is_draft) then
    raise exception 'consent version % is published and its text cannot change; publish a new version', old.version
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_consent_version_text() from public;

drop trigger if exists consent_versions_protect_text on public.consent_versions;
create trigger consent_versions_protect_text
  before update on public.consent_versions
  for each row execute function private.protect_consent_version_text();

-- Drafts are invisible to patients and to anon; an admin can still read them to review the wording.
drop policy if exists consent_versions_select on public.consent_versions;
create policy consent_versions_select on public.consent_versions
  for select to authenticated using (not is_draft or private.is_admin());

drop policy if exists consent_versions_anon_select on public.consent_versions;
create policy consent_versions_anon_select on public.consent_versions
  for select to anon using (is_current and not is_draft);

-- The DRAFT wording for the one optional purpose that has none (plain English, pending the founder's approval).
insert into public.consent_versions (consent_type, version, title, body, is_current, is_optional, is_draft, draft_note)
select 'care_circle_sharing', '2026-10-13-draft',
       'Share my record with my Care Circle',
       'I agree that the people I add to my Care Circle can see the parts of my health information that I choose to share with each of them. I decide who is in my Care Circle and what each person can see, and I can change or remove anyone at any time in the app. Tarragon Health shares nothing with them that I have not chosen. If I stop, they can no longer see my information from that point on. Choosing not to share changes nothing about my care.',
       false,   -- a draft never holds the single current slot; publish_consent_wording makes it current and retires the previous one
       true, true,
       'DRAFT pending approval (OQ-49). Not shown to patients. Publish with public.publish_consent_wording once the founder approves the exact text and the optional_consent_wording module is on.'
where not exists (select 1 from public.consent_versions c where c.consent_type = 'care_circle_sharing' and c.version = '2026-10-13-draft');

-- A signed-in session (not a migration or service context) cannot insert optional wording that is already final: it has to go
-- in as a draft and be published through public.publish_consent_wording.
create or replace function private.guard_optional_consent_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and new.is_optional and not new.is_draft then
    raise exception 'optional consent wording is added as a draft and published through public.publish_consent_wording'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_optional_consent_insert() from public;

drop trigger if exists consent_versions_guard_optional_insert on public.consent_versions;
create trigger consent_versions_guard_optional_insert
  before insert on public.consent_versions
  for each row execute function private.guard_optional_consent_insert();

create or replace function public.publish_consent_wording(p_version uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.consent_versions%rowtype;
begin
  if not private.is_admin() then
    raise exception 'only a superadmin can publish consent wording' using errcode = '42501';
  end if;
  perform private.assert_module_enabled('optional_consent_wording');
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'publishing consent wording needs a note saying who approved it and when' using errcode = '23514';
  end if;
  select * into v from public.consent_versions where id = p_version for update;
  if not found then raise exception 'no such consent version' using errcode = 'P0002'; end if;
  if not v.is_draft then raise exception 'this wording is already published' using errcode = '23514'; end if;

  perform set_config('app.publishing_consent_wording', 'on', true);
  update public.consent_versions set is_current = false
   where consent_type = v.consent_type and is_current and id <> v.id and not is_draft;
  -- The approval note goes to audit_log only: consent_versions rows are readable by patients and anon once published.
  update public.consent_versions set is_draft = false, is_current = true, published_at = now(), draft_note = null
   where id = v.id;

  perform set_config('app.publishing_consent_wording', 'off', true);
  perform private.log_audit('consent_wording.published', 'consent_version', v.id,
    jsonb_build_object('consent_type', v.consent_type, 'version', v.version, 'note', btrim(p_note)));
  return jsonb_build_object('ok', true, 'consent_type', v.consent_type, 'version', v.version);
end;
$$;
revoke all on function public.publish_consent_wording(uuid, text) from public;
revoke all on function public.publish_consent_wording(uuid, text) from anon;
grant execute on function public.publish_consent_wording(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. patient_consents: receipt columns, the trigger, the policies
-- ---------------------------------------------------------------------------
alter table public.patient_consents add column if not exists channel text;
alter table public.patient_consents add column if not exists consented_by uuid;
alter table public.patient_consents add column if not exists consented_by_relation text;
alter table public.patient_consents add column if not exists text_sha256 text;

alter table public.patient_consents drop constraint if exists patient_consents_channel_check;
alter table public.patient_consents add constraint patient_consents_channel_check
  check (channel is null or channel in ('web', 'mobile', 'staff_assisted', 'system', 'unknown'));
alter table public.patient_consents drop constraint if exists patient_consents_consented_by_relation_check;
alter table public.patient_consents add constraint patient_consents_consented_by_relation_check
  check (consented_by_relation is null or consented_by_relation in ('self', 'guardian', 'staff', 'system'));

comment on column public.patient_consents.channel is 'S04b-2 receipt: where the choice was made (web, mobile, staff_assisted, system, unknown). A signed-in patient or guardian may only label web, mobile or unknown; staff_assisted is forced for a staff-made row and system for a service context. Null on rows recorded before receipts.';
comment on column public.patient_consents.consented_by is 'S04b-2 receipt: auth.uid() of whoever made the choice (the patient, or a guardian for a dependant). Derived by the trigger, never client-supplied. No foreign key on purpose: the receipt must outlive the account.';
comment on column public.patient_consents.consented_by_relation is 'S04b-2 receipt: self, guardian (manage access to a dependant account), staff (a staff session acting through a definer function) or system (no signed-in user), derived by the trigger.';
comment on column public.patient_consents.text_sha256 is 'S04b-2 receipt: sha-256 of title || newline || body of the exact version agreed to or withdrawn, computed by the trigger.';

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
  if v_uid is not null then
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
    if v_uid is not null and not v_cv.is_current then
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

-- Insert: the patient, or a guardian (manage access) for a dependant account. Select: the same two.
drop policy if exists patient_consents_insert on public.patient_consents;
create policy patient_consents_insert on public.patient_consents
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or (private.can_act_for(patient_id)
        and exists (select 1 from public.profiles d where d.id = patient_id and d.is_dependent_account))
  );

drop policy if exists patient_consents_select on public.patient_consents;
create policy patient_consents_select on public.patient_consents
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or (private.can_act_for(patient_id)
        and exists (select 1 from public.profiles d where d.id = patient_id and d.is_dependent_account))
  );

-- Append-only stays append-only: no update or delete privilege for any client role.
revoke update, delete, truncate on public.patient_consents from authenticated, anon;

-- The receipt: what was agreed or withdrawn, the exact text, when, where, and by whom. A row recorded before receipts existed
-- says so ('legacy' relation, 'unknown' channel, no fingerprint): who made it and where are not guessed, and the version text
-- was editable then, so a fingerprint computed today would not prove what that person saw.
create or replace view public.patient_consent_receipts
with (security_invoker = true) as
select pc.id,
       pc.patient_id,
       pc.consent_type,
       pc.action,
       pc.version,
       pc.consent_version_id,
       cv.title,
       cv.body,
       cv.is_optional,
       pc.text_sha256,
       coalesce(pc.channel, 'unknown') as channel,
       coalesce(pc.consented_by_relation, 'legacy') as consented_by_relation,
       pc.created_at as recorded_at
  from public.patient_consents pc
  join public.consent_versions cv on cv.id = pc.consent_version_id;

revoke all on public.patient_consent_receipts from public, anon;
grant select on public.patient_consent_receipts to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Deletion requests: grace period, cancel, one open request
-- ---------------------------------------------------------------------------
alter table public.data_deletion_requests add column if not exists grace_ends_at timestamptz;
alter table public.data_deletion_requests add column if not exists requested_grace_days smallint;
alter table public.data_deletion_requests add column if not exists cancelled_at timestamptz;
alter table public.data_deletion_requests add column if not exists cancelled_by uuid references public.profiles (id) on delete set null;

comment on column public.data_deletion_requests.grace_ends_at is 'S04b-2: the request cannot be approved or completed before this time and the patient can cancel until it. Set at creation (7 to 30 days, 14 by default), immutable afterwards. Null only on requests that predate it.';

alter table public.data_deletion_requests drop constraint if exists data_deletion_requests_status_check;
alter table public.data_deletion_requests add constraint data_deletion_requests_status_check
  check (status in ('pending', 'under_review', 'approved_partial', 'approved_full', 'denied', 'completed', 'cancelled'));

alter table public.data_deletion_requests drop constraint if exists data_deletion_requests_reviewed_requires_reviewer;
alter table public.data_deletion_requests add constraint data_deletion_requests_reviewed_requires_reviewer
  check (status in ('pending', 'cancelled') or (reviewed_by is not null and reviewed_at is not null));

alter table public.data_deletion_requests drop constraint if exists data_deletion_requests_cancelled_requires_stamp;
alter table public.data_deletion_requests add constraint data_deletion_requests_cancelled_requires_stamp
  check (status <> 'cancelled' or cancelled_at is not null);

create unique index if not exists data_deletion_requests_one_open_per_patient
  on public.data_deletion_requests (patient_id)
  where status in ('pending', 'under_review', 'approved_partial', 'approved_full');

create or replace function private.enforce_data_deletion_request_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.patient_id := v_uid;
    new.organisation_id := (select organisation_id from public.profiles where id = v_uid);
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.completed_by := null;
    new.completed_at := null;
    new.cancelled_at := null;
    new.cancelled_by := null;
    -- The grace period is the number of days the app asks for (PROPOSED value privacy.deletion_grace), held to 7..30 here and counted
    -- from the server clock, never from a timestamp the client sends.
    new.grace_ends_at := now() + make_interval(days => least(greatest(coalesce(new.requested_grace_days, 14), 7), 30));
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
      values (new.organisation_id, v_uid, 'data_deletion.requested', 'data_deletion_request', new.id,
              jsonb_build_object('grace_ends_at', new.grace_ends_at), new.patient_id);
    return new;
  end if;

  if old.status in ('completed', 'cancelled') then
    raise exception 'This deletion request is already closed and cannot be edited further.'
      using errcode = '42501';
  end if;

  new.patient_id := old.patient_id;
  new.organisation_id := old.organisation_id;
  new.requested_at := old.requested_at;
  new.grace_ends_at := old.grace_ends_at;
  new.cancelled_at := old.cancelled_at;
  new.cancelled_by := old.cancelled_by;

  if new.status = 'cancelled' then
    if not (private.is_admin() or v_uid = old.patient_id) then
      raise exception 'Only the person who asked, or an admin, can cancel a data deletion request.'
        using errcode = '42501';
    end if;
    if not private.is_admin() and (old.grace_ends_at is null or now() >= old.grace_ends_at) then
      raise exception 'The waiting period for this deletion request has ended and it can no longer be cancelled.'
        using errcode = '23514';
    end if;
    new.cancelled_at := now();
    new.cancelled_by := v_uid;
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
      values (old.organisation_id, v_uid, 'data_deletion.cancelled', 'data_deletion_request', old.id,
              jsonb_build_object('by_admin', v_uid is distinct from old.patient_id), old.patient_id);
    return new;
  end if;

  if new.status <> old.status and new.status <> 'pending' then
    if not private.is_admin() then
      raise exception 'Only an admin can review or complete a data deletion request.'
        using errcode = '42501';
    end if;
    if new.status = 'completed' and old.status not in ('approved_full', 'approved_partial') then
      raise exception 'A deletion request can only be completed after it has been approved.' using errcode = '23514';
    end if;
    if new.status in ('approved_partial', 'approved_full', 'completed')
       and old.grace_ends_at is not null and now() < old.grace_ends_at then
      raise exception 'The patient''s waiting period has not ended; this request cannot be approved or completed yet.'
        using errcode = '23514';
    end if;
    new.reviewed_by := v_uid;
    new.reviewed_at := coalesce(old.reviewed_at, now());
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
      values (old.organisation_id, v_uid, 'data_deletion.' || new.status, 'data_deletion_request', old.id,
              jsonb_build_object('from', old.status, 'grace_ends_at', old.grace_ends_at), old.patient_id);
    if new.status = 'completed' then
      new.completed_by := v_uid;
      new.completed_at := now();
    end if;
    -- Completing an approved request closes the account.
    if new.status = 'completed' then
      -- Completing a request closes the account: the profile is DEACTIVATED, never deleted (consents, the deletion record and the
      -- clinical records hang off it). This is also what lets a required consent be withdrawn (OQ-53). Removing the sign-in and
      -- contact details is still a manual step by the reviewer (OQ-S04b2-2).
      update public.profiles set is_active = false where id = old.patient_id;
      -- And signs the person out for good: a deactivated profile alone only restricts staff, so the login is banned too (an existing
      -- session lasts until its token expires). A reviewer can lift it by clearing auth.users.banned_until.
      update auth.users set banned_until = now() + interval '100 years' where id = old.patient_id;
      perform set_config('app.closing_account', 'on', true);
      -- And ends every consent still in force, as one withdrawal row each (append-only; labelled staff, since a reviewer made them).
      insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action)
        select l.organisation_id, l.patient_id, l.consent_type, l.consent_version_id, l.version, 'withdrawn'
          from (select distinct on (consent_type) *
                  from public.patient_consents
                 where patient_id = old.patient_id
                 order by consent_type, created_at desc, id desc) l
         where l.action = 'accepted';
      perform set_config('app.closing_account', 'off', true);
    end if;
  end if;

  return new;
end;
$$;
revoke all on function private.enforce_data_deletion_request_attribution() from public;

create or replace function public.cancel_my_data_deletion_request(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.data_deletion_requests%rowtype;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into r from public.data_deletion_requests where id = p_request and patient_id = v_uid for update;
  if not found then raise exception 'no such deletion request' using errcode = 'P0002'; end if;
  if r.status not in ('pending', 'under_review', 'approved_partial', 'approved_full') then
    raise exception 'this deletion request is already closed' using errcode = '23514';
  end if;
  if r.grace_ends_at is null or now() >= r.grace_ends_at then
    raise exception 'The waiting period for this deletion request has ended and it can no longer be cancelled.' using errcode = '23514';
  end if;
  update public.data_deletion_requests set status = 'cancelled' where id = p_request;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.cancel_my_data_deletion_request(uuid) from public;
revoke all on function public.cancel_my_data_deletion_request(uuid) from anon;
grant execute on function public.cancel_my_data_deletion_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Proof the shape landed (the behavioural proof is packages/db/tests/s04b2_consent_receipts_and_deletion_grace.sql).
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.cancel_my_data_deletion_request(uuid)', 'EXECUTE') then raise exception 'S04b-2: anon can cancel deletion requests'; end if;
  if has_function_privilege('anon', 'public.publish_consent_wording(uuid,text)', 'EXECUTE') then raise exception 'S04b-2: anon can publish wording'; end if;
  if has_table_privilege('authenticated', 'public.patient_consents', 'UPDATE') or has_table_privilege('authenticated', 'public.patient_consents', 'DELETE') then
    raise exception 'S04b-2: patient_consents is no longer append-only for authenticated';
  end if;
  if exists (select 1 from public.consent_versions where is_draft and is_optional is not true) then raise exception 'S04b-2: a draft is not optional'; end if;
  if (select is_enabled from public.platform_modules where key = 'optional_consent_wording') then raise exception 'S04b-2: the wording gate must start off'; end if;
end $$;
