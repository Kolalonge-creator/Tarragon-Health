-- Care Circle Phase 3: help requests (docs/plans/care-circle-expansion-audit-and-plan-2026-11-04.md, Phase 3; spec section 8).
--
-- Extends the existing shared jobs (care_circle_tasks, S69b, module care_circle_tasks still OFF) rather than adding a second feature:
--   * Recipients. The patient may address a request to chosen people in their circle (care_circle_tasks.recipients). An addressed request
--     is seen, notified and answerable ONLY by those people (spec 8.5: never sent to every supporter by default). An unaddressed request
--     behaves exactly as before (seen by every member who may see jobs, claimable by helpers).
--   * Founder decision 2026-11-04 ("who answers"): a person the patient NAMES may answer that request even if they only view.
--   * A short note (founder decision D4, 2026-11-04): up to 140 characters, written only by the patient, shown only on the request itself.
--     Notifications never carry it (the payload stays the patient id only, the text stays generic).
--   * More kinds: transport, help paying for a test, help paying for medicines, help at a consultation, and "other" (which needs a note).
--   * Answers. A recipient or helper says "I can help" (claims it, as before), "I can't" (care_circle_task_responses), or marks it done.
--     The patient sees each answer with a first name.
--   * Expiry. A request whose date passed is now "expired" (was "cancelled"), so the patient can tell the two apart.
--
-- Not an emergency path: nothing here reads a page, a triage or an emergency event, and red events keep their own route
-- (private.notify_circle_red_alert). Live rows when written: 0 care_circle_tasks.
-- Functions are redefined from their LIVE bodies (2026-11-04, after Phase 2); changed lines are marked "P3".

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
alter table public.care_circle_tasks add column recipients uuid[];
alter table public.care_circle_tasks add column note text check (note is null or char_length(btrim(note)) between 1 and 140);
alter table public.care_circle_tasks drop constraint care_circle_tasks_kind_check;
alter table public.care_circle_tasks add constraint care_circle_tasks_kind_check check (kind = any (array[
  'take_to_appointment', 'take_to_lab', 'collect_medicines', 'visit', 'phone_call', 'errand',
  'transport', 'help_paying_test', 'help_paying_medicines', 'consultation_help', 'other']));
alter table public.care_circle_tasks add constraint care_circle_tasks_other_needs_note check (kind <> 'other' or note is not null);
alter table public.care_circle_tasks add constraint care_circle_tasks_recipients_sane
  check (recipients is null or cardinality(recipients) between 1 and 8);   -- no repeats: post_circle_task de-duplicates before insert
alter table public.care_circle_tasks drop constraint care_circle_tasks_state_check;
alter table public.care_circle_tasks add constraint care_circle_tasks_state_check check (state = any (array['open', 'claimed', 'done', 'cancelled', 'expired']));
comment on column public.care_circle_tasks.recipients is
  'Care Circle P3: the people in the circle this request is for (supporter profile ids). Null = everyone who may see jobs, as before.';
comment on column public.care_circle_tasks.note is
  'Care Circle P3 (D4): the patient''s own short note, at most 140 characters. Written only by the patient; never put in a notification.';

create table public.care_circle_task_responses (
  task_id       uuid not null references public.care_circle_tasks (id) on delete cascade,
  supporter_id  uuid not null references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id    uuid not null references public.profiles (id) on delete cascade,
  response      text not null check (response in ('cannot_help')),
  is_test       boolean not null default false,
  responded_at  timestamptz not null default now(),
  primary key (task_id, supporter_id)
);
comment on table public.care_circle_task_responses is
  'Care Circle P3: a supporter''s "I can''t help with this" on one request. ("I can help" is the claim on care_circle_tasks.) Read only '
  'through public.circle_tasks; no direct access for any role.';
alter table public.care_circle_task_responses enable row level security;
revoke all on public.care_circle_task_responses from public, anon, authenticated;
select private.classify_minor_dependant_table('care_circle_task_responses', 'exempt',
  'Care Circle P3: a supporter''s answer to an adult''s request; a Care Circle is adults-only, and an answer must never fail on age');
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('care_circle_task_responses', 'patient_id', 'operational', 'delete', false, false,
        'A supporter said they cannot help with one Care Circle request. Deleted with the request. Class assigned by the migration author, '
        'not yet reviewed by the CMO and DPO.');

-- ---------------------------------------------------------------------------
-- 2. Who may do what with one request
-- ---------------------------------------------------------------------------
-- The caller's relationship to one request: 'patient', 'recipient' (named on it, any permission), 'helper' (unaddressed, may help),
-- 'viewer' (unaddressed, may only see), or null (may not see it at all: an addressed request is invisible to everyone not named).
create function private.circle_task_access(p_task public.care_circle_tasks)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_role text; m public.care_circle_members%rowtype;
begin
  if v_uid is null then return null; end if;
  if v_uid = p_task.patient_id then return private.circle_task_role(p_task.patient_id); end if;
  if p_task.recipients is not null then
    if not (v_uid = any (p_task.recipients)) then return null; end if;
    m := private.circle_member_for(p_task.patient_id);   -- the gate: active, unexpired, adult, not paused
    return case when m.id is not null then 'recipient' end;
  end if;
  return private.circle_task_role(p_task.patient_id);
end $$;
comment on function private.circle_task_access(public.care_circle_tasks) is
  'Care Circle P3: patient / recipient / helper / viewer / null for one request. A named recipient answers whatever their permissions '
  '(founder decision 2026-11-04); an addressed request is invisible to anyone not named on it.';

-- ---------------------------------------------------------------------------
-- 3. Posting
-- ---------------------------------------------------------------------------
drop function public.post_circle_task(uuid, text, date);
create function public.post_circle_task(p_patient uuid, p_kind text, p_needed_by date default null, p_recipients uuid[] default null,
                                        p_note text default null)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_ahead integer := (private.circle_tools_rules() ->> 'task_max_days_ahead')::integer;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');                                                    -- P3
  v_recipients uuid[];                                                                                        -- P3
  t public.care_circle_tasks%rowtype;
  p public.profiles%rowtype;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if not private.module_enabled('care_circle_tasks') then raise exception 'circle_tools_unavailable' using errcode = 'P0001'; end if;
  v_role := private.circle_task_role(p_patient);
  if v_role is null then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  if v_role = 'viewer' then raise exception 'circle_task_needs_help_preset' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('take_to_appointment', 'take_to_lab', 'collect_medicines', 'visit', 'phone_call', 'errand',
                                      'transport', 'help_paying_test', 'help_paying_medicines', 'consultation_help', 'other') then   -- P3
    raise exception 'task_kind_invalid' using errcode = '22023';
  end if;
  if p_needed_by is not null and (p_needed_by < v_today or p_needed_by > v_today + v_ahead) then raise exception 'task_date_invalid' using errcode = '22023'; end if;
  -- P3: only the patient addresses a request or writes a note (D4); a helper's job stays the S69b shape
  if v_role <> 'patient' and (p_recipients is not null or v_note is not null) then
    raise exception 'task_only_patient_may_address' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 140 then raise exception 'task_note_too_long' using errcode = '22023'; end if;
  if p_kind = 'other' and v_note is null then raise exception 'task_other_needs_note' using errcode = '22023'; end if;
  if p_recipients is not null then
    -- p_recipients are the patient's own MEMBERSHIP ids (what their Care Circle page lists); each must be a current member of this
    -- patient's circle, and is stored as that member's supporter profile id. One answer for anything else.
    v_recipients := array(select distinct m.supporter_id from public.care_circle_members m join public.profiles s on s.id = m.supporter_id and s.is_active
                           where m.id = any (p_recipients) and m.patient_id = p_patient and m.state = 'active' and m.expires_at > now());
    if cardinality(v_recipients) = 0 or cardinality(v_recipients) > 8
       or cardinality(v_recipients) <> (select count(distinct x) from unnest(p_recipients) x where x is not null) then
      raise exception 'task_recipients_invalid' using errcode = '22023';
    end if;
  end if;
  select * into p from public.profiles where id = p_patient;
  if (select count(*) from public.care_circle_tasks where patient_id = p_patient and state in ('open', 'claimed'))
       >= (private.circle_tools_rules() ->> 'task_max_open')::integer then
    raise exception 'task_limit' using errcode = 'P0001';
  end if;
  insert into public.care_circle_tasks (organisation_id, patient_id, created_by, kind, needed_by, recipients, note, is_test)   -- P3
  values (p.organisation_id, p_patient, v_uid, p_kind, p_needed_by, v_recipients, v_note, coalesce(p.is_test, false))
  returning * into t;
  -- the patient posts: the helpers (or the named recipients) are told; a helper posts: the patient is told. Neutral, no payload.
  perform private.circle_task_notify(t, v_role = 'helper');
  if v_role = 'helper' then
    perform private.log_care_access(p_patient, 'record_viewed', 'care_circle', jsonb_build_object('blocks', jsonb_build_array('tasks'), 'posted', true), v_uid);
  end if;
  return jsonb_build_object('ok', true, 'task_id', t.id);
end $function$;
revoke all on function public.post_circle_task(uuid, text, date, uuid[], text) from public;
grant execute on function public.post_circle_task(uuid, text, date, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Notices: an addressed request goes to its recipients only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.circle_task_notify(p_task care_circle_tasks, p_to_patient boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record;
begin
  begin
    if p_to_patient then
      perform private.circle_notify_always(p_task.patient_id, p_task.organisation_id, 'circle_task_update', 'care_circle_tasks', p_task.id, array['in_app'], 'routine');
    else
      -- the only thing in a helper's payload is whose circle it is, so the inbox line can open that person's page; it is never echoed in text
      -- P3: an addressed request goes to the people named on it (any permission), never to every helper
      for r in select m.supporter_id from public.care_circle_members m join public.profiles sp on sp.id = m.supporter_id and sp.is_active
                where m.patient_id = p_task.patient_id and m.state = 'active' and m.expires_at > now()
                  and case when p_task.recipients is not null then m.supporter_id = any (p_task.recipients)
                           else 'pay_for_care' = any (m.permissions) end
                  and m.supporter_id <> p_task.created_by and sp.is_test = p_task.is_test and not private.circle_paused(m.patient_id) loop
        insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
        values (r.supporter_id, p_task.organisation_id, 'in_app', 'circle_task_update', jsonb_build_object('patient_id', p_task.patient_id), 'pending', 'non_clinical', 'routine', 'care_circle_tasks', p_task.id);
      end loop;
    end if;
  exception when others then
    begin
      perform private.page_incident(p_task.organisation_id, 'circle_task_notice_failed:' || p_task.id, 'A Care Circle task notice could not be sent',
        'A notice about a shared task (' || p_task.id || ') failed: ' || sqlerrm);
    exception when others then
      raise warning 'circle task notice and its incident both failed for %: %', p_task.id, sqlerrm;
    end;
  end;
end $function$;

-- ---------------------------------------------------------------------------
-- 5. Reading the list
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.circle_tasks(p_patient uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); v_role text; v_today date := (now() at time zone 'Africa/Lagos')::date; out jsonb;
  v_visible integer := (private.circle_tools_rules() ->> 'task_done_visible_days')::integer;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if not private.module_enabled('care_circle_tasks') then raise exception 'circle_tools_unavailable' using errcode = 'P0001'; end if;
  v_role := private.circle_task_role(p_patient);
  -- P3: a member who may not see jobs in general still sees the requests addressed to them (as a viewer of the rest, which is nothing)
  if v_role is null and v_uid <> p_patient and (private.circle_member_for(p_patient)).id is not null then
    v_role := 'viewer';
  end if;
  if v_role is null then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(x.j order by (x.state = 'done'), x.needed_by nulls last, x.created_at), '[]'::jsonb)
    into out
    from (
      select t.state, t.needed_by, t.created_at, jsonb_build_object(
           'task_id', t.id, 'kind', t.kind, 'needed_by', t.needed_by, 'state', t.state,
           'note', t.note,                                                                                                    -- P3 (D4)
           'addressed', t.recipients is not null,                                                                             -- P3
           -- P3: the patient sees who it went to and each answer; nobody else sees the recipient list
           'recipients', case when a.acc = 'patient' and t.recipients is not null then (
               select jsonb_agg(jsonb_build_object('name', coalesce(nullif(split_part(btrim(rp.full_name), ' ', 1), ''), 'Someone'),
                                                   'answer', case when t.claimed_by = rp.id then 'can_help'
                                                                  when exists (select 1 from public.care_circle_task_responses x
                                                                                where x.task_id = t.id and x.supporter_id = rp.id) then 'cannot_help' end)
                                order by rp.full_name)
                 from public.profiles rp where rp.id = any (t.recipients)) end,
           'cannot_help_count', case when a.acc = 'patient' then (select count(*) from public.care_circle_task_responses x where x.task_id = t.id) end,
           'claimed_by_name', case when t.state in ('claimed', 'done') then coalesce(nullif(split_part(btrim(cp.full_name), ' ', 1), ''), 'Someone') end,
           'mine', t.claimed_by = v_uid,
           'posted_by_me', t.created_by = v_uid,
           'my_answer', case when t.claimed_by = v_uid then 'can_help'
                             when exists (select 1 from public.care_circle_task_responses x where x.task_id = t.id and x.supporter_id = v_uid) then 'cannot_help' end,
           'can_claim', a.acc in ('helper', 'recipient') and t.state = 'open',                                               -- P3
           'can_decline', a.acc in ('helper', 'recipient') and t.state = 'open'                                              -- P3
                          and not exists (select 1 from public.care_circle_task_responses x where x.task_id = t.id and x.supporter_id = v_uid),
           'can_release', t.state = 'claimed' and t.claimed_by = v_uid,
           'can_complete', (t.state = 'claimed' and (a.acc = 'patient' or (a.acc in ('helper', 'recipient') and t.claimed_by = v_uid))) or (t.state = 'open' and a.acc = 'patient'),
           -- the same rule cancel_circle_task enforces: the patient, or the poster while still a helper (a poster who dropped to viewer cannot)
           'can_cancel', t.state in ('open', 'claimed') and (a.acc = 'patient' or (a.acc = 'helper' and t.created_by = v_uid))) as j
        from public.care_circle_tasks t
        left join public.profiles cp on cp.id = t.claimed_by
        cross join lateral (select private.circle_task_access(t) as acc) a
       where t.patient_id = p_patient and a.acc is not null                                                                   -- P3: addressed = named only
         and (t.state in ('open', 'claimed') or (t.state = 'done' and t.done_at > now() - make_interval(days => v_visible)))
    ) x;
  -- a supporter's look is written to the patient's own list (the patient reading their own tasks is not a look). P3: only when they saw at
  -- least one request; an empty list is not a look (a person who only gets alerts reads an empty list on every page visit)
  if v_role <> 'patient' and jsonb_array_length(out) > 0 then
    perform private.log_care_access(p_patient, 'record_viewed', 'care_circle', jsonb_build_object('blocks', jsonb_build_array('tasks')), v_uid);
  end if;
  return jsonb_build_object('role', v_role, 'tasks', out, 'today', v_today);
end $function$;

-- ---------------------------------------------------------------------------
-- 6. Answering
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_circle_task(p_task uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); t public.care_circle_tasks%rowtype;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if not private.module_enabled('care_circle_tasks') then raise exception 'circle_tools_unavailable' using errcode = 'P0001'; end if;
  select * into t from public.care_circle_tasks where id = p_task for update;
  if not found or private.circle_task_access(t) not in ('helper', 'recipient') or private.circle_task_access(t) is null then   -- P3
    raise exception 'circle_not_found' using errcode = 'P0002';
  end if;
  -- first one wins; a task already claimed answers false, never an error that names who has it
  if t.state <> 'open' then return false; end if;
  update public.care_circle_tasks set state = 'claimed', claimed_by = v_uid, claimed_at = now() where id = t.id returning * into t;
  delete from public.care_circle_task_responses where task_id = t.id and supporter_id = v_uid;   -- P3: changing their mind to "I can help"
  perform private.circle_task_notify(t, true);
  return true;
end $function$;

create function public.decline_circle_task(p_task uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); t public.care_circle_tasks%rowtype; v_acc text;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if not private.module_enabled('care_circle_tasks') then raise exception 'circle_tools_unavailable' using errcode = 'P0001'; end if;
  select * into t from public.care_circle_tasks where id = p_task;
  v_acc := case when t.id is not null then private.circle_task_access(t) end;
  if v_acc is null or v_acc not in ('helper', 'recipient') then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  if t.state <> 'open' then return false; end if;
  insert into public.care_circle_task_responses (task_id, supporter_id, organisation_id, patient_id, response, is_test)
  values (t.id, v_uid, t.organisation_id, t.patient_id, 'cannot_help', t.is_test)
  on conflict (task_id, supporter_id) do nothing;
  if found then perform private.circle_task_notify(t, true); end if;   -- the patient is told someone answered (no name, no reason)
  return true;
end $$;
revoke all on function public.decline_circle_task(uuid) from public;
grant execute on function public.decline_circle_task(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.complete_circle_task(p_task uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); t public.care_circle_tasks%rowtype; v_role text;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  select * into t from public.care_circle_tasks where id = p_task for update;
  if not found then return false; end if;
  v_role := private.circle_task_access(t);                                                                    -- P3
  -- the person who claimed it (while still a helper or a named recipient) or the patient
  if not (v_role = 'patient' or (v_role in ('helper', 'recipient') and t.claimed_by = v_uid)) then return false; end if;
  if t.state not in ('open', 'claimed') or (t.state = 'open' and v_role <> 'patient') then return false; end if;
  update public.care_circle_tasks set state = 'done', done_at = now() where id = t.id returning * into t;
  if v_role in ('helper', 'recipient') then perform private.circle_task_notify(t, true); end if;
  return true;
end $function$;

-- release stays "only the person who claimed it"; it now also checks the tool is on and they can still see the request
CREATE OR REPLACE FUNCTION public.release_circle_task(p_task uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); t public.care_circle_tasks%rowtype;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if not private.module_enabled('care_circle_tasks') then raise exception 'circle_tools_unavailable' using errcode = 'P0001'; end if;   -- P3
  update public.care_circle_tasks set state = 'open', claimed_by = null, claimed_at = null
   where id = p_task and state = 'claimed' and claimed_by = v_uid returning * into t;
  if t.id is null then return false; end if;
  perform private.circle_task_notify(t, true);
  return true;
end $function$;

-- ---------------------------------------------------------------------------
-- 7. The sweep: a named recipient keeps a claim; a passed date is "expired"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.sweep_circle_tasks()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n integer := 0; k integer; v_keep integer := (private.circle_tools_rules() ->> 'task_keep_days')::integer;
  v_stale integer := (private.circle_tools_rules() ->> 'task_stale_days')::integer;
begin
  update public.care_circle_tasks t set state = 'open', claimed_by = null, claimed_at = null
   where t.state = 'claimed' and not exists (
     select 1 from public.care_circle_members m
      where m.patient_id = t.patient_id and m.supporter_id = t.claimed_by and m.state = 'active' and m.expires_at > now()
        and ('pay_for_care' = any (m.permissions) or t.claimed_by = any (coalesce(t.recipients, '{}'::uuid[]))));          -- P3
  get diagnostics k = row_count; n := n + k;
  update public.care_circle_tasks set state = 'expired', claimed_by = null                                                    -- P3
   where state in ('open', 'claimed') and needed_by is not null and needed_by < (now() at time zone 'Africa/Lagos')::date - v_stale;
  get diagnostics k = row_count; n := n + k;
  delete from public.care_circle_tasks where state in ('done', 'cancelled', 'expired') and updated_at < now() - make_interval(days => v_keep);   -- P3
  get diagnostics k = row_count; n := n + k;
  return n;
end $function$;

-- ---------------------------------------------------------------------------
-- 8. The weekly digest counts only requests the reader may see (redefined from the live P1 body)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.circle_weekly_digest(p_patient uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  m public.care_circle_members%rowtype;
  v_perms text[];
  v_days integer := (private.circle_tools_rules() ->> 'digest_days')::integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_from date;
  v_name text;
  out jsonb;
  v_all integer; v_with integer; v_read integer; v_next timestamptz;
  v_open integer; v_claimed integer; v_done integer;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if not private.module_enabled('care_circle_digest') then raise exception 'circle_tools_unavailable' using errcode = 'P0001'; end if;
  -- the one gate: an active, unexpired member, and a paused circle shows nothing (same "not found" as everything else)
  m := private.circle_member_for(p_patient);
  if m.id is null then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  v_perms := private.circle_consented_permissions(p_patient, m.permissions);   -- P1: the patient's sharing consent applies here too
  v_from := v_today - (v_days - 1);
  select coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'Someone') into v_name from public.profiles where id = p_patient;
  out := jsonb_build_object('patient_id', p_patient, 'name', v_name, 'from', v_from, 'to', v_today, 'days', v_days);

  if 'adherence_summary' = any (v_perms) then
    select count(*) filter (where due > 0 and taken = due), count(*) filter (where due > 0) into v_all, v_with
      from (select scheduled_for_date,
                   count(*) filter (where status in ('taken', 'delayed')) taken,
                   count(*) filter (where status in ('taken', 'delayed', 'missed', 'skipped')) due
              from public.medication_logs
             where patient_id = p_patient and scheduled_for_date between v_from and v_today
             group by scheduled_for_date) d;
    out := out || jsonb_build_object('doses', jsonb_build_object('days_all_taken', v_all, 'days_with_doses', v_with));
  end if;

  if 'weekly_bp_trend' = any (v_perms) then
    -- days on which a reading was logged: a count, never a value, a time or a note
    select count(distinct (taken_at at time zone 'Africa/Lagos')::date) into v_read
      from private.vitals_readings_current
     where patient_id = p_patient and vital_type = 'blood_pressure' and systolic is not null and diastolic is not null
       and coalesce(validation_status::text, '') <> 'rejected'
       and taken_at >= v_from::timestamp at time zone 'Africa/Lagos';
    out := out || jsonb_build_object('readings', jsonb_build_object('days_logged', v_read));
  end if;

  if 'appointments' = any (v_perms) then
    select min(scheduled_for) filter (where status in ('scheduled', 'booked', 'confirmed') and scheduled_for > now()) into v_next
      from public.appointments
     where patient_id = p_patient
       and private.circle_appointment_shareable(appointment_type, reason, service);   -- P1
    out := out || jsonb_build_object('appointments', jsonb_build_object('next_at', v_next));
  end if;

  -- job counts are visible to members who may see jobs at all (a view permission or pay_for_care), not to a red_alerts-only member
  if private.circle_perms_see_tasks(m.permissions) then
    select count(*) filter (where state = 'open'), count(*) filter (where state = 'claimed'),
           count(*) filter (where state = 'done' and done_at > now() - make_interval(days => v_days))
      into v_open, v_claimed, v_done from public.care_circle_tasks
     where patient_id = p_patient and (recipients is null or v_uid = any (recipients));   -- P3: never count a request addressed to others
    out := out || jsonb_build_object('tasks', jsonb_build_object('open', v_open, 'claimed', v_claimed, 'done', v_done));
  end if;

  perform private.log_care_access(p_patient, 'record_viewed', 'care_circle', jsonb_build_object('blocks', jsonb_build_array('digest')), v_uid);
  return out;
end $function$;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'post_circle_task') <> 1 then
    raise exception 'P3 self-check: post_circle_task must have exactly one signature (no ambiguous overload)';
  end if;
  if has_function_privilege('anon', 'public.post_circle_task(uuid, text, date, uuid[], text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.decline_circle_task(uuid)', 'EXECUTE') then
    raise exception 'P3 self-check: anon can execute a help-request function';
  end if;
  if has_table_privilege('authenticated', 'public.care_circle_task_responses', 'SELECT') then
    raise exception 'P3 self-check: care_circle_task_responses is directly readable';
  end if;
end $$;
