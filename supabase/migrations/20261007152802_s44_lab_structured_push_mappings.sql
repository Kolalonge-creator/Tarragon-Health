-- S44 (Module 2, interoperability), part 4 of 4: structured results pushed by a partner laboratory, with a LOINC and UCUM mapping per laboratory (spec 2.12).
--
-- A lab sends coded results (a LOINC code, a number and a UCUM unit). Tarragon's panels (S27, lab_panel_versions) are keyed by Tarragon analyte codes
-- and one stored unit. This migration adds the bridge and nothing else:
--
--   lab_code_mappings  one row per (laboratory, LOINC code, UCUM unit): which Tarragon analyte it is, the unit the panel stores, and an optional
--                      multiplier. Rows are PROPOSED by an admin or a lab liaison and CONFIRMED only by the Chief Medical Officer
--                      (private.is_active_clinical_director). A result is only ever translated through a CONFIRMED row. No mapping is seeded:
--                      the codes a given lab uses are that lab's own data, and a wrong mapping is a wrong clinical value.
--   lab_result_pushes  one row per push (idempotent on the lab's own message id): accepted or rejected, with the exact items received.
--   lab_partner_push_result()  the lab's door. It never guesses: an item with no confirmed mapping rejects the WHOLE push (nothing is stored as a
--                      result, the lab is told which LOINC/unit pair failed), and a unit that is not the panel's unit and has no multiplier rejects it too.
--                      An accepted push goes through the same writer as a portal entry, private.submit_lab_result, so the S27 release rules apply
--                      unchanged: critical or abnormal values are held for a clinician (INV-03), a sensitive positive goes to clinician disclosure
--                      (INV-04), only a complete, all-normal result against SIGNED ranges is released. The lab is told only "received" and
--                      "released" or "held", never the clinical reason (S27 design).
--
-- Live counts before this migration: lab_results 0 rows on the S27 tables (S27 is not yet applied to production at the time of writing), so no
-- existing data is touched.

-- ---------------------------------------------------------------------------
-- 1. Mappings
-- ---------------------------------------------------------------------------
create table public.lab_code_mappings (
  id             uuid primary key default gen_random_uuid(),
  lab_provider_id uuid not null references public.lab_providers (id) on delete restrict,
  loinc_code     text not null check (loinc_code ~ '^[0-9]{1,7}-[0-9]$'),
  -- the unit the lab sends, as a UCUM code; empty for a qualitative result
  ucum_unit      text not null default '' check (char_length(ucum_unit) <= 40),
  analyte_code   text not null check (char_length(analyte_code) between 1 and 80),
  -- the unit the panel stores for that analyte; checked against the panel at proposal time
  panel_unit     text not null default '',
  unit_factor    numeric not null default 1 check (unit_factor > 0 and unit_factor <= 1000000),
  status         text not null default 'proposed' check (status in ('proposed', 'confirmed', 'retired')),
  note           text,
  proposed_by    uuid references public.profiles (id) on delete set null,
  confirmed_by   uuid references public.profiles (id) on delete set null,
  confirmed_at   timestamptz,
  created_at     timestamptz not null default now(),
  unique (lab_provider_id, loinc_code, ucum_unit),
  check (status <> 'confirmed' or (confirmed_by is not null and confirmed_at is not null)),
  -- a multiplier only makes sense when the lab's unit differs from the panel's
  check (unit_factor = 1 or ucum_unit <> panel_unit)
);
create index lab_code_mappings_lab_idx on public.lab_code_mappings (lab_provider_id, status);

create table public.lab_result_pushes (
  id              uuid primary key default gen_random_uuid(),
  lab_provider_id uuid not null references public.lab_providers (id) on delete restrict,
  message_id      text not null check (char_length(message_id) between 6 and 120),
  lab_order_id    uuid not null references public.lab_orders (id) on delete restrict,
  lab_result_id   uuid references public.lab_results (id) on delete restrict,
  outcome         text not null check (outcome in ('accepted', 'rejected')),
  reject_code     text,
  unmapped        jsonb not null default '[]'::jsonb,
  items_received  jsonb not null,
  is_test         boolean not null default false,
  received_at     timestamptz not null default now(),
  unique (lab_provider_id, message_id),
  check ((outcome = 'accepted') = (lab_result_id is not null)),
  check (outcome = 'accepted' or reject_code is not null)
);
create index lab_result_pushes_order_idx on public.lab_result_pushes (lab_order_id);

alter table public.lab_code_mappings enable row level security;
alter table public.lab_result_pushes enable row level security;
-- a lab sees its own rows; admins and the CMO see all; nobody writes directly
create policy lab_code_mappings_select on public.lab_code_mappings for select to authenticated
  using (lab_provider_id = private.lab_partner_provider() or private.is_admin() or private.is_active_clinical_director());
create policy lab_result_pushes_select on public.lab_result_pushes for select to authenticated
  using (lab_provider_id = private.lab_partner_provider() or private.is_admin());
revoke all on public.lab_code_mappings from anon, authenticated;
revoke all on public.lab_result_pushes from anon, authenticated;
grant select on public.lab_code_mappings to authenticated;
grant select on public.lab_result_pushes to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Propose, confirm, retire
-- ---------------------------------------------------------------------------
create or replace function public.propose_lab_code_mapping(
  p_lab uuid, p_loinc text, p_ucum text, p_analyte text, p_panel_unit text, p_factor numeric default 1, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_def jsonb;
  v_id uuid;
begin
  if v_uid is null or not (private.is_admin() or private.is_lab_liaison()) then
    raise exception 'this action is for admins and lab liaisons' using errcode = '42501';
  end if;
  if not exists (select 1 from public.lab_providers where id = p_lab) then raise exception 'unknown laboratory' using errcode = '22023'; end if;
  -- the analyte must exist in an active panel, and the stored unit must be the panel's own unit
  select a into v_def from public.lab_panel_versions v, jsonb_array_elements(v.analytes) a where v.is_active and a ->> 'code' = p_analyte limit 1;
  if v_def is null then raise exception 'lab_unknown_analyte' using errcode = '22023'; end if;
  if coalesce(v_def ->> 'unit', '') is distinct from coalesce(p_panel_unit, '') then raise exception 'lab_unit_mismatch' using errcode = '22023'; end if;
  insert into public.lab_code_mappings (lab_provider_id, loinc_code, ucum_unit, analyte_code, panel_unit, unit_factor, note, proposed_by)
  values (p_lab, btrim(p_loinc), coalesce(btrim(p_ucum), ''), p_analyte, coalesce(p_panel_unit, ''), coalesce(p_factor, 1), p_note, v_uid)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'proposed');
end;
$$;

create or replace function public.confirm_lab_code_mapping(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_active_clinical_director() then
    raise exception 'only the Chief Medical Officer confirms a lab code mapping' using errcode = '42501';
  end if;
  update public.lab_code_mappings set status = 'confirmed', confirmed_by = (select auth.uid()), confirmed_at = now()
   where id = p_id and status = 'proposed';
  if not found then raise exception 'mapping not found or not waiting for confirmation' using errcode = 'P0002'; end if;
  return jsonb_build_object('status', 'confirmed');
end;
$$;

create or replace function public.retire_lab_code_mapping(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (private.is_active_clinical_director() or private.is_admin()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  update public.lab_code_mappings set status = 'retired' where id = p_id and status <> 'retired';
  if not found then raise exception 'mapping not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('status', 'retired');
end;
$$;

revoke all on function public.propose_lab_code_mapping(uuid, text, text, text, text, numeric, text) from public, anon;
revoke all on function public.confirm_lab_code_mapping(uuid) from public, anon;
revoke all on function public.retire_lab_code_mapping(uuid) from public, anon;
grant execute on function public.propose_lab_code_mapping(uuid, text, text, text, text, numeric, text) to authenticated;
grant execute on function public.confirm_lab_code_mapping(uuid) to authenticated;
grant execute on function public.retire_lab_code_mapping(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The lab's door
-- ---------------------------------------------------------------------------
create or replace function public.lab_partner_push_result(p_order uuid, p_message_id text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_provider uuid := private.lab_partner_provider();
  o public.lab_orders%rowtype;
  v_prev public.lab_result_pushes%rowtype;
  v_it jsonb;
  v_map public.lab_code_mappings%rowtype;
  v_unit text;
  v_mapped jsonb := '[]'::jsonb;
  v_unmapped jsonb := '[]'::jsonb;
  v_res jsonb;
  v_state text;
  v_reject text;
  v_test boolean;
begin
  if v_provider is null then raise exception 'This action is for partner labs' using errcode = '42501'; end if;
  if p_message_id is null or char_length(btrim(p_message_id)) < 6 or char_length(p_message_id) > 120 then
    raise exception 'a message id of 6 to 120 characters is required' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 200 then
    raise exception 'items must be a list of 1 to 200 results' using errcode = '22023';
  end if;

  select * into o from public.lab_orders where id = p_order and provider_id = v_provider;
  if not found then raise exception 'Order not found for this lab' using errcode = '42501'; end if;

  -- the lab's retry of the same message answers the same thing and writes nothing new
  select * into v_prev from public.lab_result_pushes where lab_provider_id = v_provider and message_id = p_message_id;
  if found then
    return jsonb_build_object('status', case when v_prev.outcome = 'accepted' then 'received' else 'rejected' end, 'replayed', true,
                              'reject_code', v_prev.reject_code, 'unmapped', v_prev.unmapped);
  end if;

  select is_test into v_test from public.profiles where id = o.patient_id;

  if o.panel_code is null then v_reject := 'panel_required';
  elsif exists (select 1 from public.lab_results r where r.lab_order_id = p_order and r.release_state <> 'withheld' and r.superseded_by is null) then
    v_reject := 'result_already_received';
  end if;

  if v_reject is null then
    for v_it in select * from jsonb_array_elements(p_items) loop
      v_unit := coalesce(btrim(v_it ->> 'unit'), '');
      select * into v_map from public.lab_code_mappings
       where lab_provider_id = v_provider and loinc_code = btrim(coalesce(v_it ->> 'loinc', '')) and ucum_unit = v_unit and status = 'confirmed';
      if not found then
        v_unmapped := v_unmapped || jsonb_build_array(jsonb_build_object('loinc', v_it ->> 'loinc', 'unit', v_unit));
      elsif v_it ? 'value_text' and (v_it -> 'value_text') <> 'null'::jsonb then
        v_mapped := v_mapped || jsonb_build_array(jsonb_build_object('analyte_code', v_map.analyte_code, 'value_text', lower(btrim(v_it ->> 'value_text')), 'unit', v_map.panel_unit));
      elsif v_it ? 'value' and jsonb_typeof(v_it -> 'value') = 'number' then
        v_mapped := v_mapped || jsonb_build_array(jsonb_build_object('analyte_code', v_map.analyte_code,
          'value_numeric', round((v_it ->> 'value')::numeric * v_map.unit_factor, 6), 'unit', v_map.panel_unit));
      else
        v_unmapped := v_unmapped || jsonb_build_array(jsonb_build_object('loinc', v_it ->> 'loinc', 'unit', v_unit, 'problem', 'no_value'));
      end if;
    end loop;
    if jsonb_array_length(v_unmapped) > 0 then v_reject := 'unmapped_item'; end if;
  end if;

  if v_reject is null then
    begin
      v_res := private.submit_lab_result(o.patient_id, p_order, o.panel_code, v_mapped, null, 'partner', (select auth.uid()), v_provider);
    exception when others then
      -- the sub-transaction rolled back every partial write; only a lab_* validation message is shown to the lab
      v_reject := case when sqlerrm like 'lab\_%' escape '\' then sqlerrm else 'rejected' end;
    end;
  end if;

  if v_reject is not null then
    insert into public.lab_result_pushes (lab_provider_id, message_id, lab_order_id, outcome, reject_code, unmapped, items_received, is_test)
    values (v_provider, p_message_id, p_order, 'rejected', v_reject, v_unmapped, p_items, coalesce(v_test, false));
    return jsonb_build_object('status', 'rejected', 'reject_code', v_reject, 'unmapped', v_unmapped);
  end if;

  v_state := v_res ->> 'release_state';
  insert into public.lab_result_pushes (lab_provider_id, message_id, lab_order_id, lab_result_id, outcome, items_received, is_test)
  values (v_provider, p_message_id, p_order, (v_res ->> 'lab_result_id')::uuid, 'accepted', p_items, coalesce(v_test, false));
  -- never the clinical reason (S27): the lab only learns it was received and whether it is out or waiting
  return jsonb_build_object('status', 'received', 'state', case when v_state = 'released' then 'released' else 'held' end);
end;
$$;
revoke all on function public.lab_partner_push_result(uuid, text, jsonb) from public, anon;
grant execute on function public.lab_partner_push_result(uuid, text, jsonb) to authenticated;

do $$
begin
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('lab_code_mappings', 'lab_result_pushes')
              and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')) then
    raise exception 'S44 assertion: a client role can write the lab push tables directly';
  end if;
  if has_function_privilege('anon', 'public.lab_partner_push_result(uuid, text, jsonb)', 'EXECUTE') then
    raise exception 'S44 assertion: anon can push lab results';
  end if;
end $$;
