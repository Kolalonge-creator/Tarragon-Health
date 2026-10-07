-- S28c: what the founder asked of S28 on top of the live collection-code migration (20261007120114_s28_pharmacy_collection_and_dispensing).
-- Founder decisions 2026-10-07: structured questions only (no chat); batch and expiry recorded and required, never "verified"; a caregiver with the
-- pharmacy permission can choose a pharmacy for the patient; a repeat supply is a new send; the prescriber sees the questions and where each
-- prescription has got to; the S37 go-live guard blocks the whole feature until a real, licensed pharmacy exists and the CMO has signed the rules.
-- INV-02 (an answer never changes a signed prescription), INV-07 (every notice neutral), INV-10 (every read audited), INV-13 (is_test carried).
-- Live counts at write time (2026-10-07): prescriptions 0, prescription_collection_codes 0, prescription_pharmacy_flags 0. No backfill.
-- Every function restated below was read from its definition in the S28 migration of the same day, then changed in the places marked S28c.
-- Replacing a function with a new signature drops the old one first, so a bare call never becomes ambiguous.

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------
-- Whose prescription is this call about? The caller, or someone the caller acts for with the pharmacy permission (profile_access manage plus
-- manage_pharmacy, unexpired). The explicit enum cast keeps the call unambiguous next to the one-argument can_act_for overload.
create function private.rx_patient(p_beneficiary uuid) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_beneficiary is null or p_beneficiary = v_uid then return v_uid; end if;
  if not private.can_act_for(p_beneficiary, 'manage_pharmacy'::public.caregiver_permission) then
    raise exception 'not_permitted_for_this_person' using errcode = '42501';
  end if;
  return p_beneficiary;
end $$;
revoke all on function private.rx_patient(uuid) from public, anon, authenticated;

-- How many further complete supplies the medicine permits right now: 1 plus clinician-approved repeats (never above 1 plus repeats allowed)
-- minus the complete, undisputed supplies a pharmacy has recorded. The same counting the counter uses.
create function private.supplies_remaining(p_prescription uuid) returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((
    select greatest(1 + least((select count(*) from public.medication_repeat_requests r where r.medication_id = m.id and r.status = 'approved')::integer,
                              coalesce(m.repeats_allowed, 0))
           - (select count(*) from public.pharmacy_order_dispenses d where d.medication_id = m.id and d.source = 'pharmacy' and d.disputed_at is null and not coalesce(d.is_partial, false))::integer, 0)
      from public.medications m where m.prescription_id = p_prescription and m.source = 'clinician' and m.is_active and m.superseded_at is null limit 1), 0)
$$;
revoke all on function private.supplies_remaining(uuid) from public, anon, authenticated;

-- The one switch: the S37 prescribing guard (INV-14). Fail closed. Withdrawing consent is never behind it.
create function private.pharmacy_collection_on() returns boolean language sql stable security definer set search_path = '' as $$
  select private.go_live_guard_on('prescribing_enabled')
$$;
revoke all on function private.pharmacy_collection_on() from public, anon, authenticated;

-- A pharmacy can be chosen only when it is active, approved, licence verified and unexpired, with an active verified location.
create function private.pharmacy_location_choosable(p_partner uuid, p_location uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pharmacy_partners pp join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id
     where pp.id = p_partner and l.id = p_location and pp.is_active and pp.approved_at is not null and pp.license_verified_at is not null
       and (pp.license_expires_at is null or pp.license_expires_at > now()) and l.is_active and l.verified_at is not null)
$$;
revoke all on function private.pharmacy_location_choosable(uuid, uuid) from public, anon, authenticated;

create function private.rx_notify(p_recipient uuid, p_org uuid, p_template text) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload) values (p_org, p_recipient, 'in_app', 'pending', p_template, '{}'::jsonb);
end $$;
revoke all on function private.rx_notify(uuid, uuid, text) from public, anon, authenticated;
create function private.rx_notify_pharmacy(p_partner uuid, p_template text) returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select pr.id, pr.organisation_id from public.profiles pr where pr.pharmacy_partner_id = p_partner and pr.role = 'pharmacist' and pr.is_active loop
    perform private.rx_notify(r.id, r.organisation_id, p_template);
  end loop;
end $$;
revoke all on function private.rx_notify_pharmacy(uuid, text) from public, anon, authenticated;

-- Two neutral in-app notices (INV-07: they name no medicine, person or code)
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('pharmacy_collection_update', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate', 'S28c: your pharmacy, or someone acting for you, has an update. Names nothing (INV-07).'),
  ('pharmacy_question_answered', 'operational', 'routine', 'partner_pharmacy', array['in_app']::public.notification_channel[], 'immediate', 'S28c: your question was answered. Names nothing (INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('pharmacy_collection_update', 'en', 'in_app', 'Your pharmacy has an update', 'Your pharmacy has an update. Open the app to see it.'),
  ('pharmacy_question_answered', 'en', 'in_app', 'Your question was answered', 'Your question was answered. Open the app to see it.')
on conflict (template_key, locale, channel) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The state machine: a repeat send and a withdrawal, through the patient's functions only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.enforce_prescription_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.recorded_by := v_uid;
      new.source := 'clinician';
    end if;
    if v_uid is not null and new.state <> 'draft' then
      raise exception 'a prescription is created as a draft and signed afterwards' using errcode = '23514';
    end if;
  else
    -- Forward-only state machine. cancelled is terminal.
    if new.state is distinct from old.state and not (
         (old.state = 'draft'  and new.state in ('signed', 'cancelled'))
      or (old.state = 'signed' and new.state in ('sent', 'cancelled'))
      or (old.state = 'sent'   and new.state in ('dispensed', 'cancelled'))
      -- S28c: the patient's own send functions (flag on, one statement) may take a collected prescription back to sent for a repeat supply (OQ-280),
      -- and a waiting one back to signed when she withdraws her consent. Nobody else can.
      or (coalesce(current_setting('tarragon.rx_route', true), '') = 'on'
          and ((old.state = 'dispensed' and new.state = 'sent') or (old.state = 'sent' and new.state = 'signed')))
    ) then
      raise exception 'invalid prescription state change % -> %', old.state, new.state using errcode = '23514';
    end if;
    -- Signed content is frozen: a change to a medicine or dose needs a new, newly signed prescription.
    if old.signed_at is not null and (
         new.items is distinct from old.items or new.patient_id is distinct from old.patient_id
      or new.encounter_note_id is distinct from old.encounter_note_id
      or new.signed_by is distinct from old.signed_by or new.signed_at is distinct from old.signed_at) then
      raise exception 'a signed prescription cannot be altered; issue a new one' using errcode = '42501';
    end if;
  end if;

  -- Signing: moving out of draft is the prescriber's act, stamped as herself. Anyone else leaves the columns null
  -- and the CHECK refuses the row.
  if new.state not in ('draft', 'cancelled') and (new.signed_by is null or new.signed_at is null) then
    if v_uid is not null and private.has_prescribing_authority(new.organisation_id) then
      new.signed_by := v_uid;
      new.signed_at := now();
    end if;
  end if;
  if new.signed_by is not null and v_uid is not null and new.signed_by <> v_uid
     and (tg_op = 'INSERT' or old.signed_by is distinct from new.signed_by) then
    raise exception 'a prescription can only be signed by the clinician acting' using errcode = '42501';
  end if;

  -- The named pharmacy may move a sent prescription to dispensed and nothing else: routing, pickup code and the other
  -- timestamps are the prescriber's.
  if tg_op = 'UPDATE' and v_uid is not null and not private.has_prescribing_authority(old.organisation_id) then
    -- S28: the patient's own choice of pharmacy is the one other door to routing; public.patient_choose_pharmacy sets this flag for its
    -- single statement. Everything else in this block stays the prescriber's.
    if (new.pharmacy_partner_id is distinct from old.pharmacy_partner_id or new.collection_code is distinct from old.collection_code
        or new.pharmacy_location_id is distinct from old.pharmacy_location_id or new.chosen_by_patient_at is distinct from old.chosen_by_patient_at
        or new.sent_at is distinct from old.sent_at)
       and coalesce(current_setting('tarragon.rx_route', true), '') <> 'on' then
      raise exception 'only the prescriber can change routing or pickup details' using errcode = '42501';
    end if;
    if new.cancelled_at is distinct from old.cancelled_at
       or new.recorded_by is distinct from old.recorded_by or new.source is distinct from old.source
       or (coalesce(current_setting('tarragon.rx_route', true), '') <> 'on' and new.dispensed_at is distinct from old.dispensed_at and old.dispensed_at is not null) then
      raise exception 'only the prescriber can change routing or pickup details' using errcode = '42501';
    end if;
  end if;
  if new.state = 'sent'      and new.sent_at      is null then new.sent_at      := now(); end if;
  if new.state = 'dispensed' and new.dispensed_at is null then new.dispensed_at := now(); end if;
  if new.state = 'cancelled' and new.cancelled_at is null then new.cancelled_at := now(); end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. The patient's functions, now for the patient or someone acting for her (p_beneficiary), behind the go-live guard,
--    and able to send a collected prescription again while a further supply is permitted
-- ---------------------------------------------------------------------------
drop function public.patient_collection_pharmacies(uuid);
drop function public.patient_choose_pharmacy(uuid, uuid, uuid);
drop function public.patient_prescription_collection(uuid);
drop function public.patient_new_collection_code(uuid);

create function public.patient_collection_pharmacies(p_prescription uuid, p_beneficiary uuid default null)
returns table (partner_id uuid, partner_name text, location_id uuid, location_name text, state text, address text)
language plpgsql stable security definer set search_path = '' as $$
declare v_pat uuid := private.rx_patient(p_beneficiary);
begin
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  if not exists (select 1 from public.prescriptions rx where rx.id = p_prescription and rx.patient_id = v_pat and rx.state in ('signed', 'sent', 'dispensed')) then
    raise exception 'Prescription not found' using errcode = '42501';
  end if;
  -- a collected prescription is offered again only as a repeat; one already supplied elsewhere (QR, phone desk) is not offered to a partner at all
  if exists (select 1 from public.prescriptions rx where rx.id = p_prescription and rx.state in ('signed', 'dispensed')) and private.supplies_remaining(p_prescription) < 1 then
    raise exception 'collection_not_open' using errcode = '22023';
  end if;
  return query
    select pp.id, pp.name, l.id, l.name, l.state, l.address
      from public.pharmacy_partners pp join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id
     where pp.is_active and pp.approved_at is not null and pp.license_verified_at is not null
       and (pp.license_expires_at is null or pp.license_expires_at > now())
       and l.is_active and l.verified_at is not null
     order by pp.name, l.name;
end $$;

create function public.patient_choose_pharmacy(p_prescription uuid, p_partner uuid, p_location uuid, p_beneficiary uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_pat uuid := private.rx_patient(p_beneficiary);
  rx public.prescriptions%rowtype; v_code text; v_med uuid; v_prior text;
  v_len integer := coalesce((private.pharmacy_cfg() ->> 'code_length')::integer, 8); v_days integer := coalesce((private.pharmacy_cfg() ->> 'code_valid_days')::integer, 14);
begin
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  select * into rx from public.prescriptions where id = p_prescription and patient_id = v_pat for update;
  if not found then raise exception 'Prescription not found' using errcode = '42501'; end if;
  if rx.state not in ('signed', 'sent', 'dispensed') then raise exception 'collection_not_open' using errcode = '22023'; end if;
  v_prior := rx.state::text;
  select m.id into v_med from public.medications m where m.prescription_id = rx.id and m.source = 'clinician' for update;
  if v_med is not null and exists (select 1 from public.medications m where m.id = v_med and (m.superseded_at is not null or not m.is_active or (m.expires_at is not null and m.expires_at < now()))) then
    raise exception 'collection_not_open' using errcode = '22023';
  end if;
  if rx.state = 'sent' then
    -- changing pharmacy is allowed until a supply has started at the current one (a partial supply counts as started)
    if v_med is not null and exists (select 1 from public.pharmacy_order_dispenses d where d.medication_id = v_med and d.source = 'pharmacy' and d.disputed_at is null and d.is_partial
                                      and d.created_at >= coalesce(rx.sent_at, rx.created_at)) then
      raise exception 'collection_already_started' using errcode = '22023';
    end if;
  else
    -- signed or collected: a supply must still be permitted (a repeat), and none may have been taken some other way
    if private.supplies_remaining(rx.id) < 1 then raise exception 'collection_already_started' using errcode = '22023'; end if;
  end if;
  if not private.pharmacy_location_choosable(p_partner, p_location) then raise exception 'pharmacy_not_available' using errcode = '22023'; end if;
  v_code := private.new_collection_code(v_len);
  perform set_config('tarragon.rx_route', 'on', true);
  update public.prescriptions set pharmacy_partner_id = p_partner, pharmacy_location_id = p_location, chosen_by_patient_at = now(),
         state = 'sent', collection_code = null, sent_at = case when v_prior = 'sent' then sent_at else now() end, dispensed_at = null where id = rx.id;
  perform set_config('tarragon.rx_route', 'off', true);
  insert into public.prescription_collection_codes (prescription_id, organisation_id, patient_id, pharmacy_partner_id, pharmacy_location_id, code, code_expires_at, is_test)
  values (rx.id, rx.organisation_id, rx.patient_id, p_partner, p_location, v_code, now() + make_interval(days => v_days), rx.is_test)
  on conflict (prescription_id) do update set pharmacy_partner_id = excluded.pharmacy_partner_id, pharmacy_location_id = excluded.pharmacy_location_id,
    code = excluded.code, code_expires_at = excluded.code_expires_at, wrong_attempts = 0, locked_at = null, used_at = null, created_at = now();
  perform private.rx_notify_pharmacy(p_partner, 'pharmacy_new_prescription');
  perform private.rx_notify(rx.patient_id, rx.organisation_id, 'prescription_sent_patient');
  perform private.emit_domain_event('prescription.sent', rx.organisation_id, jsonb_build_object('prescription_id', rx.id),
    'prescription_sent:' || rx.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'), rx.patient_id, 'prescription', rx.id);
  perform private.log_audit('prescription.pharmacy_chosen', 'prescriptions', rx.id,
    jsonb_build_object('pharmacy_partner_id', p_partner, 'pharmacy_location_id', p_location, 'changed', v_prior = 'sent', 'repeat', v_prior = 'dispensed', 'acted_for', v_pat <> v_uid));
  -- S28c: someone acting for the patient is recorded in her access log and she is told (neutral, in-app)
  if v_pat <> v_uid then
    perform private.log_care_access(v_pat, 'acted_for', 'data_shared_pharmacy', jsonb_build_object('prescription_id', rx.id));
    perform private.rx_notify(rx.patient_id, rx.organisation_id, 'pharmacy_collection_update');
  end if;
  return v_code;
end $$;

create function public.patient_prescription_collection(p_prescription uuid, p_beneficiary uuid default null)
returns table (state text, pharmacy_name text, location_name text, address text, code text, code_expires_at timestamptz, locked boolean, expired boolean, collected boolean,
               can_repeat boolean, other_pharmacy_needed boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_pat uuid := private.rx_patient(p_beneficiary);
begin
  return query
    select rx.state::text, pp.name, l.name, l.address, c.code, c.code_expires_at, c.locked_at is not null, c.code_expires_at < now(), c.used_at is not null,
           (rx.state = 'dispensed' and private.pharmacy_collection_on() and private.supplies_remaining(rx.id) >= 1
              and exists (select 1 from public.medications m where m.prescription_id = rx.id and m.is_active and m.superseded_at is null and (m.expires_at is null or m.expires_at > now()))),
           (rx.state = 'sent' and exists (select 1 from public.prescription_pharmacy_flags f
                                           where f.prescription_id = rx.id and f.kind = 'out_of_stock' and f.pharmacy_partner_id = rx.pharmacy_partner_id
                                             and f.created_at >= coalesce(rx.chosen_by_patient_at, rx.created_at)))
      from public.prescriptions rx
      left join public.prescription_collection_codes c on c.prescription_id = rx.id
      left join public.pharmacy_partners pp on pp.id = rx.pharmacy_partner_id
      left join public.pharmacy_partner_locations l on l.id = rx.pharmacy_location_id
     where rx.id = p_prescription and rx.patient_id = v_pat and rx.state <> 'draft';
end $$;

create function public.patient_new_collection_code(p_prescription uuid, p_beneficiary uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.prescription_collection_codes%rowtype; v_pat uuid := private.rx_patient(p_beneficiary); v_code text;
  v_len integer := coalesce((private.pharmacy_cfg() ->> 'code_length')::integer, 8); v_days integer := coalesce((private.pharmacy_cfg() ->> 'code_valid_days')::integer, 14);
begin
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  select cc.* into c from public.prescription_collection_codes cc join public.prescriptions rx on rx.id = cc.prescription_id
   where cc.prescription_id = p_prescription and cc.patient_id = v_pat and rx.state = 'sent' and cc.used_at is null for update of cc;
  if not found then raise exception 'collection_not_open' using errcode = '22023'; end if;
  v_code := private.new_collection_code(v_len);
  update public.prescription_collection_codes set code = v_code, code_expires_at = now() + make_interval(days => v_days),
         wrong_attempts = 0, locked_at = null where prescription_id = p_prescription;
  perform private.log_audit('prescription.collection_code_renewed', 'prescriptions', p_prescription, jsonb_build_object('acted_for', v_pat <> (select auth.uid())));
  return v_code;
end $$;

-- S28c: the patient takes the prescription back from the pharmacy. Consent to share is revocable: the pharmacy stops seeing it at once and the code dies.
-- Not once a supply has started. Works whether or not collection is switched on, because it only removes sharing.
create function public.patient_withdraw_from_pharmacy(p_prescription uuid, p_beneficiary uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_pat uuid := private.rx_patient(p_beneficiary); rx public.prescriptions%rowtype; v_med uuid;
begin
  select * into rx from public.prescriptions where id = p_prescription and patient_id = v_pat for update;
  if not found then raise exception 'Prescription not found' using errcode = '42501'; end if;
  if rx.state <> 'sent' then raise exception 'collection_not_open' using errcode = '22023'; end if;
  select m.id into v_med from public.medications m where m.prescription_id = rx.id and m.source = 'clinician';
  if v_med is not null and exists (select 1 from public.pharmacy_order_dispenses d where d.medication_id = v_med and d.source = 'pharmacy' and d.disputed_at is null and d.is_partial
                                    and d.created_at >= coalesce(rx.sent_at, rx.created_at)) then
    raise exception 'collection_already_started' using errcode = '22023';
  end if;
  perform set_config('tarragon.rx_route', 'on', true);
  update public.prescriptions set state = 'signed', pharmacy_partner_id = null, pharmacy_location_id = null, chosen_by_patient_at = null, collection_code = null, sent_at = null where id = rx.id;
  perform set_config('tarragon.rx_route', 'off', true);
  delete from public.prescription_collection_codes where prescription_id = rx.id;
  perform private.log_audit('prescription.pharmacy_withdrawn', 'prescriptions', rx.id, jsonb_build_object('pharmacy_partner_id', rx.pharmacy_partner_id, 'acted_for', v_pat <> v_uid));
  if v_pat <> v_uid then
    perform private.log_care_access(v_pat, 'acted_for', 'data_shared_pharmacy', jsonb_build_object('prescription_id', rx.id, 'withdrawn', true));
    perform private.rx_notify(rx.patient_id, rx.organisation_id, 'pharmacy_collection_update');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Structured questions and fixed answers (no chat). A question is one of six; an answer is one of three; neither carries free text.
--    They ride on S36h's flag table and task type, so the clinical queue and the prescriber's notice work exactly as S36h built them.
-- ---------------------------------------------------------------------------
alter table public.prescription_pharmacy_flags add column question_code text
  check (question_code is null or question_code in ('dose_unclear', 'strength_unavailable', 'substitute_needed', 'allergy_or_interaction', 'details_do_not_match', 'call_me'));
comment on column public.prescription_pharmacy_flags.question_code is 'S28c: set when the flag is one of the six fixed questions (pharmacist_ask_prescriber). Null for an earlier written flag.';

create table public.prescription_flag_answers (
  flag_id uuid primary key references public.prescription_pharmacy_flags (id) on delete restrict,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  answer_code text not null check (answer_code in ('keep_as_written', 'new_prescription_coming', 'patient_to_contact_us')),
  answered_by uuid not null references public.profiles (id) on delete restrict,
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.prescription_flag_answers is 'S28c: the prescriber''s fixed reply to a pharmacy question. Append only. An answer never changes a prescription (INV-02): a different medicine is a new signed prescription.';
create trigger prescription_flag_answers_append_only before update or delete on public.prescription_flag_answers for each row execute function private.pharmacy_flag_immutable();
alter table public.prescription_flag_answers enable row level security;
revoke all on public.prescription_flag_answers from public, anon, authenticated;

create function private.pharmacy_question_text(p_code text) returns text language sql immutable set search_path = '' as $$
  select case p_code
    when 'dose_unclear' then 'The dose or directions are unclear'
    when 'strength_unavailable' then 'The strength is not available'
    when 'substitute_needed' then 'A substitute may be needed'
    when 'allergy_or_interaction' then 'A possible allergy or interaction'
    when 'details_do_not_match' then 'The details do not match the patient'
    when 'call_me' then 'Please call the pharmacy' end
$$;
revoke all on function private.pharmacy_question_text(text) from public, anon, authenticated;

-- The pharmacy asks the prescriber one of the six questions. Only for a prescription waiting at this pharmacy.
create function public.pharmacist_ask_prescriber(p_prescription uuid, p_question text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_partner uuid := private.pharmacist_partner(); rx public.prescriptions%rowtype; v_reason text := private.pharmacy_question_text(p_question); v_flag uuid; v_task uuid;
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  if v_reason is null then raise exception 'pharmacy_question_invalid' using errcode = '22023'; end if;
  select * into rx from public.prescriptions where id = p_prescription and pharmacy_partner_id = v_partner;
  if not found then raise exception 'Prescription not found for this pharmacy' using errcode = '42501'; end if;
  if rx.state <> 'sent' then raise exception 'pharmacy_flag_not_open' using errcode = '22023'; end if;
  begin
    v_task := private.create_clinical_task(rx.patient_id, 'pharmacy_flag_review', null, 'pharmacy_flag:' || rx.id);
  exception when others then
    -- the question and the prescriber's notice still stand; a queue that cannot take the task must not lose the question, but it is recorded
    perform private.log_audit('prescription.pharmacy_task_failed', 'prescriptions', rx.id, jsonb_build_object('sqlstate', sqlstate));
  end;
  insert into public.prescription_pharmacy_flags (organisation_id, prescription_id, pharmacy_partner_id, flagged_by, kind, reason, task_id, is_test, question_code)
  values (rx.organisation_id, rx.id, v_partner, (select auth.uid()), 'query_to_prescriber', v_reason, v_task, rx.is_test, p_question) returning id into v_flag;
  if rx.signed_by is not null and exists (select 1 from public.profiles pr where pr.id = rx.signed_by and pr.is_active and pr.role <> 'patient') then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (rx.organisation_id, rx.signed_by, 'in_app', 'pending', 'pharmacy_flag_notice', jsonb_build_object('flag_id', v_flag));
  end if;
  perform private.log_audit('prescription.pharmacy_question', 'prescriptions', rx.id, jsonb_build_object('flag_id', v_flag, 'question', p_question, 'pharmacy_partner_id', v_partner));
  return v_flag;
end $$;

-- "We cannot supply this": a fixed notice, no text. The patient is told neutrally and can choose another pharmacy.
create function public.pharmacist_report_out_of_stock(p_prescription uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_partner uuid := private.pharmacist_partner(); rx public.prescriptions%rowtype; v_flag uuid; v_task uuid;
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  select * into rx from public.prescriptions where id = p_prescription and pharmacy_partner_id = v_partner;
  if not found then raise exception 'Prescription not found for this pharmacy' using errcode = '42501'; end if;
  if rx.state <> 'sent' then raise exception 'pharmacy_flag_not_open' using errcode = '22023'; end if;
  begin
    v_task := private.create_clinical_task(rx.patient_id, 'pharmacy_flag_review', null, 'pharmacy_flag:' || rx.id);
  exception when others then
    perform private.log_audit('prescription.pharmacy_task_failed', 'prescriptions', rx.id, jsonb_build_object('sqlstate', sqlstate));
  end;
  insert into public.prescription_pharmacy_flags (organisation_id, prescription_id, pharmacy_partner_id, flagged_by, kind, reason, task_id, is_test)
  values (rx.organisation_id, rx.id, v_partner, (select auth.uid()), 'out_of_stock', 'The pharmacy cannot supply this item', v_task, rx.is_test) returning id into v_flag;
  perform private.rx_notify(rx.patient_id, rx.organisation_id, 'pharmacy_collection_update');
  perform private.log_audit('prescription.pharmacy_out_of_stock', 'prescriptions', rx.id, jsonb_build_object('flag_id', v_flag, 'pharmacy_partner_id', v_partner));
  return v_flag;
end $$;

-- The questions this pharmacy asked on one of its own prescriptions, with the prescriber's fixed answer.
create function public.pharmacist_prescription_questions(p_prescription uuid)
returns table (asked_at timestamptz, question_code text, answered_at timestamptz, answer_code text)
language plpgsql stable security definer set search_path = '' as $$
declare v_partner uuid := private.pharmacist_partner();
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  return query
    select f.created_at, f.question_code, a.created_at, a.answer_code
      from public.prescription_pharmacy_flags f left join public.prescription_flag_answers a on a.flag_id = f.id
     where f.prescription_id = p_prescription and f.pharmacy_partner_id = v_partner and f.question_code is not null order by f.created_at;
end $$;

-- The signing clinician answers from the fixed list. Tie-checked (INV-12), audited (INV-10). Only while the prescription is still waiting at the asking pharmacy.
create function public.answer_pharmacy_question(p_flag uuid, p_answer text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); f public.prescription_pharmacy_flags%rowtype; rx public.prescriptions%rowtype;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_answer is null or p_answer not in ('keep_as_written', 'new_prescription_coming', 'patient_to_contact_us') then raise exception 'invalid_answer' using errcode = '22023'; end if;
  select * into f from public.prescription_pharmacy_flags where id = p_flag and question_code is not null;
  if not found then raise exception 'question_not_found' using errcode = '42501'; end if;
  select * into rx from public.prescriptions where id = f.prescription_id for update;
  if rx.signed_by is distinct from v_uid or not private.clinician_has_patient_access(rx.patient_id) then raise exception 'question_not_found' using errcode = '42501'; end if;
  if exists (select 1 from public.prescription_flag_answers where flag_id = p_flag) then return jsonb_build_object('ok', false, 'reason', 'already_answered'); end if;
  if rx.state <> 'sent' or rx.pharmacy_partner_id is distinct from f.pharmacy_partner_id then return jsonb_build_object('ok', false, 'reason', 'not_waiting'); end if;
  insert into public.prescription_flag_answers (flag_id, organisation_id, answer_code, answered_by, is_test) values (p_flag, f.organisation_id, p_answer, v_uid, f.is_test);
  perform private.log_audit('prescription.pharmacy_question_answered', 'prescriptions', rx.id, jsonb_build_object('flag_id', p_flag, 'answer', p_answer));
  perform private.rx_notify_pharmacy(f.pharmacy_partner_id, 'pharmacy_question_answered');
  perform private.rx_notify(rx.patient_id, rx.organisation_id, 'pharmacy_collection_update');
  return jsonb_build_object('ok', true);
end $$;

-- The prescriber's one view: the fixed questions with their answers, where each prescription they signed has got to, and S36h's earlier written messages
-- (read only). Only prescriptions this clinician signed and is still tied to; one audited read however many rows come back.
create function public.prescriber_pharmacy_overview()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_questions jsonb; v_collection jsonb; v_earlier jsonb;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and role = 'clinician' and is_active) then raise exception 'This is for clinicians' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'question_id', f.id, 'prescription_id', rx.id, 'asked_at', f.created_at, 'pharmacy_name', pp.name, 'reason_code', f.question_code,
           'patient_name', p.full_name, 'medicines', (select coalesce(jsonb_agg(coalesce(it ->> 'drug_name', it ->> 'drug', 'item') order by coalesce(it ->> 'drug_name', it ->> 'drug', 'item')), '[]'::jsonb) from jsonb_array_elements(rx.items) it),
           'answered_at', a.created_at, 'answer_code', a.answer_code) order by (a.flag_id is null) desc, f.created_at desc), '[]'::jsonb)
    into v_questions
    from public.prescription_pharmacy_flags f join public.prescriptions rx on rx.id = f.prescription_id join public.profiles p on p.id = rx.patient_id
    join public.pharmacy_partners pp on pp.id = f.pharmacy_partner_id left join public.prescription_flag_answers a on a.flag_id = f.id
   where f.question_code is not null and rx.signed_by = v_uid and private.clinician_has_patient_access(rx.patient_id) and (a.flag_id is null or a.created_at > now() - interval '30 days');
  select coalesce(jsonb_agg(jsonb_build_object('prescription_id', rx.id, 'state', rx.state, 'patient_name', p.full_name, 'sent_at', rx.sent_at, 'dispensed_at', rx.dispensed_at,
           'pharmacy_name', pp.name, 'medicines', (select coalesce(jsonb_agg(coalesce(it ->> 'drug_name', it ->> 'drug', 'item') order by coalesce(it ->> 'drug_name', it ->> 'drug', 'item')), '[]'::jsonb) from jsonb_array_elements(rx.items) it))
           order by coalesce(rx.dispensed_at, rx.sent_at) desc), '[]'::jsonb)
    into v_collection
    from public.prescriptions rx join public.profiles p on p.id = rx.patient_id join public.pharmacy_partners pp on pp.id = rx.pharmacy_partner_id
   where rx.signed_by = v_uid and rx.state in ('sent', 'dispensed') and private.clinician_has_patient_access(rx.patient_id) and coalesce(rx.dispensed_at, rx.sent_at) > now() - interval '30 days';
  select coalesce(jsonb_agg(jsonb_build_object('flag_id', f.id, 'patient_name', p.full_name, 'pharmacy_name', pp.name, 'kind', f.kind, 'reason', f.reason, 'created_at', f.created_at,
           'items', rx.items) order by f.created_at desc), '[]'::jsonb)
    into v_earlier
    from public.prescription_pharmacy_flags f join public.prescriptions rx on rx.id = f.prescription_id join public.profiles p on p.id = rx.patient_id
    join public.pharmacy_partners pp on pp.id = f.pharmacy_partner_id
   where f.question_code is null and rx.signed_by = v_uid and private.clinician_has_patient_access(rx.patient_id) and f.created_at > now() - interval '90 days';
  perform private.log_audit('prescription.pharmacy_overview_read', 'prescriptions', null,
    jsonb_build_object('questions', jsonb_array_length(v_questions), 'collection', jsonb_array_length(v_collection), 'earlier', jsonb_array_length(v_earlier)));
  return jsonb_build_object('questions', v_questions, 'collection', v_collection, 'earlier', v_earlier);
end $$;

-- ---------------------------------------------------------------------------
-- 4. The pharmacy's functions: behind the go-live guard, open questions that count only unanswered ones, batch and expiry required
-- ---------------------------------------------------------------------------

create or replace function public.pharmacist_prescriptions()
returns table (prescription_id uuid, state text, sent_at timestamptz, dispensed_at timestamptz, patient_name text, patient_number text,
               items jsonb, open_flags integer, location_name text, code_locked boolean)
language plpgsql security definer set search_path = '' as $$
declare v_partner uuid := private.pharmacist_partner(); v_ids uuid[];
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select rx.id from public.prescriptions rx where rx.pharmacy_partner_id = v_partner and rx.state in ('sent', 'dispensed')
     order by coalesce(rx.sent_at, rx.created_at) desc limit 200) x;
  if cardinality(v_ids) > 0 then
    perform private.log_audit('pharmacy.prescriptions_listed', 'prescriptions', null, jsonb_build_object('prescription_ids', to_jsonb(v_ids), 'pharmacy_partner_id', v_partner));
  end if;
  return query
    select rx.id, rx.state::text, rx.sent_at, rx.dispensed_at, p.full_name, p.patient_number, rx.items,
           (select count(*)::integer from public.prescription_pharmacy_flags f where f.prescription_id = rx.id
              and not exists (select 1 from public.prescription_flag_answers fa where fa.flag_id = f.id)),
           l.name, coalesce(c.locked_at is not null, false)
      from public.prescriptions rx
      join public.profiles p on p.id = rx.patient_id
      left join public.pharmacy_partner_locations l on l.id = rx.pharmacy_location_id
      left join public.prescription_collection_codes c on c.prescription_id = rx.id
     where rx.id = any (v_ids)
     order by coalesce(rx.sent_at, rx.created_at) desc;
end $$;

create or replace function public.pharmacist_verify_collection(p_prescription uuid, p_code text)
returns table (outcome text, patient_name text, patient_number text, items jsonb, allergies jsonb, supplies_dispensed integer, supplies_permitted integer, outstanding_note text)
language plpgsql security definer set search_path = '' as $$
declare v_partner uuid := private.pharmacist_partner(); rx public.prescriptions%rowtype; v_out text; v_med public.medications%rowtype; v_disp integer; v_perm integer; v_appr integer;
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  select * into rx from public.prescriptions where id = p_prescription and pharmacy_partner_id = v_partner and state = 'sent' for update;
  if not found then return query select 'not_found'::text, null::text, null::text, null::jsonb, null::jsonb, 0, 0, null::text; return; end if;
  v_out := private.check_collection_code(rx.id, p_code, v_partner);
  if v_out <> 'ok' then return query select v_out, null::text, null::text, null::jsonb, null::jsonb, 0, 0, null::text; return; end if;
  select * into v_med from public.medications m where m.prescription_id = rx.id and m.source = 'clinician';
  if v_med.id is null then return query select 'no_medication'::text, null::text, null::text, null::jsonb, null::jsonb, 0, 0, null::text; return; end if;
  select count(*) into v_appr from public.medication_repeat_requests r where r.medication_id = v_med.id and r.status = 'approved';
  select count(*) into v_disp from public.pharmacy_order_dispenses d where d.medication_id = v_med.id and d.source = 'pharmacy' and d.disputed_at is null and not coalesce(d.is_partial, false);
  v_perm := 1 + least(coalesce(v_appr, 0), coalesce(v_med.repeats_allowed, 0));
  perform private.log_audit('pharmacy.prescription_opened', 'prescriptions', rx.id, jsonb_build_object('pharmacy_partner_id', v_partner));
  return query
    select 'ok'::text, p.full_name, p.patient_number, rx.items,
           coalesce((select jsonb_agg(jsonb_build_object('allergen', a.allergen, 'reaction', a.reaction, 'severity', a.severity) order by a.allergen)
                       from public.patient_allergies a where a.patient_id = rx.patient_id), '[]'::jsonb),
           v_disp, v_perm,
           (select d.outstanding_note from public.pharmacy_order_dispenses d where d.medication_id = v_med.id and d.source = 'pharmacy' and d.is_partial and d.disputed_at is null order by d.created_at desc limit 1)
      from public.profiles p where p.id = rx.patient_id;
end $$;

create or replace function public.pharmacist_dispense_prescription(
  p_prescription uuid, p_code text, p_quantity text, p_is_partial boolean, p_outstanding_note text,
  p_batch text, p_expiry date, p_registration text, p_pharmacist_name text)
returns table (outcome text, supplies_dispensed integer, supplies_permitted integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_partner uuid := private.pharmacist_partner(); rx public.prescriptions%rowtype; v_out text; v_med public.medications%rowtype;
  v_disp integer; v_perm integer; v_appr integer; v_dispense uuid; v_pname text; v_partial boolean := coalesce(p_is_partial, false);
  v_reg text := nullif(btrim(coalesce(p_registration, '')), ''); v_who text := btrim(coalesce(p_pharmacist_name, ''));
  v_qty text := nullif(btrim(coalesce(p_quantity, '')), ''); v_note text := nullif(btrim(coalesce(p_outstanding_note, '')), '');
  v_batch text := nullif(btrim(coalesce(p_batch, '')), '');
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  select * into rx from public.prescriptions where id = p_prescription and pharmacy_partner_id = v_partner and state = 'sent' for update;
  if not found then return query select 'not_found'::text, 0, 0; return; end if;
  -- the medicine row is the shared lock: the QR path and the phone desk lock the same row, so two doors cannot both take the last supply
  select * into v_med from public.medications m where m.prescription_id = rx.id and m.source = 'clinician' for update;
  if v_med.id is null then return query select 'no_medication'::text, 0, 0; return; end if;
  v_out := private.check_collection_code(rx.id, p_code, v_partner);
  if v_out <> 'ok' then return query select v_out, 0, 0; return; end if;
  -- S28c: batch and expiry are the pharmacy's own record of what it handed over, required for any supply. An out-of-date batch is never recorded
  -- as supplied. Tarragon does not check that a batch is genuine and says so.
  if v_batch is null or p_expiry is null then return query select 'batch_required'::text, 0, 0; return; end if;
  if p_expiry <= (now() at time zone 'Africa/Lagos')::date then return query select 'batch_expired'::text, 0, 0; return; end if;
  if char_length(v_who) not between 2 and 120 or v_reg is null or v_reg !~ '^[A-Za-z0-9][A-Za-z0-9 /.\-]{1,38}[A-Za-z0-9]$'
     or char_length(coalesce(v_qty, '')) > 100 or char_length(coalesce(v_batch, '')) > 60
     or (p_expiry is not null and p_expiry <= (now() at time zone 'Africa/Lagos')::date)
     or (v_partial and (v_note is null or char_length(v_note) not between 5 and 300)) then
    return query select 'invalid'::text, 0, 0; return;
  end if;
  if v_med.superseded_at is not null or not v_med.is_active or (v_med.expires_at is not null and v_med.expires_at < now()) then
    return query select 'not_active'::text, 0, 0; return;
  end if;
  select count(*) into v_appr from public.medication_repeat_requests r where r.medication_id = v_med.id and r.status = 'approved';
  select count(*) into v_disp from public.pharmacy_order_dispenses d where d.medication_id = v_med.id and d.source = 'pharmacy' and d.disputed_at is null and not coalesce(d.is_partial, false);
  v_perm := 1 + least(coalesce(v_appr, 0), coalesce(v_med.repeats_allowed, 0));
  if v_disp >= v_perm then return query select 'no_supply_available'::text, v_disp, v_perm; return; end if;
  select name into v_pname from public.pharmacy_partners where id = v_partner;
  insert into public.pharmacy_order_dispenses (
    organisation_id, patient_id, medication_id, drug_name, strength, quantity, quantity_prescribed, dispensed_on, source, recorded_by,
    pharmacy_name, pharmacist_name, pharmacist_registration, pharmacist_registration_verified, recorded_via, is_partial, outstanding_note, batch_number, expiry_date)
  values (v_med.organisation_id, v_med.patient_id, v_med.id, v_med.drug_name, v_med.dose, coalesce(v_qty, v_med.quantity), v_med.quantity,
          (now() at time zone 'Africa/Lagos')::date, 'pharmacy', (select auth.uid()), v_pname, v_who, v_reg, false, 'partner',
          v_partial, case when v_partial then v_note end, v_batch, p_expiry)
  returning id into v_dispense;
  if not v_partial then
    update public.prescriptions set state = 'dispensed' where id = rx.id;
    update public.prescription_collection_codes set used_at = now() where prescription_id = rx.id;
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (rx.organisation_id, rx.patient_id, 'in_app', 'pending', 'prescription_collected_patient', jsonb_build_object('dispense_id', v_dispense));
    perform private.emit_domain_event('prescription.dispensed', rx.organisation_id, jsonb_build_object('prescription_id', rx.id, 'dispense_id', v_dispense),
      'prescription_dispensed:' || rx.id, rx.patient_id, 'prescription', rx.id);
  end if;
  perform private.log_audit('pharmacy.dispensed', 'prescriptions', rx.id, jsonb_build_object('dispense_id', v_dispense, 'partial', v_partial, 'pharmacy_partner_id', v_partner));
  return query select case when v_partial then 'partial_recorded' else 'recorded' end, v_disp + case when v_partial then 0 else 1 end, v_perm;
end $$;

-- ---------------------------------------------------------------------------
-- 6. The S37 go-live guard (INV-14). The prescribing guard gains the pharmacy conditions; the rest of each function is S37b's, unchanged.
--    If S37 changes these functions again, this migration must be rebased on the new definition.
-- ---------------------------------------------------------------------------
create or replace function private.go_live_conditions(p_key text, p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_n integer;
  v_gaps integer;
begin
  if p_key = 'clinical_operations_enabled' then
    -- the approved hypertension protocol is a public.protocols row (S24) whose code starts htn or hypertension (the S24 placeholder is htn_hearts_ng)
    select count(*) into v_n from public.protocols where status = 'approved' and code ~ '^(htn|hypertension)';
    return jsonb_build_array(
      private.go_live_cond('hypertension_protocol_approved', 'An approved hypertension protocol', v_n > 0, 'data', v_n || ' approved'),
      private.go_live_cond('triage_rule_set_approved', 'An approved blood pressure triage rule set',
        exists (select 1 from public.triage_rule_sets where status = 'approved' and code = 'bp_care_triage'), 'data',
        (select count(*) from public.triage_rule_sets where status = 'approved' and code = 'bp_care_triage') || ' approved'),
      private.go_live_cond('tier2_clinician_active', 'At least one active tier 2 clinician',
        (select count(*) from public.clinical_staff where active and status = 'active' and credentialing_level >= 2 and is_test is not true) > 0, 'data',
        (select count(*) from public.clinical_staff where active and status = 'active' and credentialing_level >= 2 and is_test is not true) || ' active'),
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null),
      private.go_live_cond('admin_confirmation', 'Admin confirmation', true, 'switch', 'Given by an admin pressing the switch'));
  elsif p_key = 'on_call_cover_ok' then
    select count(*) into v_gaps from private.rota_gaps(p_org, now(), now() + interval '7 days');
    return jsonb_build_array(
      private.go_live_cond('rota_covers_next_7_days', 'The rota covers the next 7 days with a primary and an eligible backup', v_gaps = 0, 'data', v_gaps || ' gaps'));
  elsif p_key = 'lab_booking_enabled' then
    return jsonb_build_array(
      private.go_live_cond('synlab_active', 'SYNLAB is an active laboratory partner',
        exists (select 1 from public.lab_providers where is_active and name ilike 'synlab%'), 'data', null),
      private.go_live_cond('collection_sites', 'SYNLAB has at least one active collection site',
        exists (select 1 from public.lab_provider_locations l join public.lab_providers p on p.id = l.lab_provider_id where l.is_active and p.is_active and p.name ilike 'synlab%'), 'data', null),
      private.go_live_cond('results_flow_tested', 'The results flow has been tested end to end', private.go_live_attested(p_key, 'results_flow_tested'), 'attestation', null));
  elsif p_key = 'prescribing_enabled' then
    select count(*) into v_n from public.pharmacy_partners where is_active and onboarding_status = 'activated';
    -- S28c: sending a prescription to a pharmacy also needs a pharmacy people can actually choose today (active, approved, licence verified and
    -- unexpired, with a verified location), the collection rules confirmed by their owner, and the notification sender deployed.
    return jsonb_build_array(
      private.go_live_cond('pharmacy_partner_active', 'At least one active pharmacy partner', v_n > 0, 'data', v_n || ' active'),
      private.go_live_cond('pharmacy_licence_current', 'At least one approved pharmacy with a current, verified licence and a verified location',
        exists (select 1 from public.pharmacy_partners pp join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id where private.pharmacy_location_choosable(pp.id, l.id)), 'data',
        (select count(distinct pp.id) from public.pharmacy_partners pp join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id where private.pharmacy_location_choosable(pp.id, l.id)) || ' can be chosen'),
      private.go_live_cond('pharmacy_rules_confirmed', 'The pharmacy collection rules are confirmed',
        coalesce((select s.decision = 'confirmed' from public.proposed_config_signoffs s
                   where s.config_key = 'pharmacy.collection_rules'
                     and s.config_version = (select c.version from public.pharmacy_config c where c.is_active)
                   order by s.id desc limit 1), false), 'data', null),
      private.go_live_cond('notification_sender_deployed', 'The notification sender with the pharmacy messages is deployed',
        private.go_live_attested(p_key, 'notification_sender_deployed'), 'attestation', null),
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null),
      private.go_live_cond('clinical_lead_signoff', 'Clinical lead sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
  elsif p_key = 'scribe_enabled' then
    return jsonb_build_array(
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null),
      private.go_live_cond('con001_legal_review_recorded', 'Legal review of consent text CON-001 recorded', private.go_live_attested(p_key, 'con001_legal_review_recorded'), 'attestation', null),
      private.go_live_cond('speech_provider_configured', 'A speech-to-text provider is configured', private.go_live_attested(p_key, 'speech_provider_configured'), 'attestation', null));
  elsif p_key = 'payouts_enabled' then
    return jsonb_build_array(
      private.go_live_cond('fee_schedule_approved', 'A fee schedule is approved', private.go_live_attested(p_key, 'fee_schedule_approved'), 'attestation', null),
      private.go_live_cond('paystack_transfers_configured', 'Paystack transfers are configured', private.go_live_attested(p_key, 'paystack_transfers_configured'), 'attestation', null));
  elsif p_key = 'public_signup_enabled' then
    return jsonb_build_array(
      private.go_live_cond('stage2_exit_criteria_met', 'The Stage 2 exit criteria are met', private.go_live_attested(p_key, 'stage2_exit_criteria_met'), 'attestation', null));
  end if;
  -- An unknown key has no conditions, and a guard with no conditions is never satisfied (fail closed).
  return jsonb_build_array(private.go_live_cond('unknown_guard', 'This guard has no defined condition', false, 'data', null));
end $$;

create or replace function public.attest_go_live_condition(p_key text, p_code text, p_met boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if private.go_live_actor_role() is null then raise exception 'only an admin or the Chief Medical Officer can record this' using errcode = '42501'; end if;
  if not exists (select 1 from public.go_live_guards where key = p_key) then raise exception 'no such go-live guard: %', p_key using errcode = '22023'; end if;
  -- the conditions a person records (the rest are read from the data). A fixed list, so a broken data query cannot block recording one.
  if (p_key, p_code) not in (
       ('clinical_operations_enabled', 'clinical_safety_case_current'), ('prescribing_enabled', 'clinical_safety_case_current'),
       ('scribe_enabled', 'clinical_safety_case_current'), ('prescribing_enabled', 'notification_sender_deployed'),
       ('lab_booking_enabled', 'results_flow_tested'),
       ('scribe_enabled', 'con001_legal_review_recorded'), ('scribe_enabled', 'speech_provider_configured'),
       ('payouts_enabled', 'fee_schedule_approved'), ('payouts_enabled', 'paystack_transfers_configured'),
       ('public_signup_enabled', 'stage2_exit_criteria_met')) then
    raise exception 'that condition is read from the data (or does not exist), it cannot be attested' using errcode = '22023';
  end if;
  if p_met is null or length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'say what was checked and by whom, in a sentence' using errcode = '22023';
  end if;
  -- the safety case is the safety officer's: an admin who is not the CMO cannot record it
  if p_code = 'clinical_safety_case_current' and not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can record the clinical safety case' using errcode = '42501';
  end if;
  if p_code = 'clinical_safety_case_current' and p_met and length(btrim(p_note)) < 25 then
    raise exception 'name the safety case document, its version and who signed it' using errcode = '22023';
  end if;
  insert into public.go_live_attestations (guard_key, condition_code, met, note, attested_by)
  values (p_key, p_code, p_met, btrim(p_note), v_uid);
  perform private.log_audit('go_live_guard.condition_attested', 'go_live_guard', null, jsonb_build_object('key', p_key, 'code', p_code, 'met', p_met));
  return jsonb_build_object('ok', true);
end $$;

update public.go_live_guards
   set blocks = 'Prescriptions; sending a prescription to a partner pharmacy',
       condition_text = 'At least one active pharmacy partner with a current licence and a verified location; collection rules confirmed; notification sender deployed; clinical safety case; clinical lead sign-off',
       enforced_in = array['private.pharmacy_collection_on (every patient choice, every pharmacy list, counter check and supply, every question)'],
       not_enforced_in = 'Prescribing itself (S24, signed prescriptions) is not behind this guard yet. The downloadable prescription form, taking a prescription back from a pharmacy, and the QR and phone-desk supply paths are never behind it.'
 where key = 'prescribing_enabled';

-- ---------------------------------------------------------------------------
-- 7. Grants, and the migration proves what it claims
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.patient_collection_pharmacies(uuid,uuid)', 'public.patient_choose_pharmacy(uuid,uuid,uuid,uuid)', 'public.patient_prescription_collection(uuid,uuid)',
    'public.patient_new_collection_code(uuid,uuid)', 'public.patient_withdraw_from_pharmacy(uuid,uuid)', 'public.pharmacist_ask_prescriber(uuid,text)',
    'public.pharmacist_report_out_of_stock(uuid)', 'public.pharmacist_prescription_questions(uuid)', 'public.answer_pharmacy_question(uuid,text)', 'public.prescriber_pharmacy_overview()']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.patient_collection_pharmacies(uuid,uuid)', 'public.patient_choose_pharmacy(uuid,uuid,uuid,uuid)', 'public.patient_prescription_collection(uuid,uuid)',
    'public.patient_new_collection_code(uuid,uuid)', 'public.patient_withdraw_from_pharmacy(uuid,uuid)', 'public.pharmacist_ask_prescriber(uuid,text)',
    'public.pharmacist_report_out_of_stock(uuid)', 'public.pharmacist_prescription_questions(uuid)', 'public.answer_pharmacy_question(uuid,text)', 'public.prescriber_pharmacy_overview()',
    'public.pharmacist_prescriptions()', 'public.pharmacist_verify_collection(uuid,text)', 'public.pharmacist_dispense_prescription(uuid,text,text,boolean,text,text,date,text,text)',
    'private.rx_patient(uuid)', 'private.supplies_remaining(uuid)', 'private.pharmacy_collection_on()', 'private.rx_notify(uuid,uuid,text)']
  loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'S28c: anon can execute %', f; end if;
  end loop;
  if to_regprocedure('public.patient_choose_pharmacy(uuid,uuid,uuid)') is not null then raise exception 'S28c: the old three-argument chooser survived'; end if;
  if has_table_privilege('authenticated', 'public.prescription_flag_answers', 'SELECT') then raise exception 'S28c: the answers table is readable'; end if;
end $$;
