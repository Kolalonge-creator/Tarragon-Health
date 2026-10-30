-- OQ-484 (founder decision 2026-10-30): the CMO owns the controlled-medicine list, and there is ONE list, in the database.
--
-- Before: OQ-276 (20261008013742) had already folded the signing hard stop and every counter path into one SQL function,
-- private.is_controlled_medicine(text), but the list itself was a regex literal in that function body, and apps/web/src/lib/rules/controlled-substances.ts
-- kept a second hand-typed copy (the PDF guard and the advisory text). A test compared the two copies. Changing the list meant a migration AND a code change.
--
-- What this does
--   1. public.controlled_medicine_terms: the list as data. One row per word or phrase (matched as whole words, case-insensitive), with a tier
--      (narcotic | restricted) and a label for the advisory text, an active flag (retire, never delete), and a change note that must be NEW on every change.
--   2. public.controlled_medicine_term_history: append-only. A trigger writes one row per insert or update (who, when, why), so the list has a version
--      (the history id) and every edit is traceable whichever path made it. Deletes are refused.
--   3. public.set_controlled_medicine_term(...): the only write path for a user. Chief Medical Officer only, change note of at least 10 characters,
--      audited. This is an operational list, not a signature item: no protocol sign-off is owed (G-01).
--   4. public.get_controlled_medicine_list(): the list as the web reads it (version plus active terms). Signed-in users only.
--   5. private.is_controlled_medicine(text) now reads the table. Everything that called it (signing hard stop, S28 counter, QR page, phone desk, order
--      screen, prescription_has_controlled_item) follows with no further change. It was IMMUTABLE; it reads a table now, so it is STABLE (checked live:
--      no index, generated column, view or policy depends on it).
--   private.prescription_safety_findings was not touched: it already delegates to private.is_controlled_medicine (checked against its live body).
--
-- The seed is exactly the 58 alternatives of the live regex (identical to the 58 in the TypeScript copy; checked 2026-10-30, no difference between the
-- two). The only change is that the two optional-hyphen patterns co-?codamol and co-?dydramol, which a plain word list cannot express, become four
-- terms (co-codamol, cocodamol, co-dydramol, codydramol), which match exactly the same names. So 58 patterns become 60 terms.
-- Rows affected live: 0 (new tables). The list stays illustrative, not an NDLEA or NAFDAC schedule lookup; the CMO edits it through the function above.
--
-- Global reference data, like public.protocols: no organisation_id.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.controlled_medicine_terms (
  id            uuid primary key default gen_random_uuid(),
  term          text not null unique,
  tier          text not null,
  label         text not null,
  active        boolean not null default true,
  change_note   text not null,
  changed_by    uuid references public.profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint controlled_medicine_terms_term_shape check (term ~ '^[a-z0-9]([a-z0-9 -]*[a-z0-9])?$'),
  constraint controlled_medicine_terms_tier check (tier in ('narcotic', 'restricted')),
  constraint controlled_medicine_terms_label check (length(btrim(label)) > 0),
  constraint controlled_medicine_terms_note check (length(btrim(change_note)) >= 10)
);
comment on table public.controlled_medicine_terms is
  'OQ-484: the ONE controlled-medicine list. Illustrative, not an NDLEA/NAFDAC schedule lookup. Read by private.is_controlled_medicine (signing hard stop and every counter path) and, through get_controlled_medicine_list(), by the web guard. Edited by the CMO only, through set_controlled_medicine_term. A term is whole-word, case-insensitive; letters, digits, spaces and hyphens only, so it can never be a regex.';

create table public.controlled_medicine_term_history (
  version      bigint generated always as identity primary key,
  term_id      uuid not null,
  term         text not null,
  tier         text not null,
  label        text not null,
  active       boolean not null,
  action       text not null check (action in ('added', 'changed', 'retired', 'reinstated')),
  change_note  text not null,
  changed_by   uuid,
  changed_at   timestamptz not null default now()
);
comment on table public.controlled_medicine_term_history is
  'OQ-484: append-only record of every change to controlled_medicine_terms. The highest version is the version of the list.';

-- The API never touches either table directly: reads go through get_controlled_medicine_list, writes through set_controlled_medicine_term.
revoke all on public.controlled_medicine_terms from public, anon, authenticated;
revoke all on public.controlled_medicine_term_history from public, anon, authenticated;
alter table public.controlled_medicine_terms enable row level security;
alter table public.controlled_medicine_term_history enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Guard and history trigger
-- ---------------------------------------------------------------------------
create function private.controlled_medicine_terms_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A controlled-medicine term is retired, never deleted' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.term is distinct from old.term then
      raise exception 'A controlled-medicine term cannot be renamed: retire it and add the new one' using errcode = '42501';
    end if;
    if new.change_note is not distinct from old.change_note then
      raise exception 'Every change to the controlled-medicine list needs a new change note' using errcode = '23514';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.controlled_medicine_terms_guard() from public, anon, authenticated;
create trigger controlled_medicine_terms_a_guard
  before update or delete on public.controlled_medicine_terms
  for each row execute function private.controlled_medicine_terms_guard();

create function private.controlled_medicine_terms_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.controlled_medicine_term_history (term_id, term, tier, label, active, action, change_note, changed_by)
  values (new.id, new.term, new.tier, new.label, new.active,
          case when tg_op = 'INSERT' then 'added'
               when old.active and not new.active then 'retired'
               when not old.active and new.active then 'reinstated'
               else 'changed' end,
          new.change_note, coalesce((select auth.uid()), new.changed_by));
  return null;
end;
$$;
revoke all on function private.controlled_medicine_terms_history() from public, anon, authenticated;
create trigger controlled_medicine_terms_b_history
  after insert or update on public.controlled_medicine_terms
  for each row execute function private.controlled_medicine_terms_history();

-- ---------------------------------------------------------------------------
-- 3. Seed: exactly the live list (see the header). Marker lines are read by apps/web/scripts/generate-controlled-medicine-fallback.ts.
-- ---------------------------------------------------------------------------
insert into public.controlled_medicine_terms (term, tier, label, change_note)
select v.term, v.tier, v.label, 'Seeded from the two hand-typed lists, unchanged (OQ-484)'
  from (values
-- BEGIN SEED controlled_medicine_terms
    ('morphine', 'narcotic', 'Opioid analgesic'),
    ('pethidine', 'narcotic', 'Opioid analgesic'),
    ('meperidine', 'narcotic', 'Opioid analgesic'),
    ('fentanyl', 'narcotic', 'Opioid analgesic'),
    ('oxycodone', 'narcotic', 'Opioid analgesic'),
    ('hydrocodone', 'narcotic', 'Opioid analgesic'),
    ('methadone', 'narcotic', 'Opioid analgesic'),
    ('diamorphine', 'narcotic', 'Opioid analgesic'),
    ('oxycontin', 'narcotic', 'Opioid analgesic'),
    ('oxynorm', 'narcotic', 'Opioid analgesic'),
    ('percocet', 'narcotic', 'Opioid analgesic'),
    ('duragesic', 'narcotic', 'Opioid analgesic'),
    ('sublimaze', 'narcotic', 'Opioid analgesic'),
    ('demerol', 'narcotic', 'Opioid analgesic'),
    ('codeine', 'restricted', 'Opioid analgesic (lower schedule)'),
    ('tramadol', 'restricted', 'Opioid analgesic (lower schedule)'),
    ('dihydrocodeine', 'restricted', 'Opioid analgesic (lower schedule)'),
    ('tramal', 'restricted', 'Opioid analgesic (lower schedule)'),
    ('ultram', 'restricted', 'Opioid analgesic (lower schedule)'),
    ('ultracet', 'restricted', 'Opioid analgesic (lower schedule)'),
    ('tramacet', 'restricted', 'Opioid analgesic (lower schedule)'),
    ('zydol', 'restricted', 'Opioid analgesic (lower schedule)'),
    ('phensedyl', 'restricted', 'Opioid analgesic (lower schedule)'),
    ('solpadeine', 'restricted', 'Opioid analgesic (lower schedule)'),
    ('panadeine', 'restricted', 'Opioid analgesic (lower schedule)'),
    ('co-codamol', 'restricted', 'Opioid analgesic (lower schedule)'),
    ('cocodamol', 'restricted', 'Opioid analgesic (lower schedule)'),
    ('co-dydramol', 'restricted', 'Opioid analgesic (lower schedule)'),
    ('codydramol', 'restricted', 'Opioid analgesic (lower schedule)'),
    ('diazepam', 'restricted', 'Benzodiazepine'),
    ('lorazepam', 'restricted', 'Benzodiazepine'),
    ('alprazolam', 'restricted', 'Benzodiazepine'),
    ('midazolam', 'restricted', 'Benzodiazepine'),
    ('clonazepam', 'restricted', 'Benzodiazepine'),
    ('chlordiazepoxide', 'restricted', 'Benzodiazepine'),
    ('bromazepam', 'restricted', 'Benzodiazepine'),
    ('valium', 'restricted', 'Benzodiazepine'),
    ('diazemuls', 'restricted', 'Benzodiazepine'),
    ('ativan', 'restricted', 'Benzodiazepine'),
    ('xanax', 'restricted', 'Benzodiazepine'),
    ('rivotril', 'restricted', 'Benzodiazepine'),
    ('klonopin', 'restricted', 'Benzodiazepine'),
    ('lexotan', 'restricted', 'Benzodiazepine'),
    ('dormicum', 'restricted', 'Benzodiazepine'),
    ('librium', 'restricted', 'Benzodiazepine'),
    ('methylphenidate', 'narcotic', 'Stimulant'),
    ('amphetamine', 'narcotic', 'Stimulant'),
    ('dexamfetamine', 'narcotic', 'Stimulant'),
    ('dextroamphetamine', 'narcotic', 'Stimulant'),
    ('lisdexamfetamine', 'narcotic', 'Stimulant'),
    ('ritalin', 'narcotic', 'Stimulant'),
    ('concerta', 'narcotic', 'Stimulant'),
    ('adderall', 'narcotic', 'Stimulant'),
    ('dexedrine', 'narcotic', 'Stimulant'),
    ('vyvanse', 'narcotic', 'Stimulant'),
    ('phenobarbital', 'restricted', 'Barbiturate'),
    ('phenobarbitone', 'restricted', 'Barbiturate'),
    ('luminal', 'restricted', 'Barbiturate'),
    ('ketamine', 'restricted', 'Dissociative anaesthetic'),
    ('ketalar', 'restricted', 'Dissociative anaesthetic')
-- END SEED controlled_medicine_terms
  ) as v(term, tier, label);

-- ---------------------------------------------------------------------------
-- 4. The single check every caller already uses, now reading the table
-- ---------------------------------------------------------------------------
create or replace function private.is_controlled_medicine(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.controlled_medicine_terms t
     where t.active
       and lower(btrim(coalesce(p_name, ''))) ~* ('\m' || t.term || '\M'));
$$;
revoke all on function private.is_controlled_medicine(text) from public, anon, authenticated;
grant execute on function private.is_controlled_medicine(text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Read (web) and write (CMO only)
-- ---------------------------------------------------------------------------
create function public.get_controlled_medicine_list()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'version', coalesce((select max(h.version) from public.controlled_medicine_term_history h), 0),
    'terms', coalesce((select jsonb_agg(jsonb_build_object('term', t.term, 'tier', t.tier, 'label', t.label) order by t.term)
                         from public.controlled_medicine_terms t where t.active), '[]'::jsonb));
$$;
revoke all on function public.get_controlled_medicine_list() from public, anon;
grant execute on function public.get_controlled_medicine_list() to authenticated, service_role;

create function public.set_controlled_medicine_term(p_term text, p_tier text, p_label text, p_active boolean, p_note text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_term text := lower(btrim(regexp_replace(coalesce(p_term, ''), '\s+', ' ', 'g')));
  v_label text := btrim(coalesce(p_label, ''));
  v_note text := btrim(coalesce(p_note, ''));
  v_uid uuid := (select auth.uid());
  v_row public.controlled_medicine_terms%rowtype;
  v_id uuid;
begin
  if v_uid is null or not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can change the controlled-medicine list' using errcode = '42501';
  end if;
  if v_term !~ '^[a-z0-9]([a-z0-9 -]*[a-z0-9])?$' then
    raise exception 'a controlled-medicine term is letters, digits, spaces and hyphens only' using errcode = '22023';
  end if;
  if p_tier is null or p_tier not in ('narcotic', 'restricted') then
    raise exception 'the tier is narcotic or restricted' using errcode = '22023';
  end if;
  if v_label = '' then
    raise exception 'a controlled-medicine term needs a label' using errcode = '22023';
  end if;
  if p_active is null then
    raise exception 'say whether the term is active' using errcode = '22023';
  end if;
  if length(v_note) < 10 then
    raise exception 'a change note of at least 10 characters is required' using errcode = '22023';
  end if;

  select * into v_row from public.controlled_medicine_terms where term = v_term for update;
  if v_row.id is null then
    insert into public.controlled_medicine_terms (term, tier, label, active, change_note, changed_by)
    values (v_term, p_tier, v_label, p_active, v_note, v_uid)
    returning id into v_id;
  else
    if v_row.tier = p_tier and v_row.label = v_label and v_row.active = p_active then
      raise exception 'nothing to change: the term is already like that' using errcode = '22023';
    end if;
    update public.controlled_medicine_terms
       set tier = p_tier, label = v_label, active = p_active, change_note = v_note, changed_by = v_uid
     where id = v_row.id;
    v_id := v_row.id;
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (private.current_org_id(), v_uid, 'controlled_medicine_list.changed', 'controlled_medicine_term', v_id,
          jsonb_build_object('term', v_term, 'tier', p_tier, 'active', p_active));
  return v_id;
end;
$$;
revoke all on function public.set_controlled_medicine_term(text, text, text, boolean, text) from public, anon;
grant execute on function public.set_controlled_medicine_term(text, text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Self-check: the seed is what the header says, and the function reads the table
-- ---------------------------------------------------------------------------
do $$
declare v_terms integer; v_hist integer; v_missed text;
begin
  select count(*) into v_terms from public.controlled_medicine_terms where active;
  select count(*) into v_hist from public.controlled_medicine_term_history;
  if v_terms <> 60 or v_hist <> 60 then
    raise exception 'controlled-medicine seed: expected 60 active terms and 60 history rows, got % and %', v_terms, v_hist;
  end if;
  select string_agg(term, ', ') into v_missed from public.controlled_medicine_terms where not private.is_controlled_medicine(term);
  if v_missed is not null then raise exception 'controlled-medicine check misses seeded terms: %', v_missed; end if;
  if private.is_controlled_medicine('Amlodipine 5mg') or private.is_controlled_medicine('') or private.is_controlled_medicine(null) then
    raise exception 'controlled-medicine check flags an ordinary medicine or an empty name';
  end if;
  if has_function_privilege('anon', 'public.get_controlled_medicine_list()', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_controlled_medicine_term(text,text,text,boolean,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.is_controlled_medicine(text)', 'EXECUTE') then
    raise exception 'controlled-medicine functions are reachable by a role that should not have them';
  end if;
  if has_table_privilege('authenticated', 'public.controlled_medicine_terms', 'INSERT')
     or has_table_privilege('authenticated', 'public.controlled_medicine_terms', 'SELECT')
     or has_table_privilege('anon', 'public.controlled_medicine_terms', 'SELECT') then
    raise exception 'controlled_medicine_terms is directly reachable through the API';
  end if;
end $$;
