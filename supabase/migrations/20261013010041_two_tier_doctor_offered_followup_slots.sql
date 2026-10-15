-- Two-tier model, item 3 (decision D4): the doctor publishes several date-times, the Member picks one.
--
-- Nothing here rewrites hold_appointment_slot, confirm_appointment_booking or cancel_appointment (their live definitions were read
-- with pg_get_functiondef on 2026-10-12). The pick calls them, as the Member, inside one transaction, so the 10 minute hold, the
-- Africa/Lagos grid, the age gate, the go-live guard, the no-overlap constraint, the encounter and room, and the cancel and credit
-- policy are exactly the live ones. The only difference: the booking is covered by the Member's monthly entitlement, so its
-- payment_status is set to 'waived' between hold and confirm and no paid consultation credit is spent.
--
-- Rules enforced here:
--   * the clinician is an active doctor (not a care coordinator) and has a care tie to the Member (lead, or the care team doctor)
--   * the Member is a Member (private.patient_is_member) with an available entitlement for the month the times fall in; an offer
--     to a non-Member is refused
--   * every offered time passes private.slot_is_open (confirmed bookable block, grid, licence, leave, conflicts, test or real, lead
--     time) and does not overlap any of the doctor's live appointments, so an offer cannot sit on leave or on another booking
--   * 2 to 6 times (config), valid 72 hours at most and never past the last time; one open offer per Member
--   * picking one releases the others; a time the doctor has since lost to someone else is marked taken, not left to fail at the Member
--   * the length comes from private.call_length_for (decision C8); the doctor may shorten a routine call to 10, never a longer one
--   * every staff read of a Member's first name is audited once a day per patient (INV-10)

create function private.followup_audit_once(p_patient uuid, p_section text, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.audit_log al
                  where al.actor_id = (select auth.uid()) and al.subject_patient_id = p_patient and al.action = 'staff.chart_read'
                    and al.event -> 'sections' ? p_section and al.created_at > now() - interval '24 hours') then
    perform private.s35_audit_read(p_patient, array[p_section], p_reason, 'success');
  end if;
end;
$$;
revoke all on function private.followup_audit_once(uuid, text, text) from public, anon, authenticated;

create function private.followup_slot_clash(p_clinician uuid, p_start timestamptz, p_end timestamptz)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.appointments a
     where a.clinician_id = p_clinician
       and a.status in ('held', 'booked', 'confirmed', 'checked_in', 'in_progress')
       and not (a.status = 'held' and a.hold_expires_at < now())
       and tstzrange(a.scheduled_for, a.ends_at, '[)') && tstzrange(p_start, p_end, '[)'));
$$;
revoke all on function private.followup_slot_clash(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Create an offer (one Member). Raises with a plain message on any refusal.
-- ---------------------------------------------------------------------------
create function private.create_followup_offer(p_clinician uuid, p_patient uuid, p_starts timestamptz[], p_kind text, p_minutes integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  cfg jsonb := private.followup_setting('offers');
  clcfg jsonb := private.followup_setting('call_length');
  c jsonb := private.consult_policy();
  v_org uuid;
  v_patient_org uuid;
  v_rule jsonb;
  v_minutes integer;
  v_basis text;
  v_min_slots integer := coalesce((cfg ->> 'minSlots')::integer, 2);
  v_max_slots integer := coalesce((cfg ->> 'maxSlots')::integer, 6);
  v_lead integer := coalesce((cfg ->> 'minLeadMinutes')::integer, 120);
  v_valid integer := coalesce((cfg ->> 'offerValidHours')::integer, 72);
  v_starts timestamptz[];
  s timestamptz;
  v_membership uuid;
  v_ent public.member_followup_entitlements;
  v_first timestamptz;
  v_last timestamptz;
  v_offer uuid;
  v_test boolean;
begin
  if cfg is null or c is null then raise exception 'follow-up offers are not set up' using errcode = 'P0001'; end if;
  if p_kind not in ('monthly', 'yearly_results') then raise exception 'unknown kind of follow-up' using errcode = '22023'; end if;

  select pr.organisation_id into v_org from public.profiles pr where pr.id = p_clinician;
  select pr.organisation_id, coalesce(pr.is_test, false) into v_patient_org, v_test
    from public.profiles pr where pr.id = p_patient and pr.role = 'patient';
  if v_patient_org is null or v_patient_org is distinct from v_org then
    raise exception 'that person is not one of your patients' using errcode = 'P0001';
  end if;
  -- a care tie: the lead clinician, or the doctor on the care team (INV-12)
  if not (exists (select 1 from public.lead_assignments la where la.patient_id = p_patient and la.clinician_id = p_clinician and la.state = 'active')
          or exists (select 1 from public.care_team_assignment cta where cta.patient_id = p_patient and cta.clinician_id = p_clinician)) then
    raise exception 'that person is not one of your patients' using errcode = 'P0001';
  end if;
  if not private.patient_is_member(p_patient) then
    raise exception 'monthly check-ins are part of Membership, and this person is not a Member' using errcode = 'P0001';
  end if;
  perform private.assert_adult_for_consultation(p_patient);
  if not private.go_live_open('clinical_operations_enabled', p_patient, p_clinician) then
    raise exception 'consultations are not open yet' using errcode = 'P0001';
  end if;

  -- distinct, sorted times, within the count the policy allows
  select coalesce(array_agg(distinct x order by x), '{}') into v_starts from unnest(p_starts) x;
  if cardinality(v_starts) < v_min_slots or cardinality(v_starts) > v_max_slots then
    raise exception 'offer between % and % different times', v_min_slots, v_max_slots using errcode = 'P0001';
  end if;

  -- the call length (decision C8)
  v_rule := private.call_length_for(p_patient, p_kind);
  if v_rule is null then
    v_minutes := (c ->> 'sessionMinutes')::integer;
    v_basis := case when p_kind = 'yearly_results' then 'yearly_results' else 'standard' end;
  else
    v_minutes := (v_rule ->> 'minutes')::integer;
    v_basis := v_rule ->> 'basis';
    if p_minutes is not null then
      if v_basis = 'standard' and p_minutes between coalesce((clcfg ->> 'routineMinMinutes')::integer, v_minutes) and v_minutes then
        v_minutes := p_minutes;
      elsif p_minutes <> v_minutes then
        raise exception 'this call is % minutes and cannot be shortened', v_minutes using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- the month the times fall in, and the Member's entitlement for it
  select m.id into v_membership from public.patient_memberships m
   where m.patient_id = p_patient and m.state = 'active' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())
   order by m.starts_at desc limit 1;
  if v_membership is null then
    raise exception 'this person has no active Membership month to use' using errcode = 'P0001';
  end if;
  perform private.ensure_followup_entitlements(v_membership);
  v_first := v_starts[1];
  v_last := v_starts[cardinality(v_starts)];
  select * into v_ent from public.member_followup_entitlements e
   where e.membership_id = v_membership and e.period_start <= v_first and e.period_end > v_first for update;
  if v_ent.id is null or v_ent.period_end <= v_last then
    raise exception 'all the times must fall inside one Membership month' using errcode = 'P0001';
  end if;
  if v_ent.state <> 'available' then
    raise exception 'this Member''s check-in for that month is already %', case v_ent.state when 'booked' then 'booked' when 'consumed' then 'done' else 'closed' end
      using errcode = 'P0001';
  end if;

  -- one open offer at a time
  update public.followup_offers set status = 'expired', closed_at = now(), closed_reason = 'expired'
   where patient_id = p_patient and status = 'open' and expires_at <= now();
  update public.followup_offer_slots set state = 'expired'
   where patient_id = p_patient and state = 'offered' and offer_id in (select id from public.followup_offers where patient_id = p_patient and status = 'expired');
  if exists (select 1 from public.followup_offers where patient_id = p_patient and status = 'open') then
    raise exception 'there is already an open offer for this person: withdraw it first' using errcode = 'P0001';
  end if;

  -- every time is real: lead time, open block, no leave, no other booking
  foreach s in array v_starts loop
    if s < now() + (v_lead * interval '1 minute') then
      raise exception '% is too soon: offer times at least % minutes ahead', to_char(s at time zone 'Africa/Lagos', 'DD Mon HH24:MI'), v_lead using errcode = 'P0001';
    end if;
    if not private.slot_is_open(p_clinician, p_patient, s, s + (v_minutes * interval '1 minute')) then
      raise exception '% is not inside your confirmed bookable hours (or is on leave, off the grid, or too far ahead)',
        to_char(s at time zone 'Africa/Lagos', 'DD Mon HH24:MI') using errcode = 'P0001';
    end if;
    if private.followup_slot_clash(p_clinician, s, s + (v_minutes * interval '1 minute')) then
      raise exception '% overlaps another booking of yours', to_char(s at time zone 'Africa/Lagos', 'DD Mon HH24:MI') using errcode = 'P0001';
    end if;
  end loop;

  insert into public.followup_offers
    (organisation_id, patient_id, clinician_id, entitlement_id, kind, call_minutes, call_basis, call_config_version,
     followups_config_version, expires_at, created_by, is_test)
  values
    (v_org, p_patient, p_clinician, v_ent.id, p_kind, v_minutes, v_basis, coalesce(private.followup_setting_version('call_length'), 0),
     coalesce(private.followup_setting_version('offers'), 0),
     least(now() + (v_valid * interval '1 hour'), v_last - interval '30 minutes'), p_clinician, v_test)
  returning id into v_offer;
  insert into public.followup_offer_slots (offer_id, organisation_id, patient_id, clinician_id, starts_at, ends_at)
  select v_offer, v_org, p_patient, p_clinician, x, x + (v_minutes * interval '1 minute') from unnest(v_starts) x;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (v_org, p_patient, private.patient_reminder_channel(p_patient, false), 'pending', 'followup_times_offered',
          jsonb_build_object('offer_id', v_offer), 'non_clinical');

  return jsonb_build_object('status', 'offered', 'offer_id', v_offer, 'minutes', v_minutes, 'slots', cardinality(v_starts));
end;
$$;
revoke all on function private.create_followup_offer(uuid, uuid, timestamptz[], text, integer) from public, anon, authenticated;

create function private.require_offering_doctor()
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  -- a doctor offers the times; a care coordinator does not (logistics only), and nobody without a clinical staff row does
  if not exists (select 1 from public.clinical_staff cs
                  where cs.profile_id = v_uid and cs.active and cs.doctor_tier <> 'care_coordinator') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;
revoke all on function private.require_offering_doctor() from public, anon, authenticated;

create function public.offer_followup_slots(p_patient uuid, p_starts timestamptz[], p_kind text default 'monthly', p_minutes integer default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.require_offering_doctor();
begin
  return private.create_followup_offer(v_uid, p_patient, p_starts, p_kind, p_minutes);
end;
$$;
revoke all on function public.offer_followup_slots(uuid, timestamptz[], text, integer) from public, anon;
grant execute on function public.offer_followup_slots(uuid, timestamptz[], text, integer) to authenticated;

-- Bulk: the same times to several of the doctor's own patients. Each patient is isolated, so one refusal never blocks the rest.
-- The first Member to pick a time takes it; the same time then disappears from the others' lists (marked taken).
create function public.offer_followup_slots_bulk(p_patients uuid[], p_starts timestamptz[], p_kind text default 'monthly')
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_offering_doctor();
  cfg jsonb := private.followup_setting('offers');
  v_max integer := coalesce((cfg ->> 'bulkMaxPatients')::integer, 50);
  v_patients uuid[];
  p uuid;
  v_out jsonb := '[]'::jsonb;
  v_res jsonb;
  v_msg text;
  v_state text;
  v_offered integer := 0;
begin
  select coalesce(array_agg(distinct x), '{}') into v_patients from unnest(p_patients) x;
  if cardinality(v_patients) = 0 or cardinality(v_patients) > v_max then
    raise exception 'choose between 1 and % people', v_max using errcode = 'P0001';
  end if;
  foreach p in array v_patients loop
    begin
      v_res := private.create_followup_offer(v_uid, p, p_starts, p_kind, null);
      v_out := v_out || jsonb_build_object('patient_id', p, 'status', 'offered', 'offer_id', v_res -> 'offer_id');
      v_offered := v_offered + 1;
    exception when others then
      get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
      v_out := v_out || jsonb_build_object('patient_id', p, 'status', 'refused',
                 'reason', case when v_state in ('P0001', '22023') then v_msg else 'could not be offered' end);
    end;
  end loop;
  return jsonb_build_object('offered', v_offered, 'results', v_out,
                            'fewer_times_than_people', cardinality(p_starts) < v_offered);
end;
$$;
revoke all on function public.offer_followup_slots_bulk(uuid[], timestamptz[], text) from public, anon;
grant execute on function public.offer_followup_slots_bulk(uuid[], timestamptz[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Withdraw
-- ---------------------------------------------------------------------------
create function public.withdraw_followup_offer(p_offer uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_offering_doctor();
  o public.followup_offers;
begin
  select * into o from public.followup_offers where id = p_offer for update;
  if o.id is null or o.clinician_id is distinct from v_uid then
    raise exception 'offer not found' using errcode = '42501';
  end if;
  if o.status <> 'open' then
    return jsonb_build_object('status', o.status);
  end if;
  update public.followup_offers set status = 'withdrawn', closed_at = now(), closed_reason = 'withdrawn' where id = o.id;
  update public.followup_offer_slots set state = 'withdrawn' where offer_id = o.id and state = 'offered';
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (o.organisation_id, o.patient_id, 'in_app', 'pending', 'followup_offer_withdrawn', jsonb_build_object('offer_id', o.id), 'non_clinical');
  return jsonb_build_object('status', 'withdrawn');
end;
$$;
revoke all on function public.withdraw_followup_offer(uuid) from public, anon;
grant execute on function public.withdraw_followup_offer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The Member's view: their months and the times on offer right now
-- ---------------------------------------------------------------------------
create function public.my_followups(p_patient uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_subject uuid;
  v_ent jsonb;
  v_offers jsonb;
begin
  if v_uid is null then return jsonb_build_object('entitlement', null, 'offers', '[]'::jsonb); end if;
  v_subject := coalesce(p_patient, v_uid);
  if v_subject <> v_uid and not private.can_act_for(v_subject, 'book_appointments'::public.caregiver_permission) then
    return jsonb_build_object('entitlement', null, 'offers', '[]'::jsonb);
  end if;

  select jsonb_build_object(
           'current', (select jsonb_build_object('month_index', e.month_index, 'state', e.state, 'period_end', e.period_end,
                                                   'appointment_id', e.appointment_id,
                                                   'encounter_id', (select en.id from public.encounters en where en.appointment_id = e.appointment_id))
                         from public.member_followup_entitlements e
                        where e.patient_id = v_subject and e.period_start <= now() and e.period_end > now() and e.state <> 'voided'
                        order by e.period_start desc limit 1),
           'consumed', (select count(*) from public.member_followup_entitlements e where e.patient_id = v_subject and e.state = 'consumed'),
           'lapsed', (select count(*) from public.member_followup_entitlements e where e.patient_id = v_subject and e.state = 'lapsed'),
           'remaining', (select count(*) from public.member_followup_entitlements e
                          where e.patient_id = v_subject and e.state in ('available', 'booked') and e.period_end > now()))
    into v_ent;

  select coalesce(jsonb_agg(jsonb_build_object(
           'offer_id', o.id, 'expires_at', o.expires_at, 'call_minutes', o.call_minutes, 'kind', o.kind,
           'longer_requested', o.longer_requested,
           'slots', (select coalesce(jsonb_agg(jsonb_build_object('slot_id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at) order by s.starts_at), '[]'::jsonb)
                       from public.followup_offer_slots s
                      where s.offer_id = o.id and s.state = 'offered'
                        and s.starts_at > now()
                        and private.slot_is_open(s.clinician_id, s.patient_id, s.starts_at, s.ends_at)
                        and not private.followup_slot_clash(s.clinician_id, s.starts_at, s.ends_at))
         ) order by o.created_at), '[]'::jsonb)
    into v_offers
    from public.followup_offers o
   where o.patient_id = v_subject and o.status = 'open' and o.expires_at > now();

  return jsonb_build_object('entitlement', v_ent, 'offers', v_offers);
end;
$$;
revoke all on function public.my_followups(uuid) from public, anon;
grant execute on function public.my_followups(uuid) to authenticated;

-- The doctor's own offers (open, and closed in the last 14 days), with the Member's first name (audited once a day per Member)
create function public.my_followup_offers_sent()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_offering_doctor();
  r record;
  v_rows jsonb := '[]'::jsonb;
begin
  for r in
    select o.id, o.patient_id, split_part(pr.full_name, ' ', 1) as first_name, o.status, o.kind, o.call_minutes, o.expires_at,
           o.longer_requested, o.created_at, o.closed_reason, o.appointment_id,
           (select a.scheduled_for from public.appointments a where a.id = o.appointment_id) as booked_for,
           (select coalesce(jsonb_agg(jsonb_build_object('starts_at', s.starts_at, 'state', s.state) order by s.starts_at), '[]'::jsonb)
              from public.followup_offer_slots s where s.offer_id = o.id) as slots
      from public.followup_offers o join public.profiles pr on pr.id = o.patient_id
     where o.clinician_id = v_uid and (o.status = 'open' or o.closed_at > now() - interval '14 days')
     order by (o.status = 'open') desc, o.created_at desc
     limit 200
  loop
    perform private.followup_audit_once(r.patient_id, 'followup_offers', 'Viewing the monthly check-in offers I sent');
    v_rows := v_rows || jsonb_build_object('offer_id', r.id, 'patient_id', r.patient_id, 'first_name', r.first_name, 'status', r.status,
                                           'kind', r.kind, 'call_minutes', r.call_minutes, 'expires_at', r.expires_at,
                                           'longer_requested', r.longer_requested, 'closed_reason', r.closed_reason,
                                           'booked_for', r.booked_for, 'slots', r.slots);
  end loop;
  return v_rows;
end;
$$;
revoke all on function public.my_followup_offers_sent() from public, anon;
grant execute on function public.my_followup_offers_sent() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The Member picks a time
-- ---------------------------------------------------------------------------
create function public.pick_followup_slot(p_slot uuid, p_ask_longer boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  sl public.followup_offer_slots;
  o public.followup_offers;
  en public.member_followup_entitlements;
  cfg jsonb := private.followup_setting('offers');
  v_appt public.appointments;
  v_msg text;
  v_state text;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into sl from public.followup_offer_slots where id = p_slot;
  if sl.id is null then raise exception 'time not found' using errcode = '42501'; end if;
  select * into o from public.followup_offers where id = sl.offer_id for update;
  if not (o.patient_id = v_uid or private.can_act_for(o.patient_id, 'book_appointments'::public.caregiver_permission)) then
    raise exception 'time not found' using errcode = '42501';
  end if;
  -- re-read the slot under the offer lock
  select * into sl from public.followup_offer_slots where id = p_slot for update;

  if o.status = 'open' and o.expires_at <= now() then
    update public.followup_offers set status = 'expired', closed_at = now(), closed_reason = 'expired' where id = o.id;
    update public.followup_offer_slots set state = 'expired' where offer_id = o.id and state = 'offered';
    return jsonb_build_object('status', 'expired');
  end if;
  if o.status <> 'open' then return jsonb_build_object('status', o.status); end if;
  if sl.state <> 'offered' then return jsonb_build_object('status', 'unavailable'); end if;
  if not private.patient_is_member(o.patient_id) then
    raise exception 'monthly check-ins are part of Membership' using errcode = 'P0001';
  end if;
  select * into en from public.member_followup_entitlements where id = o.entitlement_id for update;
  if en.state <> 'available' then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- the live hold: 10 minutes, the grid, the age gate, the go-live guard and the no-overlap constraint all apply
  begin
    v_appt := public.hold_appointment_slot(
      o.organisation_id, o.clinician_id, 'telemedicine'::public.appointment_type, 'telemedicine'::public.appointment_consultation_method,
      sl.starts_at, sl.ends_at, 'Monthly check-in', null, null, null, null, o.patient_id,
      coalesce((cfg ->> 'holdMinutes')::integer, 10));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
    if v_msg like '%just taken%' or v_msg like '%not open for consultations%' or v_msg like '%has passed%' then
      update public.followup_offer_slots set state = 'taken' where id = sl.id;
      return jsonb_build_object('status', 'unavailable');
    end if;
    raise;
  end;

  update public.followup_offers
     set status = 'picked', picked_slot_id = sl.id, appointment_id = v_appt.id, closed_at = now(), closed_reason = 'picked',
         longer_requested = longer_requested or coalesce(p_ask_longer, false)
   where id = o.id;
  update public.followup_offer_slots set state = 'picked' where id = sl.id;
  update public.followup_offer_slots set state = 'released' where offer_id = o.id and id <> sl.id and state = 'offered';
  -- covered by the monthly entitlement: no paid consultation credit is spent
  update public.appointments set payment_status = 'waived' where id = v_appt.id;
  -- confirm (the live function): creates the encounter and room, stamps the call length (trigger), queues the booking confirmation
  v_appt := public.confirm_appointment_booking(v_appt.id);
  update public.member_followup_entitlements set state = 'booked', appointment_id = v_appt.id, updated_at = now() where id = en.id;

  -- the doctor's other offers that held this same time no longer have it
  update public.followup_offer_slots s set state = 'taken'
   where s.clinician_id = o.clinician_id and s.state = 'offered' and s.offer_id <> o.id
     and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(sl.starts_at, sl.ends_at, '[)');
  update public.followup_offers x set status = 'expired', closed_at = now(), closed_reason = 'times_taken'
   where x.clinician_id = o.clinician_id and x.status = 'open'
     and not exists (select 1 from public.followup_offer_slots s2 where s2.offer_id = x.id and s2.state = 'offered');

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (o.organisation_id, o.clinician_id, 'in_app', 'pending', 'followup_slot_picked', jsonb_build_object('offer_id', o.id), 'non_clinical');

  return jsonb_build_object('status', 'booked', 'appointment_id', v_appt.id, 'starts_at', v_appt.scheduled_for, 'ends_at', v_appt.ends_at,
                            'minutes', o.call_minutes,
                            'encounter_id', (select e.id from public.encounters e where e.appointment_id = v_appt.id));
end;
$$;
revoke all on function public.pick_followup_slot(uuid, boolean) from public, anon;
grant execute on function public.pick_followup_slot(uuid, boolean) to authenticated;
