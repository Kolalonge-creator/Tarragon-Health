-- Tarragon Health — Clinical Governance & Patient Safety spec §31.15.
--
-- patient_consents (20260716180000) already tracks consent obtained,
-- purpose (consent_type), date (accepted_at), and version — but its own
-- header comment already named the missing piece: "withdrawing consent is
-- a new row of a future 'withdrawn' shape, not a mutation of history." That
-- shape was never built. This migration builds exactly what the comment
-- described, nothing more.
--
-- `has_required_consents` gates a ONE-TIME transition (onboarding_completed_at
-- null -> set, private.enforce_onboarding_prereqs) and nothing else reads it
-- anywhere in the app (confirmed by a full grep before writing this) — so
-- adding withdrawal here changes no existing patient's access. A later
-- withdrawal cannot un-complete onboarding retroactively, matching how every
-- other one-time gate on this platform works; it is a durable, honest audit
-- record and a starting point for a future consent-preference surface.
--
-- consent_version_id/version on a withdrawal row are never client-supplied:
-- the trigger derives them from whichever acceptance is currently in force
-- for that (patient, consent_type) pair, same never-trust-the-client
-- attribution discipline as clinical_incident_reports.reported_by.

alter table public.patient_consents
  add column action text not null default 'accepted' check (action in ('accepted', 'withdrawn'));

comment on column public.patient_consents.action is
  'Spec §31.15. ''accepted'' (the default, matching every pre-existing row) or ''withdrawn''. The most recent row per (patient_id, consent_type) by created_at determines current status — never a mutation of an earlier row, per this table''s original append-only design.';

-- Existing rows are unambiguous: every one that predates this column is a
-- real acceptance, which the column default already covers with no backfill
-- needed. Recorded here as a DO block assertion, not silent trust.
do $$
declare
  v_non_accepted int;
begin
  select count(*) into v_non_accepted from public.patient_consents where action <> 'accepted';
  if v_non_accepted <> 0 then
    raise exception 'expected every pre-existing patient_consents row to default to accepted, found %', v_non_accepted;
  end if;
end $$;

create or replace function private.enforce_patient_consent_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current record;
begin
  if new.action <> 'withdrawn' then
    -- A normal acceptance: consent_version_id/version are exactly what the
    -- app already sends (the current consent_versions row the patient just
    -- read and agreed to) -- nothing to derive.
    return new;
  end if;

  -- The acceptance currently in force for this (patient, consent_type):
  -- the most recent 'accepted' row with no later 'withdrawn' row after it.
  select pc.consent_version_id, pc.version
  into v_current
  from public.patient_consents pc
  where pc.patient_id = new.patient_id
    and pc.consent_type = new.consent_type
    and pc.action = 'accepted'
    and not exists (
      select 1 from public.patient_consents pc2
      where pc2.patient_id = pc.patient_id
        and pc2.consent_type = pc.consent_type
        and pc2.action = 'withdrawn'
        and pc2.created_at > pc.created_at
    )
  order by pc.created_at desc
  limit 1;

  if v_current.consent_version_id is null then
    raise exception 'No currently-accepted % consent on file to withdraw', new.consent_type
      using errcode = '23514';
  end if;

  new.consent_version_id := v_current.consent_version_id;
  new.version := v_current.version;
  new.accepted_at := now();

  return new;
end;
$$;

comment on function private.enforce_patient_consent_withdrawal() is
  'Spec §31.15 withdrawal. A withdrawn row must correspond to a currently in-force acceptance (else raises) and has its consent_version_id/version server-derived from that acceptance, never client-supplied.';

create trigger patient_consents_enforce_withdrawal
  before insert on public.patient_consents
  for each row execute function private.enforce_patient_consent_withdrawal();

revoke all on function private.enforce_patient_consent_withdrawal() from public;

-- has_required_consents now looks at CURRENT status (latest action per
-- consent_type), not "has an acceptance row ever existed" -- a withdrawn
-- consent's own consent_version_id would otherwise still match cv.id and be
-- read as satisfying the requirement.
create or replace function private.has_required_consents(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.consent_versions cv
    where cv.is_current
      and not exists (
        select 1
        from public.patient_consents pc
        where pc.patient_id = p_patient
          and pc.consent_version_id = cv.id
          and pc.action = 'accepted'
          and not exists (
            select 1 from public.patient_consents pc2
            where pc2.patient_id = pc.patient_id
              and pc2.consent_type = pc.consent_type
              and pc2.action = 'withdrawn'
              and pc2.created_at > pc.created_at
          )
      )
  );
$$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'patient_consents' and column_name = 'action'
  ) then
    raise exception 'patient_consents.action missing after migration';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.patient_consents'::regclass
      and tgname = 'patient_consents_enforce_withdrawal'
      and not tgisinternal
  ) then
    raise exception 'patient_consents_enforce_withdrawal trigger missing';
  end if;

  raise notice 'PASS: patient_consents withdrawal shape present';
end $$;
