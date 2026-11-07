-- P14 (patient dashboard 2.0, spec section 6): save and resume for the patient health assessment (the four-step risk
-- assessment on the Prevention page, RiskAssessmentForm).
--
-- Design
--   * One draft per patient (patient_id is the primary key): saving again replaces it, submitting the assessment deletes it.
--   * answers is the unsubmitted form, as the form's own field names. It is never read by the rules engine, a score, a report or a
--     clinician: only a submitted assessment (risk_assessment_responses) counts.
--   * Owner only, for every command. A draft belongs to the patient: nobody else reads or writes it, staff included (staff work from
--     the submitted assessment). A supporter acting for someone cannot save a draft onto their own record by accident either, because
--     the app refuses to save while acting and this table only ever accepts patient_id = auth.uid() (so a write could only ever land
--     on the supporter's OWN draft, never on the person's). No staff-capable read policy, so no staff_read_scope row.
--   * Under-18 dependants: the default 'guarded' class (event trigger adds the restrictive minor policy).
--   * Registered in data_registry (operational, deleted at end of retention, in the patient's export, reviewed = false).
-- Nothing existing is edited.

create table public.risk_assessment_drafts (
  patient_id       uuid primary key references public.profiles (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  answers          jsonb not null default '{}'::jsonb
                   check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 16384),
  step             smallint not null default 1 check (step between 1 and 5),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index risk_assessment_drafts_org_idx on public.risk_assessment_drafts (organisation_id);

comment on table public.risk_assessment_drafts is
  'P14: one unsubmitted risk assessment per patient, so they can save and come back. Owner-only. Never used for scoring or care: only a submitted assessment counts.';

create trigger risk_assessment_drafts_set_updated_at
  before update on public.risk_assessment_drafts
  for each row execute function private.set_updated_at();

alter table public.risk_assessment_drafts enable row level security;

create policy risk_assessment_drafts_select on public.risk_assessment_drafts
  for select to authenticated
  using (patient_id = (select auth.uid()));

create policy risk_assessment_drafts_insert on public.risk_assessment_drafts
  for insert to authenticated
  with check (patient_id = (select auth.uid()) and organisation_id = private.current_org_id());

create policy risk_assessment_drafts_update on public.risk_assessment_drafts
  for update to authenticated
  using (patient_id = (select auth.uid()))
  with check (patient_id = (select auth.uid()) and organisation_id = private.current_org_id());

create policy risk_assessment_drafts_delete on public.risk_assessment_drafts
  for delete to authenticated
  using (patient_id = (select auth.uid()));

grant select, insert, update, delete on public.risk_assessment_drafts to authenticated;
revoke all on public.risk_assessment_drafts from anon, public;

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('risk_assessment_drafts', 'patient_id', 'operational', 'delete', true, false,
        'Unsubmitted risk assessment answers (save and resume). Class assigned by the migration author, not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;

do $$
begin
  if not exists (select 1 from public.data_registry where table_name = 'risk_assessment_drafts' and not reviewed) then
    raise exception 'risk_assessment_drafts is not registered in data_registry as expected';
  end if;
  if has_table_privilege('anon', 'public.risk_assessment_drafts', 'SELECT') then
    raise exception 'anon can read risk_assessment_drafts';
  end if;
  if not has_table_privilege('authenticated', 'public.risk_assessment_drafts', 'INSERT') then
    raise exception 'authenticated cannot insert into risk_assessment_drafts';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'risk_assessment_drafts'
               and permissive = 'PERMISSIVE' and coalesce(qual, with_check) not like '%auth.uid()%') then
    raise exception 'a permissive policy on risk_assessment_drafts is not owner-only';
  end if;
end $$;
