-- T2-11 (founder decision 2026-11-04, the founder is also the CMO): "prescription should be open and this should generate a PDF form of
-- prescription that patient can take to a pharmacy, this need to be active".
--
-- What this changes, and what it does not.
--
-- Counted before writing (local replay of main-dev, and the live facts given with the task): the prescribing_enabled master is OFF; its
-- conditions were all about partner pharmacies (an active partner, a verified licence and location, collection rules confirmed, the
-- pharmacy notification sender deployed) plus the clinical safety case and the CMO's switch. Tarragon has no contracted pharmacy, so those
-- conditions could never be met, and the master also closes SIGNING (private.enforce_prescription_rules, draft to signed). A signed
-- prescription is what produces the downloadable PDF (rx number, verification code, QR token on public.medications) that a patient takes to
-- any pharmacy and that any pharmacist checks at /verify-rx/[token]. So with zero partners the take-anywhere path could never open.
--
--  1. The master's conditions no longer mention a partner pharmacy. They are now: at least one active senior doctor (Senior Medical Officer
--     or Chief Medical Officer) with a verified, unexpired registration and a real credential number (the PDF refuses to print without one,
--     so this is the readiness fact that matters for take-anywhere); the clinical safety case; the CMO pressing the switch. Same role (cmo).
--     Added as a branch at the top of private.go_live_conditions, the anchored S90 way; the older prescribing branch further down the
--     wrapped chain becomes unreachable and is left alone (redefining the chain from live bodies is out of scope).
--  2. Partner collection keeps every condition it had, now as its own readiness check, private.pharmacy_partner_collection_ready():
--     a choosable partner pharmacy (active, approved, licence verified and unexpired, verified location), the collection rules confirmed,
--     and the pharmacy notification sender attested. private.pharmacy_collection_on() (the one switch every partner-collection function
--     already checks) now needs the master AND that readiness. With zero partners it stays false whatever the master says.
--  3. public.partner_pharmacy_collection_available() lets the patient screen hide "Choose where to collect" when no partner path exists, so
--     the app never implies a pharmacy is contracted.
--  4. The guard's dashboard text says the above. The master is NOT switched on: the CMO does that from the go-live page.
--  5. Copy (T2-11, second half): the Membership inclusion list gets back "Written questions to your care team between calls" and
--     "Prescriptions your care team signs", which T2-09 dropped (catalog_items.included_keys; the strings are in packages/i18n/src/en.ts).
--
-- Unchanged on purpose: tier authority (private.has_prescribing_authority), the S24 signing safety checks (controlled medicine hard stop,
-- allergy match, duplicate), interaction rules, the frozen-content and state-machine rules, the test-account bypass, the QR and phone-desk
-- supply paths (never behind the master), and every pharmacist-side function (still behind private.pharmacy_collection_on).

-- 1. The master's conditions ---------------------------------------------------------------------------------------------------------
do $patch$
declare
  v_def text := pg_get_functiondef('private.go_live_conditions(text,uuid)'::regprocedure);
  v_anchor constant text := E'\n  end if;\n  -- An unknown key has no conditions here';
  v_branch constant text := $branch$
  elsif p_key = 'prescribing_enabled' then
    -- T2-11: take-anywhere prescribing needs no partner pharmacy. Partner collection has its own readiness (private.pharmacy_partner_collection_ready).
    return jsonb_build_array(
      private.go_live_cond('prescriber_registration_verified',
        'At least one active senior doctor with a verified, unexpired registration and a real credential number (the prescription form will not print without one)',
        private.prescriber_ready_count() > 0, 'data', private.prescriber_ready_count() || ' ready'),
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null),
      private.go_live_cond('clinical_lead_signoff', 'Clinical lead sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));$branch$;
begin
  if v_def like '%T2-11: take-anywhere%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'private.go_live_conditions no longer has the expected fall-through anchor; add the T2-11 branch by hand' using errcode = '55000';
  end if;
  -- the helper the branch calls must exist before the function body is replaced
  execute $f$
    create or replace function private.prescriber_ready_count() returns integer language sql stable security definer set search_path = '' as $b$
      select count(*)::integer from public.clinical_staff cs
       where cs.active and cs.is_test is not true
         and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer')
         and cs.license_verified_at is not null and (cs.license_expires_at is null or cs.license_expires_at > now())
         and cs.credential_type is not null and nullif(btrim(cs.credential_number), '') is not null
         and cs.credential_number !~* '(pending|placeholder|tbc|tbd|unknown|test)'
    $b$ $f$;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $patch$;
revoke all on function private.prescriber_ready_count() from public, anon, authenticated;
revoke all on function private.go_live_conditions(text, uuid) from public;

-- 2. Partner collection keeps its own conditions -------------------------------------------------------------------------------------
create or replace function private.pharmacy_partner_collection_ready() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pharmacy_partners pp join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id
                  where private.pharmacy_location_choosable(pp.id, l.id))
     and coalesce((select s.decision = 'confirmed' from public.proposed_config_signoffs s
                     where s.config_key = 'pharmacy.collection_rules'
                       -- the active version; with none active (the S28 fallback case) the newest version, so a missing config row never
                       -- silently closes collection that the rest of S28 is built to keep running on its defaults
                       and s.config_version = coalesce((select c.version from public.pharmacy_config c where c.is_active),
                                                       (select max(c.version) from public.pharmacy_config c))
                     order by s.id desc limit 1), false)
     and private.go_live_attested('prescribing_enabled', 'notification_sender_deployed')
$$;
revoke all on function private.pharmacy_partner_collection_ready() from public, anon, authenticated;
comment on function private.pharmacy_partner_collection_ready() is
  'T2-11: partner pharmacy collection is an optional extra on top of take-anywhere prescribing. Needs a choosable partner pharmacy, the collection rules confirmed and the pharmacy notification sender attested. These were the prescribing_enabled master''s conditions before T2-11.';

-- The one switch every partner-collection function checks. Fail closed: no partner, no collection, whatever the master says.
create or replace function private.pharmacy_collection_on() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.go_live_guard_on('prescribing_enabled') and private.pharmacy_partner_collection_ready()
$$;
revoke all on function private.pharmacy_collection_on() from public, anon, authenticated;

-- 3. What the patient screen asks before offering "Choose where to collect" --------------------------------------------------------
create or replace function public.partner_pharmacy_collection_available() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and private.pharmacy_collection_on()
$$;
revoke all on function public.partner_pharmacy_collection_available() from public, anon;
grant execute on function public.partner_pharmacy_collection_available() to authenticated;
comment on function public.partner_pharmacy_collection_available() is
  'T2-11: true only when a partner pharmacy can actually take a prescription. The take-anywhere PDF never depends on it.';

-- 4. The guard's own account of itself --------------------------------------------------------------------------------------------
update public.go_live_guards set
  blocks = 'Signing prescriptions (the signed prescription is the PDF a patient takes to any pharmacy); partner pharmacy collection also needs a ready partner',
  condition_text = 'At least one active senior doctor with a verified registration; clinical safety case; clinical lead sign-off. No partner pharmacy is needed: a signed prescription is taken to any pharmacy. Partner collection additionally needs a choosable partner pharmacy, the collection rules confirmed and the pharmacy notification sender deployed.',
  enforced_in = array['private.enforce_prescription_rules (signing a prescription, draft to signed, for a signed-in clinician)',
                      'private.pharmacy_collection_on (every partner-pharmacy choice, list, counter check, supply and question; also needs private.pharmacy_partner_collection_ready)'],
  not_enforced_in = 'Writing a draft prescription, downloading the prescription form, checking it at /verify-rx, recording a supply from the QR or the phone desk, and taking a prescription back from a pharmacy are never behind it.'
where key = 'prescribing_enabled';

-- 5. The two inclusion lines T2-09 dropped ----------------------------------------------------------------------------------------
update public.catalog_items
   set included_keys = included_keys || array['catalog.membership_annual_no_panel.incl.4', 'catalog.membership_annual_no_panel.incl.5']
 where code = 'membership_annual_no_panel'
   and not ('catalog.membership_annual_no_panel.incl.4' = any (included_keys));

-- 6. The migration proves what it claims -----------------------------------------------------------------------------------------
do $$
declare v_codes text;
begin
  select string_agg(c ->> 'code', ',' order by c ->> 'code') into v_codes
    from jsonb_array_elements(private.go_live_conditions('prescribing_enabled', null)) c;
  if v_codes is distinct from 'clinical_lead_signoff,clinical_safety_case_current,prescriber_registration_verified' then
    raise exception 'T2-11: prescribing_enabled conditions are %', v_codes;
  end if;
  if (select switch_role from public.go_live_guards where key = 'prescribing_enabled') <> 'cmo'
     or (select kind from public.go_live_guards where key = 'prescribing_enabled') <> 'master' then
    raise exception 'T2-11: prescribing_enabled lost its role or kind';
  end if;
  if exists (select 1 from public.go_live_guards where key = 'prescribing_enabled' and is_on)
     and not exists (select 1 from public.go_live_guard_log where guard_key = 'prescribing_enabled' and action = 'switched_on') then
    raise exception 'T2-11: prescribing_enabled is on with no switched_on log row';
  end if;
  if not private.pharmacy_partner_collection_ready() and private.pharmacy_collection_on() then
    raise exception 'T2-11: partner collection is open without a ready partner';
  end if;
  if has_function_privilege('anon', 'public.partner_pharmacy_collection_available()', 'EXECUTE') then raise exception 'anon can call partner_pharmacy_collection_available'; end if;
  if not has_function_privilege('authenticated', 'public.partner_pharmacy_collection_available()', 'EXECUTE') then raise exception 'authenticated cannot call partner_pharmacy_collection_available'; end if;
  foreach v_codes in array array['private.pharmacy_partner_collection_ready()', 'private.prescriber_ready_count()', 'private.pharmacy_collection_on()'] loop
    if has_function_privilege('anon', v_codes, 'EXECUTE') or has_function_privilege('authenticated', v_codes, 'EXECUTE') then
      raise exception 'T2-11: % is callable by a client role', v_codes;
    end if;
  end loop;
end $$;
