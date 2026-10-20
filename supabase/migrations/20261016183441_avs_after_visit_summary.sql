-- AVS: clinician-approved, plain-language after-visit summary with a "what happens next" checklist.
-- Design: docs/design/AVS.md. Invariants: INV-02 (signature stamped by the acting clinician), INV-07 (events and notifications carry ids
-- only), INV-10 (staff reads audited), INV-11 (a draft, withdrawn, unsigned-note, amended-pending or unreleased-protected summary never
-- reaches a patient), INV-13 (is_test). No language model: assembly is plain SQL over the signed note and the signed orders of the same
-- encounter. No new AI call site.
--
-- What this adds
--   * visit_summaries (one per signed note), visit_summary_items (the checklist, frozen once approved), visit_summary_item_progress
--     (the patient's tick-off and the optional care_tasks link) and visit_summary_revisions (the record of a superseded approval).
--   * private.visit_summary_state_ok(): the ONE visibility rule, used by RLS and by the patient RPC.
--   * assemble / update / approve / withdraw (clinician), read_visit_summary_for_review (clinician, audited), my_visit_summaries,
--     set_visit_summary_item_done and add_visit_summary_item_to_tasks (patient).
--   * events visit_summary.approved / .withdrawn / .viewed and the templates visit_summary_ready / visit_summary_withdrawn.
-- Access model: every readable table has RLS on and an explicit `grant select ... to authenticated`; the only select policies are the
-- patient's and a caregiver's, both calling the visibility rule. There is NO staff select policy: staff read through the audited
-- function. No table has an insert/update/delete grant; every write goes through a definer function.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.visit_summaries (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  note_id                     uuid not null unique references public.clinical_encounter_notes (id) on delete restrict,
  clinical_encounter_id       uuid references public.clinical_encounters (id) on delete set null,
  state                       text not null default 'draft' check (state in ('draft', 'approved', 'withdrawn')),
  revision                    integer not null default 1 check (revision >= 1),
  summary_text                text not null default '' check (char_length(summary_text) <= 4000),
  draft_source                jsonb not null default '{}'::jsonb check (jsonb_typeof(draft_source) = 'object'),
  assembled_by                uuid references public.profiles (id) on delete set null,
  assembled_at                timestamptz not null default now(),
  edited_at                   timestamptz,
  approved_by                 uuid references public.profiles (id) on delete restrict,
  approved_by_staff           uuid references public.clinical_staff (id) on delete restrict,
  approved_at                 timestamptz,
  amendment_count_at_approval integer check (amendment_count_at_approval is null or amendment_count_at_approval >= 0),
  withdrawn_by                uuid references public.profiles (id) on delete set null,
  withdrawn_at                timestamptz,
  withdrawn_reason            text,
  is_test                     boolean not null default false,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  -- INV-02 style: an approved (or later withdrawn) summary carries the approving clinician and time; a draft carries neither.
  constraint visit_summaries_approved_needs_signature check (
    state = 'draft' or (approved_by is not null and approved_by_staff is not null and approved_at is not null
                        and amendment_count_at_approval is not null)),
  constraint visit_summaries_draft_has_no_signature check (
    state <> 'draft' or (approved_by is null and approved_by_staff is null and approved_at is null
                         and amendment_count_at_approval is null)),
  constraint visit_summaries_withdrawn_needs_reason check (
    state <> 'withdrawn' or (withdrawn_by is not null and withdrawn_at is not null
                             and char_length(btrim(coalesce(withdrawn_reason, ''))) >= 10)),
  constraint visit_summaries_approved_has_text check (state <> 'approved' or char_length(btrim(summary_text)) >= 20)
);
create index visit_summaries_patient_idx on public.visit_summaries (patient_id, created_at desc);
comment on table public.visit_summaries is
  'AVS. One plain-language after-visit summary per signed clinical_encounter_notes row. Written by a clinician after a deterministic draft, '
  'approved by a signature stamped by trigger. Visible to the patient only through private.visit_summary_state_ok().';

create table public.visit_summary_items (
  id            uuid primary key default gen_random_uuid(),
  summary_id    uuid not null references public.visit_summaries (id) on delete restrict,
  position      integer not null default 0,
  kind          text not null check (kind in ('medicine', 'lab', 'referral', 'plan_change', 'recheck', 'follow_up', 'custom')),
  -- Plain values only (drug name, dose, frequency, a plain-language care plan change). The label is rendered by the apps from
  -- packages/i18n; custom_text is a clinician override for one item.
  params        jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  custom_text   text check (custom_text is null or char_length(custom_text) <= 400),
  due_on        date,
  source_table  text check (source_table is null or source_table in ('prescriptions', 'lab_orders', 'specialist_referrals', 'care_plan_changes')),
  source_ref    text,
  created_at    timestamptz not null default now(),
  constraint visit_summary_items_source_pair check ((source_table is null) = (source_ref is null))
);
create unique index visit_summary_items_source_uq on public.visit_summary_items (summary_id, source_table, source_ref) where source_table is not null;
create index visit_summary_items_summary_idx on public.visit_summary_items (summary_id, position);

create table public.visit_summary_item_progress (
  item_id     uuid primary key references public.visit_summary_items (id) on delete cascade,
  summary_id  uuid not null references public.visit_summaries (id) on delete restrict,
  patient_id  uuid not null references public.profiles (id) on delete cascade,
  done_at     timestamptz,
  task_id     uuid references public.care_tasks (id) on delete set null,
  updated_at  timestamptz not null default now()
);
create index visit_summary_item_progress_summary_idx on public.visit_summary_item_progress (summary_id);

-- The record of an approval that was superseded (an amendment made the summary stale, or it was withdrawn and rewritten).
-- No access is intended for anyone but the owner: RLS on, no policy, no grant (deliberate, see header).
create table public.visit_summary_revisions (
  id                uuid primary key default gen_random_uuid(),
  summary_id        uuid not null references public.visit_summaries (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  revision          integer not null,
  state_at_reset    text not null,
  approved_by       uuid references public.profiles (id) on delete set null,
  approved_at       timestamptz,
  summary_text      text not null,
  items_snapshot    jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now()
);

alter table public.visit_summaries enable row level security;
alter table public.visit_summary_items enable row level security;
alter table public.visit_summary_item_progress enable row level security;
alter table public.visit_summary_revisions enable row level security;
-- authenticated is revoked too: the project's default privileges (alter default privileges ... to authenticated) hand every new table
-- full DML, and only a revoke here leaves the select grant below as the whole surface. Writes go through the definer functions only.
revoke all on public.visit_summaries, public.visit_summary_items, public.visit_summary_item_progress, public.visit_summary_revisions from public, anon, authenticated;
grant select on public.visit_summaries, public.visit_summary_items, public.visit_summary_item_progress to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The visibility rule (INV-11). One function; RLS and the RPC both call it.
-- ---------------------------------------------------------------------------
-- Amendments of a note, including an amendment of an amendment (create_note_amendment accepts any signed note as the original).
create function private.visit_summary_amend_counts(p_note uuid) returns table (finalized integer, pending integer)
language sql stable security definer set search_path = ''
as $$
  with recursive chain as (
    select a.id, a.status from public.clinical_encounter_notes a where a.amends_note_id = p_note
    union
    select a.id, a.status from public.clinical_encounter_notes a join chain c on a.amends_note_id = c.id
  )
  select count(*) filter (where status = 'finalized')::integer, count(*) filter (where status <> 'finalized')::integer from chain;
$$;
revoke all on function private.visit_summary_amend_counts(uuid) from public, anon;
grant execute on function private.visit_summary_amend_counts(uuid) to authenticated;

-- A checklist step is shown only while the record it was copied from is still in force: a cancelled prescription, a declined or
-- expired care plan change, a cancelled or finished lab order and a closed referral drop out of what the patient sees.
create function private.visit_summary_item_source_ok(p_table text, p_ref text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case p_table
    when 'prescriptions' then exists (select 1 from public.prescriptions p where p.id::text = split_part(p_ref, ':', 1)
                                       and p.state::text in ('signed', 'sent', 'dispensed'))
    when 'care_plan_changes' then exists (select 1 from public.care_plan_changes c where c.id::text = p_ref and c.state in ('signed', 'confirmed'))
    when 'lab_orders' then exists (select 1 from public.lab_orders o where o.id::text = p_ref and o.status::text not in ('cancelled', 'resulted'))
    when 'specialist_referrals' then exists (select 1 from public.specialist_referrals r where r.id::text = p_ref
                                              and r.status::text not in ('declined', 'completed', 'closed', 'draft'))
    else true   -- a step the doctor wrote by hand has no source to go stale
  end;
$$;
revoke all on function private.visit_summary_item_source_ok(text, text) from public, anon;
grant execute on function private.visit_summary_item_source_ok(text, text) to authenticated;

create function private.visit_summary_state_ok(p_summary uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.visit_summaries s
      join public.clinical_encounter_notes n on n.id = s.note_id
     where s.id = p_summary
       and s.state = 'approved'
       and n.status = 'finalized'
       and n.patient_id = s.patient_id
       -- withdrawn as entered in error: the summary goes with it
       and not exists (select 1 from public.note_error_flags f where f.note_id = n.id)
       -- an amendment hides the summary: while one is still a draft, and after it is signed until the summary is approved again
       and (select ac.pending from private.visit_summary_amend_counts(n.id) ac) = 0
       and s.amendment_count_at_approval = (select ac.finalized from private.visit_summary_amend_counts(n.id) ac)
       -- a protected note (reproductive health and similar) shows only once the note's OWN release has been decided
       and (not n.is_protected
            or exists (select 1 from public.note_releases r where r.note_id = n.id and r.state = 'released'))
  );
$$;
revoke all on function private.visit_summary_state_ok(uuid) from public, anon;
grant execute on function private.visit_summary_state_ok(uuid) to authenticated;

-- A caregiver never sees the summary of a protected note, whatever has been released to the patient.
create function private.visit_summary_caregiver_ok(p_summary uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.visit_summary_state_ok(p_summary)
     and not exists (select 1 from public.visit_summaries s join public.clinical_encounter_notes n on n.id = s.note_id
                      where s.id = p_summary and n.is_protected);
$$;
revoke all on function private.visit_summary_caregiver_ok(uuid) from public, anon;
grant execute on function private.visit_summary_caregiver_ok(uuid) to authenticated;

create policy visit_summaries_patient_select on public.visit_summaries for select to authenticated
  using (patient_id = (select auth.uid()) and private.visit_summary_state_ok(id));
-- A summary names medicines and tests, so a caregiver needs the care plan, medication and results permissions together.
create function private.visit_summary_caregiver_may(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_read_clinical(p_patient, 'view_care_plan'::public.caregiver_permission)
     and private.can_read_clinical(p_patient, 'view_medication'::public.caregiver_permission)
     and private.can_read_clinical(p_patient, 'view_results'::public.caregiver_permission);
$$;
revoke all on function private.visit_summary_caregiver_may(uuid) from public, anon;
grant execute on function private.visit_summary_caregiver_may(uuid) to authenticated;

create policy visit_summaries_caregiver_select on public.visit_summaries for select to authenticated
  using (patient_id <> (select auth.uid()) and private.visit_summary_caregiver_ok(id)
         and private.visit_summary_caregiver_may(patient_id));

create policy visit_summary_items_patient_select on public.visit_summary_items for select to authenticated
  using (private.visit_summary_item_source_ok(source_table, source_ref)
         and exists (select 1 from public.visit_summaries s where s.id = summary_id and s.patient_id = (select auth.uid())
                      and private.visit_summary_state_ok(s.id)));
create policy visit_summary_items_caregiver_select on public.visit_summary_items for select to authenticated
  using (private.visit_summary_item_source_ok(source_table, source_ref)
         and exists (select 1 from public.visit_summaries s where s.id = summary_id and s.patient_id <> (select auth.uid())
                      and private.visit_summary_caregiver_ok(s.id) and private.visit_summary_caregiver_may(s.patient_id)));

create policy visit_summary_item_progress_patient_select on public.visit_summary_item_progress for select to authenticated
  using (patient_id = (select auth.uid()) and private.visit_summary_state_ok(summary_id));

-- ---------------------------------------------------------------------------
-- 3. Plain-language copy lint (database floor; the review panel shows more advice client side)
-- ---------------------------------------------------------------------------
create function private.visit_summary_copy_problems(p_text text) returns text[]
language sql immutable set search_path = ''
as $$
  select array_remove(array[
    case when p_text ~ '[—–]' then 'dash' end,
    case when p_text ~* '\mwarning\M' then 'warning' end,
    case when p_text ~* '\myour doctor\M' then 'your_doctor' end,
    case when p_text ~* '\mcures?d?\M' then 'cure_claim' end,
    case when p_text ~* 'instant doctor' then 'instant_doctor' end,
    case when p_text ~* 'free healthcare' then 'free_healthcare' end
  ], null);
$$;
revoke all on function private.visit_summary_copy_problems(text) from public, anon;
grant execute on function private.visit_summary_copy_problems(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Guards: signature stamp, legal state moves, frozen content
-- ---------------------------------------------------------------------------
create function private.visit_summaries_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_staff uuid;
  v_tier text;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.state := 'draft';
    new.approved_by := null; new.approved_by_staff := null; new.approved_at := null; new.amendment_count_at_approval := null;
    new.withdrawn_by := null; new.withdrawn_at := null; new.withdrawn_reason := null;
    return new;
  end if;

  if new.note_id is distinct from old.note_id or new.patient_id is distinct from old.patient_id
     or new.organisation_id is distinct from old.organisation_id then
    raise exception 'a visit summary cannot move to another note or patient' using errcode = '42501';
  end if;

  if old.state = 'draft' and new.state = 'draft' then
    -- the signature can never be written on a draft
    new.approved_by := null; new.approved_by_staff := null; new.approved_at := null; new.amendment_count_at_approval := null;
    new.edited_at := now();
    return new;
  end if;

  if old.state = 'draft' and new.state = 'approved' then
    select id, doctor_tier::text into v_staff, v_tier from public.clinical_staff where profile_id = v_uid and active limit 1;
    if v_uid is null or v_staff is null or v_tier not in ('senior_medical_officer', 'chief_medical_officer') then
      raise exception 'only a doctor can approve a visit summary' using errcode = '42501';
    end if;
    new.approved_by := v_uid;                      -- forge-proof: the caller cannot supply these
    new.approved_by_staff := v_staff;
    new.approved_at := now();
    new.amendment_count_at_approval := (select ac.finalized from private.visit_summary_amend_counts(old.note_id) ac);
    new.withdrawn_by := null; new.withdrawn_at := null; new.withdrawn_reason := null;
    return new;
  end if;

  if old.state = 'approved' and new.state = 'approved' then
    if new.summary_text is distinct from old.summary_text or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at or new.approved_by_staff is distinct from old.approved_by_staff
       or new.amendment_count_at_approval is distinct from old.amendment_count_at_approval or new.revision is distinct from old.revision then
      raise exception 'an approved visit summary is frozen: write a new revision instead' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.state = 'approved' and new.state = 'withdrawn' then
    select id into v_staff from public.clinical_staff where profile_id = v_uid and active limit 1;
    if v_uid is null or v_staff is null then raise exception 'only a doctor can withdraw a visit summary' using errcode = '42501'; end if;
    new.summary_text := old.summary_text; new.approved_by := old.approved_by; new.approved_by_staff := old.approved_by_staff;
    new.approved_at := old.approved_at; new.amendment_count_at_approval := old.amendment_count_at_approval;
    new.withdrawn_by := v_uid; new.withdrawn_at := now();
    return new;
  end if;

  if old.state in ('approved', 'withdrawn') and new.state = 'draft' then
    -- the one way back: the function sets this flag after it has stored the superseded approval
    if coalesce(current_setting('avs.allow_reset', true), '') <> 'on' then
      raise exception 'an approved or withdrawn visit summary can only be reopened through assemble_visit_summary' using errcode = '42501';
    end if;
    new.approved_by := null; new.approved_by_staff := null; new.approved_at := null; new.amendment_count_at_approval := null;
    new.withdrawn_by := null; new.withdrawn_at := null; new.withdrawn_reason := null;
    new.revision := old.revision + 1;
    new.edited_at := now();
    return new;
  end if;

  if old.state = 'withdrawn' and new.state = 'withdrawn' then
    if new.summary_text is distinct from old.summary_text or new.withdrawn_reason is distinct from old.withdrawn_reason then
      raise exception 'a withdrawn visit summary is frozen' using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'illegal visit summary state change % to %', old.state, new.state using errcode = '42501';
end;
$$;
revoke all on function private.visit_summaries_guard() from public, anon, authenticated;
create trigger visit_summaries_guard before insert or update on public.visit_summaries
  for each row execute function private.visit_summaries_guard();

create function private.visit_summary_items_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_state text; v_sid uuid := case when tg_op = 'DELETE' then old.summary_id else new.summary_id end;
begin
  select state into v_state from public.visit_summaries where id = v_sid;
  if v_state is distinct from 'draft' then
    raise exception 'the checklist of an approved visit summary is frozen' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and new.summary_id is distinct from old.summary_id then
    raise exception 'an item cannot move to another summary' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.visit_summary_items_guard() from public, anon, authenticated;
create trigger visit_summary_items_guard before insert or update or delete on public.visit_summary_items
  for each row execute function private.visit_summary_items_guard();

-- ---------------------------------------------------------------------------
-- 5. Events and templates (ids only, INV-07)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('visit_summary.approved', 'A doctor approved an after-visit summary', 'AVS', false),
  ('visit_summary.withdrawn', 'A doctor withdrew an approved after-visit summary', 'AVS', false),
  ('visit_summary.viewed', 'A patient or caregiver opened an after-visit summary', 'AVS', false);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('visit_summary.approved', 1, array['summary_id', 'note_id']),
  ('visit_summary.withdrawn', 1, array['summary_id', 'note_id']),
  ('visit_summary.viewed', 1, array['summary_id', 'note_id']);

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('visit_summary_ready', 'operational', 'routine', 'patient', array['in_app','push']::public.notification_channel[], 'immediate', 'A summary of your visit is ready to read.'),
  ('visit_summary_withdrawn', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate', 'A summary was taken back; the app says why.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('visit_summary_ready', 'en', 'in_app', 'Your visit summary is ready', 'Your care team has written a summary of your visit. Open the app to read it.'),
  ('visit_summary_ready', 'en', 'push', 'Your visit summary is ready', 'Open the app to read it.'),
  ('visit_summary_withdrawn', 'en', 'in_app', 'About your visit summary', 'Your care team took back a summary. Open the app to see why.')
on conflict (template_key, locale, channel) do nothing;

create function private.avs_emit(p_type text, p_summary uuid, p_dedupe text) returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.visit_summaries%rowtype;
begin
  select * into s from public.visit_summaries where id = p_summary;
  perform private.emit_domain_event(p_type, s.organisation_id, jsonb_build_object('summary_id', s.id, 'note_id', s.note_id),
    p_dedupe, s.patient_id, 'visit_summary', s.id);
exception when others then
  -- an event must never block care; the failure is recorded
  insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
  values (s.organisation_id, 'visit_summary_event.error', 'visit_summary', s.id, jsonb_build_object('type', p_type, 'error', sqlerrm));
end;
$$;
revoke all on function private.avs_emit(text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Clinician functions
-- ---------------------------------------------------------------------------
-- Who may work on a summary: a doctor (not a care coordinator) who may work on the note.
create function private.avs_assert_doctor(p_note uuid) returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v_patient uuid; v_org uuid; v_tier text;
begin
  v_patient := private.may_work_on_note(p_note);
  select organisation_id into v_org from public.clinical_encounter_notes where id = p_note;
  select doctor_tier::text into v_tier from public.clinical_staff where profile_id = (select auth.uid()) and active limit 1;
  if v_tier is null or v_tier not in ('senior_medical_officer', 'chief_medical_officer') or not private.is_clinical_tier(v_org) then
    raise exception 'only a doctor can work on a visit summary' using errcode = '42501';
  end if;
  return v_patient;
end;
$$;
revoke all on function private.avs_assert_doctor(uuid) from public, anon, authenticated;

create function public.assemble_visit_summary(p_note uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  n public.clinical_encounter_notes%rowtype;
  s public.visit_summaries%rowtype;
  v_patient uuid;
  v_id uuid;
  v_text text;
  v_from timestamptz;
  v_to timestamptz;
  v_pos integer;
  v_amend integer;
  r record;
  v_rx uuid[] := '{}'; v_lab uuid[] := '{}'; v_ref uuid[] := '{}'; v_chg uuid[] := '{}';
begin
  v_patient := private.avs_assert_doctor(p_note);
  select * into n from public.clinical_encounter_notes where id = p_note;
  if n.status <> 'finalized' then raise exception 'visit_summary_note_unsigned' using errcode = 'P0001'; end if;
  if exists (select 1 from public.note_error_flags where note_id = p_note) then
    raise exception 'visit_summary_note_withdrawn' using errcode = 'P0001';
  end if;
  v_from := n.encounter_date - interval '2 hours';
  v_to := coalesce(n.finalized_at, now()) + interval '2 hours';
  select ac.finalized into v_amend from private.visit_summary_amend_counts(p_note) ac;

  select * into s from public.visit_summaries where note_id = p_note for update;
  if found then
    if s.state = 'approved' and s.amendment_count_at_approval = v_amend
       and (select ac.pending from private.visit_summary_amend_counts(p_note) ac) = 0 then
      raise exception 'visit_summary_already_approved' using errcode = 'P0001';
    end if;
    if s.state in ('approved', 'withdrawn') then
      insert into public.visit_summary_revisions (summary_id, patient_id, revision, state_at_reset, approved_by, approved_at, summary_text, items_snapshot)
      select s.id, s.patient_id, s.revision, s.state, s.approved_by, s.approved_at, s.summary_text,
             coalesce((select jsonb_agg(to_jsonb(i) order by i.position) from public.visit_summary_items i where i.summary_id = s.id), '[]'::jsonb);
      perform set_config('avs.allow_reset', 'on', true);
      update public.visit_summaries set state = 'draft' where id = s.id;
      perform set_config('avs.allow_reset', 'off', true);
    end if;
    v_id := s.id;
  else
    v_text := btrim(concat_ws(E'\n\n', nullif(btrim(coalesce(n.assessment, '')), ''), nullif(btrim(coalesce(n.plan, '')), ''),
                              nullif(btrim(coalesce(n.follow_up_instructions, '')), '')));
    insert into public.visit_summaries (organisation_id, patient_id, note_id, clinical_encounter_id, summary_text, assembled_by, is_test)
    values (n.organisation_id, n.patient_id, n.id, n.clinical_encounter_id, left(coalesce(v_text, ''), 4000), (select auth.uid()), n.is_test)
    returning id into v_id;
  end if;

  select coalesce(max(position), 0) into v_pos from public.visit_summary_items where summary_id = v_id;

  -- Signed prescriptions linked to this note: one "take as prescribed" item per drug item.
  for r in
    select p.id, e.item, e.ord
      from public.prescriptions p, jsonb_array_elements(p.items) with ordinality as e(item, ord)
     where p.encounter_note_id = p_note and p.state in ('signed', 'sent', 'dispensed') and p.signed_by is not null
  loop
    v_rx := v_rx || r.id;
    v_pos := v_pos + 1;
    insert into public.visit_summary_items (summary_id, position, kind, params, source_table, source_ref)
    values (v_id, v_pos, 'medicine',
            jsonb_strip_nulls(jsonb_build_object('drug_name', r.item ->> 'drug_name', 'dose', r.item ->> 'dose', 'frequency', r.item ->> 'frequency')),
            'prescriptions', r.id::text || ':' || r.ord)
    on conflict do nothing;
  end loop;

  -- Lab orders and referrals by the note's author for this patient in the encounter window (no direct link exists: OQ-AVS-2).
  for r in
    select o.id from public.lab_orders o
     where o.patient_id = n.patient_id and o.ordered_by = n.authored_by_staff and o.created_at between v_from and v_to
       and o.status::text not in ('cancelled', 'resulted')
  loop
    v_lab := v_lab || r.id;
    v_pos := v_pos + 1;
    insert into public.visit_summary_items (summary_id, position, kind, source_table, source_ref)
    values (v_id, v_pos, 'lab', 'lab_orders', r.id::text) on conflict do nothing;
  end loop;

  for r in
    select sr.id from public.specialist_referrals sr
     where sr.patient_id = n.patient_id and sr.referred_by = n.authored_by_staff and sr.created_at between v_from and v_to
       and sr.status::text not in ('declined', 'completed', 'closed', 'draft')
  loop
    v_ref := v_ref || r.id;
    v_pos := v_pos + 1;
    insert into public.visit_summary_items (summary_id, position, kind, source_table, source_ref)
    values (v_id, v_pos, 'referral', 'specialist_referrals', r.id::text) on conflict do nothing;
  end loop;

  -- Signed care plan changes by the note's author in the window. Their own patient_summary is the plain-language text.
  for r in
    select c.id, c.kind, c.patient_summary from public.care_plan_changes c
     where c.patient_id = n.patient_id and c.signed_by = n.authored_by_profile
       and c.state in ('signed', 'confirmed') and c.signed_at between v_from and v_to
  loop
    v_chg := v_chg || r.id;
    v_pos := v_pos + 1;
    insert into public.visit_summary_items (summary_id, position, kind, params, source_table, source_ref)
    values (v_id, v_pos, 'plan_change', jsonb_strip_nulls(jsonb_build_object('change_kind', r.kind, 'summary', r.patient_summary)),
            'care_plan_changes', r.id::text) on conflict do nothing;
  end loop;

  update public.visit_summaries
     set draft_source = jsonb_build_object('prescription_ids', to_jsonb(v_rx), 'lab_order_ids', to_jsonb(v_lab),
                                           'referral_ids', to_jsonb(v_ref), 'care_plan_change_ids', to_jsonb(v_chg),
                                           'window_from', v_from, 'window_to', v_to, 'amendments_seen', v_amend)
   where id = v_id;
  perform private.audit_chart_read(v_patient, array['notes'], 'assemble visit summary', 'success');
  return v_id;
end;
$$;

create function public.update_visit_summary_draft(p_summary uuid, p_text text, p_items jsonb default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.visit_summaries%rowtype;
  v_item jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_pos integer := 0;
  v_kind text;
begin
  select * into s from public.visit_summaries where id = p_summary for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  perform private.avs_assert_doctor(s.note_id);
  if s.state <> 'draft' then raise exception 'visit_summary_not_a_draft' using errcode = 'P0001'; end if;
  if p_text is not null then
    if char_length(p_text) > 4000 then raise exception 'visit_summary_text_too_long' using errcode = '22023'; end if;
    update public.visit_summaries set summary_text = btrim(p_text) where id = p_summary;
  end if;
  if p_items is not null then
    if jsonb_typeof(p_items) <> 'array' then raise exception 'items must be an array' using errcode = '22023'; end if;
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_pos := v_pos + 1;
      v_kind := v_item ->> 'kind';
      if v_kind is null or v_kind not in ('medicine', 'lab', 'referral', 'plan_change', 'recheck', 'follow_up', 'custom') then
        raise exception 'unknown checklist kind' using errcode = '22023';
      end if;
      if coalesce(jsonb_typeof(v_item -> 'params'), 'object') <> 'object' then raise exception 'params must be an object' using errcode = '22023'; end if;
      if char_length(coalesce(v_item ->> 'custom_text', '')) > 400 then raise exception 'checklist text is too long' using errcode = '22023'; end if;
      if nullif(v_item ->> 'id', '') is not null then
        v_id := (v_item ->> 'id')::uuid;
        -- a step whose meaning changed starts unticked: an old tick must not carry onto new wording or a new date
        delete from public.visit_summary_item_progress pr
         using public.visit_summary_items o
         where pr.item_id = v_id and o.id = v_id and o.summary_id = p_summary
           and (o.kind is distinct from v_kind or o.params is distinct from coalesce(v_item -> 'params', o.params)
                or o.custom_text is distinct from nullif(btrim(coalesce(v_item ->> 'custom_text', '')), '')
                or o.due_on is distinct from nullif(v_item ->> 'due_on', '')::date);
        update public.visit_summary_items
           set position = v_pos, kind = v_kind, params = coalesce(v_item -> 'params', params),
               custom_text = nullif(btrim(coalesce(v_item ->> 'custom_text', '')), ''), due_on = nullif(v_item ->> 'due_on', '')::date
         where id = v_id and summary_id = p_summary;
        if not found then raise exception 'unknown checklist item' using errcode = 'P0002'; end if;
      else
        insert into public.visit_summary_items (summary_id, position, kind, params, custom_text, due_on)
        values (p_summary, v_pos, v_kind, coalesce(v_item -> 'params', '{}'::jsonb),
                nullif(btrim(coalesce(v_item ->> 'custom_text', '')), ''), nullif(v_item ->> 'due_on', '')::date)
        returning id into v_id;
      end if;
      v_ids := v_ids || v_id;
    end loop;
    delete from public.visit_summary_items where summary_id = p_summary and not (id = any(v_ids));
  end if;
end;
$$;

-- Review read: one place a doctor sees the draft or the approved text. Audited (INV-10).
create function public.read_visit_summary_for_review(p_note uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_patient uuid := private.avs_assert_doctor(p_note);
  s public.visit_summaries%rowtype;
  n public.clinical_encounter_notes%rowtype;
  v_amend integer;
begin
  perform private.audit_chart_read(v_patient, array['notes'], 'review visit summary', 'success');
  select * into n from public.clinical_encounter_notes where id = p_note;
  select ac.finalized into v_amend from private.visit_summary_amend_counts(p_note) ac;
  select * into s from public.visit_summaries where note_id = p_note;
  if not found then
    return jsonb_build_object('summary', null, 'note_signed', n.status = 'finalized', 'note_protected', n.is_protected);
  end if;
  return jsonb_build_object(
    'note_signed', n.status = 'finalized', 'note_protected', n.is_protected,
    'stale', (s.state = 'approved' and (s.amendment_count_at_approval is distinct from v_amend
              or (select ac.pending from private.visit_summary_amend_counts(p_note) ac) > 0)),
    'patient_can_see', private.visit_summary_state_ok(s.id),
    'summary', jsonb_build_object('id', s.id, 'state', s.state, 'revision', s.revision, 'summary_text', s.summary_text,
        'approved_at', s.approved_at, 'approved_by_name', (select cs.full_name from public.clinical_staff cs where cs.id = s.approved_by_staff),
        'withdrawn_at', s.withdrawn_at, 'withdrawn_reason', s.withdrawn_reason, 'draft_source', s.draft_source),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'params', i.params, 'custom_text', i.custom_text,
                        'due_on', i.due_on, 'source_table', i.source_table,
                        'source_ok', private.visit_summary_item_source_ok(i.source_table, i.source_ref)) order by i.position)
                         from public.visit_summary_items i where i.summary_id = s.id), '[]'::jsonb));
end;
$$;

create function public.approve_visit_summary(p_summary uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.visit_summaries%rowtype;
  n public.clinical_encounter_notes%rowtype;
  v_problems text[];
  v_patient uuid;
begin
  select * into s from public.visit_summaries where id = p_summary for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  v_patient := private.avs_assert_doctor(s.note_id);
  if s.state <> 'draft' then raise exception 'visit_summary_not_a_draft' using errcode = 'P0001'; end if;
  select * into n from public.clinical_encounter_notes where id = s.note_id;
  if n.status <> 'finalized' then raise exception 'visit_summary_note_unsigned' using errcode = 'P0001'; end if;
  if exists (select 1 from public.note_error_flags where note_id = s.note_id) then raise exception 'visit_summary_note_withdrawn' using errcode = 'P0001'; end if;
  if char_length(btrim(s.summary_text)) < 20 then raise exception 'visit_summary_text_needed' using errcode = '22023'; end if;
  v_problems := private.visit_summary_copy_problems(s.summary_text);
  select v_problems || coalesce(array_agg(distinct p), '{}') into v_problems
    from public.visit_summary_items i, unnest(private.visit_summary_copy_problems(coalesce(i.custom_text, '') || ' ' || i.params::text)) p
   where i.summary_id = s.id;
  if coalesce(array_length(v_problems, 1), 0) > 0 then
    raise exception 'visit_summary_copy_rules' using errcode = '22023', detail = array_to_string(v_problems, ',');
  end if;

  update public.visit_summaries set state = 'approved' where id = s.id;   -- the guard stamps the signature

  perform private.audit_chart_read(v_patient, array['notes'], 'approve visit summary', 'success');
  perform private.avs_emit('visit_summary.approved', s.id, 'visit_summary.approved:' || s.id || ':' || s.revision);
  if private.visit_summary_state_ok(s.id) then
    perform private.written_care_notify(s.patient_id, s.organisation_id, 'visit_summary_ready', jsonb_build_object('summary_id', s.id));
  end if;
end;
$$;

create function public.withdraw_visit_summary(p_summary uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.visit_summaries%rowtype; v_patient uuid; v_was_visible boolean;
begin
  select * into s from public.visit_summaries where id = p_summary for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  v_patient := private.avs_assert_doctor(s.note_id);
  if s.state <> 'approved' then raise exception 'only an approved summary can be withdrawn' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'visit_summary_reason_needed' using errcode = '22023'; end if;
  v_was_visible := private.visit_summary_state_ok(s.id);
  update public.visit_summaries set state = 'withdrawn', withdrawn_reason = btrim(p_reason) where id = s.id;
  perform private.audit_chart_read(v_patient, array['notes'], 'withdraw visit summary', 'success');
  perform private.avs_emit('visit_summary.withdrawn', s.id, 'visit_summary.withdrawn:' || s.id || ':' || s.revision);
  if v_was_visible then
    perform private.written_care_notify(s.patient_id, s.organisation_id, 'visit_summary_withdrawn', jsonb_build_object('summary_id', s.id));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Patient (and caregiver) functions
-- ---------------------------------------------------------------------------
-- A pure read: no audit row and no event, so a refresh or a tick never writes anything. Opening is recorded separately below.
create function public.my_visit_summaries(p_patient uuid default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_target uuid := coalesce(p_patient, (select auth.uid()));
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if v_target <> v_uid and not private.visit_summary_caregiver_may(v_target) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', s.id, 'note_id', s.note_id, 'revision', s.revision, 'summary_text', s.summary_text, 'approved_at', s.approved_at,
        'approved_by_name', (select cs.full_name from public.clinical_staff cs where cs.id = s.approved_by_staff),
        'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'params', i.params, 'custom_text', i.custom_text,
                             'due_on', i.due_on, 'done_at', pr.done_at, 'task_id', pr.task_id) order by i.position)
                             from public.visit_summary_items i left join public.visit_summary_item_progress pr on pr.item_id = i.id
                            where i.summary_id = s.id and private.visit_summary_item_source_ok(i.source_table, i.source_ref)), '[]'::jsonb)
      ) order by s.approved_at desc)
      from public.visit_summaries s
     where s.patient_id = v_target and private.visit_summary_state_ok(s.id)
       and (v_target = v_uid or private.visit_summary_caregiver_ok(s.id))), '[]'::jsonb);
end;
$$;

-- Called once when a person opens a summary. Audited (INV-10 spirit for a patient read) and emitted at most once a day per
-- viewer and summary, so cache refreshes never pile up rows in the append-only log.
create function public.record_visit_summary_opened(p_summary uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  s public.visit_summaries%rowtype;
begin
  select * into s from public.visit_summaries where id = p_summary;
  if v_uid is null or not found or not private.visit_summary_state_ok(s.id)
     or not (s.patient_id = v_uid or (private.visit_summary_caregiver_ok(s.id) and private.visit_summary_caregiver_may(s.patient_id))) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.audit_log where action = 'visit_summary.patient_read' and actor_id = v_uid and entity_id = s.id
                    and created_at >= date_trunc('day', now())) then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
    values (s.organisation_id, v_uid, 'visit_summary.patient_read', 'visit_summary', s.id, jsonb_build_object('revision', s.revision), s.patient_id);
  end if;
  perform private.avs_emit('visit_summary.viewed', s.id, 'visit_summary.viewed:' || s.id || ':' || v_uid || ':' || current_date);
end;
$$;

create function public.set_visit_summary_item_done(p_item uuid, p_done boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  i public.visit_summary_items%rowtype;
  s public.visit_summaries%rowtype;
  v_task uuid;
begin
  select * into i from public.visit_summary_items where id = p_item;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  select * into s from public.visit_summaries where id = i.summary_id;
  if v_uid is null or s.patient_id <> v_uid or not private.visit_summary_state_ok(s.id) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  insert into public.visit_summary_item_progress (item_id, summary_id, patient_id, done_at)
  values (i.id, s.id, s.patient_id, case when p_done then now() end)
  on conflict (item_id) do update set done_at = excluded.done_at, updated_at = now()
  returning task_id into v_task;
  if v_task is not null then
    update public.care_tasks
       set status = case when p_done then 'completed'::public.care_task_status else 'not_started'::public.care_task_status end
     where id = v_task and patient_id = v_uid and status not in ('cancelled');
  end if;
end;
$$;

create function public.add_visit_summary_item_to_tasks(p_item uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  i public.visit_summary_items%rowtype;
  s public.visit_summaries%rowtype;
  v_task uuid;
  v_title text;
begin
  select * into i from public.visit_summary_items where id = p_item;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  select * into s from public.visit_summaries where id = i.summary_id;
  if v_uid is null or s.patient_id <> v_uid or not private.visit_summary_state_ok(s.id) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  select task_id into v_task from public.visit_summary_item_progress where item_id = i.id;
  if v_task is not null then return v_task; end if;   -- already a task: idempotent
  v_title := case i.kind
    when 'medicine' then 'Follow your medicine plan'
    when 'lab' then 'Get your tests done'
    when 'referral' then 'Book the specialist visit'
    when 'plan_change' then 'Read your updated care plan'
    when 'recheck' then 'Do your check at home'
    when 'follow_up' then 'Follow-up from your visit'
    else 'From your visit summary' end;
  insert into public.care_tasks (organisation_id, patient_id, title, owner_role, due_at, source)
  values (s.organisation_id, s.patient_id, v_title, 'patient',
          case when i.due_on is not null then (i.due_on::timestamp + time '09:00') at time zone 'Africa/Lagos' end, 'visit_summary')
  returning id into v_task;
  insert into public.visit_summary_item_progress (item_id, summary_id, patient_id, task_id)
  values (i.id, s.id, s.patient_id, v_task)
  on conflict (item_id) do update set task_id = excluded.task_id, updated_at = now();
  -- a step already ticked must not leave an open task behind (the overdue engine would chase the patient for it)
  if exists (select 1 from public.visit_summary_item_progress where item_id = i.id and done_at is not null) then
    update public.care_tasks set status = 'completed'::public.care_task_status where id = v_task;
  end if;
  return v_task;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants: public API to signed-in users only (revoke from PUBLIC, which is where anon inherits execute)
-- ---------------------------------------------------------------------------
revoke all on function public.assemble_visit_summary(uuid) from public, anon;
revoke all on function public.update_visit_summary_draft(uuid, text, jsonb) from public, anon;
revoke all on function public.read_visit_summary_for_review(uuid) from public, anon;
revoke all on function public.approve_visit_summary(uuid) from public, anon;
revoke all on function public.withdraw_visit_summary(uuid, text) from public, anon;
revoke all on function public.my_visit_summaries(uuid) from public, anon;
revoke all on function public.record_visit_summary_opened(uuid) from public, anon;
revoke all on function public.set_visit_summary_item_done(uuid, boolean) from public, anon;
revoke all on function public.add_visit_summary_item_to_tasks(uuid) from public, anon;
grant execute on function public.assemble_visit_summary(uuid) to authenticated;
grant execute on function public.update_visit_summary_draft(uuid, text, jsonb) to authenticated;
grant execute on function public.read_visit_summary_for_review(uuid) to authenticated;
grant execute on function public.approve_visit_summary(uuid) to authenticated;
grant execute on function public.withdraw_visit_summary(uuid, text) to authenticated;
grant execute on function public.my_visit_summaries(uuid) to authenticated;
grant execute on function public.record_visit_summary_opened(uuid) to authenticated;
grant execute on function public.set_visit_summary_item_done(uuid, boolean) to authenticated;
grant execute on function public.add_visit_summary_item_to_tasks(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8b. Data registry (S39d): retention class, export and purge. Reviewed stays false until the CMO and DPO confirm the class.
-- ---------------------------------------------------------------------------
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes) values
  ('visit_summaries', 'patient_id', 'clinical_record', 'review', true, 'AVS. PROPOSED class, to be confirmed by the CMO and DPO.'),
  ('visit_summary_item_progress', 'patient_id', 'clinical_record', 'review', true, 'AVS. PROPOSED class, to be confirmed by the CMO and DPO.'),
  ('visit_summary_items', '(select s.patient_id from public.visit_summaries s where s.id = t.summary_id)', 'clinical_record', 'review', true,
   'AVS. Checklist steps of a summary. PROPOSED class, to be confirmed by the CMO and DPO.'),
  ('visit_summary_revisions', 'patient_id', 'clinical_record', 'review', true, 'AVS. Superseded approvals kept as a record. PROPOSED class, to be confirmed by the CMO and DPO.')
on conflict (table_name) do nothing;

-- ---------------------------------------------------------------------------
-- 9. Closing assertions
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.assemble_visit_summary(uuid)', 'public.update_visit_summary_draft(uuid,text,jsonb)', 'public.read_visit_summary_for_review(uuid)',
    'public.approve_visit_summary(uuid)', 'public.withdraw_visit_summary(uuid,text)', 'public.my_visit_summaries(uuid)',
    'public.record_visit_summary_opened(uuid)', 'public.set_visit_summary_item_done(uuid,boolean)', 'public.add_visit_summary_item_to_tasks(uuid)',
    'private.visit_summary_amend_counts(uuid)', 'private.visit_summary_item_source_ok(text,text)', 'private.visit_summary_caregiver_may(uuid)',
    'private.visit_summary_state_ok(uuid)', 'private.visit_summary_caregiver_ok(uuid)', 'private.visit_summary_copy_problems(text)',
    'private.avs_emit(text,uuid,text)', 'private.avs_assert_doctor(uuid)', 'private.visit_summaries_guard()', 'private.visit_summary_items_guard()'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'AVS: anon can execute %', f; end if;
  end loop;
  if has_table_privilege('anon', 'public.visit_summaries', 'SELECT') or has_table_privilege('anon', 'public.visit_summary_items', 'SELECT')
     or has_table_privilege('anon', 'public.visit_summary_item_progress', 'SELECT') then
    raise exception 'AVS: anon can read a visit summary table';
  end if;
  if not has_table_privilege('authenticated', 'public.visit_summaries', 'SELECT')
     or not has_table_privilege('authenticated', 'public.visit_summary_items', 'SELECT')
     or not has_table_privilege('authenticated', 'public.visit_summary_item_progress', 'SELECT') then
    raise exception 'AVS: authenticated lacks its select grant (reads would silently return nothing)';
  end if;
  if has_table_privilege('authenticated', 'public.visit_summaries', 'INSERT')
     or has_table_privilege('authenticated', 'public.visit_summaries', 'UPDATE')
     or has_table_privilege('authenticated', 'public.visit_summaries', 'DELETE')
     or has_table_privilege('authenticated', 'public.visit_summary_items', 'INSERT')
     or has_table_privilege('authenticated', 'public.visit_summary_items', 'UPDATE')
     or has_table_privilege('authenticated', 'public.visit_summary_item_progress', 'INSERT')
     or has_table_privilege('authenticated', 'public.visit_summary_item_progress', 'UPDATE') then
    raise exception 'AVS: a client can write a visit summary table directly';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'visit_summaries' and cmd <> 'SELECT') then
    raise exception 'AVS: unexpected write policy on visit_summaries';
  end if;
  if (select count(*) from public.event_types where event_type like 'visit_summary.%') <> 3 then raise exception 'AVS: event types missing'; end if;
  raise notice 'AVS migration assertions passed';
end $$;
