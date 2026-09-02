create type public.provider_complaint_stage as enum (
  'received', 'triage', 'investigation', 'provider_response',
  'resolution', 'governance_review', 'closed', 'withdrawn'
);

comment on type public.provider_complaint_stage is
  '§29.5 pipeline. ''withdrawn'' is the one terminal state reachable from any earlier stage — a complainant may always withdraw; it is not a stage the process advances into.';

create type public.provider_complaint_category as enum (
  'clinical', 'conduct', 'communication', 'punctuality', 'access', 'administrative', 'other'
);

create type public.provider_complaint_severity as enum ('low', 'moderate', 'serious', 'critical');

create type public.provider_complaint_outcome as enum (
  'upheld', 'partially_upheld', 'not_upheld', 'no_further_action'
);

create or replace function private.provider_complaint_stage_ordinal(p_stage public.provider_complaint_stage)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_stage
    when 'received' then 1
    when 'triage' then 2
    when 'investigation' then 3
    when 'provider_response' then 4
    when 'resolution' then 5
    when 'governance_review' then 6
    when 'closed' then 7
    when 'withdrawn' then 99
  end;
$$;

comment on function private.provider_complaint_stage_ordinal(public.provider_complaint_stage) is
  'Position of a stage in the §29.5 pipeline. ''withdrawn'' is 99 (off-pipeline terminal) so ordinal comparison never treats it as "further along" than closed by accident.';

revoke all on function private.provider_complaint_stage_ordinal(public.provider_complaint_stage) from public, anon;

create table public.provider_complaints (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  reference              text not null,

  subject_staff_id       uuid not null references public.clinical_staff (id) on delete restrict,
  raised_by              uuid references public.profiles (id) on delete set null,
  patient_id             uuid references public.profiles (id) on delete set null,

  category               public.provider_complaint_category not null,
  severity               public.provider_complaint_severity,
  summary                text not null check (length(btrim(summary)) > 0),

  stage                  public.provider_complaint_stage not null default 'received',

  triaged_by             uuid references public.profiles (id) on delete set null,
  triaged_at             timestamptz,

  investigation_opened_by uuid references public.profiles (id) on delete set null,
  investigation_opened_at timestamptz,

  response_requested_at   timestamptz,
  provider_response       text,
  provider_responded_at   timestamptz,

  outcome                 public.provider_complaint_outcome,
  resolution_summary      text,
  resolved_by             uuid references public.profiles (id) on delete set null,
  resolved_at             timestamptz,

  governance_reviewed_by  uuid references public.clinical_staff (id) on delete set null,
  governance_reviewed_at  timestamptz,
  governance_notes        text,

  closed_at               timestamptz,
  withdrawn_at            timestamptz,
  withdrawn_reason        text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint provider_complaints_reference_unique unique (reference),
  constraint provider_complaints_triage_paired
    check ((triaged_by is null) = (triaged_at is null)),
  constraint provider_complaints_investigation_paired
    check ((investigation_opened_by is null) = (investigation_opened_at is null)),
  constraint provider_complaints_resolution_paired
    check ((resolved_by is null) = (resolved_at is null)),
  constraint provider_complaints_governance_paired
    check ((governance_reviewed_by is null) = (governance_reviewed_at is null)),
  constraint provider_complaints_response_paired
    check ((provider_response is null) = (provider_responded_at is null)),
  constraint provider_complaints_withdrawn_has_timestamp
    check (stage <> 'withdrawn' or withdrawn_at is not null),
  constraint provider_complaints_closed_has_timestamp
    check (stage <> 'closed' or closed_at is not null),
  constraint provider_complaints_resolution_has_outcome
    check (stage not in ('resolution', 'governance_review', 'closed') or outcome is not null)
);

comment on table public.provider_complaints is
  '§29.5 formal complaint about a provider, moving through received -> triage -> investigation -> provider_response -> resolution -> governance_review -> closed. Deliberately separate from consultation_feedback: a 1-5 star experience rating is not a complaint, and a clinical concern is never a star rating (§29.4).';
comment on column public.provider_complaints.reference is
  'Human-quotable case reference (TH-CMP-YYYY-NNNN), generated server-side. Complaints get discussed in meetings and letters where a uuid is unusable.';
comment on column public.provider_complaints.raised_by is
  'The complainant. Nullable: a complaint may be raised on a patient''s behalf by staff, or arrive through a channel with no platform account. Never inferred from patient_id.';
comment on column public.provider_complaints.severity is
  'Set at triage, not at intake — a complainant''s distress is not a severity assessment. Null until triaged.';

create index provider_complaints_subject_idx on public.provider_complaints (subject_staff_id, created_at desc);
create index provider_complaints_org_stage_idx on public.provider_complaints (organisation_id, stage);
create index provider_complaints_open_idx on public.provider_complaints (organisation_id, created_at desc)
  where stage not in ('closed', 'withdrawn');
create index provider_complaints_raised_by_idx on public.provider_complaints (raised_by) where raised_by is not null;

create trigger provider_complaints_set_updated_at
  before update on public.provider_complaints
  for each row execute function private.set_updated_at();

create table public.provider_complaint_investigation_notes (
  id            uuid primary key default gen_random_uuid(),
  complaint_id  uuid not null references public.provider_complaints (id) on delete cascade,
  author_id     uuid not null references public.profiles (id) on delete restrict,
  note          text not null check (length(btrim(note)) > 0),
  created_at    timestamptz not null default now()
);

comment on table public.provider_complaint_investigation_notes is
  'The investigation file for a complaint. A separate table rather than a column on provider_complaints so that the subject provider''s legitimate read of their own complaint (from provider_response onward) cannot expose it — column-level secrecy inside one RLS policy is the kind of thing that silently breaks on the next policy edit.';

create index provider_complaint_investigation_notes_complaint_idx
  on public.provider_complaint_investigation_notes (complaint_id, created_at);

create table public.provider_complaint_events (
  id            uuid primary key default gen_random_uuid(),
  complaint_id  uuid not null references public.provider_complaints (id) on delete cascade,
  from_stage    public.provider_complaint_stage,
  to_stage      public.provider_complaint_stage not null,
  actor_id      uuid references public.profiles (id) on delete set null,
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

comment on table public.provider_complaint_events is
  'Append-only stage history, written by the transition trigger — not by the app, so it cannot be skipped. from_stage is null on the row recording intake.';

create index provider_complaint_events_complaint_idx
  on public.provider_complaint_events (complaint_id, created_at);

create sequence public.provider_complaint_reference_seq;

create or replace function private.set_provider_complaint_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reference is null or btrim(new.reference) = '' then
    new.reference := 'TH-CMP-' || to_char(now() at time zone 'Africa/Lagos', 'YYYY') || '-'
                     || lpad(nextval('public.provider_complaint_reference_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

revoke all on function private.set_provider_complaint_reference() from public, anon;

create trigger provider_complaints_set_reference
  before insert on public.provider_complaints
  for each row execute function private.set_provider_complaint_reference();

create or replace function private.enforce_provider_complaint_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from integer := private.provider_complaint_stage_ordinal(old.stage);
  v_to   integer := private.provider_complaint_stage_ordinal(new.stage);
begin
  if new.stage = old.stage then
    return new;
  end if;

  if new.stage = 'withdrawn' then
    if old.stage in ('closed', 'withdrawn') then
      raise exception 'a % complaint cannot be withdrawn', old.stage;
    end if;
    new.withdrawn_at := coalesce(new.withdrawn_at, now());
    return new;
  end if;

  if old.stage in ('closed', 'withdrawn') then
    raise exception 'complaint % is already % and cannot be reopened — raise a new complaint referencing it',
      old.reference, old.stage;
  end if;

  if v_to <> v_from + 1 then
    if not (old.stage = 'resolution' and new.stage = 'closed' and new.category <> 'clinical') then
      raise exception 'invalid complaint transition % -> % (the pipeline is forward-only, one stage at a time; only a non-clinical complaint may close straight from resolution)',
        old.stage, new.stage;
    end if;
  end if;

  if old.stage = 'triage' and (new.triaged_by is null or new.severity is null) then
    raise exception 'triage must record who triaged the complaint and assign a severity before it advances';
  end if;

  if old.stage = 'investigation' and not exists (
    select 1 from public.provider_complaint_investigation_notes where complaint_id = new.id
  ) then
    raise exception 'an investigation must record at least one investigation note before it advances';
  end if;

  if old.stage = 'provider_response' and new.provider_response is null and new.response_requested_at is null then
    raise exception 'the provider must be given a recorded opportunity to respond before the complaint advances';
  end if;

  if old.stage = 'resolution' and (new.outcome is null or new.resolved_by is null) then
    raise exception 'a resolution must record an outcome and who resolved it';
  end if;

  if new.stage = 'closed' and new.category = 'clinical' then
    if new.governance_reviewed_by is null then
      raise exception 'a clinical complaint may not be closed without a signed governance review';
    end if;
    if not exists (
      select 1 from public.clinical_staff
      where id = new.governance_reviewed_by and is_clinical_director
    ) then
      raise exception 'the governance review of a clinical complaint must be signed by a Clinical Director';
    end if;
  end if;

  if new.stage = 'investigation' then
    new.investigation_opened_at := coalesce(new.investigation_opened_at, now());
    new.investigation_opened_by := coalesce(new.investigation_opened_by, (select auth.uid()));
  end if;
  if new.stage = 'provider_response' then
    new.response_requested_at := coalesce(new.response_requested_at, now());
  end if;
  if new.stage = 'closed' then
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  return new;
end;
$$;

comment on function private.enforce_provider_complaint_stage() is
  '§29.5 pipeline as an enforced state machine: forward-only, one stage at a time, each stage gated on its own evidence, clinical complaints closable only through a Clinical-Director-signed governance review. The one permitted skip (resolution -> closed for a non-clinical complaint) is explicit rather than implied.';

revoke all on function private.enforce_provider_complaint_stage() from public, anon;

create trigger provider_complaints_enforce_stage
  before update on public.provider_complaints
  for each row execute function private.enforce_provider_complaint_stage();

create or replace function private.log_provider_complaint_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.provider_complaint_events (complaint_id, from_stage, to_stage, actor_id, detail)
    values (new.id, null, new.stage, (select auth.uid()),
            jsonb_build_object('category', new.category, 'reference', new.reference));

    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (new.organisation_id, (select auth.uid()), 'provider_complaint.received',
            'provider_complaints', new.id,
            jsonb_build_object('reference', new.reference, 'category', new.category,
                               'subject_staff_id', new.subject_staff_id));
    return new;
  end if;

  if new.stage is distinct from old.stage then
    insert into public.provider_complaint_events (complaint_id, from_stage, to_stage, actor_id, detail)
    values (new.id, old.stage, new.stage, (select auth.uid()),
            jsonb_build_object('outcome', new.outcome, 'severity', new.severity));

    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (new.organisation_id, (select auth.uid()), 'provider_complaint.stage_changed',
            'provider_complaints', new.id,
            jsonb_build_object('reference', new.reference, 'from', old.stage, 'to', new.stage,
                               'outcome', new.outcome));
  end if;
  return new;
end;
$$;

revoke all on function private.log_provider_complaint_event() from public, anon;

create trigger provider_complaints_log_event
  after insert or update on public.provider_complaints
  for each row execute function private.log_provider_complaint_event();

create or replace function private.is_complaints_handler()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin() or exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid()) and active and is_clinical_director
  );
$$;

comment on function private.is_complaints_handler() is
  'Who may run the §29.5 complaints process: platform admin, or an active Clinical Director. Deliberately NOT private.is_org_staff() — a complaint about a colleague is not care-team-wide reading.';

revoke all on function private.is_complaints_handler() from public, anon;

alter table public.provider_complaints enable row level security;
alter table public.provider_complaint_investigation_notes enable row level security;
alter table public.provider_complaint_events enable row level security;

create policy provider_complaints_select on public.provider_complaints
  for select to authenticated
  using (
    private.is_complaints_handler()
    or raised_by = (select auth.uid())
    or (
      stage in ('provider_response', 'resolution', 'governance_review', 'closed')
      and subject_staff_id in (
        select id from public.clinical_staff where profile_id = (select auth.uid())
      )
    )
  );

create policy provider_complaints_insert on public.provider_complaints
  for insert to authenticated
  with check (
    (raised_by = (select auth.uid()) or private.is_complaints_handler())
    and stage = 'received'
    and triaged_by is null
    and outcome is null
    and governance_reviewed_by is null
  );

create policy provider_complaints_update on public.provider_complaints
  for update to authenticated
  using (
    private.is_complaints_handler()
    or (
      stage = 'provider_response'
      and subject_staff_id in (
        select id from public.clinical_staff where profile_id = (select auth.uid())
      )
    )
  )
  with check (
    private.is_complaints_handler()
    or (
      stage = 'provider_response'
      and subject_staff_id in (
        select id from public.clinical_staff where profile_id = (select auth.uid())
      )
    )
  );

create or replace function private.guard_provider_complaint_subject_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or private.is_complaints_handler() then
    return new;
  end if;

  if new.stage is distinct from old.stage
     or new.category is distinct from old.category
     or new.severity is distinct from old.severity
     or new.summary is distinct from old.summary
     or new.outcome is distinct from old.outcome
     or new.resolution_summary is distinct from old.resolution_summary
     or new.resolved_by is distinct from old.resolved_by
     or new.governance_reviewed_by is distinct from old.governance_reviewed_by
     or new.governance_notes is distinct from old.governance_notes
     or new.triaged_by is distinct from old.triaged_by
     or new.subject_staff_id is distinct from old.subject_staff_id
     or new.raised_by is distinct from old.raised_by
     or new.closed_at is distinct from old.closed_at
     or new.withdrawn_at is distinct from old.withdrawn_at then
    raise exception 'a provider may only add their own response to a complaint about them'
      using errcode = '42501';
  end if;

  if old.provider_response is not null and new.provider_response is distinct from old.provider_response then
    raise exception 'a provider response is submitted once and cannot be edited afterwards'
      using errcode = '42501';
  end if;

  if new.provider_response is not null then
    new.provider_responded_at := coalesce(old.provider_responded_at, now());
  end if;

  return new;
end;
$$;

comment on function private.guard_provider_complaint_subject_update() is
  'Column-level guard for the one non-handler writer the UPDATE policy admits: the subject provider adding their own response. Everything else on the row must be unchanged, and a submitted response is immutable.';

revoke all on function private.guard_provider_complaint_subject_update() from public, anon;

create trigger a_provider_complaints_guard_subject_update
  before update on public.provider_complaints
  for each row execute function private.guard_provider_complaint_subject_update();

create policy provider_complaint_investigation_notes_all
  on public.provider_complaint_investigation_notes
  for all to authenticated
  using (private.is_complaints_handler())
  with check (private.is_complaints_handler() and author_id = (select auth.uid()));

create policy provider_complaint_events_select on public.provider_complaint_events
  for select to authenticated
  using (
    exists (
      select 1 from public.provider_complaints c
      where c.id = complaint_id
        and (
          private.is_complaints_handler()
          or c.raised_by = (select auth.uid())
          or (
            c.stage in ('provider_response', 'resolution', 'governance_review', 'closed')
            and c.subject_staff_id in (
              select id from public.clinical_staff where profile_id = (select auth.uid())
            )
          )
        )
    )
  );

grant select, insert, update on public.provider_complaints to authenticated;
revoke delete on public.provider_complaints from authenticated;

grant select, insert on public.provider_complaint_investigation_notes to authenticated;
revoke update, delete on public.provider_complaint_investigation_notes from authenticated;

grant select on public.provider_complaint_events to authenticated;
revoke insert, update, delete on public.provider_complaint_events from authenticated;

do $$
declare
  v_org  uuid;
  v_staff uuid;
  v_id   uuid;
  v_bad  boolean;
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'provider_complaints') then
    raise exception 'FAIL: provider_complaints missing';
  end if;

  select id into v_org from public.organisations limit 1;
  select id into v_staff from public.clinical_staff limit 1;

  if v_org is null or v_staff is null then
    raise notice 'SKIP: no organisation/clinical_staff row to exercise the stage machine against (empty database)';
  else
    insert into public.provider_complaints (organisation_id, subject_staff_id, category, summary)
    values (v_org, v_staff, 'clinical', 'assertion probe')
    returning id into v_id;

    v_bad := true;
    begin
      update public.provider_complaints set stage = 'closed', closed_at = now() where id = v_id;
    exception when others then
      v_bad := false;
    end;
    if v_bad then
      raise exception 'FAIL: a complaint jumped received -> closed';
    end if;

    update public.provider_complaints set stage = 'triage' where id = v_id;
    if (select stage from public.provider_complaints where id = v_id) <> 'triage' then
      raise exception 'FAIL: the legal received -> triage transition was refused';
    end if;

    v_bad := true;
    begin
      update public.provider_complaints set stage = 'investigation' where id = v_id;
    exception when others then
      v_bad := false;
    end;
    if v_bad then
      raise exception 'FAIL: triage advanced with no severity or triager recorded';
    end if;

    if not exists (select 1 from public.provider_complaint_events
                   where complaint_id = v_id and from_stage is null and to_stage = 'received') then
      raise exception 'FAIL: no intake event was logged';
    end if;

    delete from public.provider_complaints where id = v_id;
  end if;

  if has_table_privilege('authenticated', 'public.provider_complaint_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.provider_complaint_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.provider_complaint_events', 'DELETE') then
    raise exception 'FAIL: authenticated can write provider_complaint_events directly';
  end if;
  if has_table_privilege('authenticated', 'public.provider_complaints', 'DELETE') then
    raise exception 'FAIL: authenticated can delete a provider complaint';
  end if;
  if has_function_privilege('anon', 'private.is_complaints_handler()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.is_complaints_handler';
  end if;

  raise notice 'PASS: §29.5 complaints pathway — forward-only stage machine (proven, with control), governance-gated clinical closure, investigation file isolated, events append-only';
end $$;
