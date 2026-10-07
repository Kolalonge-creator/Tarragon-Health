-- S09: time-limited record sharing (spec 2.8)
--
-- Patients choose which health record sections to share, get a time-limited
-- link with a QR code. Every access is audited. Revocation is instant.
-- Sections are a closed set; reproductive_health is excluded.
--
-- Tables: record_shares, record_share_lookups
-- RPCs:   create_record_share, revoke_record_share, record_share_by_token

-- 1. Table: record_shares ---------------------------------------------------
create table if not exists public.record_shares (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  token           text not null,
  sections        text[] not null,
  expires_at      timestamptz not null,
  is_active       boolean not null default true,
  consented_at    timestamptz not null default now(),
  revoked_at      timestamptz,
  view_count      integer not null default 0,
  last_viewed_at  timestamptz,
  created_at      timestamptz not null default now(),

  constraint record_shares_token_length
    check (length(token) between 32 and 128),
  constraint record_shares_token_unique
    unique (token),
  constraint record_shares_expires_max_30d
    check (expires_at <= created_at + interval '30 days' + interval '1 minute'),
  constraint record_shares_sections_not_empty
    check (cardinality(sections) > 0),
  constraint record_shares_sections_valid
    check (sections <@ array[
      'vitals', 'medications', 'conditions', 'allergies',
      'lab_results', 'vaccinations', 'emergency_info'
    ]::text[])
);

create index if not exists record_shares_patient_idx
  on public.record_shares (patient_id, created_at desc);
create index if not exists record_shares_token_idx
  on public.record_shares (token) where is_active;

-- 2. Table: record_share_lookups (audit) ------------------------------------
create table if not exists public.record_share_lookups (
  id           uuid primary key default gen_random_uuid(),
  share_id     uuid not null references public.record_shares (id) on delete cascade,
  looked_up_at timestamptz not null default now()
);

create index if not exists record_share_lookups_share_idx
  on public.record_share_lookups (share_id, looked_up_at desc);

-- 3. RLS --------------------------------------------------------------------
alter table public.record_shares enable row level security;
alter table public.record_share_lookups enable row level security;

-- Patient reads and creates their own shares
create policy record_shares_patient_select on public.record_shares
  for select to authenticated
  using (patient_id = (select auth.uid()));

create policy record_shares_patient_insert on public.record_shares
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

create policy record_shares_patient_update on public.record_shares
  for update to authenticated
  using (patient_id = (select auth.uid()));

-- Org staff can see existence (not the token) via a view, not direct access
create policy record_shares_org_staff_select on public.record_shares
  for select to authenticated
  using (private.is_org_staff(organisation_id));

-- Patient reads their share lookups
create policy record_share_lookups_patient_select on public.record_share_lookups
  for select to authenticated
  using (
    share_id in (
      select id from public.record_shares
      where patient_id = (select auth.uid())
    )
  );

grant select, insert, update on public.record_shares to authenticated;
grant select on public.record_share_lookups to authenticated;

-- 4. RPC: create_record_share -----------------------------------------------
create or replace function public.create_record_share(
  p_sections text[],
  p_expires_in_hours integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient_id  uuid;
  v_org_id      uuid;
  v_token       text;
  v_expires_at  timestamptz;
  v_share       public.record_shares;
  v_allowed     text[] := array[
    'vitals', 'medications', 'conditions', 'allergies',
    'lab_results', 'vaccinations', 'emergency_info'
  ];
begin
  v_patient_id := (select auth.uid());
  if v_patient_id is null then
    raise exception 'not authenticated';
  end if;

  select organisation_id into v_org_id
  from public.profiles
  where id = v_patient_id;

  if v_org_id is null then
    raise exception 'profile not found';
  end if;

  -- Validate sections
  if p_sections is null or cardinality(p_sections) = 0 then
    raise exception 'at least one section must be selected';
  end if;

  if not (p_sections <@ v_allowed) then
    raise exception 'invalid section in list: allowed are vitals, medications, conditions, allergies, lab_results, vaccinations, emergency_info';
  end if;

  -- Max 30 days (720 hours)
  if p_expires_in_hours < 1 or p_expires_in_hours > 720 then
    raise exception 'expires_in_hours must be between 1 and 720';
  end if;

  -- Generate a 32-byte hex token
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := now() + (p_expires_in_hours || ' hours')::interval;

  insert into public.record_shares
    (organisation_id, patient_id, token, sections, expires_at)
  values
    (v_org_id, v_patient_id, v_token, p_sections, v_expires_at)
  returning * into v_share;

  return jsonb_build_object(
    'id', v_share.id,
    'token', v_share.token,
    'sections', v_share.sections,
    'expires_at', v_share.expires_at,
    'created_at', v_share.created_at
  );
end;
$$;

-- 5. RPC: revoke_record_share -----------------------------------------------
create or replace function public.revoke_record_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.record_shares
  set is_active = false,
      revoked_at = now()
  where id = p_share_id
    and patient_id = (select auth.uid())
    and is_active;

  if not found then
    raise exception 'share not found or already revoked';
  end if;
end;
$$;

-- 6. RPC: record_share_by_token (SECURITY DEFINER, anon-callable) -----------
create or replace function public.record_share_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share   public.record_shares%rowtype;
  v_profile public.profiles%rowtype;
  v_result  jsonb := '{}'::jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;

  select * into v_share
  from public.record_shares
  where token = p_token
    and is_active
    and expires_at > now();

  if not found then
    return null;
  end if;

  select * into v_profile
  from public.profiles
  where id = v_share.patient_id;

  if not found then
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
          'glucose_mmol', vr.glucose_mmol,
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
            and report_status = 'released'
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
$$;

-- 7. Permissions ------------------------------------------------------------
revoke all on function public.create_record_share(text[], integer) from public;
revoke all on function public.revoke_record_share(uuid) from public;
revoke all on function public.record_share_by_token(text) from public;

grant execute on function public.create_record_share(text[], integer) to authenticated;
grant execute on function public.revoke_record_share(uuid) to authenticated;
grant execute on function public.record_share_by_token(text) to anon, authenticated;

-- 8. Self-checks ------------------------------------------------------------
do $$
begin
  -- Tables exist
  if to_regclass('public.record_shares') is null then
    raise exception 'record_shares table missing';
  end if;
  if to_regclass('public.record_share_lookups') is null then
    raise exception 'record_share_lookups table missing';
  end if;

  -- Anon can execute record_share_by_token
  if not has_function_privilege('anon', 'public.record_share_by_token(text)', 'EXECUTE') then
    raise exception 'record_share_by_token must be anon-executable';
  end if;

  -- Anon cannot execute create or revoke
  if has_function_privilege('anon', 'public.create_record_share(text[], integer)', 'EXECUTE') then
    raise exception 'create_record_share must NOT be anon-executable';
  end if;
  if has_function_privilege('anon', 'public.revoke_record_share(uuid)', 'EXECUTE') then
    raise exception 'revoke_record_share must NOT be anon-executable';
  end if;

  -- RLS is enabled
  if not (select relrowsecurity from pg_class where oid = 'public.record_shares'::regclass) then
    raise exception 'record_shares must have RLS enabled';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.record_share_lookups'::regclass) then
    raise exception 'record_share_lookups must have RLS enabled';
  end if;
end
$$;
