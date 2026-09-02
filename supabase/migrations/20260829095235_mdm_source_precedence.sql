-- Tarragon Health — Health Data Architecture & MDM (spec §34.9)
-- Source precedence for conflicting data.

create table public.source_precedence_rules (
  id            uuid primary key default gen_random_uuid(),
  domain        text not null,
  source_value  text not null,
  rank          integer not null,
  note          text,
  created_at    timestamptz not null default now(),
  unique (domain, source_value)
);

comment on table public.source_precedence_rules is
  'Per-domain source precedence (§34.9), e.g. blood_profile: lab_document ranks above patient_attested. Lower rank = higher precedence (wins a conflict).';

create or replace function public.resolve_source_precedence(
  p_domain text,
  p_source_a text,
  p_source_b text
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_source_a = p_source_b then p_source_a
    else (
      select r.source_value
      from public.source_precedence_rules r
      where r.domain = p_domain and r.source_value in (p_source_a, p_source_b)
      order by r.rank asc
      limit 1
    )
  end;
$$;

comment on function public.resolve_source_precedence is
  'Returns whichever of p_source_a/p_source_b has the lower (higher-precedence) rank for p_domain in source_precedence_rules. Returns null if the domain has no rule for either source — an unranked domain should never silently pick a winner.';

insert into public.source_precedence_rules (domain, source_value, rank, note) values
  ('blood_profile', 'lab_document', 1, 'A lab report is a direct, verifiable test result.'),
  ('blood_profile', 'patient_attested', 2, 'Self-reported; may be memory, an old card, or a guess.');

create table public.superseded_source_values (
  id               uuid primary key default gen_random_uuid(),
  domain           text not null,
  entity_table     text not null,
  entity_id        uuid not null,
  patient_id       uuid references public.profiles (id) on delete set null,
  organisation_id  uuid references public.organisations (id) on delete set null,
  attempted_source text not null,
  attempted_value  jsonb not null,
  existing_source  text not null,
  existing_value   jsonb not null,
  attempted_by     uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);

comment on table public.superseded_source_values is
  'A lower-precedence write that conflicted with an existing higher-precedence value and was rejected (§34.9: "the original patient-reported value should not simply disappear"). The higher-precedence row keeps governing the live record; this table is where the rejected claim is preserved instead of being lost.';

create index superseded_source_values_entity_idx on public.superseded_source_values (entity_table, entity_id, created_at desc);
create index superseded_source_values_patient_idx on public.superseded_source_values (patient_id, created_at desc);

alter table public.source_precedence_rules enable row level security;
alter table public.superseded_source_values enable row level security;

create policy source_precedence_rules_select on public.source_precedence_rules
  for select to authenticated using (true);
create policy source_precedence_rules_insert on public.source_precedence_rules
  for insert to authenticated with check (private.is_admin());
create policy source_precedence_rules_update on public.source_precedence_rules
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy source_precedence_rules_delete on public.source_precedence_rules
  for delete to authenticated using (private.is_admin());

create policy superseded_source_values_select on public.superseded_source_values
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.source_precedence_rules to authenticated;
grant select on public.superseded_source_values to authenticated;
revoke all on public.source_precedence_rules from anon;
revoke all on public.superseded_source_values from anon;
revoke execute on function public.resolve_source_precedence(text, text, text) from public;
grant execute on function public.resolve_source_precedence(text, text, text) to authenticated, service_role;

create or replace function private.enforce_blood_profile_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_staff  boolean;
  v_doc_owner uuid;
  v_winner    text;
begin
  v_is_staff := private.is_org_staff(new.organisation_id);

  if not v_is_staff then
    if new.patient_id <> auth.uid() then
      raise exception 'you may only record your own blood group and genotype'
        using errcode = '42501';
    end if;
    new.provenance          := 'patient_attested';
    new.document_id         := null;
    new.attested_at         := now();
    new.recorded_by         := auth.uid();
    if new.attestation_version is null then
      raise exception 'an attestation version is required' using errcode = '23514';
    end if;
  end if;

  if new.provenance = 'lab_document' then
    if new.document_id is null then
      raise exception 'a lab-backed blood group or genotype must link the report it came from'
        using errcode = '23514';
    end if;
    select patient_id into v_doc_owner
    from public.lab_result_documents where id = new.document_id;

    if v_doc_owner is null or v_doc_owner <> new.patient_id then
      raise exception 'that report does not belong to this patient'
        using errcode = '23514';
    end if;
    new.attested_at         := null;
    new.attestation_version := null;
  end if;

  if TG_OP = 'UPDATE'
     and OLD.provenance is distinct from new.provenance
     and (OLD.blood_group is distinct from new.blood_group or OLD.genotype is distinct from new.genotype)
  then
    v_winner := public.resolve_source_precedence('blood_profile', OLD.provenance, new.provenance);

    if v_winner = OLD.provenance then
      insert into public.superseded_source_values (
        domain, entity_table, entity_id, patient_id, organisation_id,
        attempted_source, attempted_value, existing_source, existing_value, attempted_by
      ) values (
        'blood_profile', 'patient_blood_profile', new.patient_id, new.patient_id, new.organisation_id,
        new.provenance,
        jsonb_build_object('blood_group', new.blood_group, 'genotype', new.genotype),
        OLD.provenance,
        jsonb_build_object('blood_group', OLD.blood_group, 'genotype', OLD.genotype),
        coalesce(new.recorded_by, auth.uid())
      );

      raise warning 'blood_profile update rejected: % (attempted, lower precedence) cannot override % (existing, higher precedence); attempted claim recorded in superseded_source_values', new.provenance, OLD.provenance;

      new.blood_group          := OLD.blood_group;
      new.genotype              := OLD.genotype;
      new.genotype_note         := OLD.genotype_note;
      new.provenance             := OLD.provenance;
      new.document_id            := OLD.document_id;
      new.attested_at            := OLD.attested_at;
      new.attestation_version    := OLD.attestation_version;
      new.recorded_by            := OLD.recorded_by;
    end if;
  end if;

  if new.genotype is distinct from 'other'::public.haemoglobin_genotype then
    new.genotype_note := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

do $$
begin
  if public.resolve_source_precedence('blood_profile', 'lab_document', 'patient_attested') <> 'lab_document' then
    raise exception 'FAIL: lab_document should outrank patient_attested for blood_profile';
  end if;
  if public.resolve_source_precedence('blood_profile', 'lab_document', 'lab_document') <> 'lab_document' then
    raise exception 'FAIL: identical sources should resolve to themselves';
  end if;
  if public.resolve_source_precedence('unranked_domain', 'a', 'b') is not null then
    raise exception 'FAIL: an unranked domain must resolve to null, not silently pick a winner';
  end if;
  if has_function_privilege('anon', 'public.resolve_source_precedence(text,text,text)', 'EXECUTE') then
    raise exception 'FAIL: anon still holds EXECUTE on public.resolve_source_precedence';
  end if;
end;
$$;

do $$
declare
  v_patient uuid := '8487376b-7844-428a-bcb8-8795e89eb0f5';
  v_org     uuid := '00000000-0000-0000-0000-000000000001';
  v_staff   uuid;
  v_doc     uuid;
  v_superseded_count_before int;
  v_superseded_count_after  int;
begin
  select id into v_staff from public.profiles where organisation_id = v_org and role = 'clinician' limit 1;
  if v_staff is null then
    raise notice 'SKIP source-precedence end-to-end test: no clinician in fixture org %', v_org;
    return;
  end if;

  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, source)
  values (v_org, v_patient, 'test/mdm-source-precedence.pdf', 'mdm-source-precedence.pdf', 'application/pdf', 'patient')
  returning id into v_doc;

  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.patient_blood_profile (patient_id, organisation_id, genotype, provenance, document_id)
  values (v_patient, v_org, 'AA', 'lab_document', v_doc)
  on conflict (patient_id) do update set genotype = 'AA', provenance = 'lab_document', document_id = v_doc, attested_at = null, attestation_version = null;
  reset role;

  select count(*) into v_superseded_count_before from public.superseded_source_values where patient_id = v_patient;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.patient_blood_profile set genotype = 'AS', attestation_version = 'v1' where patient_id = v_patient;
  reset role;

  select count(*) into v_superseded_count_after from public.superseded_source_values where patient_id = v_patient;
  if v_superseded_count_after <> v_superseded_count_before + 1 then
    raise exception 'FAIL: rejected patient claim was not recorded in superseded_source_values (before=%, after=%)', v_superseded_count_before, v_superseded_count_after;
  end if;

  if not exists (select 1 from public.patient_blood_profile where patient_id = v_patient and genotype = 'AA' and provenance = 'lab_document') then
    raise exception 'FAIL: lab-confirmed genotype was overwritten by a lower-precedence patient attestation';
  end if;
end;
$$;
