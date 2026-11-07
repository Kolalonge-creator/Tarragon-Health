-- Customer Support Dashboard, phase B: who may work the support desk (SUP-2, docs/design/SUPPORT-DASHBOARD.md).
--
-- A support agent is a permission, never an account role (CLAUDE.md: never re-split profiles.role). Two keys:
--   support.agent   work the desk: see the shared support queues, reply, add internal notes, assign to self, hand off.
--   support.manage  the support lead: everything an agent does, plus reassign anyone's work, bulk assign, and edit the
--                   desk's operational settings (SLA targets, business hours, holidays, reply templates).
-- support.manage was seeded by 20260718230000 and carried by the "Customer support administrator" preset, but nothing
-- checked it until now. Its label and description are updated to say what it now gates.
--
-- private.is_support_staff() is the one gate the desk's own tables, view and RPCs use. It admits:
--   * the super admin;
--   * an active Care Coordinator, because MSG-2/MSG-3 already make the coordinator the first owner of the support queue;
--   * a clinician holding support.agent or support.manage.
-- A key on any other account role (analyst, finance) does not open the desk: the support tables it works over are
-- org-staff tables those roles cannot read, so the gate would open onto an empty queue (review finding, 2026-11-07).
-- It deliberately does NOT admit a clinician by role: doctors keep their existing pages, and support work is not
-- clinical work. A clinician who also works the desk can be granted support.agent.
--
-- What this does not change: the underlying support tables keep their existing RLS (private.is_org_staff and the
-- patient's own rows). The desk is a workspace over them; it does not widen anyone's access to them. Clinical tables
-- are untouched: holding a support key grants no clinical read (proved in
-- packages/db/tests/sup_support_desk_permissions_and_work_items.sql).

insert into public.permissions (key, label, category, description) values
  ('support.agent', 'Support agent', 'Operations',
   'Work the support desk: the shared support queues, customer replies, internal notes, assigning work to yourself and '
   'handing work to Finance, Technical Operations or Provider Operations. Never grants clinical record access, refund '
   'approval, payment changes or provider verification.')
on conflict (key) do update set label = excluded.label, description = excluded.description;

update public.permissions
   set label = 'Support lead',
       description = 'Lead the support desk: everything a support agent does, plus reassigning anyone''s work, bulk '
                     'assignment, and the desk''s operational settings (SLA targets, business hours, public holidays, '
                     'reply templates). Never grants clinical record access.'
 where key = 'support.manage';

create or replace function private.is_support_lead()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select private.has_permission('support.manage')
     and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'care_coordinator', 'clinician'));
$$;

create or replace function private.is_support_staff()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  -- Key holders must sit on a staff account that can reach the desk and its org-staff tables (coordinator or clinician);
  -- the super admin holds every key. A key on an analyst or finance account would open a gate onto an empty queue.
  select private.is_admin()
      or (
        exists (
          select 1 from public.profiles p
           where p.id = (select auth.uid()) and p.is_active
             and (p.role = 'care_coordinator'
                  or (p.role = 'clinician' and (private.has_permission('support.agent') or private.has_permission('support.manage'))))
        )
        and private.mfa_requirement_met()
      );
$$;

comment on function private.is_support_staff() is
  'Support desk gate (SUP-2): the super admin, an active Care Coordinator, or a clinician holding support.agent or support.manage. Never a clinician by role alone.';
comment on function private.is_support_lead() is
  'Support lead gate (SUP-2): support.manage. Reassignment, bulk assignment and desk settings.';

revoke all on function private.is_support_staff() from public, anon;
revoke all on function private.is_support_lead() from public, anon;
grant execute on function private.is_support_staff() to authenticated;
grant execute on function private.is_support_lead() to authenticated;

-- A ready-made bundle for a dedicated support agent, next to the existing lead preset. Base role care_coordinator, the
-- same as the lead preset: the support queues are org-staff tables and the coordinator is their first owner (MSG-2).
do $$
declare
  v_role_id uuid;
begin
  insert into public.custom_roles (name, base_role, description)
  values ('Customer support agent', 'care_coordinator'::public.user_role,
          'Works the support desk: queues, customer replies, internal notes and hand-offs. No clinical judgement, no refunds, no payment changes.')
  on conflict (name) do update set description = excluded.description
  returning id into v_role_id;

  insert into public.role_permissions (custom_role_id, permission_key)
  values (v_role_id, 'support.agent')
  on conflict (custom_role_id, permission_key) do nothing;
end $$;

do $$
begin
  if not exists (select 1 from public.permissions where key = 'support.agent') then
    raise exception 'support.agent permission missing';
  end if;
  if not exists (
    select 1 from public.role_permissions rp join public.custom_roles cr on cr.id = rp.custom_role_id
     where cr.name = 'Customer support agent' and rp.permission_key = 'support.agent'
  ) then
    raise exception 'Customer support agent preset does not carry support.agent';
  end if;
  if has_function_privilege('anon', 'private.is_support_staff()', 'EXECUTE')
     or has_function_privilege('anon', 'private.is_support_lead()', 'EXECUTE') then
    raise exception 'support desk gates must not be executable by anon';
  end if;
end $$;
