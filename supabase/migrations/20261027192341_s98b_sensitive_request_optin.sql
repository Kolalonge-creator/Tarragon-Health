-- S98b: sensitive tests (HIV, hepatitis B and C, and anything screen_types.sensitive) MAY get an automatic test request, but only for a patient who
-- has explicitly opted in. Founder decision 2026-10-27. CMO and DPO review is still owed before the new guard is switched on.
--
-- Live counts before this migration: no table of this name; 0 screening_schedules rows; the S98 job is not applied or switched on, so no
-- sensitive request has ever been issued automatically. Nothing is converted.
--
-- Why a small table and not the consent matrix: the matrix is a fixed data_type x purpose grid with a draft wording key set in every locale;
-- adding a cell means new enum values and keys and a CMO/DPO wording pass of its own. This is one boolean per patient, own row, audited.
--
-- What this adds (nothing switched on):
--   1. screening_sensitive_request_optin: one row per patient (RLS: own row read only; writes only through the audited RPC). In the data registry.
--   2. Guard screening_sensitive_request_optin_enabled, seeded OFF. screening_request_automation_enabled alone is NOT enough for a sensitive test.
--   3. my_sensitive_request_optin() / set_my_sensitive_request_optin(): the patient reads and sets their own choice. Adults only. Opting in needs the
--      guard open for the patient; withdrawing is always allowed and never deletes an existing request.
--   4. run_screening_request_automation(): a sensitive test gets a request only when BOTH guards are open, the patient has opted in, the schedule came
--      from a signed rule set (as for every test), and the insert passes the existing lab-order triggers. A refusal by a trigger is skipped and logged
--      (no test name in the log), never bypassed. Self-arranged orders carry no home-collection fields, so the home_kit_sensitive_enabled trigger is
--      untouched and still governs home collection only.
--   5. INV-07: the "your request" notification payload and the screening reminder payloads no longer carry a sensitive test's name.
--
-- Rollback: restore run_screening_request_automation from 20261027192259, restore the two patched functions from their previous definitions, drop the
-- two RPCs and the table, delete the guard row and the registry row.

-- 1. Table
create table public.screening_sensitive_request_optin (
  patient_id      uuid primary key references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  opted_in        boolean not null,
  changed_at      timestamptz not null default now()
);
comment on table public.screening_sensitive_request_optin is
  'S98b: the patient''s own choice to let the preventive engine issue a printable request for a SENSITIVE screening (HIV, hepatitis, and anything screen_types.sensitive). No row = not opted in. Withdrawing sets opted_in false; it never deletes an existing request. Written only by set_my_sensitive_request_optin().';
alter table public.screening_sensitive_request_optin enable row level security;
revoke all on public.screening_sensitive_request_optin from public, anon, authenticated;
grant select on public.screening_sensitive_request_optin to authenticated;
create policy screening_sensitive_request_optin_select on public.screening_sensitive_request_optin
  for select to authenticated using (patient_id = (select auth.uid()));

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes) values
  ('screening_sensitive_request_optin', 'patient_id', 'consent', 'review', true,
   'The patient''s opt-in to automatic test requests for sensitive screenings. PROPOSED class, to be confirmed by the CMO and DPO.')
on conflict (table_name) do nothing;

-- 2. Guard (off)
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('screening_sensitive_request_optin_enabled', 'Automatic test requests for sensitive screenings (opt-in)',
   'Automatic test requests for HIV, hepatitis and other sensitive screenings, and the patient opt-in switch',
   'Needs CMO and DPO review before it can be switched on (wording, who may opt in, how a reactive result is disclosed). Also needs screening_request_automation_enabled on. A patient must still opt in individually.',
   'cmo', array['run_screening_request_automation', 'set_my_sensitive_request_optin'],
   'Manual "Get & print" for a sensitive test is unchanged. Home collection stays behind home_kit_sensitive_enabled.');

-- 3. RPCs
create function public.my_sensitive_request_optin() returns table (available boolean, opted_in boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return query select private.go_live_open_patient('screening_sensitive_request_optin_enabled', v_uid),
    coalesce((select o.opted_in from public.screening_sensitive_request_optin o where o.patient_id = v_uid), false);
end $$;
revoke all on function public.my_sensitive_request_optin() from public, anon;
grant execute on function public.my_sensitive_request_optin() to authenticated;

create function public.set_my_sensitive_request_optin(p_opt_in boolean) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_role text; v_dob date;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_opt_in is null then raise exception 'choice_required' using errcode = '22023'; end if;
  select organisation_id, role::text, date_of_birth into v_org, v_role, v_dob from public.profiles where id = v_uid;
  if v_org is null or v_role <> 'patient' then raise exception 'only a patient can set this' using errcode = '42501'; end if;
  if p_opt_in then
    if v_dob is null or v_dob > (private.lagos_today() - interval '18 years')::date then raise exception 'adults_only' using errcode = '22023'; end if;
    if not private.go_live_open_patient('screening_sensitive_request_optin_enabled', v_uid) then raise exception 'not_available_yet' using errcode = '55000'; end if;
  end if;
  insert into public.screening_sensitive_request_optin (patient_id, organisation_id, opted_in, changed_at)
  values (v_uid, v_org, p_opt_in, now())
  on conflict (patient_id) do update set opted_in = excluded.opted_in, changed_at = now();
  perform private.log_audit(case when p_opt_in then 'screening_sensitive_optin.granted' else 'screening_sensitive_optin.withdrawn' end,
    'screening_sensitive_request_optin', v_uid, '{}'::jsonb);
  return p_opt_in;
end $$;
revoke all on function public.set_my_sensitive_request_optin(boolean) from public, anon;
grant execute on function public.set_my_sensitive_request_optin(boolean) to authenticated;

-- 4. The job
create or replace function private.run_screening_request_automation(p_patient uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record; v_order uuid; v_issued integer := 0; v_sensitive integer := 0; v_no_bundle integer := 0; v_failed integer := 0; v_is_sens boolean;
  v_fail_states text[] := '{}'; v_fail_org uuid;
begin
  if p_patient is null then
    if not private.go_live_guard_on('screening_request_automation_enabled') then return jsonb_build_object('ran', false, 'reason', 'guard_off'); end if;
  else
    if not private.go_live_open_patient('screening_request_automation_enabled', p_patient) then return jsonb_build_object('ran', false, 'reason', 'guard_off'); end if;
  end if;

  for r in
    select s.id as schedule_id, s.organisation_id, s.patient_id, st.code, st.sensitive,
           (select b.id from public.panel_bundles b where b.is_active and b.test_codes = array[st.code] order by (b.code like 'single\_%') desc, b.self_bookable, b.code limit 1) as bundle_id
      from public.screening_schedules s
      join public.profiles p on p.id = s.patient_id
      join public.screen_types st on st.id = s.screen_type_id and st.is_active
     where s.status in ('pending', 'overdue')
       and s.due_date <= current_date
       and p.role = 'patient' and p.is_active and p.organisation_id is not null
       and (p_patient is null or s.patient_id = p_patient)
       and (coalesce(p.is_test, false)
            or exists (select 1 from public.screening_rule_sets rs where rs.id = s.rule_set_id and rs.is_active and rs.approved_by is not null))
       and not exists (select 1 from public.lab_orders o where o.screening_schedule_id = s.id)
     order by s.due_date, s.id
     limit 1000
  loop
    -- one source: screen_types.sensitive (live, hiv, hep_b, hep_c, syphilis and chlamydia_gonorrhoea are all flagged)
    v_is_sens := r.sensitive;
    -- a sensitive test needs the second guard AND the patient's own opt-in; otherwise it stays a patient action (INV-04)
    if v_is_sens and not (
         private.go_live_open_patient('screening_sensitive_request_optin_enabled', r.patient_id)
         and exists (select 1 from public.screening_sensitive_request_optin o where o.patient_id = r.patient_id and o.opted_in)) then
      v_sensitive := v_sensitive + 1; continue;
    end if;
    if r.bundle_id is null then v_no_bundle := v_no_bundle + 1; continue; end if;
    begin
      perform pg_advisory_xact_lock(hashtextextended('screening_request:' || r.schedule_id::text, 0));
      if exists (select 1 from public.lab_orders o where o.screening_schedule_id = r.schedule_id) then continue; end if;
      perform set_config('tarragon.screening_request_job', 'on', true);
      insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, screening_schedule_id, status, origin, fulfilment, total_kobo)
      values (r.organisation_id, r.patient_id, r.bundle_id, r.schedule_id, 'ordered', 'patient_initiated', 'self_arranged', 0)
      returning id into v_order;
      perform set_config('tarragon.screening_request_job', 'off', true);
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (r.organisation_id, null, 'screening_request.auto_issued', 'lab_orders', v_order,
              case when v_is_sens then jsonb_build_object('screening_schedule_id', r.schedule_id, 'sensitive', true)
                   else jsonb_build_object('screening_schedule_id', r.schedule_id, 'screen_type', r.code) end);
      v_issued := v_issued + 1;
    exception when others then
      -- skip, never bypass; recorded durably after the loop, naming no patient, schedule or test (INV-07)
      perform set_config('tarragon.screening_request_job', 'off', true);
      v_failed := v_failed + 1;
      v_fail_states := array_append(v_fail_states, sqlstate);
      v_fail_org := coalesce(v_fail_org, r.organisation_id);
    end;
  end loop;
  -- outside the per-row handler on purpose: if recording the failure fails, the whole run fails loudly instead of being swallowed
  if v_failed > 0 then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
    values (v_fail_org, null, 'screening_request.auto_issue_failed', 'screening_schedules', null,
            jsonb_build_object('failed', v_failed, 'sqlstates', to_jsonb(v_fail_states)), 'failed');
    if not exists (select 1 from public.ops_incidents where external_reference = 'screening_request_automation' and status not in ('resolved', 'closed')) then
      insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
      values (v_fail_org, 'technical', 'sev3', 'Automatic test requests failed for some patients',
              format('%s automatic test request(s) failed in the last nightly run (SQLSTATE: %s). See audit_log action screening_request.auto_issue_failed. No patient or test is named here.',
                     v_failed, array_to_string(v_fail_states, ',')),
              'screening_request_automation', now(), now() + interval '1 day');
    end if;
  end if;
  return jsonb_build_object('ran', true, 'issued', v_issued, 'skipped_sensitive', v_sensitive, 'skipped_no_bundle', v_no_bundle, 'failed', v_failed);
end $$;
revoke all on function private.run_screening_request_automation(uuid) from public, anon, authenticated;

-- 5. INV-07 patches, from the live definitions, by exact anchors
do $$
declare v_def text; v_new text; v_a text; v_b text;
begin
  -- the "your request" notification payload: a sensitive bundle is called "a lab test"
  v_def := pg_get_functiondef('private.enqueue_lab_order_requested_notifications()'::regprocedure);
  v_a := 'select name into v_test_name from public.panel_bundles where id = new.panel_bundle_id;';
  if position(v_a in v_def) = 0 then raise exception 'S98b: anchor missing in enqueue_lab_order_requested_notifications'; end if;
  v_new := replace(v_def, v_a,
    'select case when exists (select 1 from public.screen_types st where st.sensitive and st.code = any (b.test_codes)) then null else b.name end into v_test_name from public.panel_bundles b where b.id = new.panel_bundle_id;');
  execute v_new;

  -- the request EMAIL: the PDF link (a bearer link built from order_id by send-pending-notifications' documentLinkFor) names the test inside the PDF.
  -- For a sensitive bundle the email carries no order_id, so the function sends no link; the email text is already neutral ("sign in to open your
  -- printable request") and the patient downloads from the app. No Edge Function change or redeploy is needed: documentLinkFor returns null when
  -- order_id is not a string and the email goes without a link.
  v_def := pg_get_functiondef('private.enqueue_lab_order_requested_notifications()'::regprocedure);
  v_a := $a$'order_id',     new.id$a$;
  if position(v_a in v_def) = 0 then raise exception 'S98b: order_id anchor missing in enqueue_lab_order_requested_notifications'; end if;
  v_new := replace(v_def, v_a,
    $a$'order_id',     case when exists (select 1 from public.panel_bundles pbx join public.screen_types sx on sx.sensitive and sx.code = any (pbx.test_codes) where pbx.id = new.panel_bundle_id) then null else new.id end$a$);
  execute v_new;

  -- the screening reminders: a sensitive screening is called "a screening test"
  v_def := pg_get_functiondef('private.queue_screening_reminders()'::regprocedure);
  v_b := 'select s.*, st.name as screen_type_name';
  if (length(v_def) - length(replace(v_def, v_b, ''))) / length(v_b) <> 4 then raise exception 'S98b: expected the name anchor 4 times in queue_screening_reminders'; end if;
  v_new := replace(v_def, v_b, 'select s.*, case when st.sensitive then ''a screening test'' else st.name end as screen_type_name');
  execute v_new;
end $$;

do $$
begin
  if exists (select 1 from public.go_live_guards where key = 'screening_sensitive_request_optin_enabled' and is_on) then raise exception 'S98b self-check: the guard must start off'; end if;
  if has_table_privilege('anon', 'public.screening_sensitive_request_optin', 'SELECT') or has_table_privilege('authenticated', 'public.screening_sensitive_request_optin', 'INSERT')
     or has_table_privilege('authenticated', 'public.screening_sensitive_request_optin', 'UPDATE') then raise exception 'S98b self-check: table grants are wrong'; end if;
  if has_function_privilege('anon', 'public.set_my_sensitive_request_optin(boolean)', 'EXECUTE') or has_function_privilege('anon', 'public.my_sensitive_request_optin()', 'EXECUTE') then
    raise exception 'S98b self-check: anon can run the opt-in functions'; end if;
  if exists (select 1 from private.minor_guard_gaps()) then raise exception 'S98b self-check: minor guard gaps'; end if;
  if not exists (select 1 from public.data_registry where table_name = 'screening_sensitive_request_optin') then raise exception 'S98b self-check: not in the data registry'; end if;
end $$;
