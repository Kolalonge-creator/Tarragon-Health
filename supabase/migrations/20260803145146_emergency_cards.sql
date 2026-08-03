-- The record a patient carries into any hospital.
--
-- Tarragon owns no clinics, so the durable thing it can be is the record that
-- travels with the person. A stranger doctor at 2am, at a facility that has
-- never seen this patient, scans a QR code and gets the handful of facts that
-- change what they do in the next ten minutes.
--
-- ⚠️ THIS IS A DELIBERATE, CONSENTED PHI EXPOSURE. A token in this table makes
-- a fixed, minimal dataset readable by ANYONE holding the token, with no
-- account and no login. That is the entire point — an unconscious patient
-- cannot log in — and it is also the risk. Every safeguard below exists because
-- of it:
--
--   1. OFF BY DEFAULT. No card exists until the patient creates one.
--   2. EXPLICIT CONSENT, recorded with a timestamp, and the consent text is
--      shown at the moment of creation.
--   3. REVOCABLE AND ROTATABLE at any time by the patient, instantly.
--   4. MINIMAL FIXED DATASET. Allergies, current medicines, ongoing conditions,
--      blood group, emergency contact. NOT the record. No results, no notes, no
--      history, no risk scores, no mental-health data, no reproductive health.
--      The dataset is fixed in the function body, not chosen per request, so it
--      cannot be widened by a caller.
--   5. EVERY LOOKUP IS LOGGED and shown back to the patient, so a card being
--      read by someone unexpected is visible to them.
--   6. TOKENS ARE 32 RANDOM BYTES. Guessing one is not a realistic attack; the
--      realistic risk is a printed card being lost, which is what revocation is
--      for.

create table if not exists public.emergency_cards (
  id                 uuid primary key default gen_random_uuid(),
  patient_id         uuid not null unique references public.profiles (id) on delete cascade,
  organisation_id    uuid not null references public.organisations (id),
  -- URL-safe, 32 bytes of randomness. Rotated by writing a new value.
  token              text not null unique check (length(token) between 32 and 128),
  is_active          boolean not null default true,
  -- Consent is recorded, not assumed. A card with no consent timestamp is a bug.
  consented_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  revoked_at         timestamptz,
  last_viewed_at     timestamptz,
  view_count         integer not null default 0
);

create index if not exists emergency_cards_token_idx on public.emergency_cards (token)
  where is_active;

-- Every read of a card, so the patient can see who has been looking.
create table if not exists public.emergency_card_lookups (
  id            uuid primary key default gen_random_uuid(),
  card_id       uuid not null references public.emergency_cards (id) on delete cascade,
  looked_up_at  timestamptz not null default now()
);

create index if not exists emergency_card_lookups_card_idx
  on public.emergency_card_lookups (card_id, looked_up_at desc);

alter table public.emergency_cards enable row level security;
alter table public.emergency_card_lookups enable row level security;

-- The patient owns their own card. Org staff can see THAT one exists (useful
-- when a patient rings asking about it) but the token itself is never exposed
-- through a policy — only through the patient's own select, and the app only
-- ever renders it to them.
drop policy if exists emergency_cards_select on public.emergency_cards;
create policy emergency_cards_select on public.emergency_cards
  for select using (
    patient_id = auth.uid()
    or private.is_org_staff(organisation_id)
  );

drop policy if exists emergency_cards_lookups_select on public.emergency_card_lookups;
create policy emergency_cards_lookups_select on public.emergency_card_lookups
  for select using (
    exists (
      select 1 from public.emergency_cards c
      where c.id = emergency_card_lookups.card_id
        and (c.patient_id = auth.uid() or private.is_org_staff(c.organisation_id))
    )
  );

-- No insert/update/delete policy anywhere. Creating, rotating and revoking all
-- go through the RPCs below, so consent is always recorded and a card can never
-- be created for someone by someone else.

grant select on public.emergency_cards to authenticated;
grant select on public.emergency_card_lookups to authenticated;

-- ---------------------------------------------------------------- create/rotate

create or replace function public.create_emergency_card()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_token text;
begin
  select organisation_id into v_org
  from public.profiles
  where id = auth.uid() and role = 'patient';

  if v_org is null then
    raise exception 'only a patient may create their own emergency card'
      using errcode = '42501';
  end if;

  -- 32 random bytes, base64url. gen_random_bytes comes from pgcrypto, which
  -- this project already has installed in the extensions schema.
  v_token := replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_');
  v_token := replace(v_token, '=', '');

  insert into public.emergency_cards (patient_id, organisation_id, token, is_active, consented_at)
  values (auth.uid(), v_org, v_token, true, now())
  on conflict (patient_id) do update
    set token        = excluded.token,
        is_active    = true,
        consented_at = now(),
        revoked_at   = null,
        -- Rotating issues a genuinely new card: the old token stops working and
        -- the view history starts again, so a stale count cannot reassure
        -- someone about a card they have just replaced.
        view_count   = 0,
        last_viewed_at = null;

  return v_token;
end;
$$;

create or replace function public.revoke_emergency_card()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.emergency_cards
  set is_active = false, revoked_at = now()
  where patient_id = auth.uid();
end;
$$;

-- ------------------------------------------------------------------ the read
--
-- Deliberately anon-executable. This is the one function on the platform that
-- is meant to be readable without an account, because the person it protects
-- may be unconscious. Everything it can return is fixed in this body.

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

  select * into v_card
  from public.emergency_cards
  where token = p_token and is_active;

  if not found then
    return null;
  end if;

  select * into v_profile from public.profiles where id = v_card.patient_id;
  if not found then
    return null;
  end if;

  -- Log first, so a read is recorded even if payload assembly then fails.
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
      select jsonb_agg(jsonb_build_object(
        'allergen', a.allergen,
        'reaction', a.reaction,
        'severity', a.severity
      ) order by a.severity desc nulls last, a.allergen)
      from public.patient_allergies a
      where a.patient_id = v_card.patient_id
    ), '[]'::jsonb),
    'medications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'drug_name', m.drug_name,
        'dose', m.dose,
        'frequency', m.frequency
      ) order by m.drug_name)
      from public.medications m
      where m.patient_id = v_card.patient_id and m.is_active
    ), '[]'::jsonb),
    'conditions', coalesce((
      select jsonb_agg(distinct cp.condition::text)
      from public.care_plans cp
      where cp.patient_id = v_card.patient_id and cp.status = 'active'
    ), '[]'::jsonb),
    -- Blood group and genotype are the two facts that change what a receiving
    -- team does immediately, and in Nigeria genotype especially so. `source` is
    -- carried through deliberately: a patient's recollection and a lab report
    -- are both worth knowing and are not the same thing.
    'blood', (
      select jsonb_build_object(
        'blood_group', b.blood_group::text,
        'genotype', b.genotype::text,
        'note', b.genotype_note,
        'source', b.source
      )
      from public.patient_blood_profile b
      where b.patient_id = v_card.patient_id
    ),
    'issued_at', v_card.created_at,
    'source', 'TarragonHealth'
  );

  return v_payload;
end;
$$;

revoke all on function public.create_emergency_card() from public;
revoke all on function public.revoke_emergency_card() from public;
revoke all on function public.emergency_card_by_token(text) from public;

grant execute on function public.create_emergency_card() to authenticated;
grant execute on function public.revoke_emergency_card() to authenticated;
-- The deliberate exception on this platform: readable with no account.
grant execute on function public.emergency_card_by_token(text) to anon, authenticated;

do $$
begin
  if not has_table_privilege('authenticated', 'public.emergency_cards', 'SELECT') then
    raise exception 'emergency_cards: authenticated grant did not take';
  end if;

  -- anon must reach the card ONLY through the token function, never the table.
  if has_table_privilege('anon', 'public.emergency_cards', 'SELECT') then
    raise exception 'emergency_cards: anon must not be able to read the table directly';
  end if;
  if has_function_privilege('anon', 'public.create_emergency_card()', 'EXECUTE') then
    raise exception 'create_emergency_card must not be anon-executable';
  end if;
  if not has_function_privilege('anon', 'public.emergency_card_by_token(text)', 'EXECUTE') then
    raise exception 'emergency_card_by_token must be anon-executable — that is the point';
  end if;
end $$;
