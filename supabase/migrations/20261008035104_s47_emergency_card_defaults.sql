-- S47 (chat decision 2026-10-07; NOT a signature): emergency card defaults.
--
-- ON by default: blood group and genotype, allergies, current medicines, emergency contacts (and the identity lines the card already carried).
-- OFF until the person chooses: ongoing conditions or diagnoses, and anything reproductive or mental health.
-- The live link, the printed page, the QR text and the phone's offline card all read the same choices (apps/web/src/lib/emergency/field-choices.ts and
-- apps/mobile/src/lib/emergency.ts mirror this table), and a detail that is not shared is SAID to be not shared, never written as "none recorded".
--
-- Counted first: public.emergency_card_fields is created by S43 (migration 20261007230508), which is not applied to production, so it has 0 rows there; there is
-- nothing to convert. Because a person with no row yet previously saw EVERYTHING, the wrapper now applies these same defaults when there is no row.
--
-- A reproductive or mental health entry can only reach the card through the conditions list (the card has no other such field). When conditions are shown,
-- an entry that looks reproductive or mental health is still removed unless its own switch is on. The test for "looks like" is one function
-- (private.emergency_card_sensitive_condition) mirrored by isSensitiveCondition in the web and phone code; a Jest test fails if the two lists differ.

alter table public.emergency_card_fields
  alter column show_conditions set default false,
  add column show_reproductive  boolean not null default false,
  add column show_mental_health boolean not null default false;

-- sensitive-conditions-pattern-begin
create function private.emergency_card_sensitive_condition(p_text text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_text ~* '(pregnan|antenatal|postnatal|fertil|contracepti|menstru|menopaus|reproduct|obstetric|gynae|gynec)' then 'reproductive'
    when p_text ~* '(mental|depress|anxiet|psych|bipolar|schizo|suicid|self.?harm|ptsd|trauma|panic|mood)' then 'mental_health'
    else null end
$$;
-- sensitive-conditions-pattern-end
revoke all on function private.emergency_card_sensitive_condition(text) from public, anon, authenticated;

-- S47 review fix: a medicine can give away a reproductive or mental health matter just as a condition can (a contraceptive, an antidepressant). The medicines
-- list on the card is filtered by this the same way the conditions list is. Mirrored in the web and phone code; a Jest test fails if the lists differ.
-- sensitive-medicines-pattern-begin
create function private.emergency_card_sensitive_medicine(p_text text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_text ~* '(contracept|levonorgestrel|norethisterone|ethinylestradiol|medroxyprogesterone|depo.?provera|misoprostol|mifepristone|clomiphene)' then 'reproductive'
    when p_text ~* '(antidepress|sertraline|fluoxetine|citalopram|escitalopram|paroxetine|venlafaxine|mirtazapine|amitriptyline|lithium|risperidone|olanzapine|quetiapine|haloperidol|chlorpromazine|diazepam|lorazepam|alprazolam|clonazepam|bupropion)' then 'mental_health'
    else null end
$$;
-- sensitive-medicines-pattern-end
revoke all on function private.emergency_card_sensitive_medicine(text) from public, anon, authenticated;

create or replace function public.emergency_card_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full jsonb;
  v_patient uuid;
  f public.emergency_card_fields%rowtype;
  v_hidden text[] := '{}';
begin
  v_full := public.emergency_card_full_by_token(p_token);   -- does the lookup, the audit row and the patient notice, exactly as before
  if v_full is null then
    return null;
  end if;
  select patient_id into v_patient from public.emergency_cards where token = p_token;
  select * into f from public.emergency_card_fields where patient_id = v_patient;
  if not found then
    -- S47: no choice made yet means the DEFAULTS, not everything
    f.show_date_of_birth := true; f.show_sex := true; f.show_patient_number := true;
    f.show_allergies := true; f.show_medications := true; f.show_blood := true; f.show_emergency_contact := true;
    f.show_conditions := false; f.show_reproductive := false; f.show_mental_health := false;
  end if;
  if not f.show_date_of_birth then v_full := v_full - 'date_of_birth'; v_hidden := array_append(v_hidden, 'date_of_birth'); end if;
  if not f.show_sex then v_full := v_full - 'sex'; v_hidden := array_append(v_hidden, 'sex'); end if;
  if not f.show_patient_number then v_full := v_full - 'patient_number'; v_hidden := array_append(v_hidden, 'patient_number'); end if;
  if not f.show_emergency_contact then v_full := v_full || jsonb_build_object('emergency_contact', null); v_hidden := array_append(v_hidden, 'emergency_contact'); end if;
  if not f.show_allergies then v_full := v_full || jsonb_build_object('allergies', '[]'::jsonb); v_hidden := array_append(v_hidden, 'allergies'); end if;
  if not f.show_medications then v_full := v_full || jsonb_build_object('medications', '[]'::jsonb); v_hidden := array_append(v_hidden, 'medications'); end if;
  if f.show_medications then
    -- the medicines list drops a reproductive or mental health medicine unless its own switch is on (the card then says those are not shared)
    v_full := v_full || jsonb_build_object('medications', coalesce((
      select jsonb_agg(m) from jsonb_array_elements(coalesce(v_full -> 'medications', '[]'::jsonb)) m
       where case private.emergency_card_sensitive_medicine(m ->> 'drug_name')
               when 'reproductive' then f.show_reproductive
               when 'mental_health' then f.show_mental_health
               else true end), '[]'::jsonb));
  end if;
  if not f.show_conditions then
    v_full := v_full || jsonb_build_object('conditions', '[]'::jsonb); v_hidden := array_append(v_hidden, 'conditions');
  else
    -- shown conditions still lose a reproductive or mental health entry unless that switch is on
    v_full := v_full || jsonb_build_object('conditions', coalesce((
      select jsonb_agg(c) from jsonb_array_elements_text(coalesce(v_full -> 'conditions', '[]'::jsonb)) c
       where case private.emergency_card_sensitive_condition(c)
               when 'reproductive' then f.show_reproductive
               when 'mental_health' then f.show_mental_health
               else true end), '[]'::jsonb));
  end if;
  if not f.show_reproductive then v_hidden := array_append(v_hidden, 'reproductive'); end if;
  if not f.show_mental_health then v_hidden := array_append(v_hidden, 'mental_health'); end if;
  if not f.show_blood then v_full := v_full || jsonb_build_object('blood', null); v_hidden := array_append(v_hidden, 'blood'); end if;
  return v_full || jsonb_build_object('hidden_fields', to_jsonb(v_hidden));
end;
$$;
revoke all on function public.emergency_card_by_token(text) from public;
grant execute on function public.emergency_card_by_token(text) to anon, authenticated;

do $$
begin
  if not has_function_privilege('anon', 'public.emergency_card_by_token(text)', 'EXECUTE') then raise exception 'S47 self-check: emergency_card_by_token must stay anon-executable'; end if;
  if has_function_privilege('anon', 'private.emergency_card_sensitive_medicine(text)', 'EXECUTE') or has_function_privilege('anon', 'private.emergency_card_sensitive_condition(text)', 'EXECUTE') then raise exception 'S47 self-check: the classifier must not be callable by anon'; end if;
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'emergency_card_fields' and column_name = 'show_conditions') <> 'false' then
    raise exception 'S47 self-check: conditions must default off';
  end if;
end $$;
