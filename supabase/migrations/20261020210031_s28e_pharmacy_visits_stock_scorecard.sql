-- S28e: pharmacy readiness and reach (docs/research/S26-S30-competitor-review-and-build-plan.md, S28e; OQ-275; spec 9.6, 21.7; Part C.2).
--
-- What this adds, on top of the live S28 / S28c / S54c / S74 / OQ-276 pharmacy code (every function restated below was read from its live definition
-- first, and only the marked lines changed):
--   1. ONE VISIT, SEVERAL MEDICINES (OQ-275 option a). S24 signs one medicine per prescription, so a patient with three medicines chose a pharmacy three
--      times and carried three codes. A patient can now choose one pharmacy for several waiting prescriptions and gets ONE code for the visit
--      (patient_choose_pharmacy_for_visit). A signed prescription is never altered (INV-02): the visit only groups routing and the code. At the counter
--      each prescription is still its own item: its own full or partial supply, its own controlled-medicine check (OQ-276), and the SAME shared supply
--      count and row lock as before (nothing about counting changes). The wrong-try count and the lock belong to the visit, so cycling through the
--      members of a visit gives no more guesses than one prescription gets.
--   2. STOCK CONFIRMATION, YES OR NO. A pharmacy confirms for a prescription sent to it: "we have this" (yes) or "we cannot supply this" (no, which is the
--      existing out-of-stock report, so the patient is told and can choose another pharmacy). No price is stored, shown or compared here (OQ-283). A
--      controlled medicine is never confirmed (OQ-276). A confirmation dies when the patient changes pharmacy or takes a new code.
--   3. PHARMACY SCORECARD (spec 21.7). Adds turnaround to dispense (sent to fully supplied), flags raised and out-of-stock reports to the S74 partner
--      quality figures, and a desk read (pharmacy_scorecard). For a pharmacy, a breach is a SUGGESTION for staff to look at, never an automatic
--      removal: the S74 rule that suspends from new work by itself stays as it was for laboratories and clinics (config removal.suggest_only_kinds).
--      A person can still suspend a pharmacy from new work with a written reason (suspend_partner_from_new_work, unchanged), and an expired licence
--      already stops a pharmacy being offered to patients (pharmacy_location_choosable).
--
-- Live counts at write time (2026-10-16): pharmacy_partners active 0, prescription_collection_codes 0, prescription_pharmacy_flags 0, partner_quality
-- rows for a pharmacy 0. So no conversion step exists; this is structural only. The go-live guard (prescribing_enabled) is untouched and stays OFF.
-- Part C.2: no home delivery, no price comparison, no supplier or consignment role, no chat. Nothing here adds one.
--
-- Lessons applied: new table gets its own grant and RLS (default privileges give anon nothing); anon EXECUTE is revoked from PUBLIC; every
-- restated function keeps its live signature (no new overload of a function that is called with untyped literals); the version is the filename.

-- ---------------------------------------------------------------------------
-- 1. Versioned rules. pharmacy_config v3 adds the visit size; partner_quality_config v2 adds the pharmacy figures. Both PROPOSED (CMO and pharmacy
--    lead, OQ-360); mirrored in packages/shared proposed-config with drift tests.
-- ---------------------------------------------------------------------------
-- Fail loudly, never revert silently: the new rows below carry the values the previous active rows had when this was written. If either active row has
-- been changed since (a new version adopted by the CMO or the pharmacy lead), this migration stops instead of putting the old numbers back.
do $$
begin
  if (select config from public.pharmacy_config where is_active) is distinct from '{"code_length": 8, "code_valid_days": 14, "max_wrong_attempts": 5, "suggestion_valid_days": 14}'::jsonb then
    raise exception 'S28e: the active pharmacy_config is no longer the S54c version; rebase this migration on its current values';
  end if;
  if (select rules from public.partner_quality_config where is_active) is distinct from $q$
{
  "window_days": 90,
  "turnaround": { "lab_target_hours": 72, "min_orders": 10, "min_within_target_percent": 80 },
  "complaints": { "category_codes": ["late_result", "wrong_result", "communication", "charge_dispute", "safety", "licence", "other"], "upheld_limit": 3 },
  "licence": { "expiring_days": 30 },
  "weights": { "turnaround": 40, "complaints": 30, "licence": 30 },
  "score": { "warn_below": 70, "suspend_below": 50 },
  "removal": { "auto_suspend": true, "suspend_on": ["licence_expired", "complaints_upheld_limit", "turnaround_below_target", "score_below_floor"], "override_days": 30, "reason_min_chars": 20 }
}
$q$::jsonb then
    raise exception 'S28e: the active partner_quality_config is no longer the S74 version; rebase this migration on its current values';
  end if;
end $$;

update public.pharmacy_config set is_active = false where is_active;
-- pharmacy-rules-v3-begin
insert into public.pharmacy_config (version, is_active, config)
select coalesce(max(version), 1) + 1, true, $json$
{"code_length": 8, "code_valid_days": 14, "max_wrong_attempts": 5, "suggestion_valid_days": 14, "max_items_per_visit": 10}
$json$::jsonb from public.pharmacy_config;
-- pharmacy-rules-v3-end

create function private.pharmacy_max_items_per_visit() returns integer language sql stable security definer set search_path = '' as
$$ select greatest(2, coalesce((private.pharmacy_cfg() ->> 'max_items_per_visit')::integer, 10)) $$;
revoke all on function private.pharmacy_max_items_per_visit() from public, anon, authenticated;

update public.partner_quality_config set is_active = false where is_active;
-- partner-quality-v2-begin
insert into public.partner_quality_config (version, is_active, effective_from, rules)
select coalesce(max(version), 1) + 1, true, '2026-10-16', $json$
{
  "window_days": 90,
  "turnaround": { "lab_target_hours": 72, "min_orders": 10, "min_within_target_percent": 80 },
  "pharmacy": { "dispense_target_hours": 72, "min_dispenses": 10, "min_within_target_percent": 70, "min_sent": 10, "out_of_stock_percent": 30 },
  "complaints": { "category_codes": ["late_result", "wrong_result", "communication", "charge_dispute", "safety", "licence", "other"], "upheld_limit": 3 },
  "licence": { "expiring_days": 30 },
  "weights": { "turnaround": 40, "complaints": 30, "licence": 30 },
  "score": { "warn_below": 70, "suspend_below": 50 },
  "removal": { "auto_suspend": true, "suspend_on": ["licence_expired", "complaints_upheld_limit", "turnaround_below_target", "score_below_floor"], "suggest_only_kinds": ["pharmacy"], "override_days": 30, "reason_min_chars": 20 }
}
$json$::jsonb from public.partner_quality_config;
-- partner-quality-v2-end

-- ---------------------------------------------------------------------------
-- 2. The visit: one code for several prescriptions sent to one pharmacy together
-- ---------------------------------------------------------------------------
create table public.pharmacy_collection_visits (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  patient_id           uuid not null references public.profiles (id) on delete restrict,
  pharmacy_partner_id  uuid not null references public.pharmacy_partners (id) on delete restrict,
  pharmacy_location_id uuid references public.pharmacy_partner_locations (id) on delete restrict,
  wrong_attempts       integer not null default 0,
  locked_at            timestamptz,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now()
);
create index pharmacy_collection_visits_patient_idx on public.pharmacy_collection_visits (patient_id);
create index pharmacy_collection_visits_partner_idx on public.pharmacy_collection_visits (pharmacy_partner_id);
create index pharmacy_collection_visits_org_idx on public.pharmacy_collection_visits (organisation_id);
create index pharmacy_collection_visits_location_idx on public.pharmacy_collection_visits (pharmacy_location_id);
comment on table public.pharmacy_collection_visits is
  'S28e: several prescriptions a patient sent to one pharmacy together under one collection code. The code itself lives only on the members'' prescription_collection_codes rows (one copy of the secret); this row is the visit''s identity and the authority for its wrong-try count and lock. The patient reads her own; the pharmacy never reads it, it can only test a guess (pharmacist_verify_visit).';
alter table public.pharmacy_collection_visits enable row level security;
revoke all on public.pharmacy_collection_visits from public, anon, authenticated;
grant select on public.pharmacy_collection_visits to authenticated;
create policy pharmacy_collection_visits_patient_select on public.pharmacy_collection_visits
  for select to authenticated using (patient_id = (select auth.uid()));

alter table public.prescription_collection_codes
  add column visit_id uuid references public.pharmacy_collection_visits (id) on delete set null,
  add column stock_confirmed_at timestamptz;
create index prescription_collection_codes_visit_idx on public.prescription_collection_codes (visit_id);
comment on column public.prescription_collection_codes.visit_id is 'S28e: the visit this prescription was sent in. Null for a prescription sent on its own, or after a new code or a change of pharmacy took it out of the visit.';
comment on column public.prescription_collection_codes.stock_confirmed_at is 'S28e: the pharmacy confirmed it has this item (yes only; "no" is the out-of-stock report). Cleared when the code, pharmacy or location changes. No price.';

-- A change of code, pharmacy or location takes a prescription out of its visit (its code is no longer the visit's) and clears the stock
-- confirmation (it was about the old pharmacy, or a new send). Setting visit_id in the same statement as the code (as the visit function does) keeps it in.
-- The one other way a code changes without leaving the visit is patient_new_visit_code, which renews the whole visit's code and says so with the
-- transaction flag tarragon.visit_code, so the members stay together and keep the pharmacy's stock answers.
create function private.collection_code_reset_on_change() returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('tarragon.visit_code', true), '') = 'on' then return new; end if;
  if new.code is distinct from old.code or new.pharmacy_partner_id is distinct from old.pharmacy_partner_id
     or new.pharmacy_location_id is distinct from old.pharmacy_location_id then
    new.stock_confirmed_at := null;
    if new.visit_id is not distinct from old.visit_id then new.visit_id := null; end if;
  end if;
  return new;
end $$;
revoke all on function private.collection_code_reset_on_change() from public, anon, authenticated;
create trigger prescription_collection_codes_reset_on_change before update on public.prescription_collection_codes
  for each row execute function private.collection_code_reset_on_change();

-- The tests for the code are visit-aware. Live definition read first (S28 migration); changed only where marked S28e. The visit's own row is the
-- authority for the lock and the wrong-try count (it is locked before the code row). Copying the count onto the other members is only for display
-- and uses SKIP LOCKED, so a counter call never waits on a member row that a patient call (which locks prescription then code row, in id order)
-- holds: waiting there could deadlock against a patient sending the visit at the same moment, and a rolled-back wrong try would weaken the lockout.
create or replace function private.check_collection_code(p_rx uuid, p_code text, p_partner uuid) returns text language plpgsql security definer set search_path = '' as $$
declare c public.prescription_collection_codes%rowtype; v public.pharmacy_collection_visits%rowtype; v_visit uuid;
  v_max integer := coalesce((private.pharmacy_cfg() ->> 'max_wrong_attempts')::integer, 5); v_in text := upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')); v_n integer;
begin
  -- S28e: lock the visit (if any) before the code row
  select cc.visit_id into v_visit from public.prescription_collection_codes cc where cc.prescription_id = p_rx and cc.pharmacy_partner_id = p_partner;
  if v_visit is not null then
    select * into v from public.pharmacy_collection_visits where id = v_visit and pharmacy_partner_id = p_partner for update;
    -- a code row that points at a visit this pharmacy cannot see must never be tried without a count: fail closed
    if not found then return 'not_found'; end if;
  end if;
  select * into c from public.prescription_collection_codes where prescription_id = p_rx and pharmacy_partner_id = p_partner for update;
  if not found then return 'not_found'; end if;
  -- the patient took it out of the visit between the two reads: start again on the new footing
  if c.visit_id is distinct from v_visit then return private.check_collection_code(p_rx, p_code, p_partner); end if;
  if c.used_at is not null then return 'already_collected'; end if;
  if c.locked_at is not null or v.locked_at is not null then return 'locked'; end if;
  if c.code_expires_at < now() then return 'expired'; end if;
  if v_in <> c.code then
    if v_visit is not null then
      -- S28e: the try counts against the whole visit; the visit row decides the lock for every member (checked above), the copy on the members is display
      v_n := v.wrong_attempts + 1;
      update public.pharmacy_collection_visits set wrong_attempts = v_n, locked_at = case when v_n >= v_max then now() end where id = v_visit;
      update public.prescription_collection_codes set wrong_attempts = v_n, locked_at = case when v_n >= v_max then now() end
       where prescription_id in (select m.prescription_id from public.prescription_collection_codes m where m.visit_id = v_visit and m.used_at is null for update skip locked);
    else
      v_n := c.wrong_attempts + 1;
      update public.prescription_collection_codes set wrong_attempts = v_n, locked_at = case when v_n >= v_max then now() end where prescription_id = p_rx;
    end if;
    perform private.log_audit('pharmacy.collection_code_failed', 'prescriptions', p_rx, jsonb_build_object('pharmacy_partner_id', p_partner, 'attempt', v_n, 'locked', v_n >= v_max, 'visit', v_visit is not null));
    return case when v_n >= v_max then 'locked' else 'wrong_code' end;
  end if;
  return 'ok';
end $$;
revoke all on function private.check_collection_code(uuid, text, uuid) from public, anon, authenticated;

-- A short readable name for the one item on a prescription. The signing path writes drug_name; older rows used drug, name or medication.
create function private.rx_item_label(p_items jsonb) returns text language sql immutable set search_path = '' as $$
  select coalesce(nullif(btrim(e ->> 'drug_name'), ''), nullif(btrim(e ->> 'drug'), ''), nullif(btrim(e ->> 'name'), ''), nullif(btrim(e ->> 'medication'), ''))
    from (select case when jsonb_typeof(p_items) = 'array' then p_items -> 0 else null end as e) x
$$;
revoke all on function private.rx_item_label(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Patient: choose once for several prescriptions; read the visit; list what is waiting
-- ---------------------------------------------------------------------------
-- Every prescription goes through the SAME single door (patient_choose_pharmacy: owner or acting caregiver, verified listable pharmacy, a supply still
-- permitted, S54 and S74 rules, audit, events), all in this one transaction, so any refusal stops the whole call and nothing is half sent.
-- Afterwards the members share one new code. Returns that code.
create function public.patient_choose_pharmacy_for_visit(p_prescriptions uuid[], p_partner uuid, p_location uuid, p_beneficiary uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_pat uuid := private.rx_patient(p_beneficiary);
  v_ids uuid[]; v_id uuid; v_visit uuid; v_code text; v_org uuid; v_test boolean;
  v_len integer := coalesce((private.pharmacy_cfg() ->> 'code_length')::integer, 8); v_days integer := coalesce((private.pharmacy_cfg() ->> 'code_valid_days')::integer, 14);
begin
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  -- the patient herself only (see patient_new_visit_code): a caregiver sends one prescription at a time, as in S28c
  if v_pat <> (select auth.uid()) then raise exception 'not_permitted_for_this_person' using errcode = '42501'; end if;
  select array_agg(x order by x) into v_ids from (select distinct unnest(coalesce(p_prescriptions, '{}'::uuid[])) as x) s;
  if v_ids is null or cardinality(v_ids) < 2 or cardinality(v_ids) > private.pharmacy_max_items_per_visit() then
    raise exception 'visit_size_invalid' using errcode = '22023';
  end if;
  if (select count(*) from public.prescriptions rx where rx.id = any (v_ids) and rx.patient_id = v_pat) <> cardinality(v_ids) then
    raise exception 'Prescription not found' using errcode = '42501';
  end if;
  foreach v_id in array v_ids loop   -- ascending id order: concurrent visits lock in the same order
    perform public.patient_choose_pharmacy(v_id, p_partner, p_location, p_beneficiary);
  end loop;
  select rx.organisation_id, rx.is_test into v_org, v_test from public.prescriptions rx where rx.id = v_ids[1];
  v_code := private.new_collection_code(v_len);
  insert into public.pharmacy_collection_visits (organisation_id, patient_id, pharmacy_partner_id, pharmacy_location_id, is_test)
  values (v_org, v_pat, p_partner, p_location, v_test) returning id into v_visit;
  update public.prescription_collection_codes set visit_id = v_visit, code = v_code, code_expires_at = now() + make_interval(days => v_days),
         wrong_attempts = 0, locked_at = null, used_at = null
   where prescription_id = any (v_ids);
  perform private.log_audit('prescription.pharmacy_visit_chosen', 'pharmacy_collection_visits', v_visit,
    jsonb_build_object('pharmacy_partner_id', p_partner, 'items', cardinality(v_ids), 'acted_for', v_pat <> (select auth.uid())));
  return v_code;
end $$;

-- The prescriptions sent in the same visit as this one (including itself), for the patient's own page. Empty when it was sent on its own.
-- Only the patient herself: a caregiver acting for her can choose and renew one prescription at a time (S28c) but is not shown the names of her other
-- waiting medicines here, because those names can include a confidential category (reproductive or sexual health) and this bulk read has no category check.
create function public.patient_collection_visit(p_prescription uuid, p_beneficiary uuid default null)
returns table (prescription_id uuid, medicine text, state text, collected boolean, stock_confirmed_at timestamptz, other_pharmacy_needed boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_pat uuid := private.rx_patient(p_beneficiary); v_visit uuid;
begin
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  if v_pat <> (select auth.uid()) then return; end if;
  select c.visit_id into v_visit from public.prescription_collection_codes c where c.prescription_id = p_prescription and c.patient_id = v_pat;
  if v_visit is null then return; end if;
  return query
    select rx.id, private.rx_item_label(rx.items), rx.state::text, c.used_at is not null, c.stock_confirmed_at,
           (rx.state = 'sent' and exists (select 1 from public.prescription_pharmacy_flags f
                                           where f.prescription_id = rx.id and f.kind = 'out_of_stock' and f.pharmacy_partner_id = rx.pharmacy_partner_id
                                             and f.created_at >= coalesce(rx.chosen_by_patient_at, rx.created_at)))
      from public.prescription_collection_codes c join public.prescriptions rx on rx.id = c.prescription_id
     where c.visit_id = v_visit and c.patient_id = v_pat
     order by rx.created_at, rx.id;
end $$;

-- Everything of hers that is waiting to be sent or has been sent and not yet collected: one read for the phone and for the "also send" list.
-- Her own code is shown to her (as in patient_prescription_collection); nothing is shown to anyone else, including a caregiver acting for her (see above:
-- the answer is empty for a caregiver, so the "also send" ticks and the phone card are the patient's own).
create function public.patient_collection_overview(p_beneficiary uuid default null)
returns table (prescription_id uuid, medicine text, state text, visit_id uuid, pharmacy_name text, location_name text, address text, code text,
               code_expires_at timestamptz, locked boolean, expired boolean, stock_confirmed_at timestamptz, other_pharmacy_needed boolean, controlled boolean,
               pharmacy_partner_id uuid, pharmacy_location_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare v_pat uuid := private.rx_patient(p_beneficiary);
begin
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  if v_pat <> (select auth.uid()) then return; end if;
  return query
    select rx.id, private.rx_item_label(rx.items), rx.state::text, c.visit_id, pp.name, l.name, l.address,
           c.code, c.code_expires_at, coalesce(c.locked_at is not null or vz.locked_at is not null, false), coalesce(c.code_expires_at < now(), false), c.stock_confirmed_at,
           (rx.state = 'sent' and exists (select 1 from public.prescription_pharmacy_flags f
                                           where f.prescription_id = rx.id and f.kind = 'out_of_stock' and f.pharmacy_partner_id = rx.pharmacy_partner_id
                                             and f.created_at >= coalesce(rx.chosen_by_patient_at, rx.created_at))),
           private.prescription_has_controlled_item((select m.drug_name from public.medications m where m.prescription_id = rx.id and m.source = 'clinician' limit 1), rx.items),
           case when rx.state = 'sent' then rx.pharmacy_partner_id end, case when rx.state = 'sent' then rx.pharmacy_location_id end
      from public.prescriptions rx
      left join public.prescription_collection_codes c on c.prescription_id = rx.id and rx.state = 'sent'
      left join public.pharmacy_collection_visits vz on vz.id = c.visit_id
      left join public.pharmacy_partners pp on pp.id = rx.pharmacy_partner_id and rx.state = 'sent'
      left join public.pharmacy_partner_locations l on l.id = rx.pharmacy_location_id and rx.state = 'sent'
     where rx.patient_id = v_pat and (rx.state = 'sent' or private.prescription_collectable(rx.id))
       and (rx.state <> 'sent' or c.used_at is null)
     order by (rx.state = 'sent') desc, rx.created_at desc, rx.id
     limit 200;   -- far more than anyone has waiting; sent ones come first because they carry the codes
end $$;

-- A new code for the WHOLE visit (the old one stops working at once; a lock is cleared). patient_new_collection_code is for one prescription and takes
-- it out of its visit; this keeps the members together, keeps the pharmacy's stock answers and does not resend anything to the pharmacy (no new notice,
-- no new send time), unlike choosing the pharmacy again. Lock order: the visit, then the members' code rows in id order.
create function public.patient_new_visit_code(p_prescription uuid, p_beneficiary uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_pat uuid := private.rx_patient(p_beneficiary); v_visit uuid; v_org uuid; v_code text; v_n integer;
  v_len integer := coalesce((private.pharmacy_cfg() ->> 'code_length')::integer, 8); v_days integer := coalesce((private.pharmacy_cfg() ->> 'code_valid_days')::integer, 14);
begin
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  -- The patient herself only. One code opens EVERY medicine in the visit at the counter (names, allergies, patient details), and a caregiver is deliberately
  -- not shown her other medicines (they can be a confidential category), so a caregiver may not mint or renew a code that reaches all of them.
  if v_pat <> (select auth.uid()) then raise exception 'not_permitted_for_this_person' using errcode = '42501'; end if;
  select cc.visit_id, cc.organisation_id into v_visit, v_org from public.prescription_collection_codes cc where cc.prescription_id = p_prescription and cc.patient_id = v_pat;
  if v_visit is null then raise exception 'collection_not_open' using errcode = '22023'; end if;
  perform 1 from public.pharmacy_collection_visits where id = v_visit and patient_id = v_pat for update;
  if not found then raise exception 'collection_not_open' using errcode = '22023'; end if;
  perform 1 from public.prescription_collection_codes cc join public.prescriptions rx on rx.id = cc.prescription_id
   where cc.visit_id = v_visit and cc.used_at is null and rx.state = 'sent' order by cc.prescription_id for update of cc;
  get diagnostics v_n = row_count;
  -- the prescription asked about must still be a waiting member of this visit now that the visit is locked (the first read was not under a lock: a
  -- new code or a change of pharmacy for it may have taken it out in between), otherwise the code returned would not apply to it
  if v_n = 0 or not exists (select 1 from public.prescription_collection_codes cc where cc.prescription_id = p_prescription and cc.visit_id = v_visit and cc.used_at is null) then
    raise exception 'collection_not_open' using errcode = '22023';
  end if;
  v_code := private.new_collection_code(v_len);
  perform set_config('tarragon.visit_code', 'on', true);
  update public.pharmacy_collection_visits set wrong_attempts = 0, locked_at = null where id = v_visit;
  update public.prescription_collection_codes cc set code = v_code, code_expires_at = now() + make_interval(days => v_days), wrong_attempts = 0, locked_at = null
   from public.prescriptions rx where rx.id = cc.prescription_id and cc.visit_id = v_visit and cc.used_at is null and rx.state = 'sent';
  perform set_config('tarragon.visit_code', 'off', true);
  perform private.log_audit('prescription.visit_code_renewed', 'pharmacy_collection_visits', v_visit, jsonb_build_object('items', v_n, 'acted_for', v_pat <> (select auth.uid())));
  return v_code;
end $$;

-- The two older readers that show "locked" now read the visit's own lock as well, because the copy of the lock on the other members is only a best-effort
-- display copy (see check_collection_code). Restated from their live definitions (S28c); the only change is the join to the visit and the locked test.
create or replace function public.patient_prescription_collection(p_prescription uuid, p_beneficiary uuid default null)
returns table (state text, pharmacy_name text, location_name text, address text, code text, code_expires_at timestamptz, locked boolean, expired boolean, collected boolean,
               can_repeat boolean, other_pharmacy_needed boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_pat uuid := private.rx_patient(p_beneficiary);
begin
  return query
    select rx.state::text, pp.name, l.name, l.address, c.code, c.code_expires_at, (c.locked_at is not null or vz.locked_at is not null), c.code_expires_at < now(), c.used_at is not null,
           (rx.state = 'dispensed' and private.pharmacy_collection_on() and private.supplies_remaining(rx.id) >= 1
              and exists (select 1 from public.medications m where m.prescription_id = rx.id and m.is_active and m.superseded_at is null and (m.expires_at is null or m.expires_at > now()))),
           (rx.state = 'sent' and exists (select 1 from public.prescription_pharmacy_flags f
                                           where f.prescription_id = rx.id and f.kind = 'out_of_stock' and f.pharmacy_partner_id = rx.pharmacy_partner_id
                                             and f.created_at >= coalesce(rx.chosen_by_patient_at, rx.created_at)))
      from public.prescriptions rx
      left join public.prescription_collection_codes c on c.prescription_id = rx.id
      left join public.pharmacy_collection_visits vz on vz.id = c.visit_id
      left join public.pharmacy_partners pp on pp.id = rx.pharmacy_partner_id
      left join public.pharmacy_partner_locations l on l.id = rx.pharmacy_location_id
     where rx.id = p_prescription and rx.patient_id = v_pat and rx.state <> 'draft';
end $$;

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
           l.name, coalesce(c.locked_at is not null or vz.locked_at is not null, false)
      from public.prescriptions rx
      join public.profiles p on p.id = rx.patient_id
      left join public.pharmacy_partner_locations l on l.id = rx.pharmacy_location_id
      left join public.prescription_collection_codes c on c.prescription_id = rx.id
      left join public.pharmacy_collection_visits vz on vz.id = c.visit_id
     where rx.id = any (v_ids)
     order by coalesce(rx.sent_at, rx.created_at) desc;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Pharmacy: stock yes or no, the visit at the counter
-- ---------------------------------------------------------------------------
-- "We have this" (yes) or "we cannot supply this" (no). No quantity, no price. A controlled medicine gets neither answer (OQ-276).
-- Outcomes: confirmed, out_of_stock, controlled_medicine, already_reported, not_found. A "no" cannot be taken back: it has told the patient, opened a task
-- for the care team and counts in the scorecard, so a later "yes" for the same send is refused as already_reported (the patient sends it again if the
-- "no" was a mistake, which is a new send and a new answer).
create function public.pharmacist_confirm_stock(p_prescription uuid, p_in_stock boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare v_partner uuid := private.pharmacist_partner(); rx public.prescriptions%rowtype; c public.prescription_collection_codes%rowtype; v_drug text;
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  if p_in_stock is null then raise exception 'say yes or no' using errcode = '22023'; end if;
  select * into rx from public.prescriptions where id = p_prescription and pharmacy_partner_id = v_partner and state = 'sent' for update;
  if not found then return 'not_found'; end if;
  select * into c from public.prescription_collection_codes where prescription_id = rx.id and pharmacy_partner_id = v_partner for update;
  if not found then return 'not_found'; end if;
  -- A controlled medicine is neither confirmed nor reported as out of stock through this door, whichever the answer: the counter refuses it at every step
  -- (OQ-276), so a "no" here would only open a clinical task and add a false out-of-stock mark against the pharmacy. Nothing is recorded but the refusal.
  select m.drug_name into v_drug from public.medications m where m.prescription_id = rx.id and m.source = 'clinician' limit 1;
  if private.prescription_has_controlled_item(v_drug, rx.items) then
    perform private.log_audit('pharmacy.controlled_medicine_refused', 'prescriptions', rx.id, jsonb_build_object('step', 'stock', 'pharmacy_partner_id', v_partner));
    return 'controlled_medicine';
  end if;
  if not p_in_stock then
    -- the existing, fixed "we cannot supply this" report: it tells the patient neutrally and she can choose another pharmacy
    perform public.pharmacist_report_out_of_stock(rx.id);
    update public.prescription_collection_codes set stock_confirmed_at = null where prescription_id = rx.id;
    perform private.log_audit('pharmacy.stock_answered', 'prescriptions', rx.id, jsonb_build_object('in_stock', false, 'pharmacy_partner_id', v_partner));
    return 'out_of_stock';
  end if;
  if exists (select 1 from public.prescription_pharmacy_flags f
              where f.prescription_id = rx.id and f.kind = 'out_of_stock' and f.pharmacy_partner_id = v_partner
                and f.created_at >= coalesce(rx.chosen_by_patient_at, rx.created_at)) then
    return 'already_reported';
  end if;
  if c.stock_confirmed_at is null then
    update public.prescription_collection_codes set stock_confirmed_at = now() where prescription_id = rx.id;
    perform private.rx_notify(rx.patient_id, rx.organisation_id, 'pharmacy_collection_update');
  end if;
  perform private.log_audit('pharmacy.stock_answered', 'prescriptions', rx.id, jsonb_build_object('in_stock', true, 'pharmacy_partner_id', v_partner));
  return 'confirmed';
end $$;

-- For this pharmacy's waiting prescriptions: which were sent together (visit) and whether it has said "we have this". Ids and one timestamp only
-- (no patient data, no code), so the list page can group them and show the stock answer.
create function public.pharmacist_collection_extras()
returns table (prescription_id uuid, visit_id uuid, stock_confirmed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_partner uuid := private.pharmacist_partner();
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  return query
    select c.prescription_id, c.visit_id, c.stock_confirmed_at from public.prescription_collection_codes c join public.prescriptions rx on rx.id = c.prescription_id
     where c.pharmacy_partner_id = v_partner and rx.state = 'sent' and rx.pharmacy_partner_id = v_partner and c.used_at is null
     order by c.visit_id nulls last, c.prescription_id;
end $$;

-- The code is tested ONCE for the visit (a wrong try counts once, however many items); then each waiting item gets its own answer: ok, or refused
-- for that item (a controlled medicine, OQ-276, or no live medicine). Patient details and allergies are shown only for items that can be supplied,
-- as in pharmacist_verify_collection. Supplying is still one item at a time through pharmacist_dispense_prescription.
create function public.pharmacist_verify_visit(p_visit uuid, p_code text)
returns table (outcome text, prescription_id uuid, item_outcome text, patient_name text, patient_number text, items jsonb, allergies jsonb,
               supplies_dispensed integer, supplies_permitted integer, outstanding_note text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_partner uuid := private.pharmacist_partner(); v_ids uuid[]; v_id uuid; rx public.prescriptions%rowtype; v_out text; v_med public.medications%rowtype;
  v_disp integer; v_perm integer; v_appr integer; v_first uuid;
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  select array_agg(r.id order by r.id) into v_ids from (
    select x.id from public.prescriptions x join public.prescription_collection_codes cc on cc.prescription_id = x.id
     where cc.visit_id = p_visit and x.pharmacy_partner_id = v_partner and x.state = 'sent' order by x.id for update of x) r;
  if v_ids is null then
    return query select 'not_found'::text, null::uuid, null::text, null::text, null::text, null::jsonb, null::jsonb, 0, 0, null::text; return;
  end if;
  v_first := v_ids[1];
  v_out := private.check_collection_code(v_first, p_code, v_partner);
  if v_out <> 'ok' then
    return query select v_out, null::uuid, null::text, null::text, null::text, null::jsonb, null::jsonb, 0, 0, null::text; return;
  end if;
  foreach v_id in array v_ids loop
    select * into rx from public.prescriptions where id = v_id;
    select * into v_med from public.medications m where m.prescription_id = rx.id and m.source = 'clinician';
    if v_med.id is null then
      return query select 'ok'::text, rx.id, 'no_medication'::text, null::text, null::text, null::jsonb, null::jsonb, 0, 0, null::text; continue;
    end if;
    if private.prescription_has_controlled_item(v_med.drug_name, rx.items) then
      perform private.log_audit('pharmacy.controlled_medicine_refused', 'prescriptions', rx.id, jsonb_build_object('step', 'verify', 'pharmacy_partner_id', v_partner, 'visit', true));
      return query select 'ok'::text, rx.id, 'controlled_medicine'::text, null::text, null::text, null::jsonb, null::jsonb, 0, 0, null::text; continue;
    end if;
    select count(*) into v_appr from public.medication_repeat_requests r where r.medication_id = v_med.id and r.status = 'approved';
    select count(*) into v_disp from public.pharmacy_order_dispenses d where d.medication_id = v_med.id and d.source = 'pharmacy' and d.disputed_at is null and not coalesce(d.is_partial, false);
    v_perm := 1 + least(coalesce(v_appr, 0), coalesce(v_med.repeats_allowed, 0));
    perform private.log_audit('pharmacy.prescription_opened', 'prescriptions', rx.id, jsonb_build_object('pharmacy_partner_id', v_partner, 'visit', true));
    return query
      select 'ok'::text, rx.id, 'ok'::text, p.full_name, p.patient_number, rx.items,
             coalesce((select jsonb_agg(jsonb_build_object('allergen', a.allergen, 'reaction', a.reaction, 'severity', a.severity) order by a.allergen)
                         from private.patient_allergies_current a where a.patient_id = rx.patient_id), '[]'::jsonb),
             v_disp, v_perm,
             (select d.outstanding_note from public.pharmacy_order_dispenses d where d.medication_id = v_med.id and d.source = 'pharmacy' and d.is_partial and d.disputed_at is null order by d.created_at desc limit 1)
        from public.profiles p where p.id = rx.patient_id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Pharmacy scorecard (spec 21.7). compute_partner_quality and apply_partner_quality restated from their live definitions (S74); only the lines
--    marked S28e are new. Laboratory and clinic figures are computed exactly as before.
-- ---------------------------------------------------------------------------
alter table public.partner_quality
  add column sent_measured integer not null default 0,
  add column flags_raised integer not null default 0,
  add column out_of_stock_flags integer not null default 0;
comment on column public.partner_quality.sent_measured is 'S28e: prescriptions sent to a pharmacy in the window (test patients left out). Zero for a laboratory or clinic.';
comment on column public.partner_quality.flags_raised is 'S28e: flags and fixed questions a pharmacy raised in the window (test left out).';
comment on column public.partner_quality.out_of_stock_flags is 'S28e: of those, the "we cannot supply this" reports.';

create or replace function private.compute_partner_quality(p_kind text, p_id uuid, p_now timestamptz default now()) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg public.partner_quality_config%rowtype;
  v_rules jsonb;
  v_window integer;
  v_month date := private.lagos_month(p_now);
  v_exp timestamptz; v_ver timestamptz;
  v_lic_state text;
  v_target numeric; v_min_orders integer; v_min_pct numeric;
  v_n integer := 0; v_median numeric; v_within numeric;
  v_upheld integer; v_open integer; v_limit integer;
  v_c_turn numeric; v_c_comp numeric; v_c_lic numeric;
  v_w jsonb; v_wsum numeric := 0; v_acc numeric := 0;
  v_score numeric; v_breaches text[] := '{}';
  v_id uuid;
  v_pc jsonb; v_sent integer := 0; v_flags integer := 0; v_oos integer := 0;   -- S28e
begin
  if not private.partner_exists(p_kind, p_id) then raise exception 'partner_not_found' using errcode = '22023'; end if;
  select * into v_cfg from public.partner_quality_config where is_active;
  if not found then raise exception 'partner_quality_config_missing' using errcode = '55000'; end if;
  v_rules := v_cfg.rules;
  v_window := (v_rules ->> 'window_days')::integer;
  v_w := v_rules -> 'weights';

  -- licence
  if p_kind in ('lab', 'pharmacy') then
    select l.expires_at, l.verified_at into v_exp, v_ver from private.partner_licence(p_kind, p_id) l;
    v_lic_state := case
      when v_exp is not null and v_exp <= p_now then 'expired'
      when v_exp is null and v_ver is null then 'unverified'
      when v_exp is not null and v_exp <= p_now + make_interval(days => (v_rules #>> '{licence,expiring_days}')::integer) then 'expiring'
      else 'current' end;
    v_c_lic := case v_lic_state when 'expired' then 0 when 'unverified' then 50 when 'expiring' then 60 else 100 end;
  else
    v_lic_state := 'not_tracked';
  end if;

  -- turnaround (laboratories only; test patients left out, INV-13)
  if p_kind = 'lab' then
    v_target := (v_rules #>> '{turnaround,lab_target_hours}')::numeric;
    v_min_orders := (v_rules #>> '{turnaround,min_orders}')::integer;
    v_min_pct := (v_rules #>> '{turnaround,min_within_target_percent}')::numeric;
    select count(*), percentile_cont(0.5) within group (order by h),
           100.0 * count(*) filter (where h <= v_target) / nullif(count(*), 0)
      into v_n, v_median, v_within
      from (select extract(epoch from (o.resulted_at - o.payment_confirmed_at)) / 3600.0 as h
              from public.lab_orders o join public.profiles pt on pt.id = o.patient_id
             where o.provider_id = p_id and not pt.is_test and o.status = 'resulted'
               and o.payment_confirmed_at is not null and o.resulted_at is not null
               and o.resulted_at >= p_now - make_interval(days => v_window) and o.resulted_at <= p_now) m;
    if v_n >= v_min_orders then v_c_turn := round(v_within, 1); end if;   -- too few orders to judge: not scored, not penalised
  elsif p_kind = 'pharmacy' then
    -- S28e: turnaround to dispense = the patient choosing THIS pharmacy to the full supply. The clock starts at chosen_by_patient_at, which every choice
    -- resets, not at sent_at, which a change of pharmacy keeps (otherwise a pharmacy that picks up another's failed send inherits its waiting time).
    -- It includes the patient's own time to reach the counter, so it is a prompt to look, never a verdict, and for a pharmacy it only ever raises a
    -- suggestion (removal.suggest_only_kinds). Test patients left out (INV-13).
    v_pc := v_rules -> 'pharmacy';
    v_target := (v_pc ->> 'dispense_target_hours')::numeric;
    v_min_orders := (v_pc ->> 'min_dispenses')::integer;
    v_min_pct := (v_pc ->> 'min_within_target_percent')::numeric;
    select count(*), percentile_cont(0.5) within group (order by h),
           100.0 * count(*) filter (where h <= v_target) / nullif(count(*), 0)
      into v_n, v_median, v_within
      from (select extract(epoch from (rx.dispensed_at - coalesce(rx.chosen_by_patient_at, rx.sent_at))) / 3600.0 as h
              from public.prescriptions rx join public.profiles pt on pt.id = rx.patient_id
             where rx.pharmacy_partner_id = p_id and not pt.is_test and rx.state = 'dispensed'
               and coalesce(rx.chosen_by_patient_at, rx.sent_at) is not null and rx.dispensed_at is not null and rx.dispensed_at >= coalesce(rx.chosen_by_patient_at, rx.sent_at)
               and rx.dispensed_at >= p_now - make_interval(days => v_window) and rx.dispensed_at <= p_now) m;
    if v_n >= v_min_orders then v_c_turn := round(v_within, 1); end if;
    -- prescriptions sent to this pharmacy in the window: the ones whose code row is still here PLUS the ones it reported out of stock (their code row has
    -- usually moved to another pharmacy, and counting only the first group would shrink the base while the reports stay in the numerator: 4 of 6 instead of 4 of 10).
    -- A prescription the patient moved away without a report is not counted; the code table keeps only the latest pharmacy, so that history is not kept.
    select count(*) into v_sent from (
      select c.prescription_id from public.prescription_collection_codes c
       where c.pharmacy_partner_id = p_id and not c.is_test and c.created_at >= p_now - make_interval(days => v_window) and c.created_at <= p_now
      union
      select f.prescription_id from public.prescription_pharmacy_flags f
       where f.pharmacy_partner_id = p_id and f.kind = 'out_of_stock' and not f.is_test and f.created_at >= p_now - make_interval(days => v_window) and f.created_at <= p_now) s;
    -- flags raised counts every flag and question; out-of-stock counts DISTINCT prescriptions, the same unit as the base it is divided by, so a
    -- prescription re-sent and reported again does not count twice and the rate cannot pass 100 percent
    select count(*), count(distinct f.prescription_id) filter (where f.kind = 'out_of_stock') into v_flags, v_oos from public.prescription_pharmacy_flags f
     where f.pharmacy_partner_id = p_id and not f.is_test and f.created_at >= p_now - make_interval(days => v_window) and f.created_at <= p_now;
  end if;

  -- complaints (test raisers left out)
  select count(*) filter (where state = 'upheld' and created_at >= p_now - make_interval(days => v_window)),
         count(*) filter (where state = 'open')
    into v_upheld, v_open
    from public.partner_complaints where partner_kind = p_kind and partner_id = p_id and not is_test;
  v_limit := (v_rules #>> '{complaints,upheld_limit}')::integer;
  v_c_comp := round(100 * greatest(0, 1 - v_upheld::numeric / v_limit), 1);

  -- score: weighted mean of the components that apply
  if v_c_turn is not null then v_acc := v_acc + v_c_turn * (v_w ->> 'turnaround')::numeric; v_wsum := v_wsum + (v_w ->> 'turnaround')::numeric; end if;
  v_acc := v_acc + v_c_comp * (v_w ->> 'complaints')::numeric; v_wsum := v_wsum + (v_w ->> 'complaints')::numeric;
  if v_c_lic is not null then v_acc := v_acc + v_c_lic * (v_w ->> 'licence')::numeric; v_wsum := v_wsum + (v_w ->> 'licence')::numeric; end if;
  v_score := round(v_acc / v_wsum, 1);

  -- breaches
  if v_lic_state = 'expired' then v_breaches := v_breaches || 'licence_expired'::text; end if;
  if v_upheld >= v_limit then v_breaches := v_breaches || 'complaints_upheld_limit'::text; end if;
  if p_kind <> 'pharmacy' and v_c_turn is not null and v_within < v_min_pct then v_breaches := v_breaches || 'turnaround_below_target'::text; end if;
  if p_kind = 'pharmacy' then   -- S28e: the pharmacy's own two codes (not in removal.suspend_on, and a pharmacy is suggest-only anyway)
    if v_c_turn is not null and v_within < v_min_pct then v_breaches := v_breaches || 'dispense_turnaround_slow'::text; end if;
    if v_sent >= (v_pc ->> 'min_sent')::integer and 100.0 * v_oos / nullif(v_sent, 0) >= (v_pc ->> 'out_of_stock_percent')::numeric then
      v_breaches := v_breaches || 'out_of_stock_often'::text;
    end if;
  end if;
  if v_score < (v_rules #>> '{score,suspend_below}')::numeric then v_breaches := v_breaches || 'score_below_floor'::text; end if;

  insert into public.partner_quality as q (partner_kind, partner_id, period_month, config_version, turnaround_target_hours, turnaround_actual_median_hours,
         orders_measured, pct_within_target, complaints_upheld, complaints_open, licence_expires_at, licence_state, score, components, breaches, computed_at,
         sent_measured, flags_raised, out_of_stock_flags)
  values (p_kind, p_id, v_month, v_cfg.version, v_target, round(v_median, 1), v_n, round(v_within, 1), v_upheld, v_open, v_exp, v_lic_state, v_score,
          jsonb_strip_nulls(jsonb_build_object('turnaround', v_c_turn, 'complaints', v_c_comp, 'licence', v_c_lic)), v_breaches, p_now,
          v_sent, v_flags, v_oos)
  on conflict (partner_kind, partner_id, period_month) do update set
    config_version = excluded.config_version, turnaround_target_hours = excluded.turnaround_target_hours,
    turnaround_actual_median_hours = excluded.turnaround_actual_median_hours, orders_measured = excluded.orders_measured,
    pct_within_target = excluded.pct_within_target, complaints_upheld = excluded.complaints_upheld, complaints_open = excluded.complaints_open,
    licence_expires_at = excluded.licence_expires_at, licence_state = excluded.licence_state, score = excluded.score,
    components = excluded.components, breaches = excluded.breaches, computed_at = excluded.computed_at,
    sent_measured = excluded.sent_measured, flags_raised = excluded.flags_raised, out_of_stock_flags = excluded.out_of_stock_flags
  returning id into v_id;
  return v_id;
end $$;
revoke all on function private.compute_partner_quality(text, uuid, timestamptz) from public, anon, authenticated;

create or replace function private.apply_partner_quality(p_kind text, p_id uuid, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  q public.partner_quality%rowtype;
  v_rem jsonb := private.partner_quality_setting('removal');
  v_on text[];
  v_hit text[];
  v_so text[];
  st public.partner_work_status%rowtype;
  v_suspend boolean := false;
  v_org uuid;
  v_id uuid;
  v_key text;
  v_new boolean;
begin
  v_id := private.compute_partner_quality(p_kind, p_id, p_now);
  select * into q from public.partner_quality where id = v_id;
  -- the event key below carries the breach set itself, so the event is idempotent per month and breach set.
  select array(select jsonb_array_elements_text(v_rem -> 'suspend_on')) into v_on;
  select array(select jsonb_array_elements_text(coalesce(v_rem -> 'suggest_only_kinds', '[]'::jsonb))) into v_so;   -- S28e
  v_hit := array(select b from unnest(q.breaches) b where b = any (v_on));
  select * into st from public.partner_work_status where partner_kind = p_kind and partner_id = p_id;

  -- S28e: a kind that is suggest-only (a pharmacy) is never suspended by the rule: staff see the breach and decide (suspend_partner_from_new_work)
  if coalesce((v_rem ->> 'auto_suspend')::boolean, false) and cardinality(v_hit) > 0 and coalesce(st.state, 'open') = 'open' and not (p_kind = any (v_so)) then
    -- a person's override holds off a performance breach, never an expired licence
    v_suspend := 'licence_expired' = any (v_hit) or st.override_until is null or st.override_until <= p_now;
  end if;

  if v_suspend then
    perform private.partner_set_status(p_kind, p_id, 'suspended', 'rule', null, v_hit, 'Removed from new work by rule', q.config_version, q.id);
  end if;

  if cardinality(q.breaches) > 0 then
    v_org := private.partner_event_org(p_kind, p_id);
    if v_org is not null then
      -- the key carries the RESULTING state, so the run that suspends and every later run that finds it already suspended share one key (one event, not two)
      v_key := 'partner_quality_breach:' || p_kind || ':' || p_id || ':' || q.period_month || ':' || md5(array_to_string(q.breaches, ',')) || ':' || (v_suspend or coalesce(st.state, 'open') = 'suspended')::text;
      -- S28e: a suggestion-only breach never clears by itself (nothing is suspended), so the desk is told when the breach set is NEW, not every night
      v_new := not exists (select 1 from public.domain_events e where e.event_type = 'partner.quality_breach' and e.idempotency_key = v_key);
      perform private.emit_domain_event('partner.quality_breach', v_org,
        jsonb_build_object('partner_kind', p_kind, 'partner_id', p_id, 'breaches', to_jsonb(q.breaches), 'suspended', v_suspend or coalesce(st.state, 'open') = 'suspended'),
        v_key, null, 'partner', p_id);
      -- a suggestion-only kind is announced when ITS breach set is new (per partner, so one partner's notice never swallows another's); every other kind keeps
      -- the S74 rule (at most one desk notice a day while a breach stands)
      if v_suspend
         or (p_kind = any (v_so) and v_new)
         or (not (p_kind = any (v_so)) and not exists (select 1 from public.notifications n where n.template = 'partner_quality_attention' and n.created_at > p_now - interval '1 day')) then
        perform private.partner_notify_desk(v_org);
      end if;
    end if;
  end if;
  perform private.log_audit('partner.quality_computed', 'partner_quality', q.id,
    jsonb_build_object('partner_kind', p_kind, 'partner_id', p_id, 'score', q.score, 'breaches', to_jsonb(q.breaches), 'suspended_now', v_suspend));
  return jsonb_build_object('quality_id', q.id, 'score', q.score, 'breaches', to_jsonb(q.breaches), 'suspended_now', v_suspend);
end $$;
revoke all on function private.apply_partner_quality(text, uuid, timestamptz) from public, anon, authenticated;

-- The desk's pharmacy scorecard: every pharmacy with its latest figures, its work state, the licence days left and what staff are asked to look at.
-- Admin or the Chief Medical Officer (the S74 partner desk). No patient data. A suggestion is only a prompt: nothing here suspends anyone.
create function public.pharmacy_scorecard() returns table (
  partner_id uuid, partner_name text, is_active boolean, work_state text, reason_codes text[], override_until timestamptz,
  score numeric, suggestions text[], review_suggested boolean,
  licence_state text, licence_expires_at timestamptz, licence_days_left integer,
  dispense_target_hours numeric, dispense_median_hours numeric, pct_within_target numeric, dispenses_measured integer,
  sent_measured integer, flags_raised integer, out_of_stock_flags integer,
  complaints_upheld integer, complaints_open integer, computed_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.partner_desk_actor() then raise exception 'not authorised' using errcode = '42501'; end if;
  -- The licence is read LIVE from the pharmacy row, not from the last nightly snapshot: a pharmacy with no snapshot yet, or a licence that ran out
  -- since the last run, must still show as expired and ask for a review (the nightly figures are for the rest).
  return query
  select ph.id, ph.name, ph.is_active, coalesce(s.state, 'open'), coalesce(s.reason_codes, '{}'), s.override_until,
         q.score,
         (select coalesce(array_agg(distinct x order by x), '{}'::text[]) from unnest(
            coalesce(q.breaches, '{}'::text[]) || case when not ph.is_active then '{}'::text[] when lv.st = 'expired' then array['licence_expired']::text[] when lv.st = 'expiring' then array['licence_expiring']::text[] else '{}'::text[] end) x),
         -- an inactive pharmacy (a placeholder or a retired one) cannot receive work, so its licence date alone never asks for a review
         coalesce(s.state, 'open') = 'open' and (cardinality(coalesce(q.breaches, '{}'::text[])) > 0 or (ph.is_active and lv.st in ('expired', 'expiring'))),
         lv.st,
         ph.license_expires_at,
         case when ph.license_expires_at is null then null
              else ((ph.license_expires_at at time zone 'Africa/Lagos')::date - (now() at time zone 'Africa/Lagos')::date) end,
         q.turnaround_target_hours, q.turnaround_actual_median_hours, q.pct_within_target, coalesce(q.orders_measured, 0),
         coalesce(q.sent_measured, 0), coalesce(q.flags_raised, 0), coalesce(q.out_of_stock_flags, 0),
         coalesce(q.complaints_upheld, 0), coalesce(q.complaints_open, 0), q.computed_at
    from public.pharmacy_partners ph
    left join public.partner_work_status s on s.partner_kind = 'pharmacy' and s.partner_id = ph.id
    left join lateral (select * from public.partner_quality x where x.partner_kind = 'pharmacy' and x.partner_id = ph.id order by x.period_month desc limit 1) q on true
    cross join lateral (select case
        when ph.license_expires_at is not null and ph.license_expires_at <= now() then 'expired'
        when ph.license_expires_at is null and ph.license_verified_at is null then 'unverified'
        when ph.license_expires_at is not null and ph.license_expires_at <= now() + make_interval(days => coalesce((private.partner_quality_setting('licence') ->> 'expiring_days')::integer, 30)) then 'expiring'
        else 'current' end as st) lv
   order by ph.is_active desc, ph.name;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants. Functions: signed-in only. anon's EXECUTE is revoked from PUBLIC (the pseudo-role carries it), never from anon alone.
-- ---------------------------------------------------------------------------
revoke all on function public.patient_choose_pharmacy_for_visit(uuid[], uuid, uuid, uuid) from public, anon;
revoke all on function public.patient_collection_visit(uuid, uuid) from public, anon;
revoke all on function public.patient_collection_overview(uuid) from public, anon;
revoke all on function public.patient_new_visit_code(uuid, uuid) from public, anon;
revoke all on function public.pharmacist_confirm_stock(uuid, boolean) from public, anon;
revoke all on function public.pharmacist_collection_extras() from public, anon;
revoke all on function public.pharmacist_verify_visit(uuid, text) from public, anon;
revoke all on function public.pharmacy_scorecard() from public, anon;
grant execute on function public.patient_choose_pharmacy_for_visit(uuid[], uuid, uuid, uuid) to authenticated;
grant execute on function public.patient_collection_visit(uuid, uuid) to authenticated;
grant execute on function public.patient_collection_overview(uuid) to authenticated;
grant execute on function public.patient_new_visit_code(uuid, uuid) to authenticated;
grant execute on function public.pharmacist_confirm_stock(uuid, boolean) to authenticated;
grant execute on function public.pharmacist_collection_extras() to authenticated;
grant execute on function public.pharmacist_verify_visit(uuid, text) to authenticated;
grant execute on function public.pharmacy_scorecard() to authenticated;

-- The new patient-keyed table is registered in the S39d data registry like its siblings (default classification, awaiting CMO and DPO review).
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name, 'patient_id', private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Registered with the default S39d classification when S28e was added; awaiting review.'
  from unnest(array['pharmacy_collection_visits']) as t(table_name)
 where to_regclass('public.' || t.table_name) is not null
on conflict (table_name) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Closing assertions
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.pharmacy_collection_visits'::regclass) then raise exception 'RLS is off on pharmacy_collection_visits'; end if;
  if has_table_privilege('anon', 'public.pharmacy_collection_visits', 'SELECT') then raise exception 'anon can read pharmacy_collection_visits'; end if;
  if has_table_privilege('authenticated', 'public.pharmacy_collection_visits', 'INSERT') or has_table_privilege('authenticated', 'public.pharmacy_collection_visits', 'UPDATE') then
    raise exception 'authenticated can write pharmacy_collection_visits directly';
  end if;
  foreach f in array array[
    'public.patient_choose_pharmacy_for_visit(uuid[],uuid,uuid,uuid)', 'public.patient_collection_visit(uuid,uuid)', 'public.patient_collection_overview(uuid)', 'public.patient_new_visit_code(uuid,uuid)',
    'public.pharmacist_confirm_stock(uuid,boolean)', 'public.pharmacist_collection_extras()', 'public.pharmacist_verify_visit(uuid,text)', 'public.pharmacy_scorecard()'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon can call %', f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated cannot call %', f; end if;
  end loop;
  if (select count(*) from public.pharmacy_config where is_active) <> 1 or (select count(*) from public.partner_quality_config where is_active) <> 1 then
    raise exception 'exactly one active pharmacy_config and one active partner_quality_config version is required';
  end if;
  if private.pharmacy_max_items_per_visit() < 2 then raise exception 'visit size must allow at least 2'; end if;
  if (select (rules #>> '{removal,suggest_only_kinds}') from public.partner_quality_config where is_active) is null then raise exception 'pharmacy must be suggest-only'; end if;
  -- the go-live guard is not touched by this migration
  if exists (select 1 from public.go_live_guards where key = 'prescribing_enabled' and is_on) and not exists (select 1 from public.go_live_guard_log where guard_key = 'prescribing_enabled' and action = 'switched_on') then
    raise exception 'prescribing_enabled is on with no switched_on log row';
  end if;
end $$;
