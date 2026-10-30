-- Ease a new patient in: one grouped reminder per stage instead of one per screening, and a weekly limit on new printed requests.
--
-- Why: the first real nightly run (2026-10-30) gave each of four real patients 14 to 16 reminders in one morning and 8 printed test
-- requests at once. A patient who opens the app to 15 reminders dismisses them together, so the one that matters is lost among them, and
-- 8 lab tests on one day is not what anyone does or pays for.
--
-- 1. GROUPED REMINDER. For each stage (upcoming, due, overdue, escalated), a patient with more than 2 schedules entering that stage the
--    same night gets ONE reminder carrying a count ("N checks due") instead of one per screening. Up to 2 are still sent one by one,
--    exactly as before. The grouped reminder reuses the same templates (screening_upcoming, screening_due, screening_overdue,
--    screening_escalated) with a count in the payload, names no test (INV-07), and points at the first one in priority order.
--    Every schedule in the group moves to the new stage, so none is reminded again individually.
-- 2. WEEKLY LIMIT ON NEW REQUESTS. run_screening_request_automation issues at most the signed rule set's `pacing.maxNewRequestsPerWeek`
--    new printed requests per patient in any rolling 7 days, in the signed `pacing.priority` order (blood pressure and blood sugar
--    first). The rest wait their turn. WITH NO `pacing` KEY IN THE SIGNED RULE SET THERE IS NO LIMIT AND THE ORDER IS BY DUE DATE, so
--    this migration changes nothing about requests until the CMO signs the rule set below.
-- 3. RULE SET v4 DRAFT. A copy of the signed v3 with a PROPOSED `pacing` block (3 a week; priority order below). Inactive and unsigned.
--    The CMO reads and signs it on the sign-off hub; the value and the order are clinical choices and live in the signed rule set, not
--    in code.
-- 4. A schedule keeps being issued requests after a NEWER rule set is signed. The automation used to require the schedule's own rule set
--    to still be ACTIVE, so signing v4 would have silently stopped requests for every schedule created under v3. It now requires only
--    that the schedule's rule set was signed.
--
-- The automation is patched from its LIVE body with self-asserting match counts. queue_screening_reminders is rewritten whole; its
-- stage conditions are copied from the live body and the dedupe fix of 20261030100000 (channel row only when the channel is not in_app)
-- is kept.
create or replace function private.screening_pacing() returns jsonb
language sql stable security definer set search_path = ''
as $$ select rs.config -> 'pacing' from public.screening_rule_sets rs where rs.is_active and rs.approved_by is not null order by rs.version desc limit 1 $$;

create or replace function private.screening_pacing_cap() returns integer
language sql stable security definer set search_path = ''
as $$ select case when jsonb_typeof(private.screening_pacing() -> 'maxNewRequestsPerWeek') = 'number'
                  then (private.screening_pacing() ->> 'maxNewRequestsPerWeek')::integer end $$;

-- lower number = earlier. A test not named in the signed priority list sorts after every named one.
create or replace function private.screening_priority(p_code text) returns integer
language sql stable security definer set search_path = ''
as $$ select coalesce((select (o.ordinality)::integer
                         from jsonb_array_elements_text(case when jsonb_typeof(private.screening_pacing() -> 'priority') = 'array'
                                                             then private.screening_pacing() -> 'priority' else '[]'::jsonb end) with ordinality as o(code, ordinality)
                        where o.code = p_code limit 1), 1000) $$;

create or replace function private.queue_screening_notification(p_org uuid, p_patient uuid, p_template text, p_push boolean, p_payload jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  -- the patient's own channel (email or push) gets its row only when that channel is not the inbox; the inbox copy is always queued once
  if private.patient_reminder_channel(p_patient) <> 'in_app' then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (p_org, p_patient, private.patient_reminder_channel(p_patient), 'pending', p_template, p_payload);
  end if;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (p_org, p_patient, 'in_app', 'pending', p_template, p_payload);
  if p_push then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (p_org, p_patient, 'push', 'pending', p_template, p_payload);
  end if;
end $$;

create or replace function private.queue_screening_stage(p_template text, p_stage text, p_ids uuid[], p_push boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  g record;
  r record;
  v_group_over constant integer := 2;  -- more than this many in one stage on one night become one grouped reminder
begin
  if p_ids is null or cardinality(p_ids) = 0 then return; end if;
  for g in
    select s.organisation_id, s.patient_id, count(*)::integer as n, min(s.due_date) as first_due,
           array_agg(s.id order by private.screening_priority(st.code), s.due_date, s.id) as ids
      from public.screening_schedules s
      join public.screen_types st on st.id = s.screen_type_id
     where s.id = any (p_ids)
     group by s.organisation_id, s.patient_id
  loop
    if g.n > v_group_over then
      perform private.queue_screening_notification(g.organisation_id, g.patient_id, p_template, p_push,
        jsonb_build_object('screen_type_name', 'your screening checks', 'due_date', g.first_due, 'schedule_id', g.ids[1],
                           'lab_order_id', private.open_screening_request_id(g.ids[1]), 'count', g.n));
    else
      for r in
        select s.id, s.due_date, case when st.sensitive then 'a screening test' else st.name end as screen_type_name
          from public.screening_schedules s join public.screen_types st on st.id = s.screen_type_id
         where s.id = any (g.ids) order by array_position(g.ids, s.id)
      loop
        perform private.queue_screening_notification(g.organisation_id, g.patient_id, p_template, p_push,
          jsonb_build_object('screen_type_name', r.screen_type_name, 'due_date', r.due_date, 'schedule_id', r.id,
                             'lab_order_id', private.open_screening_request_id(r.id)));
      end loop;
    end if;
    update public.screening_schedules set reminder_stage = p_stage::public.reminder_stage, reminder_sent_at = now() where id = any (g.ids);
  end loop;
end $$;

create or replace function private.queue_screening_reminders() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  -- stage conditions are those of the previous body, in the same order; each stage sees the stage updates of the one before it
  perform private.queue_screening_stage('screening_upcoming', 'upcoming', array(
    select s.id from public.screening_schedules s
     where s.status in ('pending', 'booked', 'overdue') and not private.screening_result_uploaded(s.id)
       and s.reminder_stage is null and s.due_date > current_date and s.due_date <= current_date + 7), false);
  perform private.queue_screening_stage('screening_due', 'due', array(
    select s.id from public.screening_schedules s
     where s.status in ('pending', 'booked', 'overdue') and not private.screening_result_uploaded(s.id)
       and (s.reminder_stage is null or s.reminder_stage = 'upcoming')
       and s.due_date <= current_date and s.due_date >= current_date - 6), false);
  perform private.queue_screening_stage('screening_overdue', 'overdue', array(
    select s.id from public.screening_schedules s
     where s.status in ('pending', 'booked', 'overdue') and not private.screening_result_uploaded(s.id)
       and (s.reminder_stage is null or s.reminder_stage in ('upcoming', 'due'))
       and s.due_date < current_date - 6), false);
  perform private.queue_screening_stage('screening_escalated', 'escalated', array(
    select s.id from public.screening_schedules s
     where s.status in ('pending', 'booked', 'overdue') and not private.screening_result_uploaded(s.id)
       and s.reminder_stage = 'overdue' and s.due_date < current_date - 20), true);
end $$;

revoke all on function private.screening_pacing(), private.screening_pacing_cap(), private.screening_priority(text),
  private.queue_screening_notification(uuid, uuid, text, boolean, jsonb), private.queue_screening_stage(text, text, uuid[], boolean),
  private.queue_screening_reminders() from public, anon, authenticated;

-- the request automation: priority order, weekly limit, and keep issuing for schedules of an earlier SIGNED rule set
do $$
declare
  v_def text;
  v_new text;
  v_pat text;
  v_n integer;
begin
  v_def := pg_get_functiondef('private.run_screening_request_automation(uuid)'::regprocedure);
  v_new := v_def;

  v_pat := E'v_fail_states text[] := ''{}''; v_fail_org uuid;';
  v_n := (length(v_new) - length(replace(v_new, v_pat, ''))) / length(v_pat);
  if v_n <> 1 then raise exception 'FAIL: expected 1 declare line, matched % (the live body has changed)', v_n; end if;
  v_new := replace(v_new, v_pat, v_pat || E'\n  v_cap integer; v_recent integer; v_capped integer := 0;');

  v_pat := E'     order by s.due_date, s.id\n     limit 1000';
  v_n := (length(v_new) - length(replace(v_new, v_pat, ''))) / length(v_pat);
  if v_n <> 1 then raise exception 'FAIL: expected 1 order-by, matched %', v_n; end if;
  v_new := replace(v_new, v_pat, E'     order by private.screening_priority(st.code), s.due_date, s.id\n     limit 1000');

  v_pat := E'    if r.bundle_id is null then v_no_bundle := v_no_bundle + 1; continue; end if;\n';
  v_n := (length(v_new) - length(replace(v_new, v_pat, ''))) / length(v_pat);
  if v_n <> 1 then raise exception 'FAIL: expected 1 bundle check, matched %', v_n; end if;
  v_new := replace(v_new, v_pat, v_pat ||
    E'    -- weekly pacing (signed rule set): no limit unless the signed set carries pacing.maxNewRequestsPerWeek\n' ||
    E'    v_cap := private.screening_pacing_cap();\n' ||
    E'    if v_cap is not null then\n' ||
    E'      select count(*)::integer into v_recent from public.lab_orders o\n' ||
    E'       where o.patient_id = r.patient_id and o.screening_schedule_id is not null and o.created_at > now() - interval ''7 days'';\n' ||
    E'      if v_recent >= v_cap then v_capped := v_capped + 1; continue; end if;\n' ||
    E'    end if;\n');

  v_pat := E'''skipped_no_bundle'', v_no_bundle, ''failed'', v_failed)';
  v_n := (length(v_new) - length(replace(v_new, v_pat, ''))) / length(v_pat);
  if v_n <> 1 then raise exception 'FAIL: expected 1 return object, matched %', v_n; end if;
  v_new := replace(v_new, v_pat, E'''skipped_no_bundle'', v_no_bundle, ''failed'', v_failed, ''skipped_paced'', v_capped)');

  v_pat := 'rs.id = s.rule_set_id and rs.is_active and rs.approved_by is not null';
  v_n := (length(v_new) - length(replace(v_new, v_pat, ''))) / length(v_pat);
  if v_n <> 1 then raise exception 'FAIL: expected 1 rule-set condition, matched %', v_n; end if;
  v_new := replace(v_new, v_pat, 'rs.id = s.rule_set_id and rs.approved_by is not null');

  execute v_new;
  v_def := pg_get_functiondef('private.run_screening_request_automation(uuid)'::regprocedure);
  if position('private.screening_pacing_cap()' in v_def) = 0 or position('skipped_paced' in v_def) = 0
     or position('private.screening_priority(st.code)' in v_def) = 0 or position('rs.is_active and rs.approved_by' in v_def) > 0 then
    raise exception 'FAIL: the automation patch did not take';
  end if;
  if has_function_privilege('anon', 'private.run_screening_request_automation(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.queue_screening_reminders()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.queue_screening_stage(text,text,uuid[],boolean)', 'EXECUTE') then
    raise exception 'FAIL: a screening job function is callable by a client role';
  end if;
end $$;

-- the rule set v4 DRAFT: v3 plus a PROPOSED pacing block. Inactive and unsigned; the CMO signs it on the hub.
insert into public.screening_rule_sets (code, version, config, notes, is_active)
select rs.code, 4,
       jsonb_set(rs.config, '{pacing}', jsonb_build_object(
         'maxNewRequestsPerWeek', 3,
         'priority', jsonb_build_array('blood_pressure', 'hba1c', 'ogtt_fpg', 'lipid_panel', 'kft', 'lft', 'fbc', 'urinalysis', 'ecg_resting')),
         true),
       'PROPOSED, for the CMO to read and sign. Rules are exactly those of v3. Adds pacing: at most 3 new printed test requests per patient in any 7 days, in the priority order given (blood pressure, then blood sugar tests, then the rest in the order listed; tests not listed come last). The number and the order are clinical choices and are the CMO''s to change before signing. Written 2026-10-30 after the first nightly run gave each new patient 8 requests at once.',
       false
  from public.screening_rule_sets rs
 where rs.version = 3 and rs.is_active and rs.approved_by is not null
   and not exists (select 1 from public.screening_rule_sets x where x.code = rs.code and x.version = 4);
