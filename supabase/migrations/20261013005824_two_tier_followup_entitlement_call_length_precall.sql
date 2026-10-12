-- Two-tier model, items 3 and 4: entitlement upkeep, the tiered call length rule, the pre-call summary, the worklist and the nudge.
--
-- POLICY (documented here so nobody has to guess; values are in followup_config, PROPOSED):
--   * A Member's 365-day membership carries 12 follow-up months. Month n runs from the membership start plus n-1 months (Africa/Lagos)
--     to the start plus n months. One follow-up per month. A month that passes with none taken LAPSES: it is not carried over
--     (carryOverMonths 0), so a Member cannot stockpile twelve calls for the last week.
--   * A booked follow-up holds the month. It is CONSUMED when the call completes. Cancelled in time, by the clinician, or expired:
--     the month goes back to available. A Member's late cancellation (inside the consultation cancel window) consumes it, matching
--     the credit rule (lateCancelConsumes). A Member no-show does not consume it (patientNoShowConsumes false); a clinician no-show never does.
--   * The yearly results call is one of the 12: it takes that month's follow-up (it is not an extra call).
--   * A month that ends with no follow-up booked is nudged (in-app, push or email as the Member prefers, never SMS) and appears on
--     the worklist of the lead doctor and the care coordinator.
-- The tiered call length (decision C8): 20 minutes for the yearly results call and for a Member with a condition on the problem
-- list or an abnormal or held result in the lookback; otherwise 15 (a doctor may choose 10 for a routine call). The length and the
-- config version used are stamped on the encounter when it is created (INV-16), however the call was booked.

-- ---------------------------------------------------------------------------
-- 1. Entitlement upkeep
-- ---------------------------------------------------------------------------
create function private.ensure_followup_entitlements(p_membership uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  m public.patient_memberships;
  cfg jsonb := private.followup_setting('offers');
  v_months integer := coalesce((cfg ->> 'entitlementMonths')::integer, 12);
  v_ver integer := coalesce(private.followup_setting_version('offers'), 1);
  v_test boolean;
  i integer;
  ps timestamptz;
  pe timestamptz;
  v_made integer := 0;
  v_rows integer;
begin
  select * into m from public.patient_memberships where id = p_membership;
  if m.id is null or m.state <> 'active' then return 0; end if;
  v_test := coalesce((select pr.is_test from public.profiles pr where pr.id = m.patient_id), false);
  for i in 1..v_months loop
    ps := ((m.starts_at at time zone 'Africa/Lagos') + ((i - 1) * interval '1 month')) at time zone 'Africa/Lagos';
    pe := ((m.starts_at at time zone 'Africa/Lagos') + (i * interval '1 month')) at time zone 'Africa/Lagos';
    if m.ends_at is not null then
      exit when ps >= m.ends_at;
      pe := least(pe, m.ends_at);
    end if;
    insert into public.member_followup_entitlements
      (organisation_id, patient_id, membership_id, month_index, period_start, period_end, state, config_version, is_test)
    values
      -- a month that was already over when the membership was recorded was never available to this Member
      (m.organisation_id, m.patient_id, m.id, i, ps, pe, case when pe <= now() then 'voided' else 'available' end, v_ver, v_test)
    on conflict (membership_id, month_index) do nothing;
    get diagnostics v_rows = row_count;
    v_made := v_made + v_rows;
  end loop;
  return v_made;
end;
$$;
revoke all on function private.ensure_followup_entitlements(uuid) from public, anon, authenticated;

create function private.after_membership_change_followups()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.state = 'active' then
    perform private.ensure_followup_entitlements(new.id);
    if new.ends_at is not null then
      -- a shortened membership: months that would start after the end are void, and the last one is cut at the end
      update public.member_followup_entitlements set state = 'voided', updated_at = now()
       where membership_id = new.id and state = 'available' and period_start >= new.ends_at;
      update public.member_followup_entitlements set period_end = new.ends_at, updated_at = now()
       where membership_id = new.id and period_end > new.ends_at and period_start < new.ends_at;
    end if;
  else
    update public.member_followup_entitlements set state = 'voided', updated_at = now()
     where membership_id = new.id and state = 'available';
  end if;
  return null;
end;
$$;
revoke all on function private.after_membership_change_followups() from public, anon, authenticated;
create trigger patient_memberships_followups
  after insert or update of state, starts_at, ends_at on public.patient_memberships
  for each row execute function private.after_membership_change_followups();

do $$
declare r record;
begin
  for r in select id from public.patient_memberships where state = 'active' loop
    perform private.ensure_followup_entitlements(r.id);
  end loop;
end $$;

-- An appointment's life decides what happens to the month it holds.
create function private.followup_entitlement_follows_appointment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  en public.member_followup_entitlements;
  cfg jsonb := private.followup_setting('offers');
  c jsonb := private.consult_policy();
  v_late boolean;
begin
  if tg_op = 'INSERT' then
    -- a reschedule makes a new appointment: the month follows it
    if new.rescheduled_from_id is not null then
      update public.member_followup_entitlements set appointment_id = new.id, updated_at = now()
       where appointment_id = new.rescheduled_from_id and state = 'booked';
    end if;
    return null;
  end if;
  if new.status is not distinct from old.status then return null; end if;
  select * into en from public.member_followup_entitlements where appointment_id = new.id and state = 'booked' for update;
  if en.id is null then return null; end if;

  if new.status = 'completed' then
    update public.member_followup_entitlements
       set state = 'consumed', consumed_at = now(), consumed_reason = 'completed', updated_at = now() where id = en.id;
  elsif new.status = 'patient_cancelled' then
    v_late := (new.scheduled_for - coalesce(new.cancelled_at, now()))
              < make_interval(hours => coalesce((c ->> 'cancelWindowHours')::integer, 2));
    if v_late and coalesce((cfg ->> 'lateCancelConsumes')::boolean, true) then
      update public.member_followup_entitlements
         set state = 'consumed', consumed_at = now(), consumed_reason = 'late_cancel', updated_at = now() where id = en.id;
    else
      update public.member_followup_entitlements set state = 'available', appointment_id = null, updated_at = now() where id = en.id;
    end if;
  elsif new.status = 'no_show' then
    if new.no_show_reason is distinct from 'clinician_no_show' and coalesce((cfg ->> 'patientNoShowConsumes')::boolean, false) then
      update public.member_followup_entitlements
         set state = 'consumed', consumed_at = now(), consumed_reason = 'patient_no_show', updated_at = now() where id = en.id;
    else
      update public.member_followup_entitlements set state = 'available', appointment_id = null, updated_at = now() where id = en.id;
    end if;
  elsif new.status in ('provider_cancelled', 'cancelled', 'expired', 'failed') then
    update public.member_followup_entitlements set state = 'available', appointment_id = null, updated_at = now() where id = en.id;
  end if;
  return null;
end;
$$;
revoke all on function private.followup_entitlement_follows_appointment() from public, anon, authenticated;
create trigger appointments_followup_entitlement_status
  after update of status on public.appointments
  for each row execute function private.followup_entitlement_follows_appointment();
create trigger appointments_followup_entitlement_reschedule
  after insert on public.appointments
  for each row when (new.rescheduled_from_id is not null)
  execute function private.followup_entitlement_follows_appointment();

-- ---------------------------------------------------------------------------
-- 2. The tiered call length rule (decision C8). Pure reads, returns minutes and a COARSE basis only.
-- ---------------------------------------------------------------------------
create function private.call_length_for(p_patient uuid, p_kind text default 'monthly')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  cfg jsonb := private.followup_setting('call_length');
  v_ver integer := private.followup_setting_version('call_length');
  v_days integer;
  v_need boolean;
begin
  if cfg is null then return null; end if;
  if p_kind = 'yearly_results' then
    return jsonb_build_object('minutes', (cfg ->> 'yearlyResultsMinutes')::integer, 'basis', 'yearly_results', 'version', v_ver);
  end if;
  v_days := coalesce((cfg ->> 'abnormalLookbackDays')::integer, 90);
  v_need :=
    exists (select 1 from public.patient_conditions c
             where c.patient_id = p_patient
               and c.status::text in (select jsonb_array_elements_text(cfg -> 'conditionStatuses')))
    or exists (select 1 from public.lab_results r
                where r.patient_id = p_patient and r.superseded_by is null and r.withdrawn_at is null
                  and r.received_at >= now() - make_interval(days => v_days)
                  and (r.release_state in (select jsonb_array_elements_text(cfg -> 'heldReleaseStates'))
                       or exists (select 1 from public.lab_result_items i
                                   where i.lab_result_id = r.id
                                     and i.flag in (select jsonb_array_elements_text(cfg -> 'abnormalFlags')))));
  if v_need then
    return jsonb_build_object('minutes', (cfg ->> 'longMinutes')::integer, 'basis', 'longer_by_need', 'version', v_ver);
  end if;
  return jsonb_build_object('minutes', (cfg ->> 'routineMinutes')::integer, 'basis', 'standard', 'version', v_ver);
end;
$$;
revoke all on function private.call_length_for(uuid, text) from public, anon, authenticated;

-- INV-16: whatever route booked the call, the encounter records the length planned and the config version in force.
create function private.encounters_stamp_call_length()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  a public.appointments;
  o public.followup_offers;
  prev public.encounters;
begin
  if new.appointment_id is null then return new; end if;
  select * into a from public.appointments where id = new.appointment_id;
  if a.id is null then return new; end if;
  new.planned_minutes := (extract(epoch from (a.ends_at - a.scheduled_for)) / 60)::integer;
  new.call_length_config_version := private.followup_setting_version('call_length');
  select * into o from public.followup_offers where appointment_id = a.id order by created_at desc limit 1;
  if o.id is not null then
    new.call_length_basis := o.call_basis;
    new.longer_requested := o.longer_requested;
  else
    select * into prev from public.encounters e where e.appointment_id = a.rescheduled_from_id;
    new.call_length_basis := coalesce(prev.call_length_basis, 'standard');
    new.longer_requested := coalesce(prev.longer_requested, false);
  end if;
  return new;
end;
$$;
revoke all on function private.encounters_stamp_call_length() from public, anon, authenticated;
create trigger encounters_stamp_call_length
  before insert on public.encounters
  for each row execute function private.encounters_stamp_call_length();

-- ---------------------------------------------------------------------------
-- 3. The doctor extends a call; the Member asks for a longer one
-- ---------------------------------------------------------------------------
create function public.extend_encounter_call(p_encounter uuid, p_extra_minutes integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e public.encounters;
  cfg jsonb := private.followup_setting('call_length');
  v_max integer := coalesce((cfg ->> 'maxExtensionMinutes')::integer, 15);
  v_conflict boolean := false;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into e from public.encounters where id = p_encounter for update;
  if e.id is null or e.clinician_id is distinct from v_uid
     or not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active) then
    raise exception 'consultation not found' using errcode = '42501';
  end if;
  if e.status not in ('scheduled', 'waiting', 'in_progress') then
    raise exception 'this consultation is %', e.status using errcode = 'P0001';
  end if;
  if p_extra_minutes is null or p_extra_minutes < 5 or p_extra_minutes > v_max or e.extended_minutes + p_extra_minutes > v_max then
    raise exception 'a call can be extended by at most % minutes in total', v_max using errcode = 'P0001';
  end if;
  update public.encounters set extended_minutes = extended_minutes + p_extra_minutes where id = e.id returning * into e;
  -- keep the calendar honest where the doctor's next booking allows it; the call is never cut off either way
  begin
    update public.appointments set ends_at = ends_at + (p_extra_minutes * interval '1 minute') where id = e.appointment_id;
  exception when exclusion_violation then
    v_conflict := true;
  end;
  perform private.log_encounter_event(e.id, 'call_extended', v_uid, 'clinician',
    jsonb_build_object('extra_minutes', p_extra_minutes, 'total_extended', e.extended_minutes, 'calendar_conflict', v_conflict));
  return jsonb_build_object('planned_minutes', e.planned_minutes, 'extended_minutes', e.extended_minutes, 'calendar_conflict', v_conflict);
end;
$$;
revoke all on function public.extend_encounter_call(uuid, integer) from public, anon;
grant execute on function public.extend_encounter_call(uuid, integer) to authenticated;

create function public.request_longer_call(p_encounter uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e public.encounters;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into e from public.encounters where id = p_encounter for update;
  if e.id is null or not (e.patient_id = v_uid or private.can_act_for(e.patient_id, 'book_appointments'::public.caregiver_permission)) then
    raise exception 'consultation not found' using errcode = '42501';
  end if;
  if e.status not in ('scheduled', 'waiting') then
    raise exception 'this consultation is %', e.status using errcode = 'P0001';
  end if;
  update public.encounters set longer_requested = true where id = e.id;
  update public.followup_offers set longer_requested = true where appointment_id = e.appointment_id;
  perform private.log_encounter_event(e.id, 'longer_call_requested', v_uid,
    case when e.patient_id = v_uid then 'patient' else 'system' end, '{}'::jsonb);
  return jsonb_build_object('longer_requested', true);
end;
$$;
revoke all on function public.request_longer_call(uuid) from public, anon;
grant execute on function public.request_longer_call(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The pre-call summary. It WRAPS the audited clinician_patient_summary (INV-10, INV-12): the tie is the upcoming consultation
--    or the lead role, exactly as there. The extras below are read only when that summary was not denied and the same section was
--    not denied there, and one more audit row names them.
-- ---------------------------------------------------------------------------
create function public.precall_summary(p_encounter uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e public.encounters;
  v_summary jsonb;
  v_denied jsonb;
  v_since timestamptz;
  v_last timestamptz;
  v_trend jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_started jsonb := '[]'::jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_tasks jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into e from public.encounters where id = p_encounter;
  if e.id is null or e.clinician_id is distinct from v_uid
     or not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if e.status not in ('scheduled', 'waiting', 'in_progress') then
    raise exception 'this consultation is %', e.status using errcode = 'P0001';
  end if;

  v_summary := public.clinician_patient_summary(e.patient_id, 'Pre-call summary for a scheduled follow-up call');
  if v_summary ->> 'status' = 'denied' then
    return jsonb_build_object('status', 'denied');
  end if;
  v_denied := coalesce(v_summary -> 'denied', '[]'::jsonb);

  select max(x.ended_at) into v_last from public.encounters x
   where x.patient_id = e.patient_id and x.status = 'completed' and x.id <> e.id and x.ended_at < coalesce(e.scheduled_at, now());
  v_since := coalesce(v_last, now() - interval '30 days');

  if not (v_denied ? 'readings') then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.type), '[]'::jsonb) into v_trend from (
      select o.type,
             count(*) as readings,
             min(o.measured_at) as first_at,
             max(o.measured_at) as last_at,
             (array_agg(coalesce(o.systolic::numeric, o.value_numeric) order by o.measured_at asc))[1] as first_value,
             (array_agg(coalesce(o.systolic::numeric, o.value_numeric) order by o.measured_at desc))[1] as last_value,
             round(avg(coalesce(o.systolic::numeric, o.value_numeric)), 1) as average,
             round(avg(o.diastolic::numeric), 1) as average_diastolic
        from public.observations o
       where o.patient_id = e.patient_id and o.measured_at >= v_since and o.measured_at >= now() - interval '60 days'
       group by o.type) t;
  end if;
  if not (v_denied ? 'results') then
    select coalesce(jsonb_agg(r), '[]'::jsonb) into v_results
      from jsonb_array_elements(coalesce(v_summary -> 'results', '[]'::jsonb)) r
     where (r ->> 'received_at')::timestamptz > v_since;
  end if;
  if not (v_denied ? 'medications') then
    select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc), '[]'::jsonb) into v_started from (
      select drug_name, dose, frequency, is_active, created_at
        from public.medications where patient_id = e.patient_id and created_at > v_since order by created_at desc limit 20) m;
    select coalesce(jsonb_agg(to_jsonb(c) order by c.applied_at desc), '[]'::jsonb) into v_changes from (
      select kind, proposed_by, state, applied_at
        from public.care_plan_changes
       where patient_id = e.patient_id and state = 'confirmed' and applied_at > v_since order by applied_at desc limit 20) c;
  end if;
  select coalesce(jsonb_agg(to_jsonb(k) order by k.due_at), '[]'::jsonb) into v_tasks from (
    select type, state, due_at, priority_class from public.clinical_tasks
     where patient_id = e.patient_id and state in ('offered_to_lead', 'open', 'claimed', 'escalated') order by due_at limit 20) k;

  perform private.s35_audit_read(e.patient_id, array['precall_extras'], 'Pre-call summary for a scheduled follow-up call', 'success');

  return jsonb_build_object(
    'status', v_summary ->> 'status',
    'encounter', jsonb_build_object('id', e.id, 'scheduled_at', e.scheduled_at, 'planned_minutes', e.planned_minutes,
                                    'extended_minutes', e.extended_minutes, 'longer_requested', e.longer_requested),
    'since_last_call', v_last,
    'since', v_since,
    'summary', v_summary,
    'vitals_trend', v_trend,
    'results_since', v_results,
    'medicines_started_since', v_started,
    'medicine_changes_since', v_changes,
    'open_tasks', v_tasks);
end;
$$;
revoke all on function public.precall_summary(uuid) from public, anon;
grant execute on function public.precall_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Worklist: Members whose month needs a follow-up offered, or whose month passed without one
-- ---------------------------------------------------------------------------
create function public.followups_due_worklist()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_rows jsonb := '[]'::jsonb;
  r record;
begin
  if v_uid is null or not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  for r in
    select x.patient_id, split_part(pr.full_name, ' ', 1) as first_name, x.kind, x.entitlement_id, x.month_index, x.period_end
      from (
        -- this month is still open, nothing is booked and no offer is waiting
        select e.patient_id, 'due'::text as kind, e.id as entitlement_id, e.month_index, e.period_end
          from public.member_followup_entitlements e
         where e.state = 'available' and e.period_start <= now() and e.period_end > now()
           and not exists (select 1 from public.followup_offers o where o.entitlement_id = e.id and o.status = 'open')
        union all
        -- a month passed with none booked, and the Member has not caught up since
        select e.patient_id, 'missed'::text, e.id, e.month_index, e.period_end
          from public.member_followup_entitlements e
         where e.state = 'lapsed' and e.lapsed_at > now() - interval '35 days'
           and not exists (select 1 from public.member_followup_entitlements n
                            where n.patient_id = e.patient_id and n.period_start >= e.period_end and n.state in ('booked', 'consumed'))
      ) x
      join public.profiles pr on pr.id = x.patient_id
     where exists (select 1 from public.lead_assignments la where la.patient_id = x.patient_id and la.clinician_id = v_uid and la.state = 'active')
        or exists (select 1 from public.care_team_assignment cta
                    where cta.patient_id = x.patient_id and v_uid in (cta.clinician_id, cta.care_coordinator_id))
     order by (x.kind = 'missed') desc, x.period_end
     limit 200
  loop
    -- one audit row per patient per day, as the lead list does
    if not exists (select 1 from public.audit_log al
                    where al.actor_id = v_uid and al.subject_patient_id = r.patient_id and al.action = 'staff.chart_read'
                      and al.event -> 'sections' ? 'followup_worklist' and al.created_at > now() - interval '24 hours') then
      perform private.s35_audit_read(r.patient_id, array['followup_worklist'], 'Viewing the monthly follow-up worklist', 'success');
    end if;
    v_rows := v_rows || jsonb_build_object('patient_id', r.patient_id, 'first_name', r.first_name, 'kind', r.kind,
                                           'entitlement_id', r.entitlement_id, 'month_index', r.month_index, 'period_end', r.period_end);
  end loop;
  return v_rows;
end;
$$;
revoke all on function public.followups_due_worklist() from public, anon;
grant execute on function public.followups_due_worklist() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The sweep: expire offers, lapse and nudge months that passed, never lose a row to one bad row
-- ---------------------------------------------------------------------------
create function private.sweep_followups()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_expired integer := 0;
  v_lapsed integer := 0;
  v_errors integer := 0;
begin
  for r in select id from public.followup_offers where status = 'open' and expires_at <= now() loop
    begin
      update public.followup_offers set status = 'expired', closed_at = now(), closed_reason = 'expired' where id = r.id and status = 'open';
      update public.followup_offer_slots set state = 'expired' where offer_id = r.id and state = 'offered';
      v_expired := v_expired + 1;
    exception when others then
      v_errors := v_errors + 1;
    end;
  end loop;

  for r in
    select e.id, e.patient_id, e.organisation_id, e.month_index
      from public.member_followup_entitlements e
     where e.state = 'available' and e.period_end <= now()
     order by e.period_end limit 500
  loop
    begin
      update public.member_followup_entitlements set state = 'lapsed', lapsed_at = now(), nudged_at = now(), updated_at = now()
       where id = r.id and state = 'available';
      -- the Member is reminded, never by SMS: email if they prefer it, else push if subscribed, else the in-app inbox
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
      values (r.organisation_id, r.patient_id, private.patient_reminder_channel(r.patient_id), 'pending', 'followup_month_missed',
              jsonb_build_object('entitlement_id', r.id, 'month_index', r.month_index), 'non_clinical');
      v_lapsed := v_lapsed + 1;
    exception when others then
      v_errors := v_errors + 1;
    end;
  end loop;
  return jsonb_build_object('offers_expired', v_expired, 'months_lapsed', v_lapsed, 'errors', v_errors);
end;
$$;
revoke all on function private.sweep_followups() from public, anon, authenticated;

do $cron$
begin
  perform cron.schedule('followup-sweep', '*/15 * * * *', $c$select private.sweep_followups()$c$);
end
$cron$;
