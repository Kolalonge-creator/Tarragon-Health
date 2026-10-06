-- S39: security hardening, round 1 (spec section 13; docs/design/S39.md).
-- 1. The two token-guessing doors that returned a silent null on a failed guess now count it: an hourly counter per door (never the
--    token), and one ops incident when a door's failures in an hour reach the threshold in versioned config. Nothing is blocked: the
--    emergency card must open for a stranger in an emergency, so the answer to guessing is to see it, not to lock the door.
-- 2. analytics.rpc_snapshots had row-level security off. It is switched on (no policy, no grant to any API role).
-- 3. BUG FIX found by the proof: record_share_by_token read vitals_readings.glucose_mmol, a column that was renamed glucose_mmol_l, so a
--    share that included the vitals section failed with an error instead of opening. Its lab_results section filtered on report_status =
--    'released', which is not a value of that enum (preliminary, final, corrected, amended), so it failed too; it now shares only reports that
--    are not preliminary. A share that included either section failed with an error instead of opening. The answer keeps its key name glucose_mmol (the share page reads it).
-- No data is changed. Applied with the version pinned to this filename.

-- ---------------------------------------------------------------------------
-- 1. Versioned config for the alert threshold (PROPOSED, CMO and security owner)
-- ---------------------------------------------------------------------------
create table if not exists public.security_config (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  is_active boolean not null default false,
  config jsonb not null,
  created_at timestamptz not null default now()
);
create unique index if not exists security_config_one_active on public.security_config ((true)) where is_active;
alter table public.security_config enable row level security;
revoke all on public.security_config from public, anon, authenticated;
comment on table public.security_config is 'S39: versioned security thresholds (PROPOSED). Changes are new versions, never edits. Service role and private functions only.';

insert into public.security_config (version, is_active, config)
-- security-rules-begin
select 1, true, $json$
{"lookup_failure_alert_per_hour": 50}
$json$::jsonb
where not exists (select 1 from public.security_config where version = 1);

-- ---------------------------------------------------------------------------
-- 2. The failure counter and the alert
-- ---------------------------------------------------------------------------
create table if not exists public.public_lookup_failures (
  kind text not null,
  hour_start timestamptz not null,
  failures integer not null default 0,
  alerted boolean not null default false,
  primary key (kind, hour_start)
);
alter table public.public_lookup_failures enable row level security;
revoke all on public.public_lookup_failures from public, anon, authenticated;
comment on table public.public_lookup_failures is 'S39: failed lookups on the public token doors, counted per hour. Holds no token and no caller detail.';

create or replace function private.log_public_lookup_failure(p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_hour timestamptz := date_trunc('hour', now()); v_limit integer; v_row public.public_lookup_failures%rowtype; v_org uuid;
begin
  select (config ->> 'lookup_failure_alert_per_hour')::integer into v_limit from public.security_config where is_active;
  insert into public.public_lookup_failures as f (kind, hour_start, failures) values (p_kind, v_hour, 1)
  on conflict (kind, hour_start) do update set failures = f.failures + 1
  returning * into v_row;
  if v_limit is not null and v_row.failures >= v_limit and not v_row.alerted then
    update public.public_lookup_failures set alerted = true where kind = p_kind and hour_start = v_hour;
    select id into v_org from public.organisations order by created_at limit 1;
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (v_org, 'security', 'sev3', 'Many failed lookups on a public door (' || p_kind || ')',
            v_row.failures || ' failed lookups in one hour on ' || p_kind || '. This may be someone guessing tokens. Check the lookups and, if needed, rotate or expire the tokens in use.',
            'public-lookup-' || p_kind || '-' || to_char(v_hour, 'YYYYMMDDHH24'), now() + interval '1 day', now() + interval '3 days');
  end if;
end $$;
revoke all on function private.log_public_lookup_failure(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The two doors, with the counter added (bodies are the live definitions; only the three early exits changed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emergency_card_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_card    public.emergency_cards%rowtype;
  v_profile public.profiles%rowtype;
  v_payload jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    perform private.log_public_lookup_failure('emergency_card');
    return null;
  end if;

  select * into v_card
  from public.emergency_cards
  where token = p_token and is_active and expires_at > now();

  if not found then
    perform private.log_public_lookup_failure('emergency_card');
    return null;
  end if;

  select * into v_profile from public.profiles where id = v_card.patient_id;
  if not found then
    perform private.log_public_lookup_failure('emergency_card');
    return null;
  end if;

  insert into public.emergency_card_lookups (card_id) values (v_card.id);

  if v_card.last_viewed_on is null or v_card.last_viewed_on < current_date then
    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload)
    values
      (v_card.organisation_id, v_card.patient_id, 'in_app', 'emergency_card_viewed',
       jsonb_build_object('viewed_on', current_date)),
      (v_card.organisation_id, v_card.patient_id, 'email', 'emergency_card_viewed',
       jsonb_build_object('viewed_on', current_date));
  end if;

  update public.emergency_cards
  set view_count = view_count + 1, last_viewed_at = now(), last_viewed_on = current_date
  where id = v_card.id;

  v_payload := jsonb_build_object(
    'full_name', v_profile.full_name,
    'date_of_birth', v_profile.date_of_birth,
    'sex', v_profile.sex,
    'patient_number', v_profile.patient_number,
    'emergency_contact', case
      when v_profile.emergency_contact_name is null then null
      else jsonb_build_object(
        'name', v_profile.emergency_contact_name,
        'phone', v_profile.emergency_contact_phone,
        'relationship', v_profile.emergency_contact_relationship
      )
    end,
    'allergies', coalesce((
      select jsonb_agg(jsonb_build_object('allergen', a.allergen, 'reaction', a.reaction, 'severity', a.severity)
             order by a.severity desc nulls last, a.allergen)
      from public.patient_allergies a where a.patient_id = v_card.patient_id
    ), '[]'::jsonb),
    'medications', coalesce((
      select jsonb_agg(jsonb_build_object('drug_name', m.drug_name, 'dose', m.dose, 'frequency', m.frequency)
             order by m.drug_name)
      from public.medications m where m.patient_id = v_card.patient_id and m.is_active
    ), '[]'::jsonb),
    'conditions', coalesce((
      select jsonb_agg(distinct cp.condition::text)
      from public.care_plans cp where cp.patient_id = v_card.patient_id and cp.status = 'active'
    ), '[]'::jsonb),
    'blood', (
      select jsonb_build_object(
        'blood_group', b.blood_group::text,
        'genotype', b.genotype::text,
        'note', b.genotype_note,
        'provenance', b.provenance,
        'recorded_at', b.recorded_at
      )
      from public.patient_blood_profile b where b.patient_id = v_card.patient_id
    ),
    'issued_at', v_card.created_at,
    'expires_at', v_card.expires_at,
    'source', 'TarragonHealth'
  );

  return v_payload;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_share_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_share   public.record_shares%rowtype;
  v_profile public.profiles%rowtype;
  v_result  jsonb := '{}'::jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    perform private.log_public_lookup_failure('record_share');
    return null;
  end if;

  select * into v_share
  from public.record_shares
  where token = p_token
    and is_active
    and expires_at > now();

  if not found then
    perform private.log_public_lookup_failure('record_share');
    return null;
  end if;

  select * into v_profile
  from public.profiles
  where id = v_share.patient_id;

  if not found then
    perform private.log_public_lookup_failure('record_share');
    return null;
  end if;

  -- Log the lookup
  insert into public.record_share_lookups (share_id) values (v_share.id);
  update public.record_shares
  set view_count = view_count + 1, last_viewed_at = now()
  where id = v_share.id;

  -- Build result with only the selected sections
  v_result := jsonb_build_object(
    'full_name', v_profile.full_name,
    'shared_at', v_share.created_at,
    'expires_at', v_share.expires_at,
    'sections', v_share.sections
  );

  -- Vitals: last 20 readings
  if 'vitals' = any(v_share.sections) then
    v_result := v_result || jsonb_build_object(
      'vitals', coalesce((
        select jsonb_agg(jsonb_build_object(
          'vital_type', vr.vital_type::text,
          'systolic', vr.systolic,
          'diastolic', vr.diastolic,
          'pulse_bpm', vr.pulse_bpm,
          'glucose_mmol', vr.glucose_mmol_l,
          'weight_kg', vr.weight_kg,
          'temperature_c', vr.temperature_c,
          'spo2_pct', vr.spo2_pct,
          'source', vr.source::text,
          'taken_at', vr.taken_at
        ) order by vr.taken_at desc)
        from (
          select * from public.vitals_readings
          where patient_id = v_share.patient_id
          order by taken_at desc
          limit 20
        ) vr
      ), '[]'::jsonb)
    );
  end if;

  -- Medications: active only
  if 'medications' = any(v_share.sections) then
    v_result := v_result || jsonb_build_object(
      'medications', coalesce((
        select jsonb_agg(jsonb_build_object(
          'drug_name', m.drug_name,
          'dose', m.dose,
          'frequency', m.frequency,
          'is_active', m.is_active
        ) order by m.drug_name)
        from public.medications m
        where m.patient_id = v_share.patient_id and m.is_active
      ), '[]'::jsonb)
    );
  end if;

  -- Conditions: active care plans
  if 'conditions' = any(v_share.sections) then
    v_result := v_result || jsonb_build_object(
      'conditions', coalesce((
        select jsonb_agg(distinct cp.condition::text)
        from public.care_plans cp
        where cp.patient_id = v_share.patient_id and cp.status = 'active'
      ), '[]'::jsonb)
    );
  end if;

  -- Allergies
  if 'allergies' = any(v_share.sections) then
    v_result := v_result || jsonb_build_object(
      'allergies', coalesce((
        select jsonb_agg(jsonb_build_object(
          'allergen', a.allergen,
          'reaction', a.reaction,
          'severity', a.severity
        ) order by a.severity desc nulls last, a.allergen)
        from public.patient_allergies a
        where a.patient_id = v_share.patient_id
      ), '[]'::jsonb)
    );
  end if;

  -- Lab results: last 20 analyte readings
  if 'lab_results' = any(v_share.sections) then
    v_result := v_result || jsonb_build_object(
      'lab_results', coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', lr.code,
          'value', lr.value,
          'value_text', lr.value_text,
          'unit', lr.unit,
          'reference_range_text', lr.reference_range_text,
          'abnormal_flag', lr.abnormal_flag,
          'taken_at', lr.taken_at,
          'laboratory', lr.laboratory
        ) order by lr.taken_at desc)
        from (
          select * from public.lab_analyte_readings
          where patient_id = v_share.patient_id
            and report_status in ('final', 'corrected', 'amended')
          order by taken_at desc
          limit 20
        ) lr
      ), '[]'::jsonb)
    );
  end if;

  -- Vaccinations
  if 'vaccinations' = any(v_share.sections) then
    v_result := v_result || jsonb_build_object(
      'vaccinations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'vaccine_name', vc.name,
          'date_administered', vr.date_administered,
          'dose_number', vr.dose_number,
          'batch_number', vr.batch_lot_number
        ) order by vr.date_administered desc)
        from public.vaccination_records vr
        left join public.vaccination_catalog vc on vc.id = vr.vaccination_catalog_id
        where vr.profile_id = v_share.patient_id
      ), '[]'::jsonb)
    );
  end if;

  -- Emergency info: blood + emergency contact
  if 'emergency_info' = any(v_share.sections) then
    v_result := v_result || jsonb_build_object(
      'emergency_info', jsonb_build_object(
        'blood', (
          select jsonb_build_object(
            'blood_group', b.blood_group::text,
            'genotype', b.genotype::text,
            'source', b.provenance::text
          )
          from public.patient_blood_profile b
          where b.patient_id = v_share.patient_id
        ),
        'emergency_contact', case
          when v_profile.emergency_contact_name is null then null
          else jsonb_build_object(
            'name', v_profile.emergency_contact_name,
            'phone', v_profile.emergency_contact_phone,
            'relationship', v_profile.emergency_contact_relationship
          )
        end
      )
    );
  end if;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. analytics.rpc_snapshots: row-level security on
-- ---------------------------------------------------------------------------
alter table analytics.rpc_snapshots enable row level security;
revoke all on analytics.rpc_snapshots from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','private','analytics') and not c.relrowsecurity) then
    raise exception 'S39: a table is still without row-level security';
  end if;
  if not has_function_privilege('anon', 'public.emergency_card_by_token(text)', 'EXECUTE') then raise exception 'S39: the emergency card door must stay open to anon'; end if;
  if has_function_privilege('anon', 'private.log_public_lookup_failure(text)', 'EXECUTE') then raise exception 'S39: the counter must not be callable by anon'; end if;
  if (select count(*) from public.security_config where is_active) <> 1 then raise exception 'S39: exactly one active security config'; end if;
end $$;
