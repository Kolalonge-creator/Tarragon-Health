-- Tarragon Health — Comprehensive order packages (§4.1), Phase 3
--
-- "Baseline panel + mid-programme recheck" is a SEQUENCING question — two
-- lab_orders rows, at two different weeks, each linked back to its own
-- chronic_programme_schedule_occurrences row — not a missing bundle-of-
-- bundles primitive. panel_bundles already supports a multi-test bundle in
-- one order (hypertension_panel/diabetes_panel each carry several
-- test_codes); building a second "package" concept here would solve a
-- problem the schema doesn't have.
--
-- The founder's "Tarragon take payment for the tests, pay the partner lab"
-- describes the ALREADY-LIVE fulfilment='partner' path (Synlab), not the
-- self_arranged default used everywhere else. private.compute_partner_cost/
-- private.set_lab_order_computed_price (20260821191942) already own the
-- entire pricing decision for a partner order — this does not re-derive it,
-- it just attempts partner fulfilment first and lets that existing trigger
-- do the pricing/eligibility check, falling back to self_arranged on
-- failure (no contracted price, no active partner, etc.) via a plain
-- exception-block savepoint.

alter table public.lab_orders
  add column chronic_programme_occurrence_id uuid
    references public.chronic_programme_schedule_occurrences (id) on delete set null;

create index lab_orders_chronic_occurrence_idx
  on public.lab_orders (chronic_programme_occurrence_id) where chronic_programme_occurrence_id is not null;

-- Not auto-fired from the daily sweep — a lab order carries a real
-- clinical/financial commitment (enforce_lab_order_origin requires
-- ordered_by to be a genuine active clinical_staff member and a
-- clinical_indication), so a human confirms every real order via the
-- Coordinator task this raises, matching the platform's existing
-- "system proposes, staff confirms" convention (case_review_actions) rather
-- than fully silent automation. ordered_by resolves to the patient's
-- assigned clinician (care_team_assignment) — never to a Care Coordinator,
-- who has no ordering authority; if no clinician is assigned, this fails
-- loudly rather than silently attributing the order to nobody.
create or replace function public.generate_chronic_programme_lab_order(p_occurrence_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_occ public.chronic_programme_schedule_occurrences%rowtype;
  v_bundle_code text;
  v_bundle_id uuid;
  v_clinician_id uuid;
  v_order_id uuid;
  v_indication text;
begin
  select * into v_occ from public.chronic_programme_schedule_occurrences where id = p_occurrence_id;
  if v_occ.id is null then
    raise exception 'occurrence not found';
  end if;
  if not private.is_org_staff(v_occ.organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_occ.occurrence_type <> 'lab_panel' then
    raise exception 'occurrence % is not a lab_panel', p_occurrence_id using errcode = '23514';
  end if;
  if v_occ.lab_order_id is not null then
    raise exception 'a lab order already exists for this occurrence' using errcode = '23514';
  end if;

  select panel_bundle_code into v_bundle_code
  from public.chronic_programme_schedule_templates where id = v_occ.template_id;
  select id into v_bundle_id from public.panel_bundles where code = v_bundle_code;
  if v_bundle_id is null then
    raise exception 'no panel bundle configured for this occurrence''s template';
  end if;

  -- care_team_assignment.clinician_id is a profiles.id; lab_orders.ordered_by
  -- needs the clinical_staff.id for that same person (enforce_lab_order_origin
  -- checks cs.id = new.ordered_by, not a profile id) — resolve through the join.
  select cs.id into v_clinician_id
  from public.care_team_assignment cta
  join public.clinical_staff cs on cs.profile_id = cta.clinician_id and cs.organisation_id = cta.organisation_id
  where cta.patient_id = v_occ.patient_id;
  if v_clinician_id is null then
    raise exception 'this patient has no assigned clinician to attribute the order to — assign one first';
  end if;

  v_indication := format('12-week chronic-care programme panel, week %s of 12.', v_occ.week_number);

  begin
    insert into public.lab_orders
      (organisation_id, patient_id, panel_bundle_id, status, origin, fulfilment,
       ordered_by, clinical_indication, chronic_programme_occurrence_id)
    values
      (v_occ.organisation_id, v_occ.patient_id, v_bundle_id, 'pending_payment', 'clinically_triggered', 'partner',
       v_clinician_id, v_indication, p_occurrence_id)
    returning id into v_order_id;
  exception when others then
    insert into public.lab_orders
      (organisation_id, patient_id, panel_bundle_id, status, origin, fulfilment,
       ordered_by, clinical_indication, total_kobo, chronic_programme_occurrence_id)
    values
      (v_occ.organisation_id, v_occ.patient_id, v_bundle_id, 'ordered', 'clinically_triggered', 'self_arranged',
       v_clinician_id, v_indication, 0, p_occurrence_id)
    returning id into v_order_id;
  end;

  update public.chronic_programme_schedule_occurrences
    set lab_order_id = v_order_id
    where id = p_occurrence_id;

  return v_order_id;
end;
$$;

revoke execute on function public.generate_chronic_programme_lab_order(uuid) from public;
revoke execute on function public.generate_chronic_programme_lab_order(uuid) from anon;
grant execute on function public.generate_chronic_programme_lab_order(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.generate_chronic_programme_lab_order(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute generate_chronic_programme_lab_order';
  end if;
  raise notice 'PASS: chronic programme lab-order generation (partner-first, self-arranged fallback) in place';
end $$;
