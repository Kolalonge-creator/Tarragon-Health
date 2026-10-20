-- S27h: lab lifecycle and partner quality (2026-10-16). Spec 4.4, 9.6; docs/research/S26-S30-competitor-review-and-build-plan.md section S27h.
-- Invariants: INV-03 (abnormal held), INV-04 (a sensitive positive is never auto-released or explained), INV-07 (neutral notices),
-- INV-10/12 (audited, tied staff reads), INV-13 (is_test), INV-14 (fail closed on unsigned clinical config).
--
-- ALREADY BUILT by S27 to S27g (verified against the files, reused, not rebuilt):
--   * result versions "corrected / amended / appended" with supersession, a reason, one neutral "updated" notice, history kept, withdrawal
--     (S27d, S27f); a held result can be replaced while held (S27f)
--   * release authority for a critical value: only a Senior Medical Officer or the CMO (lab_review_actor, S27c; OQ-180 closed)
--   * disclosure attempts, CMO incident after the configured attempts or hours, never released by default (S27d)
--   * one neutral "under review" state with an expected time read from escalation_slas (S27d)
--   * specimen ids, rejection reasons, automatic recollection chain, turnaround alerts, partner dashboard (lab network, 2026-08-29)
--   * the explain gate lab_result_explain_allowed and the canExplainLabResult consumer with a scan test (S27c)
--   * licence columns, licence expiry as a hard stop and the quality score (S74)
--
-- BUILT HERE (the remainder):
--   1. report_status preliminary / final. A preliminary result is always held and can never be released (trigger); the final arrives as a
--      correction of kind 'finalised' against the held preliminary and goes through the same gate.
--   2. A tracked critical-value call: the on-call clinician is called, acknowledgement time and an SLA clock are recorded, an unacknowledged
--      call goes to the backup then to the clinical lead and ops on the S19 on-call rota, timers and escalation times (paging_rule).
--      Release authority is unchanged and escalation never releases.
--   3. Hold-aging: a clock for the clinician, one neutral "still reviewing" notice to the patient once the expected time has passed, and
--      escalation to the clinical lead at a PROPOSED threshold. Escalation only: nothing here changes a release state.
--   4. The bounded disclosure fallback message. The mechanism ships signed-off OFF: nothing is sent until the CMO signs the wording
--      (lab_fallback_wording_signoffs). It never releases a result.
--   5. A staff turnaround overview (the partner portal already has its own).
--   6. A delta check against the patient's last released value, shown to the reviewer as a flag only.
--   8. Partner onboarding: a laboratory cannot be switched on without a recorded licence, a verified date, a future expiry and an accreditation.
--   9. A patient trend of a released, coded, numeric value against the previous one, with the care team's note.
-- Item 7 (wire canExplainLabResult into audio and AI) is not built: no audio or AI path reads structured lab results today (scan test proves it).
--
-- Live rows before this migration (project koiplnmbgnqnbywhpjlf, read before S27 shipped, not re-read: the project was unreachable when this was
-- written): lab_results 0 at S27f; this migration adds columns and tables only, so no data step is needed.

-- ---------------------------------------------------------------------------
-- 0. Config (PROPOSED values, CMO owner). Mirrored as registry entry lab.lifecycle with a drift test.
-- ---------------------------------------------------------------------------
create table public.lab_lifecycle_config (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique check (version >= 1),
  is_active   boolean not null default false,
  rules       jsonb not null,
  notes       text,
  created_at  timestamptz not null default now()
);
create unique index lab_lifecycle_config_one_active on public.lab_lifecycle_config (is_active) where is_active;

create function private.lab_lifecycle_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
begin
  -- a missing or non-numeric key must fail the check (a null inside CHECK passes), so everything is coalesced to false
  return coalesce(
        (r #>> '{holdAging,leadEscalateMinutes,critical}') ~ '^[0-9]+$' and (r #>> '{holdAging,leadEscalateMinutes,critical}')::integer > 0
    and (r #>> '{holdAging,leadEscalateMinutes,default}') ~ '^[0-9]+$' and (r #>> '{holdAging,leadEscalateMinutes,default}')::integer > 0
    and (r #>> '{holdAging,repeatMinutes}') ~ '^[0-9]+$' and (r #>> '{holdAging,repeatMinutes}')::integer > 0
    and (r #>> '{holdAging,repeatMax}') ~ '^[0-9]+$' and (r #>> '{holdAging,repeatMax}')::integer > 0
    and (r #>> '{delta,percent}') ~ '^[0-9]+$' and (r #>> '{delta,percent}')::integer between 1 and 1000
    and (r #>> '{delta,windowDays}') ~ '^[0-9]+$' and (r #>> '{delta,windowDays}')::integer > 0
    and jsonb_typeof(r #> '{delta,perAnalytePercent}') = 'object'
    and not exists (select 1 from jsonb_each(r #> '{delta,perAnalytePercent}') e
                     where jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric <= 0 or (e.value #>> '{}')::numeric > 1000)
    and (r #>> '{disclosureFallback,afterEscalatedMinutes}') ~ '^[0-9]+$' and (r #>> '{disclosureFallback,afterEscalatedMinutes}')::integer > 0,
    false);
exception when others then
  return false;
end;
$$;
revoke all on function private.lab_lifecycle_rules_valid(jsonb) from public, anon, authenticated;
alter table public.lab_lifecycle_config add constraint lab_lifecycle_config_rules_valid check (private.lab_lifecycle_rules_valid(rules));

-- lab-lifecycle-begin
insert into public.lab_lifecycle_config (version, is_active, rules, notes) values (1, true, $json$
{
  "holdAging": {
    "leadEscalateMinutes": { "critical": 720, "default": 1440 },
    "repeatMinutes": 720,
    "repeatMax": 3
  },
  "delta": {
    "percent": 50,
    "windowDays": 365,
    "perAnalytePercent": { "creatinine": 30, "potassium": 20, "sodium": 5, "hba1c": 20, "haemoglobin": 20 }
  },
  "disclosureFallback": { "afterEscalatedMinutes": 1440 }
}
$json$::jsonb, 'PROPOSED, CMO owned. Every use is an alert or a flag; none of these values can release a result.');
-- lab-lifecycle-end

alter table public.lab_lifecycle_config enable row level security;
create policy lab_lifecycle_config_read on public.lab_lifecycle_config for select to authenticated using (true);
revoke all on public.lab_lifecycle_config from public, anon, authenticated;
grant select on public.lab_lifecycle_config to authenticated;

create function private.lab_lifecycle_rule(p_path text[]) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules #> p_path from public.lab_lifecycle_config where is_active order by version desc limit 1 $$;
revoke all on function private.lab_lifecycle_rule(text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Result status: preliminary / final
-- ---------------------------------------------------------------------------
alter table public.lab_results
  add column report_status text not null default 'final' check (report_status in ('preliminary', 'final'));
alter table public.lab_results drop constraint if exists lab_results_correction_kind_check;
alter table public.lab_results
  add constraint lab_results_correction_kind_check check (correction_kind in ('corrected', 'amended', 'appended', 'finalised'));

-- The status is set from a transaction-local setting that only the preliminary entry function raises, so no existing writer changes
-- signature. A final result that names a preliminary one (kind 'finalised') must point at a preliminary result of the same patient.
create function private.lab_result_report_status() returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_tgt public.lab_results%rowtype;
begin
  if current_setting('tarragon.lab_report_status', true) = 'preliminary' then new.report_status := 'preliminary'; end if;
  if new.correction_kind = 'finalised' then
    select * into v_tgt from public.lab_results where id = new.corrects_result_id;
    if not found or v_tgt.report_status <> 'preliminary' or v_tgt.patient_id <> new.patient_id or new.report_status <> 'final' then
      raise exception 'lab_finalise_needs_a_preliminary_result' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.lab_result_report_status() from public, anon, authenticated;
create trigger lab_results_report_status before insert on public.lab_results
  for each row execute function private.lab_result_report_status();

-- A preliminary result can never be released (INV-03) and its status never changes after it is written. This trigger is separate from
-- private.guard_lab_result so the release state machine is not rewritten here; both must pass.
create function private.lab_result_preliminary_guard() returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.report_status is distinct from old.report_status then raise exception 'lab_result_immutable' using errcode = '42501'; end if;
  if new.report_status = 'preliminary' and new.release_state = 'released' and old.release_state <> 'released' then
    raise exception 'lab_result_preliminary_not_releasable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.lab_result_preliminary_guard() from public, anon, authenticated;
create trigger lab_results_preliminary_guard before update on public.lab_results
  for each row execute function private.lab_result_preliminary_guard();

-- The one writer is patched in place (its live definition is read, an exact anchor is replaced once, and the migration refuses to run if
-- an anchor is missing). Same technique as S27g. (a) the correction kinds learn 'finalised'; (b) a preliminary result is held, never auto-released.
do $$
declare v_def text; v_new text;
  c_kinds_old constant text := $q$p_correction_kind not in ('corrected', 'amended', 'appended')$q$;
  c_kinds_new constant text := $q$p_correction_kind not in ('corrected', 'amended', 'appended', 'finalised')$q$;
  c_anchor constant text := $q$  -- always inserted held; the guard allows the one automatic step below$q$;
  c_hold constant text := $q$  -- S27h: a preliminary result is never auto-released. Only the automatic release is turned into a hold: a critical value,
  -- a sensitive positive or any other hold keeps its own state, reason and task, so the critical call, the disclosure workflow and the
  -- hold-aging thresholds start for a preliminary result exactly as for a final one. (It still cannot be released: see the trigger.)
  if current_setting('tarragon.lab_report_status', true) = 'preliminary' and v_state = 'released' then
    v_state := 'awaiting_review'; v_reason := 'preliminary_result'; v_task := 'routine_result_review';
  end if;

$q$ || c_anchor;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'submit_lab_result';
  if v_def is null then raise exception 'S27h: private.submit_lab_result not found'; end if;
  if (length(v_def) - length(replace(v_def, c_kinds_old, ''))) / length(c_kinds_old) <> 1 then raise exception 'S27h: correction kind anchor not found exactly once'; end if;
  if (length(v_def) - length(replace(v_def, c_anchor, ''))) / length(c_anchor) <> 1 then raise exception 'S27h: held-insert anchor not found exactly once'; end if;
  v_new := replace(replace(v_def, c_kinds_old, c_kinds_new), c_anchor, c_hold);
  execute v_new;
end $$;

create function public.lab_partner_submit_preliminary_result(p_order uuid, p_panel text, p_items jsonb, p_file jsonb default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare o public.lab_orders%rowtype; v_provider uuid := private.lab_partner_provider(); v jsonb;
begin
  if v_provider is null then raise exception 'This action is for partner labs' using errcode = '42501'; end if;
  select * into o from public.lab_orders where id = p_order and provider_id = v_provider;
  if not found then raise exception 'Order not found for this lab' using errcode = '42501'; end if;
  if exists (select 1 from public.lab_results r where r.lab_order_id = p_order and r.release_state <> 'withheld' and r.superseded_by is null) then
    raise exception 'lab_result_already_received' using errcode = '22023';
  end if;
  perform set_config('tarragon.lab_report_status', 'preliminary', true);
  v := private.submit_lab_result(o.patient_id, p_order, coalesce(o.panel_code, p_panel), p_items, p_file, 'partner', (select auth.uid()), v_provider);
  perform set_config('tarragon.lab_report_status', '', true);
  return v;
exception when others then
  perform set_config('tarragon.lab_report_status', '', true);
  raise;
end;
$$;
revoke all on function public.lab_partner_submit_preliminary_result(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.lab_partner_submit_preliminary_result(uuid, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The tracked critical-value call
-- ---------------------------------------------------------------------------
create table public.lab_critical_calls (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  patient_id           uuid not null references public.profiles (id) on delete cascade,
  lab_result_id        uuid not null unique references public.lab_results (id) on delete restrict,
  called_clinician_id  uuid references public.profiles (id) on delete restrict,
  backup_clinician_id  uuid references public.profiles (id) on delete restrict,
  no_cover             boolean not null default false,
  called_at            timestamptz not null default now(),
  -- the SLA clock: the call must be acknowledged by now() + the second paging escalation time
  due_at               timestamptz not null,
  acknowledged_at      timestamptz,
  acknowledged_by      uuid references public.profiles (id) on delete set null,
  backup_paged_at      timestamptz,
  leadership_alerted_at timestamptz,
  last_lead_alert_at   timestamptz,
  lead_repeat_count    integer not null default 0,
  last_error_at        timestamptz,
  closed_at            timestamptz,
  close_reason         text check (close_reason in ('released', 'withheld', 'withdrawn', 'replaced')),
  config_version       integer,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now(),
  -- acknowledged_by may become null when a profile is removed (on delete set null), so only the other direction is required
  check (acknowledged_by is null or acknowledged_at is not null),
  check ((closed_at is null) = (close_reason is null))
);
create index lab_critical_calls_open_idx on public.lab_critical_calls (called_at) where closed_at is null;
create index lab_critical_calls_called_idx on public.lab_critical_calls (called_clinician_id) where closed_at is null;
-- No policy and no grant: every read and write goes through the functions below (they carry the checks and the audit rows).
alter table public.lab_critical_calls enable row level security;
revoke all on public.lab_critical_calls from public, anon, authenticated;

-- one notice to a person; fixed neutral template, critical priority, never held back by quiet hours. Deliberately a copy of the S19
-- page_notify shape rather than a call to it: that helper stamps source_table 'pages', which the S19 delivery watchdog reads, and a lab
-- call row is not a page. If the S19 fan-out changes (channels, priority, content class), change this too.
create function private.lab_call_notify(p_recipient uuid, p_org uuid, p_template text, p_ref uuid, p_source text default 'lab_critical_calls') returns void
language plpgsql security definer set search_path = ''
as $$
declare c text;
begin
  foreach c in array array['push', 'in_app', 'email'] loop
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
    values (p_recipient, p_org, c::public.notification_channel, p_template,
            case when p_source = 'lab_results' then jsonb_build_object('lab_result_id', p_ref) else jsonb_build_object('call_id', p_ref) end,
            'pending', 'non_clinical', 'critical', p_source, p_ref);
  end loop;
end;
$$;
revoke all on function private.lab_call_notify(uuid, uuid, text, uuid, text) from public, anon, authenticated;

-- the clinical lead (CMO) and ops (admin) of the organisation, matched on the test flag. Returns how many were told.
create function private.lab_notify_leadership(p_org uuid, p_test boolean, p_template text, p_ref uuid, p_source text default 'lab_critical_calls') returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in
    select p.id from public.profiles p where p.organisation_id = p_org and p.is_active and p.role = 'admin' and p.is_test = p_test
    union
    select cs.profile_id from public.clinical_staff cs join public.profiles p on p.id = cs.profile_id
     where cs.organisation_id = p_org and cs.profile_id is not null and cs.active and cs.status = 'active'
       and cs.doctor_tier = 'chief_medical_officer' and p.is_test = p_test
  loop
    perform private.lab_call_notify(r.id, p_org, p_template, p_ref, p_source);
    n := n + 1;
  end loop;
  if n = 0 then
    perform private.page_incident(p_org, 'lab_no_leadership', 'A lab alert had nobody to go to',
      'A critical lab value or an ageing held result needed the clinical lead and ops alerted but no active chief medical officer or admin account matched. Add or activate one.');
  end if;
  return n;
end;
$$;
revoke all on function private.lab_notify_leadership(uuid, boolean, text, uuid, text) from public, anon, authenticated;

-- Opens the call when the first critical item of a result is written. A failure is audited and raises an incident; it never undoes the
-- result (which is held anyway, with its critical_result_review task) and is never silent.
create function private.lab_open_critical_call() returns trigger language plpgsql security definer set search_path = ''
as $$
declare r public.lab_results%rowtype; v_to uuid; v_backup uuid; v_id uuid; v_m2 integer;
begin
  select * into r from public.lab_results where id = new.lab_result_id;
  if r.id is null or r.superseded_by is not null then return null; end if;
  begin
    v_m2 := coalesce((private.paging_rule('escalation_minutes') ->> 1)::integer, 10);
    -- never a clinician who is the patient or has a conflict with them (S19c P4), for the first call and for the backup
    v_to := private.page_recipient(r.organisation_id, r.is_test, r.patient_id);
    select oc.backup_id into v_backup from private.on_call_now(r.organisation_id, r.is_test) oc;
    if v_backup is not null and (v_backup = v_to or not private.clinician_is_eligible(v_backup) or v_backup = r.patient_id
                                 or coalesce(private.has_conflict(v_backup, r.patient_id), false)) then v_backup := null; end if;
    insert into public.lab_critical_calls (organisation_id, patient_id, lab_result_id, called_clinician_id, backup_clinician_id, no_cover, due_at, config_version, is_test)
    values (r.organisation_id, r.patient_id, r.id, v_to, v_backup, v_to is null, now() + make_interval(mins => v_m2), private.paging_config_version(), r.is_test)
    on conflict (lab_result_id) do nothing
    returning id into v_id;
    if v_id is null then return null; end if;
    perform private.log_audit('lab_critical_call.opened', 'lab_results', r.id, jsonb_build_object('call_id', v_id, 'no_cover', v_to is null));
    if v_to is not null then
      perform private.lab_call_notify(v_to, r.organisation_id, 'lab_critical_call', v_id);
    else
      -- nobody on the rota: no timer to wait for, the lead and ops are told at once and an incident opens
      update public.lab_critical_calls set leadership_alerted_at = now() where id = v_id;
      perform private.lab_notify_leadership(r.organisation_id, r.is_test, 'lab_critical_escalation', v_id);
      perform private.page_incident(r.organisation_id, 'lab_critical_no_cover:' || v_id, 'A critical lab value with nobody on call',
        'A critical lab value arrived while no eligible clinician was on the rota. The clinical lead and ops were alerted. The result stays held.');
    end if;
  exception when others then
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (r.organisation_id, 'lab_critical_call.error', 'lab_results', r.id, jsonb_build_object('error', sqlerrm));
    perform private.page_incident(r.organisation_id, 'lab_critical_call_failed:' || r.id, 'A critical lab value could not be called out',
      'The tracked call for a critical lab value could not be created (see audit_log action lab_critical_call.error). The result is held and its review task exists; call the on-call clinician by hand.');
  end;
  return null;
end;
$$;
revoke all on function private.lab_open_critical_call() from public, anon, authenticated;
create trigger lab_result_items_critical_call after insert on public.lab_result_items
  for each row when (new.flag = 'critical') execute function private.lab_open_critical_call();

-- The call closes itself when the result leaves the held state or is withdrawn or replaced. It records why (and whether anyone had
-- acknowledged it) in the audit log; it never changes the result.
create function private.lab_close_critical_calls() returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_reason text; c record;
begin
  v_reason := case when new.withdrawn_at is not null and old.withdrawn_at is null then 'withdrawn'
                   when new.release_state = 'released' and old.release_state <> 'released' then 'released'
                   when new.release_state = 'withheld' and old.release_state <> 'withheld' then 'withheld'
                   when new.superseded_by is not null and old.superseded_by is null then 'replaced' end;
  if v_reason is not null then
    for c in update public.lab_critical_calls set closed_at = now(), close_reason = v_reason
              where lab_result_id = new.id and closed_at is null returning id, acknowledged_at loop
      perform private.log_audit('lab_critical_call.closed', 'lab_results', new.id,
        jsonb_build_object('call_id', c.id, 'reason', v_reason, 'was_acknowledged', c.acknowledged_at is not null));
    end loop;
  end if;
  return null;
end;
$$;
revoke all on function private.lab_close_critical_calls() from public, anon, authenticated;
create trigger lab_results_close_critical_calls after update on public.lab_results
  for each row when (new.release_state is distinct from old.release_state or new.withdrawn_at is distinct from old.withdrawn_at
                     or new.superseded_by is distinct from old.superseded_by)
  execute function private.lab_close_critical_calls();

create function public.acknowledge_lab_critical_call(p_call uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare c public.lab_critical_calls%rowtype; v uuid := (select auth.uid()); v_cmo boolean;
begin
  select * into c from public.lab_critical_calls where id = p_call for update;
  if not found then raise exception 'lab_critical_call_not_found' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = v and role = 'clinician') or not private.clinician_is_eligible(v) then
    raise exception 'This action is for clinicians' using errcode = '42501';
  end if;
  v_cmo := exists (select 1 from public.clinical_staff cs where cs.profile_id = v and cs.active and cs.status = 'active'
                    and cs.doctor_tier = 'chief_medical_officer' and cs.organisation_id = c.organisation_id);
  if v is distinct from c.called_clinician_id and v is distinct from c.backup_clinician_id and not v_cmo then
    perform private.log_audit('lab_critical_call.ack_denied', 'lab_results', c.lab_result_id, jsonb_build_object('call_id', c.id));
    return jsonb_build_object('error', 'not_permitted');
  end if;
  if c.closed_at is not null then return jsonb_build_object('error', 'closed'); end if;
  if c.acknowledged_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  update public.lab_critical_calls set acknowledged_at = now(), acknowledged_by = v where id = p_call;
  perform private.log_audit('lab_critical_call.acknowledged', 'lab_results', c.lab_result_id,
    jsonb_build_object('call_id', c.id, 'seconds_to_acknowledge', extract(epoch from now() - c.called_at)::integer, 'late', now() > c.due_at));
  return jsonb_build_object('ok', true);
end;
$$;

-- The open calls this clinician is on, or every open call of the organisation for the CMO. No patient is named: opening the result goes
-- through the audited, tied read.
create function public.my_lab_critical_calls() returns table (
  call_id uuid, lab_result_id uuid, called_at timestamptz, due_at timestamptz, acknowledged_at timestamptz, minutes_open integer,
  overdue boolean, my_role text, no_cover boolean)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.lab_result_id, c.called_at, c.due_at, c.acknowledged_at,
         (extract(epoch from now() - c.called_at) / 60)::integer,
         c.acknowledged_at is null and now() > c.due_at,
         case when c.called_clinician_id = (select auth.uid()) then 'called' when c.backup_clinician_id = (select auth.uid()) then 'backup' else 'lead' end,
         c.no_cover
    from public.lab_critical_calls c
   where c.closed_at is null
     and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'clinician')
     and (c.called_clinician_id = (select auth.uid()) or c.backup_clinician_id = (select auth.uid())
          or exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active'
                      and cs.doctor_tier = 'chief_medical_officer' and cs.organisation_id = c.organisation_id))
   order by c.called_at;
$$;

-- INV-12: being called is not enough to open a patient's result, taking responsibility is. Exactly as for an acknowledged red event page (S19),
-- a clinician who has ACKNOWLEDGED an open critical value call is tied to that patient until the call closes (the result is released, held back,
-- withdrawn or replaced). Never for the patient, never for a conflicted clinician, never for one who is no longer eligible. The live function is
-- patched in place with one extra branch; the migration refuses to run if its anchor is not found exactly once.
do $$
declare v_def text; v_new text;
  c_anchor constant text := $q$      -- an open specialist referral assigned to me$q$;
  c_branch constant text := $q$      -- S27h (INV-12): an open critical lab value call I have ACKNOWLEDGED; it closes with the result
      or (
        exists (
          select 1 from public.lab_critical_calls lc
           where lc.patient_id = p_patient and lc.closed_at is null and lc.acknowledged_by = (select auth.uid())
        )
        and (select auth.uid()) <> p_patient
        and not private.has_conflict((select auth.uid()), p_patient)
        and private.clinician_is_eligible((select auth.uid()))
      )
$q$ || c_anchor;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'clinician_has_patient_access' and p.pronargs = 1;
  if v_def is null then raise exception 'S27h: private.clinician_has_patient_access(uuid) not found'; end if;
  if (length(v_def) - length(replace(v_def, c_anchor, ''))) / length(c_anchor) <> 1 then raise exception 'S27h: tie anchor not found exactly once'; end if;
  v_new := replace(v_def, c_anchor, c_branch);
  execute v_new;
end $$;

create function private.sweep_lab_critical_calls() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c public.lab_critical_calls%rowtype;
  v_m1 integer := coalesce((private.paging_rule('escalation_minutes') ->> 0)::integer, 5);
  v_m2 integer := coalesce((private.paging_rule('escalation_minutes') ->> 1)::integer, 10);
  v_rep integer := coalesce((private.paging_rule('lead_repeat_minutes') #>> '{}')::integer, 5);
  v_repmax integer := coalesce((private.paging_rule('lead_repeat_max') #>> '{}')::integer, 12);
  v_backups integer := 0; v_leads integer := 0; v_repeats integer := 0;
begin
  -- a row that raised is skipped for 10 minutes so one bad row cannot be re-tried and re-logged every minute, but it is never dropped
  for c in select * from public.lab_critical_calls
            where closed_at is null and acknowledged_at is null and (last_error_at is null or last_error_at < now() - interval '10 minutes')
            order by called_at limit 500 loop
    begin
      -- the backup: only when there is one (a no-cover call went straight to the lead when it was opened)
      if not c.no_cover and c.backup_paged_at is null and now() >= c.called_at + make_interval(mins => v_m1) then
        update public.lab_critical_calls set backup_paged_at = now() where id = c.id;
        if c.backup_clinician_id is not null then
          perform private.lab_call_notify(c.backup_clinician_id, c.organisation_id, 'lab_critical_call', c.id);
          v_backups := v_backups + 1;
        end if;
        perform private.log_audit('lab_critical_call.escalated', 'lab_results', c.lab_result_id, jsonb_build_object('call_id', c.id, 'level', 1, 'backup', c.backup_clinician_id is not null));
        c.backup_paged_at := now();
      end if;
      -- the clinical lead and ops: at the second time, or at the first when there was nobody else to page
      if not c.no_cover and c.leadership_alerted_at is null and c.backup_paged_at is not null
         and (c.backup_clinician_id is null or now() >= c.called_at + make_interval(mins => v_m2)) then
        -- the incident always opens; the step counts as done only if somebody was told (otherwise it is retried next minute)
        perform private.page_incident(c.organisation_id, 'lab_critical_unacknowledged:' || c.id, 'A critical lab value has not been acknowledged',
          'A critical lab value call has not been acknowledged by the clinicians on call. The result stays held. Open the lab results page.');
        if private.lab_notify_leadership(c.organisation_id, c.is_test, 'lab_critical_escalation', c.id) > 0 then
          update public.lab_critical_calls set leadership_alerted_at = now(), last_lead_alert_at = now(), lead_repeat_count = 1 where id = c.id;
          perform private.log_audit('lab_critical_call.escalated', 'lab_results', c.lab_result_id, jsonb_build_object('call_id', c.id, 'level', 2));
          v_leads := v_leads + 1;
        end if;
      -- and again at the S19 repeat interval, up to its cap, for as long as nobody acknowledges: one delivery that did not arrive
      -- (no push subscription, a bounced email) must not end the chain
      elsif c.leadership_alerted_at is not null and c.lead_repeat_count < v_repmax
            and now() >= coalesce(c.last_lead_alert_at, c.leadership_alerted_at) + make_interval(mins => v_rep) then
        if private.lab_notify_leadership(c.organisation_id, c.is_test, 'lab_critical_escalation', c.id) > 0 then
          update public.lab_critical_calls set last_lead_alert_at = now(), lead_repeat_count = lead_repeat_count + 1 where id = c.id;
          v_repeats := v_repeats + 1;
        end if;
      end if;
    exception when others then
      update public.lab_critical_calls set last_error_at = now() where id = c.id;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (c.organisation_id, 'lab_critical_call.sweep_error', 'lab_results', c.lab_result_id, jsonb_build_object('error', sqlerrm));
      perform private.page_incident(c.organisation_id, 'lab_critical_sweep_failed', 'The critical lab value sweep failed',
        'The sweep that escalates unacknowledged critical lab value calls raised an error (audit_log action lab_critical_call.sweep_error). Check open critical calls by hand.');
    end;
  end loop;
  return jsonb_build_object('backups', v_backups, 'leads', v_leads, 'lead_repeats', v_repeats);
end;
$$;
revoke all on function private.sweep_lab_critical_calls() from public, anon, authenticated;
select cron.schedule('lab-critical-call-sweep', '* * * * *', $$select private.sweep_lab_critical_calls();$$);

-- ---------------------------------------------------------------------------
-- 3 and 4. Hold-aging and the bounded disclosure fallback
-- ---------------------------------------------------------------------------
create table public.lab_hold_state (
  lab_result_id            uuid primary key references public.lab_results (id) on delete cascade,
  organisation_id          uuid not null references public.organisations (id) on delete restrict,
  patient_notified_at      timestamptz,
  lead_escalated_at        timestamptz,
  lead_escalation_count    integer not null default 0,
  fallback_notified_at     timestamptz,
  fallback_blocked_at      timestamptz,
  created_at               timestamptz not null default now()
);
alter table public.lab_hold_state enable row level security;
revoke all on public.lab_hold_state from public, anon, authenticated;

-- the fallback wording: the CMO signs a numbered wording; the words themselves are fixed in code (linted, neutral)
create table public.lab_fallback_wording_signoffs (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique check (version >= 1),
  is_active   boolean not null default false,
  wording_key text not null check (wording_key in ('v1')),
  -- the signature binds the EXACT in-app words: md5 of the template body at signing. If the template body is edited afterwards the fallback
  -- reads as unsigned again (and says so, see sweep_lab_holds) until the CMO signs the new words.
  wording_md5 text not null,
  notes       text,
  approved_by uuid references public.clinical_staff (id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null))
);
create unique index lab_fallback_wording_one_active on public.lab_fallback_wording_signoffs (is_active) where is_active;
insert into public.lab_fallback_wording_signoffs (version, is_active, wording_key, wording_md5, notes)
values (1, true, 'v1', md5('Your care team would like to speak with you. Please open the app and send them a message when you can.'), 'DRAFT, unsigned. Wording v1 is the fixed neutral line "Your care team would like to speak with you. Please open the app and send them a message when you can." Until the CMO signs, the fallback message is never sent. It never releases a result.');
alter table public.lab_fallback_wording_signoffs enable row level security;
create policy lab_fallback_wording_read on public.lab_fallback_wording_signoffs for select to authenticated using (true);
revoke all on public.lab_fallback_wording_signoffs from public, anon, authenticated;
grant select on public.lab_fallback_wording_signoffs to authenticated;

create function private.lab_fallback_signed() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.lab_fallback_wording_signoffs w
     where w.is_active and w.approved_by is not null
       and w.wording_md5 = (select md5(l.body) from public.notification_template_locales l
                             where l.template_key = 'lab_result_contact_us' and l.locale = 'en' and l.channel = 'in_app'));
$$;
revoke all on function private.lab_fallback_signed() from public, anon, authenticated;

create function public.sign_lab_fallback_wording(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid;
begin
  if not exists (select 1 from public.lab_fallback_wording_signoffs where id = p_id) then raise exception 'Fallback wording version not found'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the fallback wording'; end if;
  update public.lab_fallback_wording_signoffs set is_active = false where is_active and id <> p_id;
  update public.lab_fallback_wording_signoffs set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('lab_fallback_wording.signed', 'lab_fallback_wording_signoffs', p_id, '{}'::jsonb);
  return p_id;
end;
$$;

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('lab_result_still_reviewing', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate', 'Something in the record is taking longer than hoped. Names no analyte, value or flag (INV-07).'),
  ('lab_result_contact_us', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate', 'The care team would like to speak with the patient. Names no analyte, value or flag (INV-07). Sent only after the CMO signs the wording.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('lab_result_still_reviewing', 'en', 'in_app', 'Still being looked at', 'Your care team is still reviewing something in your health record. It is taking longer than we hoped. Open the app to see when to expect it.'),
  ('lab_result_contact_us', 'en', 'in_app', 'Your care team would like to speak with you', 'Your care team would like to speak with you. Please open the app and send them a message when you can.')
on conflict (template_key, locale, channel) do nothing;

create function private.sweep_lab_holds() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.lab_results%rowtype;
  hs public.lab_hold_state%rowtype;
  v_expected integer := private.lab_expected_minutes();
  v_crit integer := coalesce((private.lab_lifecycle_rule('{holdAging,leadEscalateMinutes,critical}') #>> '{}')::integer, 720);
  v_def integer := coalesce((private.lab_lifecycle_rule('{holdAging,leadEscalateMinutes,default}') #>> '{}')::integer, 1440);
  v_rep integer := coalesce((private.lab_lifecycle_rule('{holdAging,repeatMinutes}') #>> '{}')::integer, 720);
  v_repmax integer := coalesce((private.lab_lifecycle_rule('{holdAging,repeatMax}') #>> '{}')::integer, 3);
  v_after integer := coalesce((private.lab_lifecycle_rule('{disclosureFallback,afterEscalatedMinutes}') #>> '{}')::integer, 1440);
  v_max integer := coalesce((private.lab_config('disclosure') ->> 'maxAttempts')::integer, 3);
  v_threshold integer; v_attempts integer;
  n_patient integer := 0; n_lead integer := 0; n_fallback integer := 0;
begin
  for r in select * from public.lab_results
            where release_state in ('awaiting_review', 'clinician_disclosure_required') and superseded_by is null and withdrawn_at is null
              and submitted_by_kind <> 'patient'
            order by received_at limit 2000 loop
    begin
      insert into public.lab_hold_state (lab_result_id, organisation_id) values (r.id, r.organisation_id) on conflict do nothing;
      select * into hs from public.lab_hold_state where lab_result_id = r.id;

      -- (3) the patient hears once that it is taking longer than expected. The same words for every held result.
      if hs.patient_notified_at is null and now() >= r.received_at + make_interval(mins => v_expected) then
        perform private.lab_notify(r.patient_id, r.organisation_id, 'lab_result_still_reviewing', jsonb_build_object('lab_result_id', r.id));
        update public.lab_hold_state set patient_notified_at = now() where lab_result_id = r.id;
        perform private.log_audit('lab_result.still_reviewing_notice', 'lab_results', r.id, '{}'::jsonb);
        n_patient := n_patient + 1;
      end if;

      -- (3) the clinical lead hears when a result has been held past the threshold, then again every repeat interval up to the maximum.
      -- A disclosure-required result already has its own CMO escalation (S27d), so it is not repeated here.
      if r.release_state = 'awaiting_review' then
        v_threshold := case when r.release_reason = 'critical' then v_crit else v_def end;
        if hs.lead_escalation_count < v_repmax and now() >= r.received_at + make_interval(mins => v_threshold + hs.lead_escalation_count * v_rep) then
          -- progress is recorded only if somebody was actually told: with no CMO or admin on file the incident opens and the step is retried
          if private.lab_notify_leadership(r.organisation_id, r.is_test, 'lab_hold_aging', r.id, 'lab_results') > 0 then
            update public.lab_hold_state set lead_escalated_at = now(), lead_escalation_count = lead_escalation_count + 1 where lab_result_id = r.id;
            perform private.log_audit('lab_result.hold_escalated', 'lab_results', r.id, jsonb_build_object('count', hs.lead_escalation_count + 1));
            n_lead := n_lead + 1;
          end if;
        end if;
      end if;

      -- (4) the bounded fallback: the attempts are used up and the CMO has been told; after the configured wait, and only once the CMO has
      -- signed the wording, the patient gets one neutral message asking them to contact the care team. The result stays held.
      if r.release_state = 'clinician_disclosure_required' and r.disclosure_escalated_at is not null and hs.fallback_notified_at is null
         and now() >= r.disclosure_escalated_at + make_interval(mins => v_after) then
        select count(*) into v_attempts from public.lab_disclosure_attempts where lab_result_id = r.id;
        if v_attempts >= v_max then
          if private.lab_fallback_signed() then
            perform private.lab_notify(r.patient_id, r.organisation_id, 'lab_result_contact_us', jsonb_build_object('lab_result_id', r.id));
            update public.lab_hold_state set fallback_notified_at = now() where lab_result_id = r.id;
            perform private.log_audit('lab_result.disclosure_fallback_notice', 'lab_results', r.id, jsonb_build_object('attempts', v_attempts));
            n_fallback := n_fallback + 1;
          elsif hs.fallback_blocked_at is null then
            -- every condition is met but the wording is unsigned: say so (once per result) instead of staying silent. The incident is one
            -- open row for the whole queue, refreshed each time; the CMO also sees the unsigned wording on the sign-off hub.
            update public.lab_hold_state set fallback_blocked_at = now() where lab_result_id = r.id;
            perform private.log_audit('lab_result.disclosure_fallback_blocked_unsigned', 'lab_results', r.id, jsonb_build_object('attempts', v_attempts));
            perform private.page_incident(r.organisation_id, 'lab_fallback_wording_unsigned', 'Patients are waiting on the unsigned fallback message',
              'At least one held sensitive result has used up its disclosure attempts and the CMO wait, and the fallback message is not sent because the CMO has not signed its wording. The result stays held. Sign it on the CMO sign-off hub, or reach the patient by hand.');
          end if;
        end if;
      end if;
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'lab_hold_sweep.error', 'lab_results', r.id, jsonb_build_object('error', sqlerrm));
      perform private.page_incident(r.organisation_id, 'lab_hold_sweep_failed', 'The held lab result sweep failed',
        'The sweep that ages held lab results raised an error (audit_log action lab_hold_sweep.error). Check held results by hand.');
    end;
  end loop;
  return jsonb_build_object('patient_notices', n_patient, 'lead_escalations', n_lead, 'fallback_notices', n_fallback);
end;
$$;
revoke all on function private.sweep_lab_holds() from public, anon, authenticated;
select cron.schedule('lab-hold-sweep', '*/15 * * * *', $$select private.sweep_lab_holds();$$);

-- the clinician's clock: every held result they are tied to, with how long it has waited and when the clinical lead will be told
create function public.lab_hold_clock() returns table (
  lab_result_id uuid, release_state text, report_status text, received_at timestamptz, expected_at timestamptz,
  lead_escalation_at timestamptz, minutes_waiting integer, past_expected boolean, lead_escalated boolean)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.release_state, r.report_status, r.received_at,
         r.received_at + make_interval(mins => private.lab_expected_minutes()),
         case when r.release_state = 'awaiting_review' then r.received_at + make_interval(mins =>
           coalesce((private.lab_lifecycle_rule(case when r.release_reason = 'critical' then '{holdAging,leadEscalateMinutes,critical}'::text[] else '{holdAging,leadEscalateMinutes,default}'::text[] end) #>> '{}')::integer, 1440)) end,
         (extract(epoch from now() - r.received_at) / 60)::integer,
         now() > r.received_at + make_interval(mins => private.lab_expected_minutes()),
         coalesce(h.lead_escalated_at is not null, false)
    from public.lab_results r
    left join public.lab_hold_state h on h.lab_result_id = r.id
   where r.release_state in ('awaiting_review', 'clinician_disclosure_required') and r.superseded_by is null and r.withdrawn_at is null
     and exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'clinician')
     and private.clinician_has_patient_access(r.patient_id)
   order by r.received_at;
$$;

-- ---------------------------------------------------------------------------
-- 6. Delta check: a flag for the reviewer, never a release rule
-- ---------------------------------------------------------------------------
create function private.lab_delta_flags(p_result uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with cfg as (
    select coalesce((private.lab_lifecycle_rule('{delta,percent}') #>> '{}')::numeric, 50) as dflt,
           coalesce((private.lab_lifecycle_rule('{delta,windowDays}') #>> '{}')::integer, 365) as win,
           coalesce(private.lab_lifecycle_rule('{delta,perAnalytePercent}'), '{}'::jsonb) as per
  ), cur as (
    select i.analyte_code, i.unit, i.value_numeric, r.patient_id, r.received_at
      from public.lab_result_items i join public.lab_results r on r.id = i.lab_result_id
     where r.id = p_result and i.value_numeric is not null
  ), prev as (
    select c.analyte_code, c.unit, c.value_numeric as cur_value, p.value_numeric as prev_value, p.released_at,
           row_number() over (partition by c.analyte_code order by p.released_at desc) rn
      from cur c
      join (select i2.analyte_code, i2.unit, i2.value_numeric, r2.released_at, r2.patient_id
              from public.lab_result_items i2 join public.lab_results r2 on r2.id = i2.lab_result_id
             where r2.release_state = 'released' and r2.withdrawn_at is null and r2.superseded_by is null and r2.id <> p_result
               and i2.value_numeric is not null) p
        on p.patient_id = c.patient_id and p.analyte_code = c.analyte_code and p.unit = c.unit
      cross join cfg
     where p.released_at >= c.received_at - make_interval(days => cfg.win)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'analyte_code', x.analyte_code, 'current', x.cur_value, 'previous', x.prev_value, 'previous_released_at', x.released_at,
           'percent_change', round(abs(x.cur_value - x.prev_value) / nullif(abs(x.prev_value), 0) * 100, 1),
           'threshold_percent', x.threshold) order by x.analyte_code), '[]'::jsonb)
    from (
      select p.*, coalesce((cfg.per ->> p.analyte_code)::numeric, cfg.dflt) as threshold
        from prev p cross join cfg where p.rn = 1
    ) x
   -- a change away from zero has no percentage but is always a change worth a look
   where (x.prev_value = 0 and x.cur_value <> 0)
      or abs(x.cur_value - x.prev_value) / nullif(abs(x.prev_value), 0) * 100 >= x.threshold;
$$;
revoke all on function private.lab_delta_flags(uuid) from public, anon, authenticated;

-- Everything the reviewer needs beside the values: status, the delta flags, the clock and the call. An audited, tied read (INV-10, INV-12).
create function public.lab_result_review_context(p_result uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.lab_results%rowtype; c public.lab_critical_calls%rowtype; h public.lab_hold_state%rowtype;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = '22023'; end if;
  r := private.lab_review_actor(p_result, false);
  if r.id is null then return jsonb_build_object('error', 'not_permitted'); end if;
  perform private.audit_chart_read(r.patient_id, array['lab_results'], p_reason, 'success');
  select * into c from public.lab_critical_calls where lab_result_id = r.id;
  select * into h from public.lab_hold_state where lab_result_id = r.id;
  return jsonb_build_object(
    'report_status', r.report_status,
    'corrects_preliminary', r.correction_kind = 'finalised',
    'delta_flags', private.lab_delta_flags(r.id),
    'critical_call', case when c.id is null then null else jsonb_build_object(
        'call_id', c.id, 'called_at', c.called_at, 'due_at', c.due_at, 'acknowledged_at', c.acknowledged_at, 'closed_at', c.closed_at,
        'overdue', c.acknowledged_at is null and c.closed_at is null and now() > c.due_at, 'no_cover', c.no_cover) end,
    'hold', jsonb_build_object('received_at', r.received_at, 'expected_at', r.received_at + make_interval(mins => private.lab_expected_minutes()),
        'lead_escalated', h.lead_escalated_at is not null));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Partner onboarding: licence and accreditation proof before a laboratory goes live
-- ---------------------------------------------------------------------------
create function private.lab_provider_gaps(p public.lab_providers) returns text[]
language sql stable set search_path = ''
as $$
  select array_remove(array[
    case when coalesce(btrim(p.license_number), '') = '' then 'licence_number' end,
    case when p.license_verified_at is null then 'licence_verified' end,
    case when p.license_expires_at is null or p.license_expires_at <= now() then 'licence_current' end,
    case when coalesce(btrim(p.accreditation), '') = '' then 'accreditation' end
  ], null);
$$;
revoke all on function private.lab_provider_gaps(public.lab_providers) from public, anon, authenticated;

-- Added beside lab_providers_active_needs_real_contacts, which is unchanged. It acts on a switch-on (insert active, or inactive to active),
-- so a laboratory that is already live is not touched by it; a live laboratory's licence is watched by the S74 quality job instead.
create function private.guard_lab_provider_activation() returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_gaps text[];
begin
  if new.is_active and (tg_op = 'INSERT' or coalesce(old.is_active, false) = false) then
    v_gaps := private.lab_provider_gaps(new);
    if coalesce(array_length(v_gaps, 1), 0) > 0 then
      raise exception 'lab_provider_needs_onboarding_proof: missing %', array_to_string(v_gaps, ', ') using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_lab_provider_activation() from public, anon, authenticated;
create trigger lab_providers_activation_proof before insert or update of is_active on public.lab_providers
  for each row execute function private.guard_lab_provider_activation();

create function public.lab_provider_onboarding_gaps(p_provider uuid) returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare p public.lab_providers%rowtype;
begin
  if not private.partner_desk_actor() then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into p from public.lab_providers where id = p_provider;
  if not found then raise exception 'lab_provider_not_found' using errcode = '22023'; end if;
  return private.lab_provider_gaps(p);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5a. Fix found while reusing the rejected-specimen path: its staff notice was addressed to clinical_staff.id, but
-- notifications.recipient_id references profiles(id). With an active Chief Medical Officer on the staff table (production has one) the
-- insert violates the foreign key and the WHOLE rejection, including the automatic re-collection, rolls back. The recipient is the staff
-- member's profile. Patched in place from the live definition; the migration refuses to run if an anchor is missing.
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_new text;
  c_a_old constant text := $q$  select v_specimen.organisation_id, cs.id, 'in_app', 'pending',$q$;
  c_a_new constant text := $q$  select v_specimen.organisation_id, cs.profile_id, 'in_app', 'pending',$q$;
  c_b_old constant text := $q$   where cs.organisation_id = v_specimen.organisation_id
     and cs.active
     and cs.doctor_tier = 'chief_medical_officer';$q$;
  c_b_new constant text := $q$   where cs.organisation_id = v_specimen.organisation_id
     and cs.active
     and cs.profile_id is not null
     and cs.doctor_tier = 'chief_medical_officer';$q$;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lab_partner_reject_specimen';
  if v_def is null then raise exception 'S27h: public.lab_partner_reject_specimen not found'; end if;
  if (length(v_def) - length(replace(v_def, c_a_old, ''))) / length(c_a_old) <> 1 then raise exception 'S27h: staff-notice recipient anchor not found exactly once'; end if;
  if (length(v_def) - length(replace(v_def, c_b_old, ''))) / length(c_b_old) <> 1 then raise exception 'S27h: staff-notice filter anchor not found exactly once'; end if;
  v_new := replace(replace(v_def, c_a_old, c_a_new), c_b_old, c_b_new);
  execute v_new;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Staff turnaround overview (the partner portal has its own)
-- ---------------------------------------------------------------------------
create function public.lab_turnaround_overview() returns table (
  provider_id uuid, provider_name text, is_active boolean, specimens_in_flight integer, open_delay_alerts integer, oldest_open_alert_hours numeric,
  rejected_30d integer, recollections_open integer, completed_30d integer, median_hours_to_complete_30d numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.partner_desk_actor() then raise exception 'not authorised' using errcode = '42501'; end if;
  return query
  select l.id, l.name, l.is_active,
         (select count(*)::integer from public.lab_specimens s where s.provider_id = l.id and s.status not in ('completed', 'rejected')),
         (select count(*)::integer from public.lab_turnaround_alerts a where a.provider_id = l.id and a.acknowledged_at is null),
         (select round(max(a.elapsed_hours), 1) from public.lab_turnaround_alerts a where a.provider_id = l.id and a.acknowledged_at is null),
         (select count(*)::integer from public.lab_specimens s where s.provider_id = l.id and s.rejected_at > now() - interval '30 days'),
         (select count(*)::integer from public.lab_specimens s where s.provider_id = l.id and s.recollection_of is not null and s.status not in ('completed', 'rejected')),
         (select count(*)::integer from public.lab_specimens s where s.provider_id = l.id and s.completed_at > now() - interval '30 days'),
         (select round((percentile_cont(0.5) within group (order by extract(epoch from s.completed_at - coalesce(s.collected_at, s.created_at)) / 3600))::numeric, 1)
            from public.lab_specimens s where s.provider_id = l.id and s.completed_at > now() - interval '30 days')
    from public.lab_providers l
   order by l.is_active desc, l.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. The patient's trend: a released, coded, numeric value against the previous one, with the care team's note
-- ---------------------------------------------------------------------------
create function private.lab_analyte_is_sensitive(p_code text) returns boolean
language sql stable security definer set search_path = ''
as $$
  -- the panel definitions are the only source: a sensitive analyte is a property of the test, not of one patient's value
  select exists (select 1 from public.lab_panel_versions v, jsonb_array_elements(v.analytes) a
                  where a ->> 'code' = p_code and coalesce((a ->> 'sensitive')::boolean, false));
$$;
revoke all on function private.lab_analyte_is_sensitive(text) from public, anon, authenticated;

create table public.lab_trend_notes (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  lab_result_id    uuid not null references public.lab_results (id) on delete restrict,
  analyte_code     text not null,
  note             text not null check (char_length(btrim(note)) between 3 and 300),
  written_by       uuid not null references public.profiles (id) on delete restrict,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now()
);
create index lab_trend_notes_result_idx on public.lab_trend_notes (lab_result_id, analyte_code, created_at desc);
-- append only: a note is never edited. (Nobody can delete one either: no role holds DELETE. A patient row removed by the test purge takes its
-- notes with it through the foreign key, which is why this trigger does not also fire on delete.)
create function private.lab_trend_notes_append_only() returns trigger language plpgsql security definer set search_path = ''
as $$ begin raise exception 'lab_trend_notes_append_only' using errcode = '42501'; end; $$;
revoke all on function private.lab_trend_notes_append_only() from public, anon, authenticated;
create trigger lab_trend_notes_no_change before update on public.lab_trend_notes
  for each row execute function private.lab_trend_notes_append_only();

-- The patient reads only their own notes on a result that is released and not withdrawn. Staff have no policy: they write through the
-- function below and read through the audited review path.
alter table public.lab_trend_notes enable row level security;
create policy lab_trend_notes_patient_read on public.lab_trend_notes for select to authenticated
  using (patient_id = (select auth.uid())
         and exists (select 1 from public.lab_results r where r.id = lab_result_id and r.release_state = 'released' and r.withdrawn_at is null));
revoke all on public.lab_trend_notes from public, anon, authenticated;
grant select on public.lab_trend_notes to authenticated;

create function public.write_lab_trend_note(p_result uuid, p_analyte text, p_note text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.lab_results%rowtype; i public.lab_result_items%rowtype;
begin
  if char_length(btrim(coalesce(p_note, ''))) not between 3 and 300 then raise exception 'lab_trend_note_length' using errcode = '22023'; end if;
  r := private.lab_review_actor(p_result, false);
  if r.id is null then return jsonb_build_object('error', 'not_permitted'); end if;
  if r.release_state <> 'released' or r.withdrawn_at is not null or r.superseded_by is not null or r.submitted_by_kind = 'patient' then
    raise exception 'lab_trend_note_result_not_current' using errcode = '22023';
  end if;
  select * into i from public.lab_result_items where lab_result_id = r.id and analyte_code = p_analyte;
  if not found or i.value_numeric is null or i.sensitive_positive or private.lab_analyte_is_sensitive(p_analyte) then
    raise exception 'lab_trend_note_analyte_not_allowed' using errcode = '22023';
  end if;
  insert into public.lab_trend_notes (organisation_id, patient_id, lab_result_id, analyte_code, note, written_by, is_test)
  values (r.organisation_id, r.patient_id, r.id, p_analyte, btrim(p_note), (select auth.uid()), r.is_test);
  perform private.log_audit('lab_trend_note.written', 'lab_results', r.id, jsonb_build_object('analyte', p_analyte));
  return jsonb_build_object('ok', true);
end;
$$;

-- Released results only; coded numeric values only; the current version of each earlier result only; never a sensitive analyte; never a
-- patient's own upload (it is unreviewed). Needs two values to say anything. Names no diagnosis: a direction and the care team's note.
create function public.my_lab_trends() returns jsonb
language sql stable security definer set search_path = ''
as $$
  with sens as (
    select distinct a ->> 'code' as code from public.lab_panel_versions v, jsonb_array_elements(v.analytes) a where coalesce((a ->> 'sensitive')::boolean, false)
  ), vals as (
    select i.analyte_code, i.unit, i.value_numeric, r.id as rid, r.released_at,
           row_number() over (partition by i.analyte_code, i.unit order by r.released_at desc, r.id) as rn
      from public.lab_result_items i join public.lab_results r on r.id = i.lab_result_id
     where r.patient_id = (select auth.uid()) and r.release_state = 'released' and r.withdrawn_at is null and r.superseded_by is null
       and r.submitted_by_kind <> 'patient' and r.report_status = 'final'
       and i.value_numeric is not null and not i.sensitive_positive and i.analyte_code not in (select code from sens)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'analyte_code', a.analyte_code, 'unit', a.unit,
      -- values and dates only: no range and no flag, because a range is shown to a patient only with its source (S05b) and that is the
      -- results list's job, not the trend's
      'latest', jsonb_build_object('value', a.value_numeric, 'released_at', a.released_at),
      'previous', jsonb_build_object('value', b.value_numeric, 'released_at', b.released_at),
      'direction', case when a.value_numeric > b.value_numeric then 'higher' when a.value_numeric < b.value_numeric then 'lower' else 'same' end,
      'note', (select n.note from public.lab_trend_notes n where n.lab_result_id = a.rid and n.analyte_code = a.analyte_code
                order by n.created_at desc limit 1)) order by a.analyte_code), '[]'::jsonb)
    from vals a join vals b on b.analyte_code = a.analyte_code and b.unit = a.unit and b.rn = 2
   where a.rn = 1;
$$;

-- the two patient-keyed tables join the data registry (export, retention review, purge walk). PROPOSED classes, to be confirmed by the CMO and DPO.
-- Under-18 dependants: both are auto-guarded by the S04b-1e event trigger, like every other lab table (a child holds no lab results).
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name, 'patient_id', private.retention_class_for(t.table_name), 'review', true,
       'S27h 2026-10-16: PROPOSED, to be confirmed by the CMO and DPO.'
  from (values ('lab_critical_calls'), ('lab_trend_notes')) as t(table_name)
on conflict (table_name) do nothing;

-- ---------------------------------------------------------------------------
-- grants (anon never; public execute revoked explicitly, not just anon)
-- ---------------------------------------------------------------------------
revoke all on function public.lab_partner_submit_preliminary_result(uuid, text, jsonb, jsonb), public.acknowledge_lab_critical_call(uuid),
  public.my_lab_critical_calls(), public.lab_hold_clock(), public.lab_result_review_context(uuid, text), public.sign_lab_fallback_wording(uuid),
  public.lab_provider_onboarding_gaps(uuid), public.lab_turnaround_overview(), public.write_lab_trend_note(uuid, text, text), public.my_lab_trends()
  from public, anon;
grant execute on function public.lab_partner_submit_preliminary_result(uuid, text, jsonb, jsonb), public.acknowledge_lab_critical_call(uuid),
  public.my_lab_critical_calls(), public.lab_hold_clock(), public.lab_result_review_context(uuid, text), public.sign_lab_fallback_wording(uuid),
  public.lab_provider_onboarding_gaps(uuid), public.lab_turnaround_overview(), public.write_lab_trend_note(uuid, text, text), public.my_lab_trends()
  to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.my_lab_trends()', 'execute') or has_function_privilege('anon', 'public.acknowledge_lab_critical_call(uuid)', 'execute')
     or has_function_privilege('anon', 'public.sign_lab_fallback_wording(uuid)', 'execute') or has_function_privilege('anon', 'public.lab_turnaround_overview()', 'execute')
     or has_table_privilege('authenticated', 'public.lab_critical_calls', 'select') or has_table_privilege('authenticated', 'public.lab_hold_state', 'select')
     or has_table_privilege('anon', 'public.lab_trend_notes', 'select') then
    raise exception 'S27h self-check: grants too wide';
  end if;
  if private.lab_fallback_signed() then raise exception 'S27h self-check: the fallback wording must start unsigned'; end if;
end $$;
