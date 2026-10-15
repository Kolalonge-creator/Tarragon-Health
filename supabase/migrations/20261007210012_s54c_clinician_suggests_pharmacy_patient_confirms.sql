-- S54c: the care team may SUGGEST a pharmacy for a signed prescription; the PATIENT confirms before anything is sent.
-- Founder decision 2026-10-07 (resolves OQ-310 as option b). Stacked on S28 (patient chooses a verified pharmacy, the code lives on a
-- patient-only table) and S54 (listable rule, price comparison).
--
-- What this keeps exactly as it was:
--   * S28: only the patient routes a prescription (patient_choose_pharmacy). A suggestion never writes prescriptions.state, pharmacy_partner_id,
--     the collection code or anything a pharmacy can see. Acceptance calls patient_choose_pharmacy itself, so every S28/S54 rule (listable,
--     unlisted refused, change-before-supply, new code, audit, neutral notices, events) applies unchanged.
--   * 8.16: nothing a clinician can call reads a commission, margin, payout or earning column, and nothing orders by one. The clinician sees only
--     neutral facts: pharmacy name, area, how near it is to the patient (same city, same state), whether the medicines are in stock (yes, no,
--     unknown) and that it is verified and listable. Ordered by proximity then name. Opening hours are not recorded anywhere, so none are shown.
--   * INV-12: a clinician suggests and reads only for a patient she is tied to (care team, open escalation, alert, task, lead, page) and only if
--     she holds a clinical tier (a Care Coordinator, pharmacist, finance and admin roles are refused).
--   * INV-10: every staff read goes through an audited function; no staff table policy exists.
--   * INV-07: the one patient notice names no medicine, condition or pharmacy.
--   * A pharmacy cannot see a suggestion at all. Only after the patient confirms does the existing S28 path route the prescription.
-- Live counts at write time: prescriptions 0, so no backfill and no data conversion.

-- 0. Versioned rule (INV-16, PROPOSED, CMO and pharmacy lead): how long a suggestion stays open. Rules are new versions, never edits: the active
--    row is replaced by version N+1 carrying the three S28 values unchanged plus the new one. Mirrored in packages/shared proposed-config
--    (pharmacy.collection_rules v2) with a drift test.
update public.pharmacy_config set is_active = false where is_active;
-- pharmacy-rules-v2-begin
insert into public.pharmacy_config (version, is_active, config)
select coalesce(max(version), 1) + 1, true, $json$
{"code_length": 8, "code_valid_days": 14, "max_wrong_attempts": 5, "suggestion_valid_days": 14}
$json$::jsonb from public.pharmacy_config;

create function private.pharmacy_suggestion_ttl_days() returns integer language sql stable security definer set search_path = '' as
$$ select greatest(1, coalesce((private.pharmacy_cfg() ->> 'suggestion_valid_days')::integer, 14)) $$;
revoke all on function private.pharmacy_suggestion_ttl_days() from public, anon, authenticated;

-- 1. The suggestion record
create table public.prescription_pharmacy_suggestions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  prescription_id uuid not null references public.prescriptions (id) on delete cascade,
  patient_id uuid not null references public.profiles (id) on delete restrict,
  pharmacy_partner_id uuid not null references public.pharmacy_partners (id) on delete restrict,
  pharmacy_location_id uuid not null references public.pharmacy_partner_locations (id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'chose_other', 'withdrawn', 'lapsed', 'expired')),
  source text not null default 'clinician' check (source = 'clinician'),
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  suggested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  settled_at timestamptz,
  settled_by uuid references public.profiles (id) on delete restrict,
  is_test boolean not null default false,
  check ((status = 'pending') = (settled_at is null)),
  check (expires_at > suggested_at)
);
create unique index prescription_pharmacy_suggestions_one_pending on public.prescription_pharmacy_suggestions (prescription_id) where status = 'pending';
create index prescription_pharmacy_suggestions_patient_idx on public.prescription_pharmacy_suggestions (patient_id, suggested_at desc);
comment on table public.prescription_pharmacy_suggestions is
  'S54c: a care-team suggestion of one pharmacy for a signed prescription. It routes nothing: only the patient does (patient_choose_pharmacy). Written only by the care_team_/patient_ functions; the patient reads her own rows; staff read through an audited function; a pharmacy never sees it.';

alter table public.prescription_pharmacy_suggestions enable row level security;
revoke all on public.prescription_pharmacy_suggestions from public, anon, authenticated;
grant select on public.prescription_pharmacy_suggestions to authenticated;
create policy prescription_pharmacy_suggestions_patient_select on public.prescription_pharmacy_suggestions
  for select to authenticated using (patient_id = (select auth.uid()));

-- 2. Event and neutral in-app notice (INV-07)
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('prescription.pharmacy_suggested', 'The care team suggested a pharmacy for a signed prescription; the patient has not confirmed it (ids only)', 'S54c', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('prescription.pharmacy_suggested', 1, array['prescription_id'])
on conflict (event_type, version) do nothing;
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('pharmacy_suggestion_patient', 'administrative', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate',
   'S54c: your care team has a suggestion for where to collect. Names no medicine, condition or pharmacy (INV-07). Nothing depends on it being seen: the prescription can be taken to any pharmacy.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('pharmacy_suggestion_patient', 'en', 'in_app', 'Your care team has a suggestion',
   'Your care team has a suggestion for where to collect your item. Open the app to see it. Nothing is sent until you choose.')
on conflict (template_key, locale, channel) do nothing;

-- 3. Helpers
-- The acting clinician: a clinical tier in the patient's organisation AND tied to this patient (INV-12). Patients, care coordinators,
-- pharmacists, finance and admin accounts are refused here.
-- An explicit allow-list, not a deny-list: the account role must be `clinician` (the one account role every doctor tier uses), the person must
-- hold a clinical doctor tier, and must be tied to the patient. A role added later (or corporate_admin, hmo_admin, care_coordinator, analyst,
-- lab_liaison and so on) is refused until someone adds it here on purpose.
create function private.may_suggest_pharmacy(p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
     and exists (select 1 from public.profiles me where me.id = (select auth.uid()) and me.role = 'clinician')
     and exists (select 1 from public.profiles pt
                  where pt.id = p_patient and pt.organisation_id is not null
                    and private.is_clinical_tier(pt.organisation_id))
     and private.clinician_has_patient_access(p_patient)
$$;
revoke all on function private.may_suggest_pharmacy(uuid) from public, anon, authenticated;

-- A prescription can take a pharmacy only while its medicine is still live: the same rule patient_choose_pharmacy applies, so a suggestion is
-- never offered that the patient could not accept.
create function private.prescription_collectable(p_rx uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.prescriptions rx where rx.id = p_rx and rx.state = 'signed')
     and not exists (select 1 from public.medications m
                      where m.prescription_id = p_rx and m.source = 'clinician'
                        and (m.superseded_at is not null or not m.is_active or (m.expires_at is not null and m.expires_at < now())))
$$;
revoke all on function private.prescription_collectable(uuid) from public, anon, authenticated;

-- Lapse path: a pending suggestion past its expiry becomes `expired`. Called by every read and by suggest, so no timer is needed and a stale
-- row is never shown as waiting. (Accept refuses an expired one by itself; it cannot lapse the row because a refusal rolls back.)
create function private.lapse_expired_pharmacy_suggestions(p_rx uuid default null) returns void
language sql volatile security definer set search_path = '' as $$
  update public.prescription_pharmacy_suggestions
     set status = 'expired', settled_at = now()
   where status = 'pending' and expires_at <= now() and (p_rx is null or prescription_id = p_rx)
$$;
revoke all on function private.lapse_expired_pharmacy_suggestions(uuid) from public, anon, authenticated;

-- A denied read is evidence only when a real clinician-role account tried it (INV-10). Accounts whose role can never be a clinician write nothing,
-- and one clinician asking about one patient is recorded once an hour, so a page that refreshes cannot flood the audit log.
create function private.audit_pharmacy_denied(p_patient uuid, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not exists (select 1 from public.profiles where id = p_patient)
     or not exists (select 1 from public.profiles me where me.id = (select auth.uid()) and me.role = 'clinician') then
    return;
  end if;
  if exists (select 1 from public.audit_log a
              where a.actor_id = (select auth.uid()) and a.subject_patient_id = p_patient and a.action = 'staff.chart_read' and a.result = 'denied'
                and a.event -> 'sections' ? 'pharmacy_suggestions' and a.created_at > now() - interval '1 hour') then
    return;
  end if;
  perform private.audit_chart_read(p_patient, array['pharmacy_suggestions'], p_reason, 'denied');
end $$;
revoke all on function private.audit_pharmacy_denied(uuid, text) from public, anon, authenticated;

-- One matcher for "which pharmacy catalogue rows can supply each item of a prescription": the item's name key and the EXACT normalised strength
-- (an item with no strength matches any strength, and says so through dose_given), restricted to listable pharmacies. The patient's price comparison
-- (S54) and the clinician's stock flag below both call it, so they cannot disagree on whether a pharmacy carries a medicine. It returns row ids and
-- the stock flag only; the price comparison joins its own price columns back by id.
create function private.pharmacy_item_matches(p_items jsonb)
returns table (ord bigint, pid uuid, med_id uuid, stock text, strength_confirmed boolean, dose_given boolean)
language sql stable security definer set search_path = '' as $$
  with items as (
    select i.ord,
           private.pharmacy_name_key(coalesce(i.item ->> 'drug', i.item ->> 'drug_name', i.item ->> 'name')) as nm,
           regexp_replace(lower(coalesce(i.item ->> 'dose', i.item ->> 'strength', '')), '[^a-z0-9.%/]+', '', 'g') as dose_n
      from jsonb_array_elements(p_items) with ordinality as i(item, ord)),
  cat as materialized (
    select pm.id, pm.pharmacy_partner_id as pid, private.pharmacy_name_key(pm.drug_name) as nk,
           regexp_replace(lower(coalesce(pm.strength, '')), '[^a-z0-9.%/]+', '', 'g') as sn, pm.stock_status
      from public.pharmacy_medications pm
     where pm.is_active and private.pharmacy_partner_listable(pm.pharmacy_partner_id))
  select it.ord, c.pid, c.id, coalesce(c.stock_status::text, 'unknown'), (c.sn = it.dose_n and it.dose_n <> ''), (it.dose_n <> '')
    from items it join cat c on it.nm <> '' and c.nk = it.nm and (it.dose_n = '' or c.sn = it.dose_n)
$$;
revoke all on function private.pharmacy_item_matches(jsonb) from public, anon, authenticated;

create function private.pharmacy_place_key(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(coalesce(private.normalise_term(p), ''), '\s+state$', ''), '')
$$;
revoke all on function private.pharmacy_place_key(text) from public, anon, authenticated;

-- 4. Clinician: the patient's signed prescriptions that still need a pharmacy, and what became of any suggestion. Audited read.
create function public.care_team_prescriptions_for_routing(p_patient uuid, p_reason text)
returns table (prescription_id uuid, rx_state text, item_summary text, signed_at timestamptz,
               suggestion_id uuid, suggestion_status text, suggested_partner_name text, suggested_location_name text, suggested_at timestamptz,
               suggested_by_me boolean, patient_can_confirm boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if not private.may_suggest_pharmacy(p_patient) then
    perform private.audit_pharmacy_denied(p_patient, p_reason);
    return;
  end if;
  perform private.audit_chart_read(p_patient, array['pharmacy_suggestions'], p_reason, 'success');
  perform private.lapse_expired_pharmacy_suggestions();
  return query
    select rx.id, rx.state::text,
           coalesce((select string_agg(coalesce(i ->> 'drug', i ->> 'drug_name', i ->> 'name'), ', ')
                       from jsonb_array_elements(rx.items) i), ''),
           rx.signed_at, s.id,
           -- a pending suggestion the patient can no longer be shown (pharmacy delisted, branch closed, medicine no longer live) is reported as
           -- unavailable, never as "waiting for the patient"
           case when s.status = 'pending' and not (private.pharmacy_partner_listable(s.pharmacy_partner_id) and l.is_active and l.verified_at is not null
                                                   and private.prescription_collectable(rx.id))
                then 'unavailable' else s.status end,
           pp.name, l.name, s.suggested_at, (s.recorded_by = (select auth.uid())),
           not exists (select 1 from public.profiles pt where pt.id = p_patient and pt.is_dependent_account)
      from public.prescriptions rx
      left join lateral (select x.* from public.prescription_pharmacy_suggestions x where x.prescription_id = rx.id
                          order by (x.status = 'pending') desc, x.suggested_at desc, x.id limit 1) s on true
      left join public.pharmacy_partners pp on pp.id = s.pharmacy_partner_id
      left join public.pharmacy_partner_locations l on l.id = s.pharmacy_location_id
     where rx.patient_id = p_patient
       and ((rx.state = 'signed' and private.prescription_collectable(rx.id))
            or (rx.state = 'sent' and s.id is not null and s.suggested_at > now() - make_interval(days => private.pharmacy_suggestion_ttl_days())))
     order by rx.signed_at desc nulls last
     limit 50;
end $$;

-- 5. Clinician: neutral facts about listable pharmacies near the patient, for one signed prescription. Audited read.
--    Reads only: partner and branch name and place, the stock flag of the medicines named on this prescription (exact strength) and the
--    listable rule. It selects no price and no commission, margin or earning column, and its order never depends on one.
create function public.care_team_pharmacy_options(p_patient uuid, p_prescription uuid, p_reason text)
returns table (partner_id uuid, partner_name text, location_id uuid, location_name text, address text, state text,
               proximity text, in_stock text, listable boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  rx public.prescriptions%rowtype;
  v_city text; v_state text; v_total integer; v_items jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if not private.may_suggest_pharmacy(p_patient) then
    perform private.audit_pharmacy_denied(p_patient, p_reason);
    return;
  end if;
  select * into rx from public.prescriptions where id = p_prescription and patient_id = p_patient and state = 'signed';
  if not found or not private.prescription_collectable(rx.id)
     or exists (select 1 from public.profiles where id = p_patient and is_dependent_account) then
    perform private.audit_pharmacy_denied(p_patient, p_reason);
    return;
  end if;
  perform private.audit_chart_read(p_patient, array['pharmacy_suggestions'], p_reason, 'success');
  select private.pharmacy_place_key(pr.city), private.pharmacy_place_key(pr.state) into v_city, v_state from public.profiles pr where pr.id = p_patient;
  if v_city is not null and (char_length(v_city) < 3 or v_city is not distinct from v_state) then v_city := null; end if;
  v_items := rx.items;
  v_total := coalesce(jsonb_array_length(v_items), 0);

  return query
  with items as (
    select i.ord, private.pharmacy_name_key(coalesce(i.item ->> 'drug', i.item ->> 'drug_name', i.item ->> 'name')) as nm
      from jsonb_array_elements(v_items) with ordinality as i(item, ord)),
  loc as (
    select pp.id as pid, pp.name as pname, l.id as lid, l.name as lname, l.address as laddr, l.state as lstate,
           -- same city: the branch's own address names the patient's city, or the pharmacy has ONE branch and that is its city. A partner's single
           -- "city" is a summary and says nothing about a second branch somewhere else, so with several branches only the branch address counts.
           case when v_city is not null
                     and (v_state is null or private.pharmacy_place_key(l.state) is not distinct from v_state)
                     and (position((' ' || v_city || ' ') in (' ' || coalesce(private.normalise_term(l.address), '') || ' ')) > 0
                          or (private.pharmacy_place_key(pp.city) = v_city
                              and (select count(*) from public.pharmacy_partner_locations x where x.pharmacy_partner_id = pp.id and x.is_active and x.verified_at is not null) = 1))
                then 'same_city'
                when v_state is not null and private.pharmacy_place_key(l.state) = v_state then 'same_state'
                when v_state is null or private.pharmacy_place_key(l.state) is null then 'unknown'
                else 'far' end as proximity
      from public.pharmacy_partners pp
      join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id and l.is_active and l.verified_at is not null
     where private.pharmacy_partner_listable(pp.id)),
  matches as materialized (select * from private.pharmacy_item_matches(v_items)),
  per_item as (
    -- one verdict per item per pharmacy, from the shared matcher: no_catalogue (nothing listed, or the item has no name: not known), none (a
    -- catalogue that does not list this item), in (some row in stock or low), unknown (a row with no stock flag), out (every row out)
    select lo.pid, it.ord,
           case when not cat.listed or it.nm = '' then 'no_catalogue'
                when mm.n = 0 then 'none'
                when mm.n_in > 0 then 'in'
                when mm.n_unknown > 0 then 'unknown'
                else 'out' end as verdict
      from (select distinct pid from loc) lo
      cross join items it
      cross join lateral (select exists (select 1 from public.pharmacy_medications pm where pm.pharmacy_partner_id = lo.pid and pm.is_active) as listed) cat
      cross join lateral (select count(*) as n,
                                 count(*) filter (where m.stock in ('in_stock', 'low_stock')) as n_in,
                                 count(*) filter (where m.stock = 'unknown') as n_unknown
                            from matches m where m.pid = lo.pid and m.ord = it.ord) mm),
  stock as (
    select pi.pid,
           case when bool_or(pi.verdict = 'no_catalogue') then 'unknown'
                when bool_or(pi.verdict in ('out', 'none')) then 'no'
                when bool_or(pi.verdict = 'unknown') then 'unknown'
                else 'yes' end as in_stock
      from per_item pi group by pi.pid)
  select lo.pid, lo.pname, lo.lid, lo.lname, lo.laddr, lo.lstate, lo.proximity, coalesce(st.in_stock, 'unknown'), true
    from loc lo left join stock st on st.pid = lo.pid
   where lo.proximity <> 'far' and v_total > 0
   order by case lo.proximity when 'same_city' then 0 when 'same_state' then 1 else 2 end, lo.pname, lo.lname;
end $$;

-- 6. Clinician: suggest one pharmacy. Replaces any earlier pending suggestion for the prescription. Routes nothing.
create function public.care_team_suggest_pharmacy(p_prescription uuid, p_partner uuid, p_location uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  rx public.prescriptions%rowtype; v_id uuid; v_uid uuid := (select auth.uid()); v_replaced boolean; v_pat uuid;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  -- authorise on a plain read first, so a stranger calling this with any prescription id never takes a row lock
  select patient_id into v_pat from public.prescriptions where id = p_prescription;
  if v_pat is null or not private.may_suggest_pharmacy(v_pat) then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into rx from public.prescriptions where id = p_prescription for update;
  if rx.state <> 'signed' or not private.prescription_collectable(rx.id) then raise exception 'suggestion_not_open' using errcode = '22023'; end if;
  -- a dependant's account has nobody who can confirm it (the S28 chooser is patient-only, OQ-332), so a suggestion would wait forever
  if exists (select 1 from public.profiles where id = rx.patient_id and is_dependent_account) then raise exception 'patient_cannot_confirm' using errcode = '22023'; end if;
  if not private.pharmacy_partner_listable(p_partner) or not exists (
       select 1 from public.pharmacy_partner_locations l
        where l.id = p_location and l.pharmacy_partner_id = p_partner and l.is_active and l.verified_at is not null) then
    raise exception 'pharmacy_not_available' using errcode = '22023';
  end if;
  perform private.lapse_expired_pharmacy_suggestions(rx.id);
  -- the patient is told once: replacing a pending suggestion changes the card she already has, it does not send a second notice
  v_replaced := exists (select 1 from public.prescription_pharmacy_suggestions where prescription_id = rx.id and status = 'pending');
  update public.prescription_pharmacy_suggestions set status = 'withdrawn', settled_at = now(), settled_by = v_uid
   where prescription_id = rx.id and status = 'pending';
  insert into public.prescription_pharmacy_suggestions (organisation_id, prescription_id, patient_id, pharmacy_partner_id, pharmacy_location_id, recorded_by, suggested_at, expires_at, is_test)
  values (rx.organisation_id, rx.id, rx.patient_id, p_partner, p_location, v_uid, clock_timestamp(),
          clock_timestamp() + make_interval(days => private.pharmacy_suggestion_ttl_days()), rx.is_test)
  returning id into v_id;
  if not v_replaced then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (rx.organisation_id, rx.patient_id, 'in_app', 'pending', 'pharmacy_suggestion_patient', '{}'::jsonb);
  end if;
  perform private.emit_domain_event('prescription.pharmacy_suggested', rx.organisation_id, jsonb_build_object('prescription_id', rx.id),
    'pharmacy_suggested:' || v_id, rx.patient_id, 'prescription', rx.id);
  perform private.log_audit('prescription.pharmacy_suggested', 'prescriptions', rx.id,
    jsonb_build_object('suggestion_id', v_id, 'pharmacy_partner_id', p_partner, 'pharmacy_location_id', p_location));
  -- the patient id comes back so the screen refreshes the right chart without trusting the form
  return jsonb_build_object('suggestion_id', v_id, 'patient_id', rx.patient_id);
end $$;

create function public.care_team_withdraw_pharmacy_suggestion(p_suggestion uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.prescription_pharmacy_suggestions%rowtype; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into s from public.prescription_pharmacy_suggestions where id = p_suggestion for update;
  if not found or s.recorded_by <> v_uid or not private.may_suggest_pharmacy(s.patient_id) then raise exception 'not authorised' using errcode = '42501'; end if;
  if s.status <> 'pending' then return jsonb_build_object('withdrawn', false, 'patient_id', s.patient_id); end if;
  update public.prescription_pharmacy_suggestions set status = 'withdrawn', settled_at = now(), settled_by = v_uid where id = s.id;
  perform private.log_audit('prescription.pharmacy_suggestion_withdrawn', 'prescriptions', s.prescription_id, jsonb_build_object('suggestion_id', s.id));
  return jsonb_build_object('withdrawn', true, 'patient_id', s.patient_id);
end $$;

-- 7. Patient: the suggestion waiting for her, if any. Only while it can still be acted on (signed, pharmacy still listable).
create function public.patient_pharmacy_suggestion(p_prescription uuid)
returns table (suggestion_id uuid, partner_id uuid, partner_name text, location_id uuid, location_name text, address text, state text, suggested_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.lapse_expired_pharmacy_suggestions(p_prescription);
  return query
    select s.id, pp.id, pp.name, l.id, l.name, l.address, l.state, s.suggested_at
      from public.prescription_pharmacy_suggestions s
      join public.prescriptions rx on rx.id = s.prescription_id
      join public.pharmacy_partners pp on pp.id = s.pharmacy_partner_id
      join public.pharmacy_partner_locations l on l.id = s.pharmacy_location_id
     where s.prescription_id = p_prescription and s.patient_id = (select auth.uid()) and s.status = 'pending' and s.expires_at > now()
       and rx.state = 'signed' and private.prescription_collectable(rx.id) and private.pharmacy_partner_listable(pp.id) and l.is_active and l.verified_at is not null;
end $$;

-- Accepting is the patient choosing that pharmacy through the one S28 door, so every S28 and S54 rule applies. Returns her collection code.
create function public.patient_accept_pharmacy_suggestion(p_suggestion uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.prescription_pharmacy_suggestions%rowtype; v_code text; v_rx uuid;
begin
  -- lock order is the prescription first, then the suggestion (the order care_team_suggest_pharmacy takes), so the two cannot deadlock
  select prescription_id into v_rx from public.prescription_pharmacy_suggestions where id = p_suggestion and patient_id = (select auth.uid());
  if v_rx is null then raise exception 'suggestion_not_open' using errcode = '22023'; end if;
  perform 1 from public.prescriptions where id = v_rx for update;
  select * into s from public.prescription_pharmacy_suggestions where id = p_suggestion and patient_id = (select auth.uid()) and status = 'pending' for update;
  -- S28's chooser is the patient herself only (patient_id = auth.uid()); acting-for is deliberately NOT wider here. An expired suggestion is refused.
  if not found or s.expires_at <= now() then raise exception 'suggestion_not_open' using errcode = '22023'; end if;
  v_code := public.patient_choose_pharmacy(s.prescription_id, s.pharmacy_partner_id, s.pharmacy_location_id);
  return v_code;
end $$;

create function public.patient_decline_pharmacy_suggestion(p_suggestion uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare s public.prescription_pharmacy_suggestions%rowtype;
begin
  select * into s from public.prescription_pharmacy_suggestions where id = p_suggestion and patient_id = (select auth.uid()) and status = 'pending' for update;
  if not found then return false; end if;
  update public.prescription_pharmacy_suggestions set status = 'declined', settled_at = now(), settled_by = (select auth.uid()) where id = s.id;
  perform private.log_audit('prescription.pharmacy_suggestion_declined', 'prescriptions', s.prescription_id, jsonb_build_object('suggestion_id', s.id));
  return true;
end $$;

-- 8. A pending suggestion settles itself when the prescription moves, through whichever door: sent to the suggested branch = accepted,
--    sent anywhere else = chose_other, cancelled or dispensed first = lapsed.
create function private.settle_pharmacy_suggestions() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'sent' and (old.state is distinct from 'sent' or new.pharmacy_partner_id is distinct from old.pharmacy_partner_id
                             or new.pharmacy_location_id is distinct from old.pharmacy_location_id) then
    if coalesce(current_setting('tarragon.rx_route', true), '') = 'on' then
      -- routed by the patient's own choice (the flag patient_choose_pharmacy sets for its one statement)
      update public.prescription_pharmacy_suggestions s
         set status = case when s.pharmacy_partner_id = new.pharmacy_partner_id and s.pharmacy_location_id = new.pharmacy_location_id
                           then 'accepted' else 'chose_other' end,
             settled_at = now(), settled_by = (select auth.uid())
       where s.prescription_id = new.id and s.status = 'pending';
    else
      -- routed some other way (a prescriber, a maintenance script): the patient confirmed nothing, so the suggestion is never recorded as hers
      update public.prescription_pharmacy_suggestions s set status = 'lapsed', settled_at = now()
       where s.prescription_id = new.id and s.status = 'pending';
    end if;
  elsif new.state in ('cancelled', 'dispensed') and old.state is distinct from new.state then
    update public.prescription_pharmacy_suggestions s set status = 'lapsed', settled_at = now()
     where s.prescription_id = new.id and s.status = 'pending';
  end if;
  return null;
end $$;
revoke all on function private.settle_pharmacy_suggestions() from public, anon, authenticated;
create trigger prescriptions_settle_pharmacy_suggestions after update of state, pharmacy_partner_id, pharmacy_location_id on public.prescriptions
  for each row execute function private.settle_pharmacy_suggestions();

-- 9. Grants: every caller is a signed-in user; the functions check who she is.
revoke all on function public.care_team_prescriptions_for_routing(uuid, text) from public, anon;
revoke all on function public.care_team_pharmacy_options(uuid, uuid, text) from public, anon;
revoke all on function public.care_team_suggest_pharmacy(uuid, uuid, uuid) from public, anon;
revoke all on function public.care_team_withdraw_pharmacy_suggestion(uuid) from public, anon;
revoke all on function public.patient_pharmacy_suggestion(uuid) from public, anon;
revoke all on function public.patient_accept_pharmacy_suggestion(uuid) from public, anon;
revoke all on function public.patient_decline_pharmacy_suggestion(uuid) from public, anon;
grant execute on function public.care_team_prescriptions_for_routing(uuid, text) to authenticated;
grant execute on function public.care_team_pharmacy_options(uuid, uuid, text) to authenticated;
grant execute on function public.care_team_suggest_pharmacy(uuid, uuid, uuid) to authenticated;
grant execute on function public.care_team_withdraw_pharmacy_suggestion(uuid) to authenticated;
grant execute on function public.patient_pharmacy_suggestion(uuid) to authenticated;
grant execute on function public.patient_accept_pharmacy_suggestion(uuid) to authenticated;
grant execute on function public.patient_decline_pharmacy_suggestion(uuid) to authenticated;

-- 10. Assertions
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.care_team_prescriptions_for_routing(uuid,text)', 'public.care_team_pharmacy_options(uuid,uuid,text)', 'public.care_team_suggest_pharmacy(uuid,uuid,uuid)',
    'public.care_team_withdraw_pharmacy_suggestion(uuid)', 'public.patient_pharmacy_suggestion(uuid)', 'public.patient_accept_pharmacy_suggestion(uuid)',
    'public.patient_decline_pharmacy_suggestion(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S54c: anon can execute %', v_fn; end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'S54c: authenticated cannot execute %', v_fn; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.prescription_pharmacy_suggestions', 'INSERT')
     or has_table_privilege('authenticated', 'public.prescription_pharmacy_suggestions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.prescription_pharmacy_suggestions', 'DELETE')
     or has_table_privilege('anon', 'public.prescription_pharmacy_suggestions', 'SELECT') then
    raise exception 'S54c: the suggestion table is writable by a client or readable by anon';
  end if;
  if pg_get_functiondef('public.care_team_pharmacy_options(uuid,uuid,text)'::regprocedure) ~* '\y(commission|margin|earn|payout|rate_bps|price_kobo)'
     or pg_get_functiondef('public.care_team_prescriptions_for_routing(uuid,text)'::regprocedure) ~* '\y(commission|margin|earn|payout|rate_bps|price_kobo)'
     or pg_get_functiondef('public.care_team_suggest_pharmacy(uuid,uuid,uuid)'::regprocedure) ~* '\y(commission|margin|earn|payout|rate_bps|price_kobo)' then
    raise exception 'S54c: a clinician-facing function mentions an earning or a price';
  end if;
  if to_regprocedure('public.patient_choose_pharmacy(uuid,uuid,uuid,uuid)') is null then
    raise exception 'S54c: S28 patient_choose_pharmacy is required (this migration is stacked on S28)';
  end if;
end $$;

-- 10. The patient's price comparison (S54) now reads its matches from the shared matcher above. Same columns, same order, same refusals.
create or replace function public.patient_price_compare(p_prescription uuid)
returns table (partner_id uuid, partner_name text, location_id uuid, location_name text, state text, address text,
               items_total integer, items_matched integer, total_kobo bigint, all_in_stock boolean, any_low_stock boolean,
               all_verified_batch boolean, prices_updated_at timestamptz, lines jsonb)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  rx public.prescriptions%rowtype;
  v_uid uuid := (select auth.uid());
  v_total integer;
begin
  select * into rx from public.prescriptions where id = p_prescription and state in ('signed', 'sent');
  if not found or v_uid is null
     or not (rx.patient_id = v_uid or private.can_act_for(rx.patient_id, 'manage_pharmacy'::public.caregiver_permission)) then
    raise exception 'Prescription not found' using errcode = '42501';
  end if;
  v_total := coalesce(jsonb_array_length(rx.items), 0);

  return query
  with cand as (
    select mm.ord, mm.pid, pm.drug_name, pm.pack_size, pm.price_kobo, mm.stock, pm.verified_batch, pm.strength,
           mm.strength_confirmed, mm.dose_given, coalesce(pm.stock_updated_at, pm.created_at) as updated
      from private.pharmacy_item_matches(rx.items) mm
      join public.pharmacy_medications pm on pm.id = mm.med_id),
  best as (
    -- one line per item per pharmacy: the cheapest row that is not out of stock, else the cheapest row
    select distinct on (c.pid, c.ord) c.*
      from cand c
     order by c.pid, c.ord, (not c.strength_confirmed and c.dose_given), (c.stock = 'unavailable'), c.price_kobo, c.drug_name),
  agg as (
    select b.pid,
           count(*)::integer as matched,
           sum(b.price_kobo)::bigint as total,
           bool_and(b.stock in ('in_stock', 'low_stock')) as all_in,
           bool_or(b.stock = 'low_stock') as any_low,
           bool_and(b.verified_batch) as all_vb,
           min(b.updated) as upd,
           jsonb_agg(jsonb_build_object('item', b.ord, 'drug', b.drug_name, 'pack', b.pack_size, 'price_kobo', b.price_kobo,
                                        'stock', b.stock, 'verified_batch', b.verified_batch, 'strength_confirmed', b.strength_confirmed)
                     order by b.ord) as lines
      from best b group by b.pid)
  select pp.id, pp.name, l.id, l.name, l.state, l.address, v_total, a.matched, a.total, a.all_in, a.any_low, a.all_vb, a.upd, a.lines
    from agg a
    join public.pharmacy_partners pp on pp.id = a.pid
    join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id and l.is_active and l.verified_at is not null
   order by a.matched desc, a.all_in desc, a.total asc, pp.name, l.name;
end $$;
