-- A ledger of signatures the Chief Medical Officer still owes for things that are ALREADY running or already drafted, so the
-- sign-off hub counts them.
--
-- Why: the 2026-10-29 screening go-live switched six guards on from a chat session under the CMO's instruction, and the safety
-- case for the scheduler (v0.1) was accepted in chat with its signature block left blank. None of that is a governed
-- configuration row, so the hub's "areas that need your signature" count could not see it. A document the database cannot read,
-- and a switch pressed on someone's say-so, need an explicit line that stays on the hub until the CMO signs it in person.
--
-- This is a to-do list, not an approval: a row here is an OBLIGATION raised by whoever shipped the thing, and signed_by/signed_at
-- can only be set by the CMO through sign_owed_signoff (type SIGN, write a note). Nothing in this migration signs anything.
--
-- Raised below (only for an organisation that has an active Chief Medical Officer):
--   screening_safety_case_v1   running: the scheduler safety case is v0.1, accepted in chat, signature block unsigned
--   screening_switches_confirm running: six screening switches were pressed from a chat session, not from the hub
--   sleep_stopbang_licence     running: the STOP-Bang licence for the sleep questionnaire has not been verified
--   vaccination_adult_drafts   draft:   three adult vaccine drafts (inactive) are unverified against the national table
create table public.owed_signoffs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  subject_key text not null check (subject_key ~ '^[a-z0-9_.:-]{3,80}$'),
  title text not null check (char_length(title) between 5 and 160),
  detail text not null check (char_length(detail) >= 20),
  -- true when the thing is already in effect (the hub shows it as live without a signature); false when it is only drafted
  running boolean not null default false,
  raised_at timestamptz not null default now(),
  raised_note text,
  signed_by uuid references public.profiles(id) on delete set null,
  signed_at timestamptz,
  sign_note text,
  constraint owed_signoffs_signature_complete check ((signed_at is null) = (sign_note is null)),
  constraint owed_signoffs_one_per_subject unique (organisation_id, subject_key)
);

alter table public.owed_signoffs enable row level security;

-- Only the organisation's Chief Medical Officer reads it; nobody writes it directly (the function below and migrations do).
create policy owed_signoffs_cmo_read on public.owed_signoffs for select to authenticated
  using (exists (
    select 1 from public.clinical_staff cs
     where cs.profile_id = (select auth.uid()) and cs.organisation_id = owed_signoffs.organisation_id
       and cs.doctor_tier = 'chief_medical_officer' and cs.active and cs.status = 'active'));

revoke all on public.owed_signoffs from public, anon, authenticated;
grant select on public.owed_signoffs to authenticated;

create or replace function public.sign_owed_signoff(p_key text, p_note text, p_confirm text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cs public.clinical_staff%rowtype;
  v_id uuid;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign this' using errcode = '42501'; end if;
  select * into cs from public.clinical_staff
   where profile_id = auth.uid() and active and status = 'active' and doctor_tier = 'chief_medical_officer' limit 1;
  if upper(btrim(coalesce(p_confirm, ''))) <> 'SIGN' then raise exception 'type SIGN to confirm; nothing was signed' using errcode = '22023'; end if;
  if char_length(v_note) < 20 then raise exception 'write what you checked, in at least 20 characters; nothing was signed' using errcode = '23514'; end if;
  update public.owed_signoffs
     set signed_by = auth.uid(), signed_at = now(), sign_note = v_note
   where organisation_id = cs.organisation_id and subject_key = p_key and signed_at is null
  returning id into v_id;
  if v_id is null then raise exception 'nothing is waiting for your signature under that name' using errcode = '22023'; end if;
  perform private.credential_audit(cs.organisation_id, auth.uid(), 'owed_signoff.signed', 'owed_signoff', v_id,
    jsonb_build_object('subject_key', p_key, 'confirmed_by_typing', 'SIGN'));
  return v_id;
end $$;

revoke all on function public.sign_owed_signoff(text, text, text) from public, anon;
grant execute on function public.sign_owed_signoff(text, text, text) to authenticated;

insert into public.owed_signoffs (organisation_id, subject_key, title, detail, running, raised_note)
select o.id, v.subject_key, v.title, v.detail, v.running, 'Raised by the 2026-10-29 screening go-live; not a signature.'
from public.organisations o
cross join (values
  ('screening_safety_case_v1', 'Screening scheduler safety case: sign version 1.0',
   'The nightly screening scheduler, the automatic test requests and the reminder ladder are running. Their safety case (docs/clinical-safety/screening-scheduler-safety-case.md) is version 0.1: you accepted it in a chat on 29 October, but its signature block is blank and version 1.0 has not been issued. Read it, then sign.',
   true),
  ('screening_switches_confirm', 'Screening switches: confirm the six you asked for in chat',
   'Six switches were pressed on 29 October from a chat session under your instruction, not from this hub: nightly scheduler, automatic test requests, sensitive-test opt-in, reproductive content, sleep questionnaire, wellbeing follow-up. Their cover, timing and DPO statements were recorded as your word in chat. Confirm them yourself, or switch any of them off from the go-live page.',
   true),
  ('sleep_stopbang_licence', 'Sleep questionnaire: STOP-Bang licence',
   'The snoring and daytime sleepiness questionnaire is on. It uses the STOP-Bang items, whose licence (University Health Network) has not been verified. Confirm the licence position, or switch the sleep switch off until it is.',
   true),
  ('vaccination_adult_drafts', 'Adult vaccines: verify three drafts against the national table',
   'Tetanus-diphtheria booster, adult hepatitis B and adult yellow fever were drafted inactive on 29 October. Their wording is drafted, not verified against the current NPHCDA/WHO table. Signing records that you verified them; it does not switch them on.',
   false)
) as v(subject_key, title, detail, running)
where exists (select 1 from public.clinical_staff cs where cs.organisation_id = o.id and cs.doctor_tier = 'chief_medical_officer' and cs.active and cs.status = 'active')
on conflict (organisation_id, subject_key) do nothing;

do $$
begin
  if has_table_privilege('anon', 'public.owed_signoffs', 'SELECT') or has_table_privilege('authenticated', 'public.owed_signoffs', 'INSERT')
     or has_table_privilege('authenticated', 'public.owed_signoffs', 'UPDATE') or has_table_privilege('authenticated', 'public.owed_signoffs', 'DELETE') then
    raise exception 'FAIL: owed_signoffs is writable by a signed-in user or readable by anon';
  end if;
  if has_function_privilege('anon', 'public.sign_owed_signoff(text,text,text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute sign_owed_signoff';
  end if;
end $$;
