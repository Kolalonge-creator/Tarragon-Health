-- Diagnostic directory Phase 7: controlled import from the data-collection spreadsheet (spec §15.4, design §11).
--
--   diagnostic_import_batches / diagnostic_import_rows   a staged copy of each spreadsheet row, checked on arrival.
--   admin_dx_import_stage(source, note, rows)            stage a batch. Touches no listing.
--   admin_dx_import_apply_row(row_id)                    a verifier turns ONE staged row into DRAFT records:
--        * a new uncontracted facility (or a new branch of an existing uncontracted one, matched by exact name and kind),
--        * each investigation as availability 'awaiting_confirmation' (a spreadsheet is not a phone call),
--        * the registration and accreditation as PENDING credentials (they count only after a person checks the source).
--      Nothing is ever listed by an import. The partner, record-status and verification-date columns are kept on the staged
--      row for reference only: partner status is set by an admin (Phase 4), and verification happens in the directory screens.
--   admin_dx_import_reject_row(row_id, reason) / admin_dx_import_batches() / admin_dx_import_rows(batch_id)
--
-- A contracted provider is never touched by an import (its branches are managed on the partner screen), and a branch whose
-- address already exists for that provider is refused as a duplicate.

-- ---------------------------------------------------------------------------
-- 1. Staging tables
-- ---------------------------------------------------------------------------
create table public.diagnostic_import_batches (
  id          uuid primary key default gen_random_uuid(),
  source      text not null check (char_length(btrim(source)) between 3 and 200),
  note        text check (note is null or char_length(note) <= 1000),
  created_by  uuid not null references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now()
);

create table public.diagnostic_import_rows (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid not null references public.diagnostic_import_batches (id) on delete restrict,
  row_number          integer not null check (row_number > 0),
  data                jsonb not null,
  problems            text[] not null default '{}',
  status              text not null default 'staged' check (status in ('staged', 'invalid', 'applied', 'rejected')),
  outcome             text,
  provider_listing_id uuid references public.diagnostic_provider_listings (id) on delete restrict,
  branch_listing_id   uuid references public.diagnostic_branch_listings (id) on delete restrict,
  decided_by          uuid references public.profiles (id) on delete restrict,
  decided_at          timestamptz,
  constraint diagnostic_import_rows_one unique (batch_id, row_number),
  constraint diagnostic_import_rows_decided check ((status in ('staged', 'invalid')) = (decided_at is null)),
  constraint diagnostic_import_rows_applied check (status <> 'applied' or branch_listing_id is not null)
);
create index diagnostic_import_rows_batch_idx on public.diagnostic_import_rows (batch_id, row_number);

do $$
declare t text;
begin
  foreach t in array array['diagnostic_import_batches', 'diagnostic_import_rows'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.can_verify_diagnostic_directory())',
                   t || '_select_verifiers', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated, anon', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Row checks (pure: what is wrong with one spreadsheet row)
-- ---------------------------------------------------------------------------
create or replace function private.diagnostic_import_problems(p jsonb)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text[] := '{}';
  v_kind text := lower(btrim(coalesce(p ->> 'facility_type', '')));
  v_code text;
  c public.reference_concepts%rowtype;
  v_reg text := lower(btrim(coalesce(p ->> 'regulator', '')));
begin
  if char_length(btrim(coalesce(p ->> 'trading_name', ''))) < 2 then v := v || 'trading_name missing'::text; end if;
  if char_length(btrim(coalesce(p ->> 'branch_name', ''))) < 2 then v := v || 'branch_name missing'::text; end if;
  if v_kind not in ('lab', 'imaging') then v := v || 'facility_type must be lab or imaging'::text; end if;
  if char_length(btrim(coalesce(p ->> 'state', ''))) < 2 then v := v || 'state missing'::text; end if;
  if char_length(btrim(coalesce(p ->> 'town', ''))) < 2 then v := v || 'town missing'::text; end if;
  if char_length(btrim(coalesce(p ->> 'address', ''))) < 5 then v := v || 'address missing'::text; end if;
  if nullif(btrim(coalesce(p ->> 'phone', '')), '') is not null and (p ->> 'phone') !~ '^\+[1-9][0-9]{7,14}$' then
    v := v || 'phone must be in +234... form'::text;
  end if;
  if (nullif(btrim(coalesce(p ->> 'latitude', '')), '') is null) <> (nullif(btrim(coalesce(p ->> 'longitude', '')), '') is null) then
    v := v || 'give both latitude and longitude, or neither'::text;
  elsif nullif(btrim(coalesce(p ->> 'latitude', '')), '') is not null then
    begin
      if (p ->> 'latitude')::double precision not between 4 and 14 or (p ->> 'longitude')::double precision not between 2 and 15 then
        v := v || 'coordinates are outside Nigeria'::text;
      end if;
    exception when others then v := v || 'latitude and longitude must be numbers'::text;
    end;
  end if;
  foreach v_code in array coalesce(string_to_array(nullif(btrim(coalesce(p ->> 'investigation_codes', '')), ''), ';'), '{}') loop
    select * into c from public.reference_concepts where code = btrim(v_code);
    if c.id is null or c.investigation_category is null then
      v := v || ('unknown investigation code ' || btrim(v_code));
    elsif c.is_ambiguous then
      v := v || ('investigation code ' || btrim(v_code) || ' is a group; use a specific test');
    elsif v_kind = 'lab' and c.modality is not null then
      v := v || ('a laboratory cannot list imaging ' || btrim(v_code));
    elsif v_kind = 'imaging' and c.domain <> 'procedure' then
      v := v || ('an imaging centre cannot list laboratory test ' || btrim(v_code));
    end if;
  end loop;
  if v_reg <> '' and v_reg not in ('mlscn_registration', 'nnra_authorisation', 'state_facility_licence', 'rrbn', 'mdcn', 'other') then
    v := v || 'regulator must be mlscn_registration, nnra_authorisation, state_facility_licence, rrbn, mdcn or other'::text;
  end if;
  if v_reg in ('state_facility_licence', 'other') and nullif(btrim(coalesce(p ->> 'regulator_name', '')), '') is null then
    v := v || 'a state licence or other regulator needs regulator_name (for example "Lagos HEFAMAA")'::text;
  end if;
  if v_reg <> '' and nullif(btrim(coalesce(p ->> 'registration_number', '')), '') is null then
    v := v || 'a regulator needs its registration_number'::text;
  end if;
  if nullif(btrim(coalesce(p ->> 'accreditation_number', '')), '') is not null and (
       nullif(btrim(coalesce(p ->> 'accreditation_body', '')), '') is null
       or nullif(btrim(coalesce(p ->> 'accreditation_scope_codes', '')), '') is null) then
    v := v || 'ISO 15189 needs its accreditation body and the tests in its scope'::text;
  end if;
  if (v_reg <> '' or nullif(btrim(coalesce(p ->> 'accreditation_number', '')), '') is not null)
     and coalesce(p ->> 'evidence_url', '') !~ '^https?://[^ ]+$' then
    v := v || 'a registration or accreditation needs evidence_url (a link to the register or certificate)'::text;
  end if;
  foreach v_code in array array['registration_expires_on', 'accreditation_expires_on'] loop
    if nullif(btrim(coalesce(p ->> v_code, '')), '') is not null and (p ->> v_code) !~ '^\d{4}-\d{2}-\d{2}$' then
      v := v || (v_code || ' must be YYYY-MM-DD');
    end if;
  end loop;
  if char_length(btrim(coalesce(p ->> 'evidence', ''))) < 5 then v := v || 'evidence (where this row came from) missing'::text; end if;
  return v;
end;
$$;
revoke all on function private.diagnostic_import_problems(jsonb) from public;

-- ---------------------------------------------------------------------------
-- 3. Stage, apply, reject, read
-- ---------------------------------------------------------------------------
create or replace function public.admin_dx_import_stage(p_source text, p_note text, p_rows jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
  r record;
  v_problems text[];
begin
  perform private.diagnostic_require_verifier();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 2000 then
    raise exception 'send 1 to 2000 rows' using errcode = '22023';
  end if;
  insert into public.diagnostic_import_batches (source, note, created_by)
  values (btrim(coalesce(p_source, '')), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_batch;
  for r in select value as data, ordinality::integer as n from jsonb_array_elements(p_rows) with ordinality loop
    if jsonb_typeof(r.data) <> 'object' then
      v_problems := array['row is not a record'];
    else
      v_problems := private.diagnostic_import_problems(r.data);
    end if;
    insert into public.diagnostic_import_rows (batch_id, row_number, data, problems, status)
    values (v_batch, r.n, case when jsonb_typeof(r.data) = 'object' then r.data else jsonb_build_object('value', r.data) end,
            v_problems, case when cardinality(v_problems) = 0 then 'staged' else 'invalid' end);
  end loop;
  perform private.diagnostic_log('diagnostic_import_batches', v_batch, 'import_staged', null, jsonb_array_length(p_rows)::text, p_source);
  return v_batch;
end;
$$;

create or replace function public.admin_dx_import_apply_row(p_row_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ir public.diagnostic_import_rows%rowtype;
  b public.diagnostic_import_batches%rowtype;
  d jsonb;
  v_kind text;
  v_name text;
  v_provider uuid;
  v_contracted boolean;
  v_listing uuid;
  v_branch uuid;
  v_code text;
  v_concept uuid;
  v_evidence text;
  v_lat double precision;
  v_lng double precision;
  v_reg text;
begin
  perform private.diagnostic_require_verifier();
  select * into ir from public.diagnostic_import_rows where id = p_row_id for update;
  if ir.id is null then raise exception 'unknown import row' using errcode = '22023'; end if;
  if ir.status <> 'staged' then raise exception 'only a staged row without problems can be applied' using errcode = '22023'; end if;
  -- Re-check: the catalogue may have changed since staging.
  if cardinality(private.diagnostic_import_problems(ir.data)) > 0 then
    raise exception 'this row has problems; fix the spreadsheet and stage it again' using errcode = '22023';
  end if;
  select * into b from public.diagnostic_import_batches where id = ir.batch_id;
  d := ir.data;
  v_kind := lower(btrim(d ->> 'facility_type'));
  v_name := btrim(d ->> 'trading_name');
  v_evidence := left('Imported from "' || b.source || '" row ' || ir.row_number || ': ' || btrim(d ->> 'evidence'), 300);
  v_lat := nullif(btrim(coalesce(d ->> 'latitude', '')), '')::double precision;
  v_lng := nullif(btrim(coalesce(d ->> 'longitude', '')), '')::double precision;

  -- Match an existing provider of the same kind by exact name (case-insensitive). Ambiguity is refused, never guessed.
  if v_kind = 'lab' then
    if (select count(*) from public.lab_providers where lower(btrim(name)) = lower(v_name)) > 1 then
      raise exception 'more than one laboratory has this name; add the branch by hand' using errcode = '23505';
    end if;
    select id, is_active into v_provider, v_contracted from public.lab_providers where lower(btrim(name)) = lower(v_name);
    if v_provider is not null then select id into v_listing from public.diagnostic_provider_listings where lab_provider_id = v_provider; end if;
  else
    if (select count(*) from public.imaging_providers where lower(btrim(name)) = lower(v_name)) > 1 then
      raise exception 'more than one imaging centre has this name; add the branch by hand' using errcode = '23505';
    end if;
    select id, is_active into v_provider, v_contracted from public.imaging_providers where lower(btrim(name)) = lower(v_name);
    if v_provider is not null then select id into v_listing from public.diagnostic_provider_listings where imaging_provider_id = v_provider; end if;
  end if;
  if coalesce(v_contracted, false) then
    raise exception 'a contracted provider''s branches are managed on the partner screen, not by import' using errcode = '42501';
  end if;
  if v_provider is not null and exists (
       select 1 from public.lab_provider_locations l where v_kind = 'lab' and l.lab_provider_id = v_provider
          and lower(regexp_replace(l.address, '\s+', ' ', 'g')) = lower(regexp_replace(btrim(d ->> 'address'), '\s+', ' ', 'g'))
       union all
       select 1 from public.imaging_provider_locations l where v_kind = 'imaging' and l.imaging_provider_id = v_provider
          and lower(regexp_replace(l.address, '\s+', ' ', 'g')) = lower(regexp_replace(btrim(d ->> 'address'), '\s+', ' ', 'g'))) then
    raise exception 'this provider already has a branch at that address' using errcode = '23505';
  end if;

  if v_provider is null then
    v_listing := public.admin_dx_create_facility(v_kind, v_name, btrim(d ->> 'branch_name'), btrim(d ->> 'state'), btrim(d ->> 'town'),
                   nullif(btrim(coalesce(d ->> 'lga', '')), ''), btrim(d ->> 'address'), nullif(btrim(coalesce(d ->> 'phone', '')), ''),
                   v_lat, v_lng, false);
    select id into v_branch from public.diagnostic_branch_listings where provider_listing_id = v_listing;
  else
    if v_listing is null then
      v_listing := public.admin_dx_create_provider_listing(v_kind, v_provider, false);
    end if;
    v_branch := public.admin_dx_add_branch(v_listing, btrim(d ->> 'branch_name'), btrim(d ->> 'state'), btrim(d ->> 'town'),
                  nullif(btrim(coalesce(d ->> 'lga', '')), ''), btrim(d ->> 'address'), nullif(btrim(coalesce(d ->> 'phone', '')), ''),
                  v_lat, v_lng);
  end if;

  foreach v_code in array coalesce(string_to_array(nullif(btrim(coalesce(d ->> 'investigation_codes', '')), ''), ';'), '{}') loop
    select id into v_concept from public.reference_concepts where code = btrim(v_code);
    perform public.admin_dx_upsert_service(v_branch, v_concept, 'awaiting_confirmation', 'onsite', null, false, null, null, v_evidence);
  end loop;

  v_reg := lower(btrim(coalesce(d ->> 'regulator', '')));
  if v_reg <> '' then
    perform public.admin_dx_record_credential('branch', v_branch, v_reg, coalesce(nullif(btrim(coalesce(d ->> 'regulator_name', '')), ''), upper(split_part(v_reg, '_', 1))),
      null, case when v_reg = 'state_facility_licence' then btrim(d ->> 'state') end, btrim(d ->> 'registration_number'),
      null, null, null, nullif(btrim(coalesce(d ->> 'registration_expires_on', '')), '')::date,
      nullif(btrim(coalesce(d ->> 'evidence_url', '')), ''), null);
  end if;
  if nullif(btrim(coalesce(d ->> 'accreditation_number', '')), '') is not null then
    perform public.admin_dx_record_credential('branch', v_branch, 'iso15189', btrim(d ->> 'accreditation_body'), btrim(d ->> 'accreditation_body'),
      null, btrim(d ->> 'accreditation_number'),
      (select array_agg(rc.id) from public.reference_concepts rc
        where rc.code = any (select btrim(x) from unnest(string_to_array(d ->> 'accreditation_scope_codes', ';')) x)),
      null, null, nullif(btrim(coalesce(d ->> 'accreditation_expires_on', '')), '')::date,
      nullif(btrim(coalesce(d ->> 'evidence_url', '')), ''), null);
  end if;

  update public.diagnostic_import_rows
     set status = 'applied', provider_listing_id = v_listing, branch_listing_id = v_branch, decided_by = auth.uid(), decided_at = now(),
         outcome = 'Draft created: tests awaiting confirmation, credentials pending'
   where id = ir.id;
  perform private.diagnostic_log('diagnostic_import_rows', ir.id, 'import_applied', 'staged', 'applied', v_evidence);
  return v_branch;
end;
$$;

create or replace function public.admin_dx_import_reject_row(p_row_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.diagnostic_require_verifier();
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'give a reason of at least 10 characters' using errcode = '22023'; end if;
  update public.diagnostic_import_rows
     set status = 'rejected', outcome = btrim(p_reason), decided_by = auth.uid(), decided_at = now()
   where id = p_row_id and status in ('staged', 'invalid');
  if not found then raise exception 'only an undecided row can be rejected' using errcode = '22023'; end if;
  perform private.diagnostic_log('diagnostic_import_rows', p_row_id, 'import_rejected', null, 'rejected', p_reason);
end;
$$;

create or replace function public.admin_dx_import_batches()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.diagnostic_require_verifier();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', b.id, 'source', b.source, 'note', b.note, 'created_at', b.created_at,
             'created_by', (select full_name from public.profiles where id = b.created_by),
             'rows', (select count(*) from public.diagnostic_import_rows r where r.batch_id = b.id),
             'staged', (select count(*) from public.diagnostic_import_rows r where r.batch_id = b.id and r.status = 'staged'),
             'invalid', (select count(*) from public.diagnostic_import_rows r where r.batch_id = b.id and r.status = 'invalid'),
             'applied', (select count(*) from public.diagnostic_import_rows r where r.batch_id = b.id and r.status = 'applied'),
             'rejected', (select count(*) from public.diagnostic_import_rows r where r.batch_id = b.id and r.status = 'rejected'))
           order by b.created_at desc)
      from (select * from public.diagnostic_import_batches order by created_at desc limit 50) b), '[]'::jsonb);
end;
$$;

create or replace function public.admin_dx_import_rows(p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.diagnostic_require_verifier();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'row_number', r.row_number, 'data', r.data, 'problems', to_jsonb(r.problems), 'status', r.status,
             'outcome', r.outcome, 'provider_listing_id', r.provider_listing_id, 'branch_listing_id', r.branch_listing_id,
             'decided_at', r.decided_at, 'decided_by', (select full_name from public.profiles where id = r.decided_by))
           order by r.row_number)
      from public.diagnostic_import_rows r where r.batch_id = p_batch_id), '[]'::jsonb);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_dx_import_stage(text, text, jsonb)',
    'public.admin_dx_import_apply_row(uuid)',
    'public.admin_dx_import_reject_row(uuid, text)',
    'public.admin_dx_import_batches()',
    'public.admin_dx_import_rows(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
  end loop;
end;
$$;
