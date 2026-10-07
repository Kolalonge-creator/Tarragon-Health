-- S22 part 3: three fixes found when preparing S22 for production (docs/design/S22.md "As built", OQ-150).
--
--   1. Membership. Subscription plans were retired on 2026-09-02, so private.patient_is_member() (which read a plan feature)
--      made nobody a Member and written questions were effectively off. There is still no checkout for the 2026-10-05
--      Membership (S25), so this adds the one table that checkout will write to, and a way for an admin or the CMO to grant
--      and end a membership with a reason today. The old plan feature still counts, so nobody loses access. No price, no
--      balance (INV-09): a membership is a dated entitlement, not money.
--   2. queue_next(p_types). The written-questions page used to claim whatever task was next, which could be a blood
--      pressure review with no screen to handle it. The page now asks for its own types. No argument keeps the old behaviour.
--   3. submit_written_question(..., p_client_id). A phone that loses signal after sending cannot know whether the question
--      arrived. A client id makes a retry return the first question instead of using a second allowance.

-- ---------------------------------------------------------------------------
-- 1. Membership
-- ---------------------------------------------------------------------------
create table public.patient_memberships (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  source          text not null check (source in ('purchase', 'voucher', 'employer', 'granted')),
  state           text not null default 'active' check (state in ('active', 'ended')),
  starts_at       timestamptz not null default now(),
  ends_at         timestamptz,
  granted_by      uuid references public.profiles (id) on delete set null,
  grant_reason    text,
  ended_by        uuid references public.profiles (id) on delete set null,
  ended_at        timestamptz,
  end_reason      text,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (source <> 'granted' or (granted_by is not null and char_length(btrim(coalesce(grant_reason, ''))) >= 10)),
  check (state <> 'ended' or (ended_at is not null and char_length(btrim(coalesce(end_reason, ''))) >= 10))
);
create unique index patient_memberships_one_active on public.patient_memberships (patient_id) where state = 'active';
create index patient_memberships_org_idx on public.patient_memberships (organisation_id, state);
alter table public.patient_memberships enable row level security;
revoke all on public.patient_memberships from public, anon, authenticated;

create or replace function private.patient_is_member(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.patient_memberships m
                  where m.patient_id = p_patient and m.state = 'active' and m.starts_at <= now()
                    and (m.ends_at is null or m.ends_at > now()))
      or private.patient_has_feature_access(p_patient, 'async_doctor_visit');
$$;
revoke all on function private.patient_is_member(uuid) from public, anon, authenticated;

create function private.can_manage_memberships() returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_admin()
      or exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active and cs.doctor_tier = 'chief_medical_officer');
$$;
revoke all on function private.can_manage_memberships() from public, anon, authenticated;

create function public.grant_membership(p_patient uuid, p_ends_at timestamptz, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  pr public.profiles%rowtype;
  v_id uuid;
begin
  if v_uid is null or not private.can_manage_memberships() then raise exception 'membership_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then raise exception 'unknown patient' using errcode = '22023'; end if;
  if pr.organisation_id is distinct from (select organisation_id from public.profiles where id = v_uid) then
    raise exception 'membership_not_authorised' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'membership_reason_needed' using errcode = '22023'; end if;
  if p_ends_at is not null and p_ends_at <= now() then raise exception 'membership_end_in_past' using errcode = '22023'; end if;
  -- a dated membership that has run out is closed here, so renewing it is not blocked by its own expired row
  update public.patient_memberships
     set state = 'ended', ended_at = now(), end_reason = 'Lapsed on its end date, closed automatically'
   where patient_id = p_patient and state = 'active' and ends_at is not null and ends_at <= now();
  if exists (select 1 from public.patient_memberships where patient_id = p_patient and state = 'active') then
    raise exception 'membership_already_active' using errcode = 'P0001';
  end if;
  insert into public.patient_memberships (organisation_id, patient_id, source, ends_at, granted_by, grant_reason, is_test)
  values (pr.organisation_id, p_patient, 'granted', p_ends_at, v_uid, btrim(p_reason), coalesce(pr.is_test, false)) returning id into v_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result, subject_patient_id)
  values (pr.organisation_id, v_uid, 'membership.grant', 'patient_membership', v_id,
          jsonb_build_object('ends_at', p_ends_at), btrim(p_reason), 'success', p_patient);
  return v_id;
end;
$$;

create function public.end_membership(p_patient uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  m public.patient_memberships%rowtype;
begin
  if v_uid is null or not private.can_manage_memberships() then raise exception 'membership_not_authorised' using errcode = '42501'; end if;
  select * into m from public.patient_memberships where patient_id = p_patient and state = 'active' for update;
  if not found then raise exception 'membership_none_active' using errcode = 'P0002'; end if;
  if m.organisation_id is distinct from (select organisation_id from public.profiles where id = v_uid) then
    raise exception 'membership_not_authorised' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'membership_reason_needed' using errcode = '22023'; end if;
  update public.patient_memberships set state = 'ended', ended_by = v_uid, ended_at = now(), end_reason = btrim(p_reason) where id = m.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result, subject_patient_id)
  values (m.organisation_id, v_uid, 'membership.end', 'patient_membership', m.id, '{}'::jsonb, btrim(p_reason), 'success', p_patient);
end;
$$;

-- For the admin page: members and the people they could be, found by name or patient number. Reads are audited.
create function public.list_memberships(p_search text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if v_uid is null or not private.can_manage_memberships() then raise exception 'membership_not_authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, event, result)
  values (v_org, v_uid, 'membership.list', 'patient_membership', jsonb_build_object('searched', v_q is not null), 'success');
  return coalesce((
    select jsonb_agg(jsonb_build_object('patient_id', p.id, 'full_name', p.full_name, 'patient_number', p.patient_number,
             'membership_id', m.id, 'source', m.source, 'starts_at', m.starts_at, 'ends_at', m.ends_at, 'grant_reason', m.grant_reason,
             'is_member', private.patient_is_member(p.id)) order by p.full_name)
      from (select * from public.profiles where organisation_id = v_org and role = 'patient'
              and (v_q is null or full_name ilike '%' || v_q || '%' or patient_number ilike '%' || v_q || '%')
              and (v_q is not null or id in (select patient_id from public.patient_memberships where state = 'active'))
            order by full_name limit 50) p
      left join public.patient_memberships m on m.patient_id = p.id and m.state = 'active'), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. queue_next takes the task types the caller wants (null = any, as before)
-- ---------------------------------------------------------------------------
drop function public.queue_next();
create function public.queue_next(p_types text[] default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  cs public.clinical_staff%rowtype;
  t public.clinical_tasks%rowtype;
  ty public.task_types%rowtype;
  v_gate text;
  v_block boolean;
  v_live public.task_claims%rowtype;
  v_n integer;
  v_try integer := 0;
  v_expires timestamptz;
  v_claim uuid;
begin
  if v_uid is null then raise exception 'queue_not_clinician' using errcode = '42501'; end if;
  -- serialises this clinician's own calls (a retry racing the original); other clinicians are not blocked
  select * into cs from public.clinical_staff where profile_id = v_uid for update;
  v_gate := private.queue_gate(v_uid);
  if v_gate is not null then raise exception '%', v_gate using errcode = '42501'; end if;
  update public.clinical_staff set queue_last_seen_at = now() where id = cs.id;

  -- already holding the cap: a retry over a dropped connection gets the same claim back, never a second task (OQ-D)
  select count(*) into v_n from public.task_claims where clinician_id = v_uid and ended_at is null;
  if v_n >= cs.max_concurrent_claims then
    select * into v_live from public.task_claims where clinician_id = v_uid and ended_at is null order by claimed_at limit 1;
    select * into t from public.clinical_tasks where id = v_live.task_id;
    return jsonb_build_object('already_claimed', true, 'claim_id', v_live.id, 'claim_expires_at', v_live.expires_at,
      'task', jsonb_build_object('id', t.id, 'type', t.type, 'priority_class', t.priority_class, 'due_at', t.due_at, 'patient_id', t.patient_id));
  end if;

  v_block := private.queue_has_block(v_uid);
  if not v_block and cs.employment_type is distinct from 'employed' then
    raise exception 'queue_no_availability' using errcode = '42501';
  end if;

  -- Up to three tries: a row another clinician claimed between our read and our lock is re-checked by the lock
  -- clause on the task itself and skipped, but LIMIT can then return nothing while other eligible rows remain.
  while v_try < 3 loop
    v_try := v_try + 1;
    select ct.* into t
      from public.clinical_tasks ct
      join private.queue_candidates(v_uid, not v_block) c on c.id = ct.id
     where ct.state in ('offered_to_lead', 'open', 'escalated')
       and (p_types is null or ct.type = any(p_types))
     order by c.priority_class, (c.state <> 'offered_to_lead'), c.due_at, c.created_at
     limit 1
       for update of ct skip locked;
    exit when found;
    exit when not exists (select 1 from private.queue_candidates(v_uid, not v_block) c2
                           join public.clinical_tasks ct2 on ct2.id = c2.id where p_types is null or ct2.type = any(p_types));
  end loop;
  if t.id is null then
    return jsonb_build_object('already_claimed', false, 'task', null, 'reason', 'none_eligible');
  end if;

  select * into ty from public.task_types where code = t.type and version = t.task_type_version;
  v_expires := now() + make_interval(mins => ty.claim_timeout_minutes);
  perform private.apply_task_transition(t.id, 'claimed', 'clinician', v_uid, 'claimed', v_uid, v_expires);
  insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, is_test)
  values (t.organisation_id, t.id, v_uid, v_expires, t.is_test) returning id into v_claim;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (t.organisation_id, v_uid, 'queue.claim', 'clinical_task', t.id,
          jsonb_build_object('type', t.type, 'priority_class', t.priority_class, 'claim_id', v_claim), t.patient_id);
  perform private.emit_domain_event('clinical_task.claimed', t.organisation_id,
    jsonb_build_object('task_id', t.id, 'type', t.type, 'priority_class', t.priority_class),
    'clinical_task.claimed:' || v_claim, t.patient_id, 'clinical_task', t.id);

  return jsonb_build_object('already_claimed', false, 'claim_id', v_claim, 'claim_expires_at', v_expires,
    'task', jsonb_build_object('id', t.id, 'type', t.type, 'priority_class', t.priority_class, 'due_at', t.due_at, 'patient_id', t.patient_id));
end;
$$;
revoke all on function public.queue_next(text[]) from public, anon;
grant execute on function public.queue_next(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Idempotent submit
-- ---------------------------------------------------------------------------
alter table public.async_consults add column client_id uuid;
create unique index async_consults_patient_client_id on public.async_consults (patient_id, client_id) where client_id is not null;

drop function public.submit_written_question(text, text, text);
create function public.submit_written_question(p_category text, p_question text, p_duration_note text default null, p_client_id uuid default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_id uuid := gen_random_uuid();
  v_existing uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_category is null or p_category not in ('medication', 'symptom', 'results', 'lifestyle', 'general') then
    raise exception 'unknown category' using errcode = '22023';
  end if;
  select organisation_id into v_org from public.profiles where id = v_uid and role = 'patient';
  if v_org is null then raise exception 'only a patient can send a written question' using errcode = '42501'; end if;
  -- a retry after a lost reply returns the first question; it never uses a second allowance
  if p_client_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('written_question_client:' || v_uid::text || p_client_id::text, 0));
    select id into v_existing from public.async_consults where patient_id = v_uid and client_id = p_client_id;
    if v_existing is not null then return v_existing; end if;
  end if;
  insert into public.async_consults (id, organisation_id, patient_id, category, question, duration_note, client_id)
  values (v_id, v_org, v_uid, p_category, btrim(p_question), nullif(btrim(coalesce(p_duration_note, '')), ''), p_client_id);
  return v_id;
end;
$$;
revoke all on function public.submit_written_question(text, text, text, uuid) from public, anon;
grant execute on function public.submit_written_question(text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Call tasks the clinician holds, and a photo attach that survives a retry
-- ---------------------------------------------------------------------------
-- A "needs a call" outcome creates a written_question_call task. The clinician holding the claim sees it here (ids only; the
-- chart is opened through the audited chart read, which the claim allows).
create function public.my_held_call_tasks() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'queue_not_clinician' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('task_id', t.id, 'patient_id', t.patient_id, 'due_at', t.due_at, 'claim_expires_at', k.expires_at)
                     order by t.due_at)
      from public.task_claims k join public.clinical_tasks t on t.id = k.task_id
     where k.clinician_id = v_uid and k.ended_at is null and t.type = 'written_question_call'), '[]'::jsonb);
end;
$$;
revoke all on function public.my_held_call_tasks() from public, anon;
grant execute on function public.my_held_call_tasks() to authenticated;

-- A phone that lost signal after the upload cannot know the photo was registered; registering the same path again returns it.
create or replace function public.attach_written_question_photo(p_consult uuid, p_path text, p_mime text, p_bytes bigint)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  c public.async_consults%rowtype;
  v_id uuid;
begin
  select * into c from public.async_consults where id = p_consult and patient_id = v_uid;
  if not found then raise exception 'not your question' using errcode = '42501'; end if;
  select id into v_id from public.async_consult_attachments where consult_id = p_consult and storage_path = p_path;
  if v_id is not null then return v_id; end if;
  if c.status not in ('submitted', 'in_review') then raise exception 'this question is closed to photos' using errcode = 'P0001'; end if;
  if split_part(p_path, '/', 1) <> v_uid::text or split_part(p_path, '/', 2) <> p_consult::text then
    raise exception 'photo path must be in your own folder for this question' using errcode = '42501';
  end if;
  if p_bytes > (private.written_care_setting('maxPhotoBytes') #>> '{}')::bigint then
    raise exception 'photo too large' using errcode = '22023', detail = 'WRITTEN_QUESTION_PHOTO_SIZE';
  end if;
  if (select count(*) from public.async_consult_attachments where consult_id = p_consult) >= (private.written_care_setting('maxPhotos') #>> '{}')::int then
    raise exception 'too many photos' using errcode = '22023', detail = 'WRITTEN_QUESTION_PHOTO_COUNT';
  end if;
  insert into public.async_consult_attachments (organisation_id, consult_id, patient_id, storage_path, mime_type, size_bytes, is_test)
  values (c.organisation_id, c.id, v_uid, p_path, p_mime, p_bytes, c.is_test) returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants and self-checks
-- ---------------------------------------------------------------------------
revoke all on function public.grant_membership(uuid, timestamptz, text) from public, anon;
revoke all on function public.end_membership(uuid, text) from public, anon;
revoke all on function public.list_memberships(text) from public, anon;
grant execute on function public.grant_membership(uuid, timestamptz, text) to authenticated;
grant execute on function public.end_membership(uuid, text) to authenticated;
grant execute on function public.list_memberships(text) to authenticated;

do $$
declare v_fn text;
begin
  foreach v_fn in array array['public.grant_membership(uuid,timestamptz,text)', 'public.end_membership(uuid,text)', 'public.list_memberships(text)',
                              'public.queue_next(text[])', 'public.submit_written_question(text,text,text,uuid)', 'public.my_held_call_tasks()'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S22 assertion: anon can execute %', v_fn; end if;
  end loop;
  if has_function_privilege('authenticated', 'private.patient_is_member(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.can_manage_memberships()', 'EXECUTE') then
    raise exception 'S22 assertion: authenticated can execute a private membership function';
  end if;
  if has_table_privilege('authenticated', 'public.patient_memberships', 'SELECT') then
    raise exception 'S22 assertion: authenticated can read patient_memberships directly';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'queue_next' and p.pronargs = 0) then
    raise exception 'S22 assertion: the old queue_next() still exists beside queue_next(text[])';
  end if;
end $$;
