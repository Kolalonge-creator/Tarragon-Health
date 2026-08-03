-- Carry blood provenance onto the card itself.
--
-- A stranger doctor reading "Genotype SS" has no way to know whether that came
-- off a lab report or out of the patient's memory, and those two claims warrant
-- different confidence. Replaces the old free-text `source` key with the
-- structural provenance, and keeps the key set otherwise identical so the
-- minimal-dataset assertion in packages/db/tests/emergency_cards.sql still holds.

create or replace function public.emergency_card_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card    public.emergency_cards%rowtype;
  v_profile public.profiles%rowtype;
  v_payload jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;

  select * into v_card from public.emergency_cards where token = p_token and is_active;
  if not found then
    return null;
  end if;

  select * into v_profile from public.profiles where id = v_card.patient_id;
  if not found then
    return null;
  end if;

  insert into public.emergency_card_lookups (card_id) values (v_card.id);
  update public.emergency_cards
  set view_count = view_count + 1, last_viewed_at = now()
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
        -- 'lab_document' or 'patient_attested'. The card renders these
        -- differently; conflating them would misrepresent how much a receiving
        -- team should lean on the value.
        'provenance', b.provenance,
        'recorded_at', b.recorded_at
      )
      from public.patient_blood_profile b where b.patient_id = v_card.patient_id
    ),
    'issued_at', v_card.created_at,
    'source', 'TarragonHealth'
  );

  return v_payload;
end;
$$;

revoke all on function public.emergency_card_by_token(text) from public;
grant execute on function public.emergency_card_by_token(text) to anon, authenticated;

do $$
begin
  if not has_function_privilege('anon', 'public.emergency_card_by_token(text)', 'EXECUTE') then
    raise exception 'emergency_card_by_token must stay anon-executable';
  end if;
end $$;
