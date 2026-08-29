alter table public.specialist_referrals
  add column if not exists outcome_document_path text,
  add column if not exists outcome_document_uploaded_at timestamptz,
  add column if not exists outcome_document_uploaded_by uuid references public.profiles (id) on delete set null,
  add column if not exists care_plan_update_note text,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.clinical_staff (id) on delete set null;

comment on column public.specialist_referrals.outcome_document_path is
  'storage.objects path (bucket specialist-referral-outcome-documents), never a public URL — the raw document/letter the specialist gave the patient. Fulfils the upload promise already made in referral-letter-document.tsx. Source-derived uploaded_by, never client-trusted.';
comment on column public.specialist_referrals.care_plan_update_note is
  'What changed in the patient''s care plan as a result of this referral''s outcome (task spec §11.15) — required before a referral can reach status=closed. A narrative note alongside the record, same relationship medications/care_plans already have to specialist_referrals: this does not itself move medication/monitoring rows, a clinician does that separately.';
comment on column public.specialist_referrals.closed_by is
  'The clinical_staff member who closed this referral. Server-derived from the acting session (private.enforce_specialist_referral_outcome_and_closure), never client-supplied. Null until closed; immutable once set.';

create index if not exists specialist_referrals_outcome_document_idx
  on public.specialist_referrals (id) where outcome_document_path is not null;

alter table public.specialist_referrals
  add constraint specialist_referrals_closed_requires_outcome check (
    status <> 'closed' or (
      closed_at is not null
      and closed_by is not null
      and care_plan_update_note is not null and length(btrim(care_plan_update_note)) > 0
      and (treatment_plan_received_at is not null or outcome_document_path is not null)
    )
  );

create or replace function private.enforce_specialist_referral_outcome_and_closure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  if old.status = 'closed' and new.status <> 'closed' then
    raise exception 'This referral is closed and cannot be reopened. Create a new referral (linked via parent_referral_id) if further specialist input is needed.'
      using errcode = '42501';
  end if;
  if old.closed_at is not null then
    new.closed_at := old.closed_at;
    new.closed_by := old.closed_by;
  end if;

  if new.outcome_document_path is distinct from old.outcome_document_path
     and new.outcome_document_path is not null then
    new.outcome_document_uploaded_at := coalesce(new.outcome_document_uploaded_at, now());
    if (select auth.uid()) is not null then
      new.outcome_document_uploaded_by := (select auth.uid());
    end if;
  end if;

  if new.status = 'closed' and old.status is distinct from 'closed' then
    if not private.is_clinical_tier(new.organisation_id) then
      raise exception 'Only a clinical-tier member of the care team can close a referral.'
        using errcode = '42501';
    end if;

    select id into v_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active
      and (
        is_clinical_director
        or doctor_tier in ('tier_1', 'tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
      )
    limit 1;

    if v_staff_id is null then
      raise exception 'Only a clinical-tier member of the care team can close a referral.'
        using errcode = '42501';
    end if;

    new.closed_by := v_staff_id;
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  return new;
end;
$$;

comment on function private.enforce_specialist_referral_outcome_and_closure() is
  'BEFORE UPDATE on specialist_referrals: freezes closed_at/closed_by once set and blocks reopening a closed referral; server-derives outcome_document_uploaded_by/_at when a document is attached; server-derives closed_by/closed_at (clinical-tier only) on the completed/waitlisted/etc -> closed transition. The specialist_referrals_closed_requires_outcome CHECK is the belt to this trigger''s suspenders.';

drop trigger if exists specialist_referrals_enforce_outcome_and_closure on public.specialist_referrals;
create trigger specialist_referrals_enforce_outcome_and_closure
  before update on public.specialist_referrals
  for each row execute function private.enforce_specialist_referral_outcome_and_closure();

revoke all on function private.enforce_specialist_referral_outcome_and_closure() from public;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'specialist_referrals_closed_requires_outcome'
      and conrelid = 'public.specialist_referrals'::regclass
  ) then
    raise exception 'specialist_referrals_closed_requires_outcome CHECK missing after migration';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'specialist_referrals_enforce_outcome_and_closure'
      and tgrelid = 'public.specialist_referrals'::regclass and not tgisinternal
  ) then
    raise exception 'specialist_referrals_enforce_outcome_and_closure trigger missing after migration';
  end if;
  raise notice 'PASS: specialist_referrals outcome/closure columns + CHECK + trigger present';
end $$;
