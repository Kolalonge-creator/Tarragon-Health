-- Follow-up build (CMO and founder answers to OQ-314..358), part 2 of 2 (part 1 added lead_end_reason 'verification_missing').
--
-- A. ONE rota-gap alert per organisation. Two mechanisms raised the same fact: S18's private.rota_gap_alert (incident
--    'rota_gap:<org>', reviewers told, 'rota.gap_detected' event, run by lead_reconcile and by every rota write) and SR5's
--    rota_gap_12h rule (ops_alerts row plus a second incident 'ops_alert:rota_gap_12h:<org>:rota_gap', evaluated every
--    minute). S18 is kept. The SR5 check now returns no rows (rule kept so the wall and its history stay; the evaluator
--    resolves any open alert itself), existing open SR5 rows are resolved quietly (no ops_alert_notify, no notice), and S18's
--    incident now resolves itself when the gaps are gone (it never did before).
-- B. OQ-350: private.lead_ineligibility_reason returns 'verification_missing' when a clinician fails the credential
--    verification gate (private.psv_satisfied) instead of mislabelling it licence_expired.
-- C. OQ-344: credentialing_config.grandfather_ends_on = 2027-01-13 (90 days from 2026-10-15) on every config version that still
--    carries a null end date, only when a grandfathered clinician exists.
-- D. OQ-334: approve_triage_rule_set refuses only when a task type USED by that rule set awaits confirmation.
-- E. OQ-352: a stored consent row for the identity check (identity_check_consents) and the service-only lookup the adapter's
--    fail-closed wrapper calls.
-- F. OQ-345 (is_test exemption): audited already by audit_row_change_trg on clinical_staff; proved in the database proof.

-- ---------------------------------------------------------------------------
-- A. one rota gap alert
-- ---------------------------------------------------------------------------
create or replace function private.ops_check_rota_gap_12h(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  -- Retired as a second alert: S18's private.rota_gap_alert owns the rota gap incident (one per organisation, key rota_gap:<org>).
  -- Kept as a function that returns nothing so the rule row, its history and its ACL stay as they were.
  select null::text, null::jsonb where false;
$$;

create or replace function private.rota_gap_alert(p_org uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
  v_now integer;
  v_ref text := 'rota_gap:' || p_org;
  v_hours integer := (private.lead_rule('gap_alert_hours') #>> '{}')::integer;
  v_summary text;
begin
  with g as (select * from private.rota_gaps(p_org, now(), now() + make_interval(hours => v_hours)))
  select count(*), count(*) filter (where gap_start <= now()),
         string_agg(format('%s from %s to %s', kind, to_char(gap_start at time zone 'Africa/Lagos', 'DD Mon HH24:MI'), to_char(gap_end at time zone 'Africa/Lagos', 'DD Mon HH24:MI')), '; ' order by gap_start)
    into v_n, v_now, v_summary from g;
  if v_n = 0 then
    -- Cover is back: close the one incident quietly (no notice). It used to stay open until someone closed it by hand.
    update public.ops_incidents
       set status = 'resolved', resolved_at = now(),
           acknowledged_at = coalesce(acknowledged_at, now()), mitigated_at = coalesce(mitigated_at, now()),
           root_cause = coalesce(root_cause, 'No on-call cover for part of the window'),
           corrective_action = coalesce(corrective_action, 'The rota now covers the window (found by the next rota check).'),
           preventive_action = coalesce(preventive_action, 'The rota gap check runs after every rota change and nightly.')
     where external_reference = v_ref and status not in ('resolved', 'closed');
    return 0;
  end if;
  if exists (select 1 from public.ops_incidents where external_reference = v_ref and status not in ('resolved', 'closed')) then
    update public.ops_incidents set summary = 'On-call cover problem in the next ' || v_hours || ' hours: ' || v_summary
     where external_reference = v_ref and status not in ('resolved', 'closed');
  else
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (p_org, 'clinical', (case when v_now > 0 then 'sev1' else 'sev2' end)::public.ops_incident_severity, 'On-call rota has uncovered or thin hours',
            'On-call cover problem in the next ' || v_hours || ' hours: ' || v_summary, v_ref, now(), now());
    perform private.credential_notify_reviewers(p_org, 'On-call cover gap', 'Some upcoming hours have no on-call cover or no working backup. Open the rota to fix it.', '{}'::jsonb, 'rota_review');
  end if;
  perform private.emit_domain_event('rota.gap_detected', p_org, jsonb_build_object('gap_count', v_n),
    'rota.gap_detected:' || p_org || ':' || to_char(date_trunc('hour', now()), 'YYYYMMDDHH24'), null, null, null, 'urgent');
  return v_n;
end;
$$;

-- Quiet clean-up of the SR5 rows (no ops_alert_notify, no notice). The row locks match the evaluator's table order (alerts, then incidents).
do $$
declare
  v_orgs uuid[]; v_org uuid; v_alerts_done integer; v_inc_done integer; v_alerts_before integer; v_inc_before integer;
begin
  lock table public.ops_alerts, public.ops_incidents in share row exclusive mode;
  select count(*) into v_alerts_before from public.ops_alerts where rule_code = 'rota_gap_12h' and state = 'open';
  select count(*) into v_inc_before from public.ops_incidents where external_reference like 'ops_alert:rota_gap_12h:%' and status not in ('resolved', 'closed');
  raise notice 'rota gap merge: % open SR5 alerts and % open SR5 incidents before', v_alerts_before, v_inc_before;

  -- organisations whose gap was only visible through the SR5 rows (their S18 incident may not exist yet)
  select coalesce(array_agg(distinct (split_part(dedup_key, ':', 1))::uuid), '{}')
    into v_orgs from public.ops_alerts
   where rule_code = 'rota_gap_12h' and state = 'open' and split_part(dedup_key, ':', 1) ~ '^[0-9a-f-]{36}$';

  with u as (update public.ops_alerts set state = 'resolved', resolved_at = now() where rule_code = 'rota_gap_12h' and state = 'open' returning 1)
  select count(*) into v_alerts_done from u;
  with u as (
    update public.ops_incidents
       set status = 'resolved', resolved_at = now(),
           acknowledged_at = coalesce(acknowledged_at, now()), mitigated_at = coalesce(mitigated_at, now()),
           root_cause = 'Two alerts reported the same rota gap (S18 and SR5); merged into one by the founder and CMO decision',
           corrective_action = 'The S18 rota gap incident (one per organisation) is the only one now; the SR5 rule no longer raises its own.',
           preventive_action = 'A database proof asserts the SR5 check returns nothing and two evaluations plus two S18 runs leave exactly one open incident.'
     where external_reference like 'ops_alert:rota_gap_12h:%' and status not in ('resolved', 'closed') returning 1)
  select count(*) into v_inc_done from u;
  raise notice 'rota gap merge: resolved % alerts and % incidents', v_alerts_done, v_inc_done;

  -- keep a real gap visible: the one S18 incident is raised now for those organisations (first notice of the merged alert only)
  foreach v_org in array v_orgs loop
    begin
      perform private.rota_gap_alert(v_org);
    exception when others then
      raise warning 'rota gap merge: S18 alert for % not raised now (%); the nightly run will', v_org, sqlerrm;
    end;
  end loop;

  assert not exists (select 1 from public.ops_alerts where rule_code = 'rota_gap_12h' and state = 'open'), 'open SR5 rota gap alerts remain';
  assert not exists (select 1 from public.ops_incidents where external_reference like 'ops_alert:rota_gap_12h:%' and status not in ('resolved', 'closed')), 'open SR5 rota gap incidents remain';
  assert not has_function_privilege('anon', 'private.ops_check_rota_gap_12h(jsonb,boolean)', 'EXECUTE'), 'anon can execute the check';
  assert not has_function_privilege('authenticated', 'private.ops_check_rota_gap_12h(jsonb,boolean)', 'EXECUTE'), 'authenticated can execute the check';
  assert not has_function_privilege('anon', 'private.rota_gap_alert(uuid)', 'EXECUTE'), 'anon can execute rota_gap_alert';
  assert not has_function_privilege('authenticated', 'private.rota_gap_alert(uuid)', 'EXECUTE'), 'authenticated can execute rota_gap_alert';
end $$;

-- ---------------------------------------------------------------------------
-- B. lead_ineligibility_reason: verification_missing (from the live definition)
-- ---------------------------------------------------------------------------
create or replace function private.lead_ineligibility_reason(p_clinician uuid, p_patient uuid) returns public.lead_end_reason
language plpgsql stable security definer set search_path = ''
as $$
declare cs public.clinical_staff%rowtype;
begin
  select * into cs from public.clinical_staff where profile_id = p_clinician;
  if not found then return 'ineligible'; end if;
  if cs.status = 'offboarded' then return 'offboarded'; end if;
  if cs.status = 'suspended' or not cs.active then
    return case when coalesce(cs.suspended_reason, '') ~* 'licen[cs]e' then 'licence_expired' else 'suspended' end;
  end if;
  if private.has_conflict(p_clinician, p_patient) then return 'conflict'; end if;
  -- OQ-350: a clinician whose licence is in date but who has no recorded primary-source verification (and is not grandfathered)
  -- failed the credential verification gate, not the licence check.
  if (cs.license_expires_at is null or private.credential_valid_on(cs.license_expires_at, now()) or private.credential_in_grace(cs.id, 'licence', now()))
     and not private.psv_satisfied(cs.id) then
    return 'verification_missing';
  end if;
  if cs.license_expires_at is not null and not private.clinician_is_eligible(p_clinician) then return 'licence_expired'; end if;
  if exists (select 1 from jsonb_array_elements_text(private.lead_rule('required_competencies')) k where not private.has_competency(p_clinician, k)) then return 'competency_revoked'; end if;
  return 'ineligible';
end;
$$;

-- ---------------------------------------------------------------------------
-- C. grandfather end date (OQ-344): 2026-10-15 + 90 days = 2027-01-13
-- credentialing-grandfather-ends-on: 2027-01-13
-- ---------------------------------------------------------------------------
do $$
declare
  v_grand integer; v_rows_before integer; v_rows_done integer;
begin
  select count(*) into v_grand from public.clinical_staff where psv_grandfathered and active and status = 'active';
  select count(*) into v_rows_before from public.credentialing_config where rules ? 'grandfather_ends_on' and rules -> 'grandfather_ends_on' = 'null'::jsonb;
  raise notice 'grandfather end date: % grandfathered active clinicians, % config versions with a null end date', v_grand, v_rows_before;
  if v_grand > 0 then
    with u as (
      update public.credentialing_config
         set rules = jsonb_set(rules, '{grandfather_ends_on}', to_jsonb('2027-01-13'::text))
       where rules ? 'grandfather_ends_on' and rules -> 'grandfather_ends_on' = 'null'::jsonb returning 1)
    select count(*) into v_rows_done from u;
    assert v_rows_done = v_rows_before, 'grandfather end date: updated row count differs from the count taken first';
    assert not exists (select 1 from public.credentialing_config where rules ? 'grandfather_ends_on' and rules -> 'grandfather_ends_on' = 'null'::jsonb), 'a config version still has a null end date';
    assert not exists (select 1 from public.credentialing_config where is_active and (rules ->> 'grandfather_ends_on') is distinct from '2027-01-13'), 'the active config does not carry the end date';
    -- the two clinicians stay eligible until the day (Africa/Lagos) the date passes
    assert not exists (select 1 from public.clinical_staff cs where cs.psv_grandfathered and cs.active and cs.status = 'active'
                          and not private.psv_satisfied(cs.id, '2027-01-13 12:00:00+01'::timestamptz)), 'a grandfathered clinician is ineligible on 2027-01-13';
    assert not exists (select 1 from public.clinical_staff cs where cs.psv_grandfathered and cs.active and cs.status = 'active'
                          and not cs.is_test and cs.doctor_tier <> 'care_coordinator'
                          and not exists (select 1 from public.clinician_primary_source_verifications v where v.clinical_staff_id = cs.id)
                          and private.psv_satisfied(cs.id, '2027-01-14 12:00:00+01'::timestamptz)), 'a grandfathered clinician without evidence is still eligible on 2027-01-14';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- D. approve_triage_rule_set: only task types this rule set uses (from the live definition)
-- ---------------------------------------------------------------------------
create or replace function public.approve_triage_rule_set(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  rs public.triage_rule_sets%rowtype;
  v_unconfirmed text;
  v_missing text;
begin
  if not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can approve a triage rule set' using errcode = '42501';
  end if;
  select * into rs from public.triage_rule_sets where id = p_id for update;
  if not found or rs.status <> 'draft' then
    raise exception 'only a draft rule set can be approved' using errcode = '22023';
  end if;
  -- OQ-334: only a task type this rule set can create counts. An unrelated unconfirmed task type no longer blocks the approval.
  select string_agg(t.code, ', ') into v_unconfirmed
    from public.task_types t
   where t.is_active and t.needs_confirmation and t.confirmed_at is null
     and exists (select 1 from jsonb_path_query(rs.rules, '$.rules[*].actions[*] ? (@.kind == "create_task")') x
                  where t.source_task_keys @> array[x ->> 'task']);
  if v_unconfirmed is not null then
    raise exception 'confirm these task types first: %', v_unconfirmed using errcode = '22023';
  end if;
  -- every task the rules can create must have a task type that answers it
  select string_agg(k, ', ') into v_missing from (
    select distinct x ->> 'task' as k
      from jsonb_path_query(rs.rules, '$.rules[*].actions[*] ? (@.kind == "create_task")') x
     where not exists (select 1 from public.task_types t where t.is_active and t.creatable and t.source_task_keys @> array[x ->> 'task'])
  ) m;
  if v_missing is not null then
    raise exception 'no active task type answers these task keys: %', v_missing using errcode = '22023';
  end if;

  update public.triage_rule_sets set status = 'retired' where code = rs.code and status = 'approved';
  update public.triage_rule_sets set status = 'approved', approved_by = (select auth.uid()), approved_at = now() where id = p_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (private.current_org_id(), (select auth.uid()), 'triage_rule_set.approved', 'triage_rule_set', p_id,
          jsonb_build_object('code', rs.code, 'version', rs.version, 'note', nullif(btrim(coalesce(p_note, '')), '')));
end;
$$;

-- ---------------------------------------------------------------------------
-- E. identity check consent (OQ-352): stored by the subject, looked up by the adapter wrapper before any vendor call
-- ---------------------------------------------------------------------------
create table public.identity_check_consents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations (id) on delete restrict,
  subject_profile_id uuid not null references public.profiles (id) on delete restrict,
  id_kind text not null check (id_kind in ('nin', 'bvn')),
  consent_text_version text not null check (length(btrim(consent_text_version)) between 1 and 40),
  given_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  is_test boolean not null default false
);
comment on table public.identity_check_consents is
  'OQ-352: the stored consent for an identity (NIN or BVN) check. The identity adapter wrapper refuses any call whose consent id is not a live row here for the same subject. Written only by record_identity_check_consent (the subject, for themself). Holds no ID number.';
create index identity_check_consents_subject_idx on public.identity_check_consents (subject_profile_id, given_at desc);
alter table public.identity_check_consents enable row level security;
create policy identity_check_consents_own_read on public.identity_check_consents for select to authenticated
  using (subject_profile_id = (select auth.uid()));
-- the default privileges give authenticated every table privilege; this table is written only by the two RPCs below
revoke all on public.identity_check_consents from authenticated, anon;
grant select on public.identity_check_consents to authenticated;
create trigger audit_row_change_trg after insert or update on public.identity_check_consents
  for each row execute function private.audit_row_change();

create function public.record_identity_check_consent(p_id_kind text, p_text_version text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_id uuid; p public.profiles%rowtype;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_id_kind not in ('nin', 'bvn') then raise exception 'ID kind must be nin or bvn' using errcode = '22023'; end if;
  select * into p from public.profiles where id = v_uid;
  if not found then raise exception 'no profile' using errcode = '42501'; end if;
  insert into public.identity_check_consents (organisation_id, subject_profile_id, id_kind, consent_text_version, is_test)
  values (p.organisation_id, v_uid, p_id_kind, p_text_version, p.is_test) returning id into v_id;
  return v_id;
end;
$$;

create function public.withdraw_identity_check_consent(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.identity_check_consents set withdrawn_at = now()
   where id = p_id and subject_profile_id = (select auth.uid()) and withdrawn_at is null;
  if not found then raise exception 'no live consent of yours with that id' using errcode = '22023'; end if;
end;
$$;

-- The adapter wrapper's lookup (edge functions, service role only): true only for a live, unwithdrawn row for this subject.
create function public.identity_consent_valid(p_consent uuid, p_subject uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.identity_check_consents c
                  where c.id = p_consent and c.subject_profile_id = p_subject and c.withdrawn_at is null);
$$;

revoke all on function public.record_identity_check_consent(text, text) from public;
revoke all on function public.withdraw_identity_check_consent(uuid) from public;
revoke all on function public.identity_consent_valid(uuid, uuid) from public;
grant execute on function public.record_identity_check_consent(text, text) to authenticated;
grant execute on function public.withdraw_identity_check_consent(uuid) to authenticated;
grant execute on function public.identity_consent_valid(uuid, uuid) to service_role;

do $$
begin
  assert not has_function_privilege('anon', 'public.record_identity_check_consent(text,text)', 'EXECUTE'), 'anon can record a consent';
  assert not has_function_privilege('anon', 'public.withdraw_identity_check_consent(uuid)', 'EXECUTE'), 'anon can withdraw a consent';
  assert not has_function_privilege('anon', 'public.identity_consent_valid(uuid,uuid)', 'EXECUTE'), 'anon can look up a consent';
  assert not has_function_privilege('authenticated', 'public.identity_consent_valid(uuid,uuid)', 'EXECUTE'), 'authenticated can look up a consent (oracle)';
  assert has_function_privilege('service_role', 'public.identity_consent_valid(uuid,uuid)', 'EXECUTE'), 'service role cannot look up a consent';
  assert not has_table_privilege('anon', 'public.identity_check_consents', 'SELECT'), 'anon can read consents';
  assert not has_table_privilege('authenticated', 'public.identity_check_consents', 'INSERT'), 'authenticated can insert a consent directly';
  assert not has_table_privilege('authenticated', 'public.identity_check_consents', 'UPDATE'), 'authenticated can update a consent directly';
  assert not has_table_privilege('authenticated', 'public.identity_check_consents', 'DELETE'), 'authenticated can delete a consent';
end $$;
