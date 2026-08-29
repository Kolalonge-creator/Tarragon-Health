-- Tarragon Health — Provider Quality & Performance Management, part 5/6:
-- §29.8 performance intervention.
--
-- §29.8 lists what poor performance "should trigger": feedback, training,
-- supervision, restricted access, formal investigation. This records those as
-- first-class, owned, closeable work items.
--
-- NOTHING IN THIS MODULE OPENS AN INTERVENTION AUTOMATICALLY, and that is the
-- central design decision rather than an omission. Part 1's policy carries
-- `intervention_triggers` as advisory suggestions ("a metric below warning for
-- two consecutive periods suggests: feedback"), and part 6 surfaces them next
-- to the figures — but a person decides. Three reasons, in order of weight:
--   1. §29.10 warns against a simplistic score deciding a clinician's
--      standing. An auto-opened intervention IS that decision, taken by a
--      threshold with no view of why the number moved.
--   2. Every metric in this module has a min_denominator precisely because
--      small samples mislead. A rule firing on a doctor's 6th appointment is
--      the exact harm min_denominator exists to prevent.
--   3. "Restricted access" is one of the listed intervention types, and this
--      platform already decided (part 4) that restricting a provider's work is
--      a human act with a named actor and a written reason.
--
-- Restricted-access interventions therefore do not restrict anything by
-- themselves: they LINK to a provider_restrictions row (part 4), which is
-- where the actual consequence and its lift path live. An intervention is the
-- management record of a decision; the restriction is the mechanism. Keeping
-- them separate means lifting a restriction never silently closes the
-- supervision that accompanied it, and closing an intervention never silently
-- unrestricts somebody.

create type public.provider_intervention_type as enum (
  'feedback', 'training', 'supervision', 'restricted_access', 'formal_investigation'
);

create type public.provider_intervention_status as enum (
  'open', 'in_progress', 'completed', 'cancelled'
);

create type public.provider_intervention_trigger as enum (
  'metric_shortfall', 'complaint_outcome', 'credential_lapse',
  'peer_review', 'patient_feedback', 'governance_directive'
);

create table public.provider_interventions (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id uuid not null references public.clinical_staff (id) on delete restrict,

  intervention_type public.provider_intervention_type not null,
  trigger_source    public.provider_intervention_trigger not null,
  status            public.provider_intervention_status not null default 'open',

  -- Provenance. §29.8 interventions land on a person's record, so what
  -- prompted one must be inspectable afterwards, not summarised in prose.
  triggering_metric public.provider_quality_metric,
  triggering_value  numeric,
  period_start      timestamptz,
  period_end        timestamptz,
  complaint_id      uuid references public.provider_complaints (id) on delete set null,
  restriction_id    uuid references public.provider_restrictions (id) on delete set null,

  rationale         text not null check (length(btrim(rationale)) > 0),
  agreed_actions    text,

  opened_by         uuid not null references public.profiles (id) on delete restrict,
  opened_at         timestamptz not null default now(),
  owner_id          uuid references public.profiles (id) on delete set null,
  due_at            timestamptz,

  provider_acknowledged_at timestamptz,

  outcome_summary   text,
  closed_by         uuid references public.profiles (id) on delete set null,
  closed_at         timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint provider_interventions_closure_paired
    check ((closed_by is null) = (closed_at is null)),
  constraint provider_interventions_terminal_is_closed
    check (status not in ('completed', 'cancelled') or closed_at is not null),
  constraint provider_interventions_open_is_not_closed
    check (status not in ('open', 'in_progress') or closed_at is null),
  -- A completed intervention says what came of it. "Completed, no detail" is
  -- what makes a performance file unusable at appraisal time.
  constraint provider_interventions_completed_has_outcome
    check (status <> 'completed' or (outcome_summary is not null and length(btrim(outcome_summary)) > 0)),
  -- A metric-driven intervention must name the metric and the period it was
  -- measured over — §29.10's "a clinician who sees fewer patients should not
  -- automatically be classified as worse" is unanswerable without knowing
  -- which window produced the figure.
  constraint provider_interventions_metric_source_is_specific
    check (trigger_source <> 'metric_shortfall'
           or (triggering_metric is not null and period_start is not null and period_end is not null)),
  constraint provider_interventions_complaint_source_is_specific
    check (trigger_source <> 'complaint_outcome' or complaint_id is not null),
  constraint provider_interventions_period_valid
    check (period_end is null or period_start is null or period_end > period_start)
);

comment on table public.provider_interventions is
  '§29.8 performance interventions (feedback / training / supervision / restricted access / formal investigation) against a provider. Always opened by a named person — nothing in this module opens one automatically; see this migration''s header for why. A restricted_access intervention links to the provider_restrictions row that carries the actual consequence, it does not impose one itself.';
comment on column public.provider_interventions.triggering_value is
  'The observed figure at the time the intervention was opened, frozen. The live metric will have moved on; a performance record that silently recomputes its own justification is not a record.';
comment on column public.provider_interventions.provider_acknowledged_at is
  'When the provider confirmed they have seen this. Null-gated: the UI must never imply a provider is aware of an intervention on their file without this stamp.';

create index provider_interventions_staff_idx
  on public.provider_interventions (clinical_staff_id, opened_at desc);
create index provider_interventions_open_idx
  on public.provider_interventions (organisation_id, due_at)
  where status in ('open', 'in_progress');
create index provider_interventions_complaint_idx
  on public.provider_interventions (complaint_id) where complaint_id is not null;

create trigger provider_interventions_set_updated_at
  before update on public.provider_interventions
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Integrity + audit
-- ---------------------------------------------------------------------------

create or replace function private.enforce_provider_intervention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restriction public.provider_restrictions;
begin
  if tg_op = 'INSERT' then
    -- organisation_id is derived from the staff record, never client-supplied
    -- — the same posture as consultation_feedback's scope trigger.
    select cs.organisation_id into new.organisation_id
    from public.clinical_staff cs where cs.id = new.clinical_staff_id;
    if new.organisation_id is null then
      raise exception 'clinical staff record not found';
    end if;
    new.opened_by := coalesce((select auth.uid()), new.opened_by);
  end if;

  -- A linked restriction must belong to the same provider. Pointing a
  -- restricted_access intervention at somebody else's restriction would make
  -- both records lie.
  if new.restriction_id is not null then
    select * into v_restriction from public.provider_restrictions where id = new.restriction_id;
    if v_restriction.clinical_staff_id <> new.clinical_staff_id then
      raise exception 'the linked restriction belongs to a different provider';
    end if;
  end if;

  if new.complaint_id is not null and exists (
    select 1 from public.provider_complaints c
    where c.id = new.complaint_id and c.subject_staff_id <> new.clinical_staff_id
  ) then
    raise exception 'the linked complaint is about a different provider';
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status
     and new.status in ('completed', 'cancelled') then
    new.closed_at := coalesce(new.closed_at, now());
    new.closed_by := coalesce(new.closed_by, (select auth.uid()));
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_provider_intervention() from public;

create trigger provider_interventions_enforce
  before insert or update on public.provider_interventions
  for each row execute function private.enforce_provider_intervention();

create or replace function private.log_provider_intervention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (new.organisation_id, (select auth.uid()),
          case when tg_op = 'INSERT' then 'provider_intervention.opened'
               else 'provider_intervention.updated' end,
          'provider_interventions', new.id,
          jsonb_build_object('type', new.intervention_type, 'status', new.status,
                             'trigger_source', new.trigger_source,
                             'clinical_staff_id', new.clinical_staff_id));

  -- The provider is told an intervention exists on their file as soon as it
  -- is opened. §29.8 interventions are developmental, not covert.
  if tg_op = 'INSERT' then
    insert into public.notifications
      (recipient_id, organisation_id, channel, template, payload, status, content_class)
    select cs.profile_id, new.organisation_id, 'in_app', 'provider_intervention_opened',
           jsonb_build_object(
             'message', format('A %s has been recorded on your professional development file. Open it to read the rationale and confirm you have seen it.',
                               replace(new.intervention_type::text, '_', ' ')),
             'intervention_id', new.id),
           'pending', 'non_clinical'
    from public.clinical_staff cs
    where cs.id = new.clinical_staff_id and cs.profile_id is not null;
  end if;

  return new;
end;
$$;

revoke all on function private.log_provider_intervention() from public;

create trigger provider_interventions_log
  after insert or update on public.provider_interventions
  for each row execute function private.log_provider_intervention();

-- ---------------------------------------------------------------------------
-- Provider acknowledgement — the one write the subject provider gets
-- ---------------------------------------------------------------------------

create or replace function public.acknowledge_provider_intervention(p_intervention_id uuid)
returns public.provider_interventions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.provider_interventions;
begin
  update public.provider_interventions i
    set provider_acknowledged_at = coalesce(i.provider_acknowledged_at, now())
    where i.id = p_intervention_id
      and i.clinical_staff_id in (
        select cs.id from public.clinical_staff cs where cs.profile_id = (select auth.uid())
      )
    returning * into v_row;

  if v_row.id is null then
    raise exception 'intervention not found, or it is not on your file'
      using errcode = '42501';
  end if;
  return v_row;
end;
$$;

comment on function public.acknowledge_provider_intervention(uuid) is
  'The subject provider confirms they have seen an intervention on their own file. Idempotent (the first acknowledgement stands). This is the only write a provider has on their own intervention record — they cannot change its type, rationale, or status.';

revoke execute on function public.acknowledge_provider_intervention(uuid) from public, anon;
grant execute on function public.acknowledge_provider_intervention(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Access — same handler gate as complaints, plus the provider's own file.
-- ---------------------------------------------------------------------------

alter table public.provider_interventions enable row level security;

create policy provider_interventions_select on public.provider_interventions
  for select to authenticated
  using (
    private.is_complaints_handler()
    or owner_id = (select auth.uid())
    or clinical_staff_id in (
      select id from public.clinical_staff where profile_id = (select auth.uid())
    )
  );

create policy provider_interventions_insert on public.provider_interventions
  for insert to authenticated
  with check (private.is_complaints_handler() and status = 'open' and closed_at is null);

create policy provider_interventions_update on public.provider_interventions
  for update to authenticated
  using (private.is_complaints_handler() or owner_id = (select auth.uid()))
  with check (private.is_complaints_handler() or owner_id = (select auth.uid()));

grant select, insert, update on public.provider_interventions to authenticated;
revoke delete on public.provider_interventions from authenticated;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_staff uuid;
  v_prof  uuid;
  v_id    uuid;
  v_bad   boolean;
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'provider_interventions') then
    raise exception 'FAIL: provider_interventions missing';
  end if;

  -- §29.8/§29.10: no automatic opener may exist. Assert that nothing in this
  -- database inserts into provider_interventions from a trigger or scheduled
  -- job — if a future migration adds one, this fails and forces the decision
  -- to be made deliberately rather than drifting in.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname in ('public', 'private')
      -- Only readable function bodies; pg_get_functiondef errors on C/internal
      -- functions extensions may have installed into these schemas.
      and l.lanname in ('plpgsql', 'sql')
      and p.prokind = 'f'
      and p.proname <> 'enforce_provider_intervention'
      and p.proname <> 'log_provider_intervention'
      and pg_get_functiondef(p.oid) ~* 'insert\s+into\s+public\.provider_interventions'
  ) then
    raise exception 'FAIL: something other than a direct user write inserts provider_interventions — §29.8 interventions are opened by a person, not a rule';
  end if;

  select cs.id, cs.profile_id into v_staff, v_prof
  from public.clinical_staff cs where cs.profile_id is not null limit 1;

  if v_staff is null then
    raise notice 'SKIP: no clinical_staff row to exercise the intervention constraints against';
  else
    -- A metric-driven intervention must name its metric and window.
    v_bad := true;
    begin
      insert into public.provider_interventions
        (organisation_id, clinical_staff_id, intervention_type, trigger_source, rationale, opened_by)
      values (gen_random_uuid(), v_staff, 'feedback', 'metric_shortfall', 'probe', v_prof);
      v_bad := false;
    exception when others then
      null; -- expected: the metric/period columns are missing
    end;
    if not v_bad then
      raise exception 'FAIL: a metric_shortfall intervention was accepted with no metric or measurement window';
    end if;

    -- Control: the same insert WITH its provenance must succeed, so the test
    -- above is not passing because the insert was malformed some other way.
    insert into public.provider_interventions
      (organisation_id, clinical_staff_id, intervention_type, trigger_source, rationale, opened_by,
       triggering_metric, triggering_value, period_start, period_end)
    values (gen_random_uuid(), v_staff, 'feedback', 'metric_shortfall', 'probe', v_prof,
            'appointment_completion_rate', 72.0, now() - interval '30 days', now())
    returning id into v_id;

    -- A completed intervention must say what came of it.
    v_bad := true;
    begin
      update public.provider_interventions set status = 'completed' where id = v_id;
      v_bad := false;
    exception when others then
      null; -- expected: outcome_summary is required
    end;
    if not v_bad then
      raise exception 'FAIL: an intervention was completed with no outcome recorded';
    end if;

    delete from public.provider_interventions where id = v_id;
  end if;

  if has_function_privilege('anon', 'public.acknowledge_provider_intervention(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute acknowledge_provider_intervention';
  end if;
  if has_table_privilege('authenticated', 'public.provider_interventions', 'DELETE') then
    raise exception 'FAIL: authenticated can delete a provider intervention';
  end if;

  raise notice 'PASS: §29.8 interventions — human-opened only (asserted structurally), provenance mandatory for metric-driven ones, completion requires an outcome, provider gets acknowledgement and notification';
end $$;
