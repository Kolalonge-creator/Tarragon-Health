-- Two-tier decisions D3, C2 (CMO, 2026-10-08), item 1: the Free red-event path.
--
-- RULE. A red event (triage red, an emergency reading, a red-flag symptom) on a FREE patient never pages a doctor, never
-- creates a clinical task for a doctor and never creates a clinician alert. A MEMBER red event pages exactly as before.
-- The Free patient gets guidance only: the acknowledge-gated "go to the nearest hospital" screen, the plain sentence that no
-- doctor has been alerted because they are on the Free plan, the emergency-contact notice (existing mechanism, no clinical
-- content), a recheck prompt, a follow-up check-in asking whether they got care (the answer is stored and is never shown to a
-- doctor), and a one-tap route to Membership that never blocks the guidance. The triage event is still logged and counted.
--
-- WHO IS A MEMBER. private.patient_is_member (S22): an active patient_memberships row, or the doctor-supported programme.
-- It fails CLOSED toward paging: a missing patient, or any error while working out membership, counts as Member and pages.
--
-- ONE RULE, ONE PLACE. The legacy red-flag triggers (BP, pulse, SpO2, temperature, red-flag symptom, symptom triage
-- assessment, emergency events) already ask private.patient_has_feature_access(patient, 'vitals_red_flag_doctor_escalation').
-- That feature was granted only by a programme or service purchase, so a Membership holder would have been refused. It now
-- also resolves true for a Member, so every legacy path and the new S12/S16/S19 path (create_red_page,
-- create_tasks_from_triage_event) follow the same rule.
--
-- LIVE COUNTS BEFORE THIS CHANGE (2026-10-12): 0 active memberships, 0 pages, 0 red non-shadow triage events, 5 emergency
-- events of which 2 raised no clinician alert (Free). No data conversion is needed; nothing existing changes meaning.
-- NOTE: with 0 active memberships, every red event on a patient with no programme purchase is guidance-only the moment this
-- is applied. Membership is not sellable yet (membership_annual is inactive, S25).
--
-- NOT TOUCHED (still page a doctor, deliberately, they are condition work-ups not the red-event path): the abnormal
-- screening result pipeline (CLAUDE.md: Category 2 to 1 stays), heart-failure weight gain, LPE red flag, mental health crisis
-- follow-up. Legacy RED-level (not emergency-level) vitals on Free keep the existing self-care suggestion only.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Config (versioned, one active row; mirrored in the proposed-config registry as free_red_event.rules; CMO to confirm)
-- ---------------------------------------------------------------------------------------------------------------------
create table public.free_red_config (
  version        integer primary key,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now(),
  constraint free_red_config_rules_valid check (
    jsonb_typeof(rules -> 'recheck_minutes') = 'number' and jsonb_typeof(rules -> 'checkin_minutes') = 'number'
    and (rules ->> 'recheck_minutes')::numeric > 0
    and (rules ->> 'checkin_minutes')::numeric > (rules ->> 'recheck_minutes')::numeric
  )
);
create unique index free_red_config_one_active on public.free_red_config (is_active) where is_active;
alter table public.free_red_config enable row level security;
revoke all on public.free_red_config from public, anon, authenticated;
-- free-red-rules-begin
insert into public.free_red_config (version, is_active, effective_from, rules)
values (1, true, current_date, $json${"recheck_minutes":30,"checkin_minutes":360}$json$::jsonb);
-- free-red-rules-end

create function private.free_red_rule(p_key text) returns integer
language sql stable security definer set search_path = ''
as $$ select (rules ->> p_key)::integer from public.free_red_config where is_active $$;
revoke all on function private.free_red_rule(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. The gate
-- ---------------------------------------------------------------------------------------------------------------------
-- The legacy feature check now also passes for a Member. The membership test is wrapped so that an error while working out
-- membership answers "yes, page" (fail closed toward paging), never "no".
create or replace function private.patient_has_feature_access(p_patient_id uuid, p_feature text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  -- Free to everyone, signed in or not yet subscribed to anything. No clinician time.
  if p_feature in (
    'health_education', 'lifestyle_coaching', 'ai_coach', 'quarterly_report',
    'prevention_coordination', 'lab_coordination', 'medication_refills',
    -- legacy free_pack keys; nothing reads them, kept so an old row stays truthful
    'tracking', 'reminders', 'education'
  ) then
    return true;
  end if;

  -- Two-tier (CMO 2026-10-08): a Member's red event reaches a doctor. If membership cannot be worked out, page.
  if p_feature = 'vitals_red_flag_doctor_escalation' then
    begin
      if p_patient_id is null or private.patient_is_member(p_patient_id) then return true; end if;
    exception when others then
      return true;
    end;
  end if;

  select role into v_role from public.profiles where id = p_patient_id;

  if v_role = 'admin' then
    return true;
  end if;

  if exists (
    select 1
    from public.service_purchases sp
    join public.service_products p on p.id = sp.service_product_id
    where sp.patient_id = p_patient_id
      and sp.status = 'active'
      and (sp.expires_at is null or sp.expires_at > now())
      and p_feature = any(p.features)
  ) then
    return true;
  end if;

  -- The doctor-supported chronic programme carries every doctor-time feature.
  -- 'annual_review' added 2026-09-04: it was in neither list, so it resolved
  -- false for everyone and private.queue_annual_reviews() scheduled nothing.
  if p_feature in (
    'vitals_red_flag_doctor_escalation', 'lifestyle_coaching', 'quarterly_report', 'ai_coach',
    'clinician_review', 'doctor_checkin', 'async_doctor_visit', 'health_education',
    'chronic_doctor_supported_track', 'multi_condition_review', 'result_document_review',
    'annual_review'
  ) then
    return exists (
      select 1
      from public.programme_purchases pp
      where pp.patient_id = p_patient_id
        and pp.status = 'active'
        and pp.ends_at >= current_date
    );
  end if;

  return false;
end;
$$;

-- The one question every red path asks: may this patient's red event reach a doctor?
create function private.patient_may_page_doctor(p_patient uuid) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_patient is null then return true; end if;
  return private.patient_has_feature_access(p_patient, 'vitals_red_flag_doctor_escalation');
exception when others then
  return true;
end;
$$;
revoke all on function private.patient_may_page_doctor(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. The Free record: one row per Free red event. Patient-readable only. No staff, admin or clinician policy exists on
--    purpose: the check-in answer is never shown to a doctor on Free.
-- ---------------------------------------------------------------------------------------------------------------------
create table public.free_red_events (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  patient_id           uuid not null references public.profiles (id) on delete cascade,
  emergency_event_id   uuid not null unique references public.emergency_events (id) on delete cascade,
  triage_event_id      uuid unique references public.triage_events (id) on delete set null,
  is_test              boolean not null default false,
  recheck_due_at       timestamptz not null,
  recheck_notified_at  timestamptz,
  checkin_due_at       timestamptz not null,
  checkin_notified_at  timestamptz,
  checkin_answer       text check (checkin_answer in ('got_care', 'going_now', 'not_yet')),
  checkin_answered_at  timestamptz,
  created_at           timestamptz not null default now(),
  check ((checkin_answer is null) = (checkin_answered_at is null))
);
create index free_red_events_due_idx on public.free_red_events (checkin_due_at) where checkin_answer is null;
create index free_red_events_patient_idx on public.free_red_events (patient_id, created_at desc);
alter table public.free_red_events enable row level security;
create policy free_red_events_patient_read on public.free_red_events for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.free_red_events from public, anon, authenticated;
grant select on public.free_red_events to authenticated;
comment on table public.free_red_events is 'A red event on a Free patient (CMO decision 2026-10-08): guidance only, no doctor alerted. Patient-readable only; the check-in answer is never routed to a doctor.';

-- Neutral notices to the patient (INV-07: no condition, reading or result). In-app always lands; push or email also if the patient has one.
create function private.free_red_notify(p_org uuid, p_patient uuid, p_template text, p_source uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_ch public.notification_channel;
begin
  insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
  values (p_patient, p_org, 'in_app', p_template, '{}'::jsonb, 'pending', 'non_clinical', 'critical', 'free_red_events', p_source);
  v_ch := private.patient_reminder_channel(p_patient, true);
  if v_ch is not null and v_ch <> 'in_app' then
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
    values (p_patient, p_org, v_ch, p_template, '{}'::jsonb, 'pending', 'non_clinical', 'critical', 'free_red_events', p_source);
  end if;
end;
$$;
revoke all on function private.free_red_notify(uuid, uuid, text, uuid) from public, anon, authenticated;

-- Opens the Free record for an emergency event nobody was paged for. Idempotent per emergency event.
create function private.open_free_red_event(p_emergency uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare e public.emergency_events%rowtype; v_id uuid; v_test boolean;
begin
  select * into e from public.emergency_events where id = p_emergency;
  if not found then return null; end if;
  select coalesce(is_test, false) into v_test from public.profiles where id = e.patient_id;
  insert into public.free_red_events (organisation_id, patient_id, emergency_event_id, is_test, recheck_due_at, checkin_due_at)
  values (e.organisation_id, e.patient_id, e.id, coalesce(v_test, false),
          now() + make_interval(mins => coalesce(private.free_red_rule('recheck_minutes'), 30)),
          now() + make_interval(mins => coalesce(private.free_red_rule('checkin_minutes'), 360)))
  on conflict (emergency_event_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.free_red_events where emergency_event_id = p_emergency;
    return v_id;
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (e.organisation_id, null, 'free_red_event.recorded', 'free_red_events', v_id, jsonb_build_object('doctor_alerted', false, 'source', e.source));
  perform private.free_red_notify(e.organisation_id, e.patient_id, 'free_red_guidance', v_id);
  return v_id;
end;
$$;
revoke all on function private.open_free_red_event(uuid) from public, anon, authenticated;

-- Every emergency event that raised no clinician alert and whose patient may not page a doctor gets the Free record.
create function private.after_emergency_event_free_guidance() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.clinician_alert_id is null and not private.patient_may_page_doctor(new.patient_id) then
    perform private.open_free_red_event(new.id);
  end if;
  return null;
end;
$$;
revoke all on function private.after_emergency_event_free_guidance() from public, anon, authenticated;
create trigger emergency_events_free_guidance after insert on public.emergency_events
  for each row execute function private.after_emergency_event_free_guidance();

-- The triage path: records the red grade of a Free patient as an emergency event (which shows the guidance and starts the
-- contact notice) and links it to the triage event. Idempotent per triage event.
create function private.record_free_red_event(p_triage uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare te public.triage_events%rowtype; v_ee uuid; v_fre uuid;
begin
  select * into te from public.triage_events where id = p_triage;
  if not found then raise exception 'unknown triage event' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('freered:' || p_triage));
  select id into v_fre from public.free_red_events where triage_event_id = p_triage;
  if found then return v_fre; end if;
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
  values (te.organisation_id, te.patient_id, 'triage_red', 'Your latest reading or answers need prompt attention.', 'active')
  returning id into v_ee;
  update public.free_red_events set triage_event_id = te.id, is_test = te.is_test where emergency_event_id = v_ee returning id into v_fre;
  return v_fre;
end;
$$;
revoke all on function private.record_free_red_event(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. The S19 and S16 entry points follow the rule
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.create_red_page(p_triage_event uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  te public.triage_events%rowtype;
  v_root uuid;
  v_to uuid;
  v_page public.pages%rowtype;
begin
  select * into te from public.triage_events where id = p_triage_event;
  if not found then raise exception 'unknown triage event' using errcode = '22023'; end if;
  -- two layers with the handler: a shadow grade (rule set nobody approved, OQ-88) and anything that is not a red grade
  -- carrying the page action never pages
  if te.shadow or te.grade <> 'red' or not (te.actions @> '[{"kind":"page_on_call"}]'::jsonb) then return null; end if;
  perform pg_advisory_xact_lock(hashtext('page:' || p_triage_event));
  select id into v_root from public.pages where triage_event_id = p_triage_event and parent_page_id is null;
  if found then return v_root; end if;

  -- Two-tier (CMO 2026-10-08): a Free patient's red event pages nobody. They get the guidance record instead. A Member, or a
  -- patient whose membership cannot be worked out, falls through and pages as before.
  if not private.patient_may_page_doctor(te.patient_id) then
    perform private.record_free_red_event(te.id);
    return null;
  end if;

  v_to := private.page_recipient(te.organisation_id, te.is_test);
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.pages (organisation_id, patient_id, triage_event_id, role, to_clinician_id, escalation_level, no_cover, lead_alerted_at, config_version, is_test)
  values (te.organisation_id, te.patient_id, te.id, case when v_to is null then 'escalation' else 'primary' end::public.page_role, v_to,
          case when v_to is null then 2 else 0 end, v_to is null, case when v_to is null then now() end, private.paging_config_version(), te.is_test)
  returning * into v_page;
  perform set_config('tarragon.paging_write', 'off', true);

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (te.organisation_id, null, 'page.sent', 'page', v_page.id, jsonb_build_object('role', v_page.role, 'level', v_page.escalation_level, 'no_cover', v_page.no_cover));
  perform private.emit_domain_event('page.sent', te.organisation_id, jsonb_build_object('page_id', v_page.id, 'role', v_page.role),
    'page.sent:' || v_page.id, te.patient_id, 'page', v_page.id, 'urgent');

  if v_to is not null then
    perform private.page_notify(v_to, te.organisation_id, 'on_call_page', v_page.id);
  else
    -- safety case 9: nobody on the rota to page. No timer to wait for: level 2 straight away, a task so any on-call
    -- clinician can take it, and an incident.
    perform private.page_notify_leadership(te.organisation_id, v_page.id, te.is_test);
    perform private.page_task(v_page, te.rule_set_version);
    perform private.page_incident(te.organisation_id, 'page_no_cover:' || v_page.id, 'Red event with nobody on call',
      'A red event arrived while no eligible clinician was on the rota. The clinical lead and ops were alerted and a priority task is open.');
    perform private.emit_domain_event('page.escalated', te.organisation_id, jsonb_build_object('page_id', v_page.id, 'level', 2, 'reason', 'no_cover'),
      'page.escalated:' || v_page.id || ':2', te.patient_id, 'page', v_page.id, 'urgent');
  end if;
  return v_page.id;
end;
$$;

create or replace function public.create_tasks_from_triage_event(p_triage_event uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  te public.triage_events%rowtype;
  a jsonb;
  v_type text;
  v_made integer := 0;
  v_due integer;
begin
  select * into te from public.triage_events where id = p_triage_event;
  if not found then raise exception 'unknown triage event' using errcode = '22023'; end if;
  if te.shadow or te.patient_id is null then return 0; end if;
  -- Two-tier (CMO 2026-10-08): a Free patient's red event creates no clinical task for a doctor.
  if te.grade = 'red' and not private.patient_may_page_doctor(te.patient_id) then return 0; end if;
  for a in select x from jsonb_array_elements(te.actions) x where x ->> 'kind' = 'create_task' loop
    select code into v_type from public.task_types where is_active and creatable and source_task_keys @> array[a ->> 'task'];
    if v_type is null then
      raise exception 'no task type answers the triage task key %', a ->> 'task' using errcode = 'P0001';
    end if;
    v_due := nullif(a ->> 'dueMinutes', '')::integer;
    perform private.create_clinical_task(te.patient_id, v_type, v_due,
      'triage:' || te.patient_id || ':' || v_type, te.id, te.rule_set_version, null);
    v_made := v_made + 1;
  end loop;
  return v_made;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. The patient's side: the check-in and its answer
-- ---------------------------------------------------------------------------------------------------------------------
-- The newest unanswered check-in that is due for the signed-in patient, if any.
create function public.my_free_red_checkin() returns table (id uuid, created_at timestamptz, checkin_due_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query
    select f.id, f.created_at, f.checkin_due_at from public.free_red_events f
     where f.patient_id = auth.uid() and f.checkin_answer is null and f.checkin_due_at <= now()
       and f.created_at > now() - interval '7 days'
     order by f.created_at desc limit 1;
end;
$$;

-- Stores the patient's answer. Only the patient it belongs to can answer; nothing is routed to a doctor.
create function public.answer_free_red_checkin(p_id uuid, p_answer text) returns void
language plpgsql security definer set search_path = ''
as $$
declare f public.free_red_events%rowtype;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_answer is null or p_answer not in ('got_care', 'going_now', 'not_yet') then
    raise exception 'unknown answer' using errcode = '22023';
  end if;
  select * into f from public.free_red_events where id = p_id for update;
  if not found or f.patient_id <> auth.uid() then raise exception 'not found' using errcode = '42501'; end if;
  if f.checkin_answer is not null then return; end if;
  update public.free_red_events set checkin_answer = p_answer, checkin_answered_at = now() where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. The sweep: recheck prompt and check-in notices. A failure is audited, never silent, and never stops the other rows.
-- ---------------------------------------------------------------------------------------------------------------------
create function private.sweep_free_red_events() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r public.free_red_events%rowtype; n integer := 0;
begin
  for r in select * from public.free_red_events
            where checkin_answer is null
              and ((recheck_notified_at is null and recheck_due_at <= now()) or (checkin_notified_at is null and checkin_due_at <= now()))
            order by created_at
  loop
    begin
      if r.recheck_notified_at is null and r.recheck_due_at <= now() then
        perform private.free_red_notify(r.organisation_id, r.patient_id, 'free_red_recheck', r.id);
        update public.free_red_events set recheck_notified_at = now() where id = r.id;
        n := n + 1;
      end if;
      if r.checkin_notified_at is null and r.checkin_due_at <= now() then
        perform private.free_red_notify(r.organisation_id, r.patient_id, 'free_red_checkin', r.id);
        update public.free_red_events set checkin_notified_at = now() where id = r.id;
        n := n + 1;
      end if;
    exception when others then
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (r.organisation_id, null, 'free_red_event.sweep_error', 'free_red_events', r.id, jsonb_build_object('sqlstate', sqlstate));
    end;
  end loop;
  return n;
end;
$$;
revoke all on function private.sweep_free_red_events() from public, anon, authenticated;
select cron.schedule('sweep-free-red-events', '*/5 * * * *', $$ select private.sweep_free_red_events(); $$);

-- Execute rights: the two patient RPCs are for signed-in patients only; anon inherits through PUBLIC, so revoke from public.
revoke all on function public.my_free_red_checkin() from public, anon;
revoke all on function public.answer_free_red_checkin(uuid, text) from public, anon;
grant execute on function public.my_free_red_checkin() to authenticated;
grant execute on function public.answer_free_red_checkin(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.create_red_page(uuid)', 'EXECUTE') then raise exception 'create_red_page must not be callable by anon'; end if;
  if has_function_privilege('anon', 'public.my_free_red_checkin()', 'EXECUTE') or has_function_privilege('anon', 'public.answer_free_red_checkin(uuid,text)', 'EXECUTE') then
    raise exception 'free red check-in RPCs must not be callable by anon';
  end if;
  if has_function_privilege('authenticated', 'private.patient_may_page_doctor(uuid)', 'EXECUTE') then raise exception 'the gate must not be callable by authenticated'; end if;
  if has_table_privilege('anon', 'public.free_red_events', 'SELECT') or has_table_privilege('authenticated', 'public.free_red_events', 'INSERT') then
    raise exception 'free_red_events grants are wrong';
  end if;
  if private.patient_may_page_doctor(null) is not true then raise exception 'an unknown patient must be paged for'; end if;
  if (select count(*) from public.free_red_config where is_active) <> 1 then raise exception 'exactly one active free_red_config row expected'; end if;
end $$;
