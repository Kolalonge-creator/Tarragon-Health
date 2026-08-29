-- Tarragon Health — Specialist Care Coordination & Continuity Engine, part 5/7
-- specialist_referral_action_items — one auditable row per accepted
-- specialist recommendation, immediately routed to whichever existing
-- engine owns that kind of work (spec §70.4/§70.6: "structured
-- recommendations could create tasks", "every recommendation needs an
-- owner").
--
-- Deliberately NOT a new parallel worklist or a new status lifecycle —
-- same "never rebuild X as a parallel record" discipline CLAUDE.md states
-- for the Annual Health Review, and the same routing shape
-- consultation_follow_ups already established for the internal-encounter
-- case (20260828000005): this table is the immutable bridge, not the place
-- work gets tracked or resolved. Two destinations, decided by action_type:
--   * repeat_test / investigation / follow_up_appointment / other — Care
--     Coordinator logistics (book, chase, remind) -> a real row on the
--     existing care_outreach_tasks worklist a coordinator already checks
--     daily, trigger_type='specialist_action_pending'.
--   * medication_review / care_plan_review — a clinical decision (only a
--     doctor may change a care plan or start/adjust a medication, per
--     CLAUDE.md) -> the existing care_plan_review_prompts doctor worklist,
--     trigger_event_type='specialist_recommendation'. This NEVER writes
--     care_plans directly.
--
-- Because routing happens at INSERT time (not a later "action" click),
-- "resolved" is never tracked here — it is read live off whichever
-- downstream row this item links to (care_outreach_tasks.status /
-- care_plan_review_prompts.status). No dual source of truth, same
-- "wearable metrics vs vitals_readings" reasoning already documented in
-- CLAUDE.md. Referral closure (part 7 of this series) reads that same join.
--
-- Creating an item requires clinical tier — interpreting a specialist's
-- recommendation into a specific, owned task is itself a clinical judgment,
-- even for the logistics-shaped ones, same posture as
-- consultation_follow_ups' own INSERT gate.

create table if not exists public.specialist_referral_action_items (
  id                            uuid primary key default gen_random_uuid(),
  organisation_id               uuid not null references public.organisations (id) on delete restrict,
  patient_id                    uuid not null references public.profiles (id) on delete cascade,
  referral_id                   uuid not null references public.specialist_referrals (id) on delete cascade,
  -- Nullable: most items come from a confirmed AI extraction, but a
  -- clinician may also add one by hand (e.g. from a phone call with the
  -- specialist, no document at all).
  extraction_id                 uuid references public.specialist_consultation_extractions (id) on delete set null,

  action_type                   public.specialist_referral_action_item_type not null,
  description                   text not null check (length(btrim(description)) > 0),
  due_at                        timestamptz,

  created_by_staff              uuid references public.clinical_staff (id) on delete restrict,

  linked_outreach_task_id       uuid references public.care_outreach_tasks (id) on delete set null,
  linked_care_plan_review_prompt_id uuid references public.care_plan_review_prompts (id) on delete set null,

  created_at                    timestamptz not null default now(),

  -- Exactly one destination, matching which bucket action_type falls into —
  -- the routing trigger below is what actually sets these, this constraint
  -- is the provable guarantee that routing always happened.
  constraint specialist_referral_action_items_routed check (
    (action_type in ('repeat_test', 'investigation', 'follow_up_appointment', 'other')
      and linked_outreach_task_id is not null and linked_care_plan_review_prompt_id is null)
    or
    (action_type in ('medication_review', 'care_plan_review')
      and linked_care_plan_review_prompt_id is not null and linked_outreach_task_id is null)
  )
);

comment on table public.specialist_referral_action_items is
  'Spec §70.4/§70.6 — one immutable row per accepted specialist recommendation, routed at creation to care_outreach_tasks (logistics) or care_plan_review_prompts (clinical decision). Resolution status is read live off the linked row, never duplicated here.';

create index specialist_referral_action_items_referral_idx
  on public.specialist_referral_action_items (referral_id);
create index specialist_referral_action_items_patient_idx
  on public.specialist_referral_action_items (patient_id, created_at desc);
create index specialist_referral_action_items_org_idx
  on public.specialist_referral_action_items (organisation_id);

alter table public.specialist_referral_action_items enable row level security;

create policy specialist_referral_action_items_select on public.specialist_referral_action_items
  for select to authenticated using (private.is_org_staff(organisation_id));

-- Broad here, narrowed by the write trigger below — same "RLS admits, the
-- trigger narrows" shape as clinical_encounter_notes/consultation_follow_ups.
create policy specialist_referral_action_items_insert on public.specialist_referral_action_items
  for insert to authenticated with check (private.is_org_staff(organisation_id));

-- No UPDATE/DELETE policy: an item is written once, fully routed, and never
-- edited afterward — same "retained, not resolved" posture as
-- clinical_encounter_notes. Correcting a mistaken item means resolving the
-- downstream task/prompt as not-needed through its own existing UI, not
-- editing history here.
grant select, insert on public.specialist_referral_action_items to authenticated;
revoke update, delete on public.specialist_referral_action_items from authenticated;

-- ---------------------------------------------------------------------------
-- Forge-proof write + routing trigger.
-- ---------------------------------------------------------------------------
create or replace function private.route_specialist_referral_action_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referral   public.specialist_referrals%rowtype;
  v_staff_id   uuid;
  v_prompt_id  uuid;
  v_task_id    uuid;
  v_priority   smallint;
begin
  select * into v_referral from public.specialist_referrals where id = new.referral_id;
  if v_referral.id is null then
    raise exception 'Referral not found' using errcode = '23503';
  end if;

  -- Never trust client-supplied scope: always the referral's own.
  new.organisation_id := v_referral.organisation_id;
  new.patient_id := v_referral.patient_id;

  if not private.is_clinical_tier(v_referral.organisation_id) then
    raise exception 'Only a clinical-tier member of the care team can turn a specialist recommendation into a tracked action.'
      using errcode = '42501';
  end if;

  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = v_referral.organisation_id
    and active
  limit 1;
  new.created_by_staff := v_staff_id;

  -- Immutable from here: an item is written once, fully routed.
  new.linked_outreach_task_id := null;
  new.linked_care_plan_review_prompt_id := null;

  if new.action_type in ('medication_review', 'care_plan_review') then
    perform private.enqueue_care_plan_review_prompt(
      v_referral.organisation_id,
      v_referral.patient_id,
      'specialist_recommendation',
      new.referral_id,
      format('Specialist recommendation (%s referral %s): %s',
        v_referral.specialist_type, v_referral.referral_number, new.description)
    );
    select id into v_prompt_id
    from public.care_plan_review_prompts
    where patient_id = v_referral.patient_id
      and trigger_event_type = 'specialist_recommendation'
      and status = 'open'
    order by created_at desc
    limit 1;
    new.linked_care_plan_review_prompt_id := v_prompt_id;
  else
    v_priority := case when v_referral.urgency = 'urgent' then 1 else 2 end;
    insert into public.care_outreach_tasks
      (organisation_id, patient_id, trigger_type, trigger_detail, priority)
    values (
      v_referral.organisation_id, v_referral.patient_id, 'specialist_action_pending',
      jsonb_build_object(
        'referral_id', new.referral_id,
        'referral_number', v_referral.referral_number,
        'specialist_type', v_referral.specialist_type,
        'action_type', new.action_type::text,
        'description', new.description,
        'due_at', new.due_at
      ),
      v_priority
    )
    on conflict (patient_id, trigger_type) where status in ('open', 'in_progress', 'contacted')
      do update set trigger_detail = public.care_outreach_tasks.trigger_detail || excluded.trigger_detail
    returning id into v_task_id;
    new.linked_outreach_task_id := v_task_id;
  end if;

  return new;
end;
$$;

comment on function private.route_specialist_referral_action_item() is
  'BEFORE INSERT on specialist_referral_action_items. Derives organisation_id/patient_id from the referral (never client-supplied), requires clinical tier, and routes the item to care_outreach_tasks (logistics action_types) or care_plan_review_prompts (clinical action_types), stamping the link column the ROUTED check constraint requires.';

drop trigger if exists specialist_referral_action_items_route on public.specialist_referral_action_items;
create trigger specialist_referral_action_items_route
  before insert on public.specialist_referral_action_items
  for each row execute function private.route_specialist_referral_action_item();

revoke all on function private.route_specialist_referral_action_item() from public;

do $$
begin
  if not has_table_privilege('authenticated', 'public.specialist_referral_action_items', 'SELECT') then
    raise exception 'specialist_referral_action_items: authenticated SELECT grant did not take';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'specialist_referral_action_items' and cmd in ('UPDATE', 'DELETE')
  ) then
    raise exception 'specialist_referral_action_items must have no UPDATE/DELETE policy — items are immutable once routed';
  end if;
end $$;
