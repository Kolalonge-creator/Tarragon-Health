-- S47 review fixes (read-only review of branch decisions/cmo-choices-2026-10-07, 2026-10-07). Nothing signed, nothing applied to production.
-- Whether to edit or add: the items that touch functions this branch itself created (the go-live restatement, the report collector, the hand-over sweep, the
-- anti-HBs trigger, the emergency card wrapper) were corrected IN PLACE in their S47 migrations, which were created on this branch and have never been applied.
-- The items that touch functions created on the integration branch (S42 anonymiser and phone event, S43 share link, S44 export) are restated HERE in a new
-- migration, so those earlier files stay as they were. Counts first: all of these tables are created by migrations that are not yet applied to production, so there are
-- 0 live rows to convert; the one place that can hold personal data already written (domain_events keys) is scrubbed by a function that is safe to re-run.
--
--   2. account.phone_verified no longer puts the phone digits in domain_events.idempotency_key (INV-07); existing keys are rewritten, the anonymiser scrubs too.
--   3. The anonymiser revokes the account's share links and emergency card; the public doors stop serving them.
--   4. INV-04: the legacy lab readings branch of a share link and of the FHIR export drops blood-borne and sexual-health codes; the sensitive-code test matches
--      VARIANTS (hiv_rna, hbv_dna, anti_hbc, hbsag variants, hcv_rna, hiv_p24) through a pattern list kept as data.
--   5. The FHIR export honours the adolescent confidentiality gate for a guardian (conditions, medicines, allergies in mental health or reproductive health) and
--      says truthfully which domains it withheld. (The emergency card medicines filter is in the emergency card migration.)

-- ---------------------------------------------------------------------------
-- 2. Phone verified: no personal data in the idempotency key
-- ---------------------------------------------------------------------------
create or replace function private.scrub_phone_event_keys(p_patient uuid default null) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  -- domain_events is append only on purpose. Removing personal data from a key is the one edit we allow, so the trigger is lifted for exactly this statement.
  alter table public.domain_events disable trigger domain_events_no_update;
  update public.domain_events
     set idempotency_key = 'account.phone_verified:' || patient_id::text || ':h' || substr(md5(idempotency_key), 1, 16)
   where event_type = 'account.phone_verified'
     and idempotency_key ~ '^account\.phone_verified:[0-9a-f-]{36}:[0-9]{6,}$'
     and (p_patient is null or patient_id = p_patient);
  get diagnostics v_n = row_count;
  alter table public.domain_events enable trigger domain_events_no_update;
  return v_n;
end $$;
revoke all on function private.scrub_phone_event_keys(uuid) from public, anon, authenticated;

create or replace function private.emit_phone_verified() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid;
begin
  select organisation_id into v_org from public.profiles where id = new.id and role = 'patient';
  if v_org is not null then
    begin
      -- keyed on WHEN the phone was confirmed (a fresh confirmation after a number change is a new event), never on the number itself
      perform private.emit_domain_event('account.phone_verified', v_org, '{}'::jsonb,
        'account.phone_verified:' || new.id::text || ':t' || to_char(new.phone_confirmed_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISSUS'), new.id, 'profile', new.id);
    exception when others then
      raise warning 'account.phone_verified not emitted: %', sqlerrm;
    end;
  end if;
  return new;
end $$;
revoke all on function private.emit_phone_verified() from public, anon, authenticated;
select private.scrub_phone_event_keys(null);

-- ---------------------------------------------------------------------------
-- 3. The anonymiser also closes the public doors
-- ---------------------------------------------------------------------------
create or replace function private.anonymise_patient_account(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles%rowtype;
  v_removed jsonb := '{}'::jsonb;
  v_kept text[] := '{}';
  v_n integer;
  t text;
  r record;
begin
  select * into p from public.profiles where id = p_patient;
  if not found or p.role <> 'patient' then raise exception 'anonymise_not_a_patient' using errcode = '22023'; end if;
  if p.full_name = 'Deleted account' then raise exception 'anonymise_already_done' using errcode = '23505'; end if;

  -- 3a. Rows that exist only to serve the person, outside every retention category: removed. Each is checked against the
  --     retention policy first, so a table added to a retention category later is skipped, not deleted.
  foreach t in array array['push_subscriptions', 'patient_notification_preferences', 'onboarding_answers', 'patient_devices'] loop
    if private.table_is_retained(t) then v_kept := v_kept || t; continue; end if;
    execute format('delete from public.%I where %s = $1', t, case when t = 'push_subscriptions' then 'profile_id' else 'patient_id' end) using p_patient;
    get diagnostics v_n = row_count;
    v_removed := v_removed || jsonb_build_object(t, v_n);
  end loop;

  if not private.table_is_retained('proxy_setups') then
    delete from public.proxy_setups where created_by_profile_id = p_patient or confirmed_profile_id = p_patient;
    get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('proxy_setups', v_n);
  end if;
  if not private.table_is_retained('care_circle_members') then
    delete from public.care_circle_members where patient_id = p_patient or supporter_id = p_patient;
    get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('care_circle_members', v_n);
    delete from public.care_circle_invites where patient_id = p_patient;
    get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('care_circle_invites', v_n);
  end if;
  -- Anyone who could see this record, or whose record this person could see, loses that link.
  delete from public.profile_access where profile_id = p_patient or grantee_user_id = p_patient;
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('profile_access', v_n);

  -- S47 review fix: every link that still opens the record is closed, and the public doors stop serving at once. A share link and the emergency card carry a
  -- bearer token; deleting an account must end them, not leave them live for their remaining days.
  update public.record_shares set is_active = false, revoked_at = coalesce(revoked_at, now()), pin_hash = null where patient_id = p_patient;
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('record_shares_revoked', v_n);
  update public.emergency_cards set is_active = false, revoked_at = coalesce(revoked_at, now()) where patient_id = p_patient;
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('emergency_cards_revoked', v_n);
  -- the phone number must not survive in an event key either
  perform private.scrub_phone_event_keys(p_patient);

  -- Connected-app tokens: disconnected and the secrets nulled (the readings themselves are clinical and stay).
  update public.wearable_connections set status = 'disconnected', access_token = null, refresh_token = null where patient_id = p_patient;
  get diagnostics v_n = row_count; v_removed := v_removed || jsonb_build_object('wearable_connections_tokens_cleared', v_n);

  -- 3b. Optional consents switch off (history stays: consent evidence is retained). Required cells cannot be withdrawn and
  --     do not need to be: the account is closed.
  for r in select data_type, purpose from public.consent_matrix_cells where not required_for_care loop
    perform private.record_consent_cell(p_patient, p.organisation_id, p.is_test, r.data_type, r.purpose, false, 'account_closure', null, p_patient);
  end loop;

  -- 3c. Identity. The clinical record is kept under its retention category but no longer says whose it is.
  update public.profiles set
      full_name = 'Deleted account', phone = null, avatar_url = null, state = null, city = null, area = null, lga = null,
      emergency_contact_name = null, emergency_contact_phone = null, emergency_contact_relationship = null,
      next_of_kin_name = null, next_of_kin_phone = null, emergency_contact_consent = false,
      date_of_birth = case when date_of_birth is null then null else make_date(extract(year from date_of_birth)::integer, 1, 1) end,
      metadata = '{}'::jsonb, marketing_opt_in = false, is_active = false
    where id = p_patient;

  -- Sign-in: the login is closed and cannot be recovered (no email, no phone, no password, no session).
  delete from auth.sessions where user_id = p_patient;
  delete from auth.identities where user_id = p_patient;
  update auth.users set email = 'deleted-' || p_patient::text || '@deleted.invalid', phone = null, encrypted_password = '',
         raw_user_meta_data = '{}'::jsonb, banned_until = 'infinity', email_change = '', phone_change = '',
         updated_at = now()
   where id = p_patient;

  return jsonb_build_object(
    'removed', v_removed,
    'skipped_as_retained', to_jsonb(v_kept),
    'retained_categories', (select coalesce(jsonb_agg(c.category order by c.category), '[]'::jsonb) from public.data_retention_policies c where c.is_active and c.category <> 'marketing_and_analytics'),
    'identity_removed', true,
    'at', now());
end $$;
revoke all on function private.anonymise_patient_account(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. INV-04: variants of a sensitive code, and the legacy readings branches
-- ---------------------------------------------------------------------------
create table public.sensitive_result_code_patterns (
  pattern text primary key check (pattern = lower(pattern)),
  virus   text not null check (virus in ('hiv', 'hbv', 'hcv')),
  note    text
);
alter table public.sensitive_result_code_patterns enable row level security;
create policy sensitive_result_code_patterns_read on public.sensitive_result_code_patterns for select to authenticated using (true);
revoke all on public.sensitive_result_code_patterns from public, anon, authenticated;
grant select on public.sensitive_result_code_patterns to authenticated;
comment on table public.sensitive_result_code_patterns is
  'S47: regular expressions (matched against the lower-cased analyte code) for every spelling of an HIV, hepatitis B or hepatitis C test. Data, so a new variant is a row, not a release. Mirrors the registry key results.sensitive_code_patterns. anti_hbs (the immunity titre) is deliberately not listed: it drives the immunity rule and is never explained by AI for a different reason (it is not a diagnosis).';
-- sensitive-code-patterns-begin
insert into public.sensitive_result_code_patterns (pattern, virus, note) values
  ('^hiv', 'hiv', 'hiv, hiv_rna, hiv_p24, hiv_ag_ab, hiv1, hiv_viral_load'),
  ('^(hbv|hbs|hbe|hbc|hbcore)', 'hbv', 'hbsag, hbs_ag, hbv_dna, hbeag, hbc'),
  ('^anti_?hb[ce]', 'hbv', 'anti_hbc, anti_hbe (anti_hbs is the immunity titre and is not listed)'),
  ('^(hep_?b|hepatitis_?b)', 'hbv', 'hep_b, hepb, hepatitis_b, hepatitis_b_core'),
  ('^(hcv|anti_?hcv)', 'hcv', 'hcv_ab, hcv_rna, anti_hcv'),
  ('^(hep_?c|hepatitis_?c)', 'hcv', 'hep_c, hepc, hepatitis_c')
on conflict (pattern) do nothing;
-- sensitive-code-patterns-end

create or replace function private.is_sensitive_result_code(p_code text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_code is not null and (
    exists (select 1 from public.sensitive_result_codes s where s.code = lower(btrim(p_code)))
    or exists (select 1 from public.sensitive_result_code_patterns p where lower(btrim(p_code)) ~ p.pattern))
$$;
revoke all on function private.is_sensitive_result_code(text) from public, anon, authenticated;

create or replace function public.record_share_open(p_token text, p_pin text default null, p_commit boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.record_share_config;
  s public.record_shares%rowtype;
  v_profile public.profiles%rowtype;
  v_out jsonb;
  v_attempts_left integer;
  v_lookup uuid;
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 128 then
    return jsonb_build_object('status', 'not_found');
  end if;
  v_cfg := private.record_share_setting();

  -- the row lock serialises two simultaneous openings, so a view cap cannot be exceeded
  -- a legacy row that still carries its plaintext token (written before the hash existed) is found by that token too
  select * into s from public.record_shares where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') or token = p_token for update;
  if not found then
    -- S39 (integration): every miss on the public door is counted, so a run of guesses raises the ops alarm; the answer a guesser sees is unchanged
    perform private.log_public_lookup_failure('record_share');
    return jsonb_build_object('status', 'not_found');
  end if;

  if not s.is_active or s.revoked_at is not null then
    insert into public.record_share_lookups (share_id, outcome) values (s.id, 'revoked');
    perform private.log_public_lookup_failure('record_share');
    return jsonb_build_object('status', 'gone', 'reason', 'revoked');
  end if;
  if s.expires_at <= now() then
    insert into public.record_share_lookups (share_id, outcome) values (s.id, 'expired');
    perform private.log_public_lookup_failure('record_share');
    return jsonb_build_object('status', 'gone', 'reason', 'expired');
  end if;
  if s.max_views is not null and s.view_count >= s.max_views then
    insert into public.record_share_lookups (share_id, outcome) values (s.id, 'view_cap');
    return jsonb_build_object('status', 'gone', 'reason', 'view_cap');
  end if;
  if s.locked_at is not null then
    insert into public.record_share_lookups (share_id, outcome) values (s.id, 'locked');
    return jsonb_build_object('status', 'locked');
  end if;

  -- PREVIEW (p_commit = false): what a plain GET of the link does. A messaging app or mail scanner that unfurls a link must not spend a view or
  -- read a record. Nothing is counted and no data is returned: only whether the link is live and whether it needs a PIN. A link that has ended
  -- is still reported (and the attempt logged) above, exactly as for a person.
  if not p_commit then
    if s.pin_hash is not null then
      return jsonb_build_object('status', 'pin_required');
    end if;
    return jsonb_build_object('status', 'ready', 'expires_at', s.expires_at,
                              'views_left', case when s.max_views is null then null else s.max_views - s.view_count end);
  end if;

  if s.pin_hash is not null then
    if p_pin is null or btrim(p_pin) = '' then
      return jsonb_build_object('status', 'pin_required');
    end if;
    if extensions.crypt(p_pin, s.pin_hash) is distinct from s.pin_hash then
      update public.record_shares
         set pin_failed_attempts = pin_failed_attempts + 1,
             locked_at = case when pin_failed_attempts + 1 >= v_cfg.max_pin_attempts then now() else null end
       where id = s.id
      returning v_cfg.max_pin_attempts - pin_failed_attempts into v_attempts_left;
      insert into public.record_share_lookups (share_id, outcome) values (s.id, 'pin_wrong');
      return jsonb_build_object('status', 'pin_wrong', 'attempts_left', greatest(v_attempts_left, 0));
    end if;
    update public.record_shares set pin_failed_attempts = 0 where id = s.id;
  end if;

  select * into v_profile from public.profiles where id = s.patient_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  insert into public.record_share_lookups (share_id, outcome) values (s.id, 'viewed') returning id into v_lookup;
  update public.record_shares set view_count = view_count + 1, last_viewed_at = now() where id = s.id;
  perform private.emit_domain_event('share_link.accessed', s.organisation_id, jsonb_build_object('share_id', s.id),
                                    'share_link.accessed:' || v_lookup::text, s.patient_id, 'record_share', s.id);

  v_out := jsonb_build_object('full_name', v_profile.full_name, 'shared_at', s.created_at, 'expires_at', s.expires_at, 'sections', s.sections,
                              'views_left', case when s.max_views is null then null else s.max_views - s.view_count - 1 end);

  if 'vitals' = any (s.sections) then
    v_out := v_out || jsonb_build_object('vitals', coalesce((
      select jsonb_agg(jsonb_build_object('vital_type', vr.vital_type::text, 'systolic', vr.systolic, 'diastolic', vr.diastolic,
               'pulse_bpm', vr.pulse_bpm, 'glucose_mmol', vr.glucose_mmol_l, 'weight_kg', vr.weight_kg, 'temperature_c', vr.temperature_c,
               'spo2_pct', vr.spo2_pct, 'source', vr.source::text, 'taken_at', vr.taken_at) order by vr.taken_at desc)
        from (select * from public.vitals_readings where patient_id = s.patient_id order by taken_at desc limit 20) vr), '[]'::jsonb));
  end if;
  if 'medications' = any (s.sections) then
    v_out := v_out || jsonb_build_object('medications', coalesce((
      select jsonb_agg(jsonb_build_object('drug_name', m.drug_name, 'dose', m.dose, 'frequency', m.frequency, 'is_active', m.is_active) order by m.drug_name)
        from public.medications m where m.patient_id = s.patient_id and m.is_active), '[]'::jsonb));
  end if;
  if 'conditions' = any (s.sections) then
    v_out := v_out || jsonb_build_object('conditions', coalesce((
      select jsonb_agg(distinct cp.condition::text) from public.care_plans cp where cp.patient_id = s.patient_id and cp.status = 'active'), '[]'::jsonb));
  end if;
  if 'allergies' = any (s.sections) then
    v_out := v_out || jsonb_build_object('allergies', coalesce((
      select jsonb_agg(jsonb_build_object('allergen', a.allergen, 'reaction', a.reaction, 'severity', a.severity) order by a.severity desc nulls last, a.allergen)
        from public.patient_allergies a where a.patient_id = s.patient_id), '[]'::jsonb));
  end if;
  -- Lab results: released and not withdrawn (INV-03), never a sensitive positive (INV-04: a link holder is not a clinician disclosing it),
  -- plus final legacy readings. A held, withheld or withdrawn result is invisible here exactly as it is to the patient.
  if 'lab_results' = any (s.sections) then
    v_out := v_out || jsonb_build_object('lab_results', coalesce((
      select jsonb_agg(x.j order by x.taken_at desc) from (
        select r.released_at as taken_at,
               jsonb_build_object('code', i.analyte_code, 'value', i.value_numeric, 'value_text', i.value_text, 'unit', i.unit,
                 'reference_range_text', case when i.ref_low is not null or i.ref_high is not null then concat_ws(' to ', i.ref_low::text, i.ref_high::text) end,
                 'abnormal_flag', i.flag, 'taken_at', r.released_at, 'laboratory', null) as j
          from public.lab_result_items i join public.lab_results r on r.id = i.lab_result_id
         where i.patient_id = s.patient_id and r.release_state = 'released' and r.withdrawn_at is null and r.superseded_by is null and not i.sensitive_positive
        union all
        select lr.taken_at,
               jsonb_build_object('code', lr.code, 'value', lr.value, 'value_text', lr.value_text, 'unit', lr.unit,
                 'reference_range_text', lr.reference_range_text, 'abnormal_flag', lr.abnormal_flag::text, 'taken_at', lr.taken_at, 'laboratory', lr.laboratory)
          from public.lab_analyte_readings lr
         where lr.patient_id = s.patient_id and lr.report_status in ('final', 'corrected', 'amended')
           and not private.report_excluded_code(lr.code)   -- S47 review fix (INV-04): a legacy reading of a blood-borne or sexual-health test never rides a link
         order by 1 desc limit 40) x), '[]'::jsonb));
  end if;
  if 'vaccinations' = any (s.sections) then
    v_out := v_out || jsonb_build_object('vaccinations', coalesce((
      select jsonb_agg(jsonb_build_object('vaccine_name', vc.name, 'date_administered', vr.date_administered, 'dose_number', vr.dose_number,
               'batch_number', vr.batch_lot_number, 'verified', vr.verification_status::text = 'verified') order by vr.date_administered desc)
        from public.vaccination_records vr left join public.vaccination_catalog vc on vc.id = vr.vaccination_catalog_id
       where vr.profile_id = s.patient_id), '[]'::jsonb));
  end if;
  if 'procedures' = any (s.sections) then
    v_out := v_out || jsonb_build_object('procedures', coalesce((
      select jsonb_agg(jsonb_build_object('name', p.name, 'performed_on', p.performed_on, 'approximate_year', p.approximate_year, 'facility', p.facility,
               'verified_by_clinician', p.verified_by_clinician) order by coalesce(p.performed_on, make_date(coalesce(p.approximate_year, 1900), 1, 1)) desc)
        from public.procedures p where p.patient_id = s.patient_id and p.removed_at is null), '[]'::jsonb));
  end if;
  if 'family_history' = any (s.sections) then
    v_out := v_out || jsonb_build_object('family_history', coalesce((
      select jsonb_agg(jsonb_build_object('condition_name', f.condition_name, 'relationship', f.relationship::text, 'age_of_onset_years', f.age_of_onset_years,
               'verified_by_clinician', f.verified_by_clinician) order by f.condition_name)
        from public.family_history f where f.patient_id = s.patient_id and f.removed_at is null), '[]'::jsonb));
  end if;
  if 'emergency_info' = any (s.sections) then
    v_out := v_out || jsonb_build_object('emergency_info', jsonb_build_object(
      'blood', (select jsonb_build_object('blood_group', b.blood_group::text, 'genotype', b.genotype::text, 'source', b.provenance::text)
                  from public.patient_blood_profile b where b.patient_id = s.patient_id),
      'emergency_contact', case when v_profile.emergency_contact_name is null then null
         else jsonb_build_object('name', v_profile.emergency_contact_name, 'phone', v_profile.emergency_contact_phone, 'relationship', v_profile.emergency_contact_relationship) end));
  end if;

  return jsonb_build_object('status', 'ok', 'record', v_out);
end;
$$;

-- The S09 name stays callable for the web code that is already deployed. It returns the record only on a clean opening and null otherwise
-- (a PIN-protected link therefore reads as not found to the old page, which is the safe direction).
revoke all on function public.record_share_open(text, text, boolean) from public;
grant execute on function public.record_share_open(text, text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. FHIR export: the adolescent confidentiality gate
-- ---------------------------------------------------------------------------
-- One classifier for a free-text name: a condition word or a medicine word that gives a reproductive or mental health matter away. It composes the two
-- emergency card classifiers (migration 20261008035104) and maps to the waiver domain names.
create function private.confidential_domain_of_text(p_text text) returns text
language sql immutable set search_path = ''
as $$
  select case coalesce(private.emergency_card_sensitive_condition(p_text), private.emergency_card_sensitive_medicine(p_text))
           when 'reproductive' then 'sexual_reproductive_health'
           when 'mental_health' then 'mental_health'
           else null end
$$;
revoke all on function private.confidential_domain_of_text(text) from public, anon, authenticated;

create or replace function public.fhir_export_snapshot(p_patient uuid, p_sections text[] default null, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c_cap constant integer := 1000;                      -- technical page size per section, not a clinical value
  v_uid uuid := (select auth.uid());
  v_all constant text[] := array['vitals', 'lab_results', 'medications', 'conditions', 'allergies', 'immunizations', 'documents'];
  v_req text[];
  v_ok text[] := '{}';
  v_refused text[] := '{}';
  v_kind text;
  v_prof public.profiles%rowtype;
  v_sec text;
  v_cat public.care_access_category;
  v_allowed boolean;
  v_out jsonb;
  v_n integer := 0;
  v_part jsonb;
  v_hide_rep boolean := false;
  v_hide_mh boolean := false;
  v_excluded text[] := '{}';
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_prof from public.profiles where id = p_patient and role = 'patient';
  if not found then return jsonb_build_object('status', 'denied'); end if;

  v_req := coalesce(p_sections, v_all);
  if exists (select 1 from unnest(v_req) s where s <> all (v_all)) then
    raise exception 'unknown section' using errcode = '22023';
  end if;

  if v_uid = p_patient then
    v_kind := 'self';
  elsif exists (select 1 from public.profiles where id = v_uid and role = 'patient') then
    v_kind := 'supporter';
  else
    v_kind := 'staff';
    if p_reason is null or char_length(btrim(p_reason)) < 10 then
      raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
    end if;
  end if;

  -- S47 review fix: a guardian reading an adolescent (10 to 17) gets reproductive and mental health items only with the young person's waiver for that
  -- domain (private.guardian_may_view_confidential_domain). The same gate the rest of the platform uses, applied to the export.
  if v_kind = 'supporter' then
    v_hide_rep := not private.guardian_may_view_confidential_domain(p_patient, v_uid, 'sexual_reproductive_health');
    v_hide_mh := not private.guardian_may_view_confidential_domain(p_patient, v_uid, 'mental_health');
    if v_hide_rep then v_excluded := v_excluded || 'sexual_reproductive_health'::text; end if;
    if v_hide_mh then v_excluded := v_excluded || 'mental_health'::text; end if;
  end if;

  foreach v_sec in array v_req loop
    v_cat := case v_sec when 'vitals' then 'vitals_readings' when 'lab_results' then 'labs_results' when 'medications' then 'medications'
                        when 'immunizations' then 'vaccinations' else 'medical_history' end::public.care_access_category;
    v_allowed := case v_kind when 'self' then true
                             when 'supporter' then private.can_read_clinical(p_patient, v_cat)
                             else private.can_staff_read_clinical(p_patient, v_cat) end;
    if v_allowed then v_ok := v_ok || v_sec; else v_refused := v_refused || v_sec; end if;
  end loop;

  if cardinality(v_ok) = 0 then
    if v_kind = 'staff' then perform private.audit_chart_read(p_patient, v_req, p_reason, 'denied'); end if;
    return jsonb_build_object('status', 'denied');
  end if;

  v_out := jsonb_build_object(
    'status', 'ok', 'generated_at', now(), 'requester_kind', v_kind,
    'sections_included', to_jsonb(v_ok), 'sections_refused', to_jsonb(v_refused),
    'excluded_domains', to_jsonb(v_excluded),
    'limits', jsonb_build_array('items_inside_general_sections_are_not_classified_by_purpose'),
    'patient', jsonb_build_object('id', v_prof.id, 'patient_number', v_prof.patient_number, 'full_name', v_prof.full_name,
                                  'sex', v_prof.sex::text, 'date_of_birth', v_prof.date_of_birth));

  if 'vitals' = any (v_ok) then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.taken_at desc), '[]'::jsonb) into v_part from (
      select id, vital_type::text as vital_type, taken_at, source::text as source, systolic, diastolic, pulse_bpm, glucose_mmol_l,
             glucose_context::text as glucose_context, weight_kg, temperature_c, spo2_pct, waist_cm, ketones_mmol_l,
             respiratory_rate_bpm, peak_flow_l_min
        from public.vitals_readings where patient_id = p_patient order by taken_at desc limit c_cap) x;
    v_out := v_out || jsonb_build_object('vitals', v_part);
    v_n := v_n + jsonb_array_length(v_part);
  end if;

  if 'lab_results' = any (v_ok) then
    select coalesce(jsonb_agg(x.j order by x.ts desc), '[]'::jsonb) into v_part from (
      select r.released_at as ts,
             jsonb_build_object('id', i.id, 'code', i.analyte_code, 'value', i.value_numeric, 'value_text', i.value_text, 'unit', i.unit,
               'ref_low', i.ref_low, 'ref_high', i.ref_high, 'flag', i.flag, 'taken_at', r.released_at, 'origin', 'lab_result') as j
        from public.lab_result_items i join public.lab_results r on r.id = i.lab_result_id
       where i.patient_id = p_patient and r.release_state = 'released' and r.withdrawn_at is null and r.superseded_by is null and not i.sensitive_positive
      union all
      select lr.taken_at,
             jsonb_build_object('id', lr.id, 'code', lr.code, 'value', lr.value, 'value_text', lr.value_text, 'unit', lr.unit,
               'ref_low', lr.reference_range_low, 'ref_high', lr.reference_range_high, 'flag', lr.abnormal_flag::text, 'taken_at', lr.taken_at, 'origin', 'legacy_reading')
        from public.lab_analyte_readings lr
       where lr.patient_id = p_patient and lr.report_status in ('final', 'corrected', 'amended')
         and not private.report_excluded_code(lr.code)   -- S47 review fix (INV-04)
      order by 1 desc limit c_cap) x;
    v_out := v_out || jsonb_build_object('lab_results', v_part);
    v_n := v_n + jsonb_array_length(v_part);
  end if;

  if 'medications' = any (v_ok) then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_part from (
      select id, drug_name, dose, frequency, route, is_active, source::text as source, stopped_at, created_at
        from public.medications where patient_id = p_patient and superseded_at is null
         and not (v_hide_rep and coalesce(private.confidential_domain_of_text(drug_name), '') = 'sexual_reproductive_health')
         and not (v_hide_mh and coalesce(private.confidential_domain_of_text(drug_name), '') = 'mental_health')
       order by created_at desc limit c_cap) x;
    v_out := v_out || jsonb_build_object('medications', v_part);
    v_n := v_n + jsonb_array_length(v_part);
  end if;

  if 'conditions' = any (v_ok) then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_part from (
      select id, condition_name, icd10_code, status::text as status, date_identified, source::text as source, created_at
        from public.patient_conditions where patient_id = p_patient
         and not (v_hide_rep and coalesce(private.confidential_domain_of_text(condition_name), '') = 'sexual_reproductive_health')
         and not (v_hide_mh and coalesce(private.confidential_domain_of_text(condition_name), '') = 'mental_health')
       order by created_at desc limit c_cap) x;
    v_out := v_out || jsonb_build_object('conditions', v_part);
    v_n := v_n + jsonb_array_length(v_part);
  end if;

  if 'allergies' = any (v_ok) then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.noted_at desc), '[]'::jsonb) into v_part from (
      select id, allergen, reaction, severity::text as severity, noted_at, verification_status::text as verification_status, source::text as source
        from public.patient_allergies where patient_id = p_patient
         and not (v_hide_rep and coalesce(private.confidential_domain_of_text(allergen), '') = 'sexual_reproductive_health')
         and not (v_hide_mh and coalesce(private.confidential_domain_of_text(allergen), '') = 'mental_health')
       order by noted_at desc limit c_cap) x;
    v_out := v_out || jsonb_build_object('allergies', v_part);
    v_n := v_n + jsonb_array_length(v_part);
  end if;

  if 'immunizations' = any (v_ok) then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.date_administered desc), '[]'::jsonb) into v_part from (
      select vr.id, vc.code as vaccine_code, vc.name as vaccine_name, vr.dose_number, vr.date_administered, vr.batch_lot_number,
             coalesce(vr.location, vr.provider) as given_where, vr.route::text as route, vr.site,
             vr.verification_status::text as verification_status
        from public.vaccination_records vr left join public.vaccination_catalog vc on vc.id = vr.vaccination_catalog_id
       where vr.profile_id = p_patient and vr.verification_status::text <> 'rejected'
       order by vr.date_administered desc limit c_cap) x;
    v_out := v_out || jsonb_build_object('immunizations', v_part);
    v_n := v_n + jsonb_array_length(v_part);
  end if;

  if 'documents' = any (v_ok) then
    -- metadata only: never the file, its text, or a value read from a photo
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_part from (
      select id, document_type::text as document_type, document_date, mime_type, source::text as source, created_at
        from public.patient_documents where patient_id = p_patient and coalesce(ocr_state, 'pending') not in ('rejected', 'failed')
       order by created_at desc limit c_cap) x;
    v_out := v_out || jsonb_build_object('documents', v_part);
    v_n := v_n + jsonb_array_length(v_part);
  end if;

  insert into public.fhir_export_log (organisation_id, patient_id, requested_by, requester_kind, sections, refused_sections, resource_count, is_test)
  values (v_prof.organisation_id, p_patient, v_uid, v_kind, v_ok, v_refused, v_n + 1, v_prof.is_test);
  if v_kind = 'staff' then perform private.audit_chart_read(p_patient, v_ok, p_reason, 'success'); end if;

  return v_out;
end;
$$;
revoke all on function public.fhir_export_snapshot(uuid, text[], text) from public, anon;
grant execute on function public.fhir_export_snapshot(uuid, text[], text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.fhir_export_snapshot(uuid, text[], text)', 'EXECUTE') then raise exception 'S47b: anon can run fhir_export_snapshot'; end if;
  if has_function_privilege('authenticated', 'private.anonymise_patient_account(uuid)', 'EXECUTE') then raise exception 'S47b: anonymiser callable by a session'; end if;
  if has_function_privilege('authenticated', 'private.scrub_phone_event_keys(uuid)', 'EXECUTE') then raise exception 'S47b: scrub callable by a session'; end if;
  if not has_function_privilege('anon', 'public.record_share_open(text, text, boolean)', 'EXECUTE') then raise exception 'S47b: record_share_open must stay anon-executable'; end if;
  if not private.is_sensitive_result_code('HIV_RNA') or not private.is_sensitive_result_code('anti_hbc') or private.is_sensitive_result_code('anti_hbs') or private.is_sensitive_result_code('hba1c') then
    raise exception 'S47b: sensitive code variants are wrong';
  end if;
end $$;
