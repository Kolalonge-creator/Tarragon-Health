-- S56 step 4 of 4: the crisis card's data (function 10.3). No model anywhere in this path (INV-01).
--
-- 1. crisis_helplines: the helplines the crisis card may show. Seeded as UNVERIFIED CANDIDATES only: last_verified_at is null on every
--    row and nothing here was phoned. The card shows a helpline only after a human has verified it (verify_crisis_helpline, admin or
--    the clinical director, a reason recorded, audited) and only while that verification is newer than the PROPOSED re-verify age.
--    Until then the card says it is not yet verified and points to 112 and the nearest hospital. The SURPIN and MANI rows carry no
--    number at all (the research note's numbers came from directory listings and must be dialled before use); She Writes Woman
--    carries the number already published on the marketing site, still unverified.
-- 2. crisis_card_config: PROPOSED values (emergency number, re-verify age, staffed callback SLA). The callback SLA is shown to a
--    patient only once the row is confirmed; a draft number is never promised.
-- 3. get_crisis_card(): what any signed-in patient may read (verified helplines only, never a candidate), also cached on the device.
--
-- Rows: crisis_helplines 3 (seed), crisis_card_config 1 (seed). Nothing existing is changed.

create table if not exists public.crisis_helplines (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(btrim(name)) > 0),
  phone_e164        text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  hours_text        text,
  languages         text[] not null default '{}'::text[],
  source_note       text not null,
  is_active         boolean not null default true,
  last_verified_at  timestamptz,
  verified_by       uuid references public.profiles (id) on delete restrict,
  verification_note text,
  created_at        timestamptz not null default now(),
  constraint crisis_helplines_verified_complete check (
    last_verified_at is null or (verified_by is not null and phone_e164 is not null and char_length(btrim(coalesce(verification_note, ''))) >= 10))
);
create index if not exists crisis_helplines_verified_by_idx on public.crisis_helplines (verified_by) where verified_by is not null;
alter table public.crisis_helplines enable row level security;
drop policy if exists crisis_helplines_staff_select on public.crisis_helplines;
create policy crisis_helplines_staff_select on public.crisis_helplines for select to authenticated
  using (private.is_admin() or private.is_active_clinical_director());
revoke all on public.crisis_helplines from anon;
grant select on public.crisis_helplines to authenticated;

insert into public.crisis_helplines (name, phone_e164, hours_text, languages, source_note)
select * from (values
  ('SURPIN (Suicide Research and Prevention Initiative)', null::text, null::text, array['en']::text[],
   'Candidate from the S56 research note. No number is stored: it must be phoned and confirmed before it is entered and verified.'),
  ('MANI (Mentally Aware Nigeria Initiative)', null, null, array['en'],
   'Candidate from the S56 research note. No number is stored: it must be phoned and confirmed before it is entered and verified.'),
  ('She Writes Woman', '+2348008002000', null, array['en'],
   'Number already published on the marketing site (mental-health-support-notice.tsx). Unverified: not phoned in this build.')
) v(name, phone_e164, hours_text, languages, source_note)
where not exists (select 1 from public.crisis_helplines);

create table if not exists public.crisis_card_config (
  id         uuid primary key default gen_random_uuid(),
  version    integer not null unique check (version >= 1),
  status     text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  config     jsonb not null,
  notes      text,
  is_active  boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists crisis_card_config_one_active on public.crisis_card_config (is_active) where is_active;
alter table public.crisis_card_config enable row level security;
drop policy if exists crisis_card_config_select on public.crisis_card_config;
create policy crisis_card_config_select on public.crisis_card_config for select to authenticated
  using (private.is_admin() or private.is_active_clinical_director());
revoke all on public.crisis_card_config from anon;
grant select on public.crisis_card_config to authenticated;
-- crisis-card-v1-begin
insert into public.crisis_card_config (version, status, config, notes, is_active)
values (1, 'proposed', $json${"emergency_number":"112","helpline_reverify_days":180,"callback_sla_minutes":30}$json$::jsonb,
  'PROPOSED by the build, owner CMO: 112 is the national emergency line (it may not connect everywhere, so the card always also says go to the nearest hospital); helplines older than this re-verify age drop back to unverified; the staffed callback SLA is shown to a patient only once this row is confirmed.', true)
on conflict (version) do nothing;
-- crisis-card-v1-end

create or replace function public.get_crisis_card()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_cfg public.crisis_card_config%rowtype; v_days integer; v_lines jsonb;
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into v_cfg from public.crisis_card_config where is_active;
  v_days := coalesce((v_cfg.config ->> 'helpline_reverify_days')::integer, 180);
  select coalesce(jsonb_agg(jsonb_build_object('name', h.name, 'phone_e164', h.phone_e164, 'hours_text', h.hours_text,
           'languages', h.languages, 'last_verified_at', h.last_verified_at) order by h.name), '[]'::jsonb)
    into v_lines from public.crisis_helplines h
   where h.is_active and h.phone_e164 is not null and h.last_verified_at is not null
     and h.last_verified_at > now() - make_interval(days => v_days);
  return jsonb_build_object('emergency_number', coalesce(v_cfg.config ->> 'emergency_number', '112'), 'helplines', v_lines,
    'callback_sla_minutes', case when v_cfg.status = 'confirmed' then (v_cfg.config ->> 'callback_sla_minutes')::integer else null end);
end $$;
revoke all on function public.get_crisis_card() from public, anon;
grant execute on function public.get_crisis_card() to authenticated;

create or replace function public.verify_crisis_helpline(p_id uuid, p_phone_e164 text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid;
begin
  if v_uid is null or not (private.is_admin() or private.is_active_clinical_director()) then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_note is null or char_length(btrim(p_note)) < 10 then raise exception 'say how it was verified (at least 10 characters)' using errcode = '22023'; end if;
  if p_phone_e164 is null or p_phone_e164 !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'a number in international format is required' using errcode = '22023'; end if;
  update public.crisis_helplines set phone_e164 = p_phone_e164, last_verified_at = now(), verified_by = v_uid, verification_note = btrim(p_note)
   where id = p_id;
  if not found then raise exception 'unknown helpline' using errcode = '22023'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason)
    values (v_org, v_uid, 'crisis_helpline.verified', 'crisis_helpline', p_id, jsonb_build_object('note', btrim(p_note)), btrim(p_note));
end $$;
revoke all on function public.verify_crisis_helpline(uuid, text, text) from public, anon;
grant execute on function public.verify_crisis_helpline(uuid, text, text) to authenticated;

create or replace function public.unverify_crisis_helpline(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid;
begin
  if v_uid is null or not (private.is_admin() or private.is_active_clinical_director()) then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_note is null or char_length(btrim(p_note)) < 10 then raise exception 'say why (at least 10 characters)' using errcode = '22023'; end if;
  update public.crisis_helplines set last_verified_at = null, verified_by = null, verification_note = null where id = p_id;
  if not found then raise exception 'unknown helpline' using errcode = '22023'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason)
    values (v_org, v_uid, 'crisis_helpline.unverified', 'crisis_helpline', p_id, jsonb_build_object('note', btrim(p_note)), btrim(p_note));
end $$;
revoke all on function public.unverify_crisis_helpline(uuid, text) from public, anon;
grant execute on function public.unverify_crisis_helpline(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from public.crisis_helplines where last_verified_at is not null) then raise exception 'FAIL: a helpline was seeded as verified'; end if;
  if has_function_privilege('anon', 'public.get_crisis_card()', 'EXECUTE') or has_function_privilege('anon', 'public.verify_crisis_helpline(uuid,text,text)', 'EXECUTE') then
    raise exception 'FAIL: anon can reach the crisis card functions';
  end if;
end $$;
