-- Two-tier decisions, 2026-10-12, item 3: a Member in the 14 day GRACE can book their follow-up.
--
-- POLICY (documented so nobody has to guess):
--   * A Membership year has 12 monthly follow-up entitlements (months 1 to 12). The last month ends exactly at ends_at, so no month
--     straddles it; therefore a Member whose year ended naturally and who is inside the grace gets EXACTLY ONE extra entitlement,
--     month_index 13, covering [ends_at, ends_at + grace). It is created on demand (ensure_followup_entitlements, called by the offer
--     function) and is consumed, cancelled and lapsed by the same triggers as any other month. Nobody can stockpile: one row, one call.
--   * offer_followup_slots (private.create_followup_offer) now finds the membership through the grace, so it offers inside month 13;
--     pick_followup_slot already asked private.patient_is_member (grace included) and reads the entitlement by id.
--   * A lapsed person (grace over) and a person whose Membership was ended by a refund (state 'ended') are refused as before.
--   * The membership-change trigger no longer voids month 13 (it only ever managed months 1 to 12).
-- ROLLBACK: restore the 20261013005824 / 20261013010041 bodies of the three functions; delete from member_followup_entitlements
--   where month_index = 13.

create or replace function private.ensure_followup_entitlements(p_membership uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  m public.patient_memberships;
  cfg jsonb := private.followup_setting('offers');
  v_months integer := coalesce((cfg ->> 'entitlementMonths')::integer, 12);
  v_ver integer := coalesce(private.followup_setting_version('offers'), 1);
  v_grace integer := private.membership_grace_days();
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
  -- the one grace follow-up: only while the year has ended and the grace has not
  if m.ends_at is not null and m.ends_at <= now() and m.ends_at + make_interval(days => v_grace) > now() then
    insert into public.member_followup_entitlements
      (organisation_id, patient_id, membership_id, month_index, period_start, period_end, state, config_version, is_test)
    values (m.organisation_id, m.patient_id, m.id, 13, m.ends_at, m.ends_at + make_interval(days => v_grace), 'available', v_ver, v_test)
    on conflict (membership_id, month_index) do nothing;
    get diagnostics v_rows = row_count;
    v_made := v_made + v_rows;
  end if;
  return v_made;
end;
$$;

create or replace function private.after_membership_change_followups()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.state = 'active' then
    perform private.ensure_followup_entitlements(new.id);
    if new.ends_at is not null then
      -- a shortened membership: months that would start after the end are void, and the last one is cut at the end
      update public.member_followup_entitlements set state = 'voided', updated_at = now()
       where membership_id = new.id and state = 'available' and month_index <= 12 and period_start >= new.ends_at;
      update public.member_followup_entitlements set period_end = new.ends_at, updated_at = now()
       where membership_id = new.id and month_index <= 12 and period_end > new.ends_at and period_start < new.ends_at;
    end if;
  else
    update public.member_followup_entitlements set state = 'voided', updated_at = now()
     where membership_id = new.id and state = 'available';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
create or replace function private.create_followup_offer(p_clinician uuid, p_patient uuid, p_starts timestamptz[], p_kind text, p_minutes integer)
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
   where m.patient_id = p_patient and m.state = 'active' and m.starts_at <= now()
     and (m.ends_at is null or m.ends_at + make_interval(days => private.membership_grace_days()) > now())
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
