-- S36d: clinician roster for operations and the clinical lead, and the role-grants history view.
--
-- Built ONLY over S15 (20261006013217_s15_clinician_credentialing.sql). Reused as they are: private.credential_is_cmo(),
-- private.can_credential_review(), private.suspend_clinician_internal(), private.clinician_is_eligible(), private.indemnity_required(),
-- public.grant_clinician_competency(), public.reinstate_clinician(), private.credential_audit(). Nothing in S15 is changed.
--
-- Why new functions exist at all:
--   * S15's own doors (suspend_clinician, reinstate_clinician, grant_clinician_competency) admit only an admin account or the active
--     chief medical officer. Operations in this platform is a DELEGATED permission (clinical_staff.manage), so an ops user holding it
--     could neither look at the roster nor suspend anyone. The functions below give that permission a read door and a reasoned suspend
--     door, and give it a REQUEST door for the two things spec 9.4 reserves to the clinical lead (competency grant, reinstatement).
--   * Only the active CMO decides a request (public.decide_clinician_change), and the decision runs through the existing S15 function,
--     so every S15 rule (level needed for a competency, renewed licence and indemnity before reinstatement) still applies.
--   * Role-grants history: public.permission_grants_history() for an admin or a holder of users.permissions.grant.
--
-- Open points written down (docs/OPEN-QUESTIONS.md OQ-220..OQ-224): the S15 reinstate door still admits an admin account; grants have
-- no expiry column; the history reads user_permission_grants plus the audit rows the members actions write.

-- ---------------------------------------------------------------------------
-- 1. Requests table. Written only by the functions below.
-- ---------------------------------------------------------------------------
create table public.clinician_change_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id uuid not null references public.clinical_staff (id) on delete cascade,
  kind              text not null check (kind in ('competency_grant', 'reinstatement')),
  competency_code   text references public.competencies (code),
  reason            text not null check (length(btrim(reason)) >= 10),
  requested_by      uuid not null references public.profiles (id) on delete restrict,
  requested_at      timestamptz not null default now(),
  state             text not null default 'pending' check (state in ('pending', 'approved', 'declined')),
  decided_by        uuid references public.profiles (id) on delete restrict,
  decided_at        timestamptz,
  decision_note     text,
  is_test           boolean not null default false,
  check ((kind = 'competency_grant') = (competency_code is not null)),
  check ((state = 'pending') = (decided_at is null))
);
create unique index clinician_change_requests_one_pending
  on public.clinician_change_requests (clinical_staff_id, kind, coalesce(competency_code, '')) where state = 'pending';
create index clinician_change_requests_state_idx on public.clinician_change_requests (state, requested_at desc);

alter table public.clinician_change_requests enable row level security;
revoke all on public.clinician_change_requests from anon;
revoke insert, update, delete, truncate on public.clinician_change_requests from authenticated;
grant select on public.clinician_change_requests to authenticated;

create function private.can_view_clinician_roster() returns boolean
language sql stable security definer set search_path = ''
as $$ select private.can_credential_review() or private.has_permission('clinical_staff.manage'); $$;
revoke all on function private.can_view_clinician_roster() from public, anon, authenticated;
grant execute on function private.can_view_clinician_roster() to authenticated;

create policy clinician_change_requests_select on public.clinician_change_requests
  for select to authenticated using (private.can_view_clinician_roster());

-- ---------------------------------------------------------------------------
-- 2. The roster (read). One audit-free read of working facts; no contact details, documents or application text.
-- ---------------------------------------------------------------------------
create function public.clinician_roster()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid;
begin
  if not private.can_view_clinician_roster() then raise exception 'not allowed' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = auth.uid();
  return (select coalesce(jsonb_agg(x order by (x ->> 'full_name')), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', cs.id, 'full_name', cs.full_name, 'doctor_tier', cs.doctor_tier, 'employment_type', cs.employment_type,
      'status', cs.status, 'active', cs.active, 'level', cs.credentialing_level,
      'suspended_at', cs.suspended_at, 'suspended_reason', cs.suspended_reason,
      'license_expires_at', cs.license_expires_at, 'indemnity_expires_at', cs.indemnity_expires_at,
      'indemnity_required', coalesce(private.indemnity_required(cs.id), false),
      'eligible', case when cs.profile_id is null then false else private.clinician_is_eligible(cs.profile_id) end,
      'is_self', cs.profile_id is not distinct from auth.uid(),
      'competencies', (select coalesce(jsonb_agg(cc.competency_code order by cc.competency_code), '[]'::jsonb)
                       from public.clinician_competencies cc where cc.clinical_staff_id = cs.id and cc.revoked_at is null),
      'pending_requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'competency_code', r.competency_code,
                             'reason', r.reason, 'requested_at', r.requested_at, 'requested_by_name', (select full_name from public.profiles where id = r.requested_by),
                             'requested_by_me', r.requested_by = auth.uid()) order by r.requested_at), '[]'::jsonb)
                           from public.clinician_change_requests r where r.clinical_staff_id = cs.id and r.state = 'pending')
    ) as x
    from public.clinical_staff cs
    where cs.status <> 'offboarded' and (v_org is null or cs.organisation_id = v_org)
  ) q);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Ops door: suspend, with a reason, audited. Same effect as S15's suspend (it calls S15's own internal function).
-- ---------------------------------------------------------------------------
create function public.ops_suspend_clinician(p_staff uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype;
begin
  if not private.can_view_clinician_roster() then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'give a reason of at least 10 characters' using errcode = '23514'; end if;
  select * into s from public.clinical_staff where id = p_staff;
  if not found then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  if s.profile_id is not distinct from auth.uid() then raise exception 'you cannot suspend yourself' using errcode = '42501'; end if;
  if s.status <> 'active' then raise exception 'only an active clinician can be suspended' using errcode = '23514'; end if;
  perform private.suspend_clinician_internal(p_staff, btrim(p_reason), auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Ops door: ask the clinical lead for a competency grant or a reinstatement.
-- ---------------------------------------------------------------------------
create function public.request_clinician_change(p_staff uuid, p_kind text, p_competency text, p_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype; v_id uuid;
begin
  if not private.can_view_clinician_roster() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind not in ('competency_grant', 'reinstatement') then raise exception 'unknown request kind' using errcode = '23514'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'give a reason of at least 10 characters' using errcode = '23514'; end if;
  select * into s from public.clinical_staff where id = p_staff;
  if not found then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  if s.profile_id is not distinct from auth.uid() then raise exception 'you cannot make a request about yourself' using errcode = '42501'; end if;
  if p_kind = 'competency_grant' then
    if p_competency is null or not exists (select 1 from public.competencies where code = p_competency and is_active) then
      raise exception 'unknown competency' using errcode = 'P0002'; end if;
    if exists (select 1 from public.clinician_competencies where clinical_staff_id = p_staff and competency_code = p_competency and revoked_at is null) then
      raise exception 'that competency is already held' using errcode = '23514'; end if;
  else
    if s.status <> 'suspended' then raise exception 'only a suspended clinician can be reinstated' using errcode = '23514'; end if;
    p_competency := null;
  end if;
  begin
    insert into public.clinician_change_requests (organisation_id, clinical_staff_id, kind, competency_code, reason, requested_by, is_test)
      values (s.organisation_id, p_staff, p_kind, p_competency, btrim(p_reason), auth.uid(), s.is_test) returning id into v_id;
  exception when unique_violation then
    raise exception 'that request is already waiting for the clinical lead' using errcode = '23505';
  end;
  perform private.credential_audit(s.organisation_id, auth.uid(), 'clinician_change.requested', 'clinical_staff', s.id,
    jsonb_build_object('request_id', v_id, 'kind', p_kind, 'code', p_competency, 'reason', btrim(p_reason)));
  perform private.credential_notify_reviewers(s.organisation_id, 'A clinician change needs your decision',
    s.full_name || ': ' || case when p_kind = 'reinstatement' then 'reinstatement' else 'competency ' || p_competency end || ' was requested.',
    jsonb_build_object('clinical_staff_id', s.id, 'request_id', v_id));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. CMO door: decide a request. Approval runs the existing S15 function as the CMO (so its level and renewal rules apply).
-- ---------------------------------------------------------------------------
create function public.decide_clinician_change(p_request uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.clinician_change_requests%rowtype;
begin
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can decide this' using errcode = '42501'; end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'give a reason of at least 10 characters' using errcode = '23514'; end if;
  select * into r from public.clinician_change_requests where id = p_request for update;
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
  if r.state <> 'pending' then raise exception 'that request was already decided' using errcode = '23514'; end if;
  if r.requested_by = auth.uid() then raise exception 'someone else must decide your request' using errcode = '42501'; end if;
  if p_approve then
    if r.kind = 'competency_grant' then
      perform public.grant_clinician_competency(r.clinical_staff_id, r.competency_code);
    else
      perform public.reinstate_clinician(r.clinical_staff_id, coalesce(nullif(btrim(p_note), ''), 'Approved on request: ' || r.reason));
    end if;
  end if;
  update public.clinician_change_requests
    set state = case when p_approve then 'approved' else 'declined' end, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
    where id = p_request;
  perform private.credential_audit(r.organisation_id, auth.uid(), case when p_approve then 'clinician_change.approved' else 'clinician_change.declined' end,
    'clinical_staff', r.clinical_staff_id, jsonb_build_object('request_id', r.id, 'kind', r.kind, 'code', r.competency_code, 'note', nullif(btrim(p_note), '')));
  perform private.credential_notify(r.requested_by, r.organisation_id, 'Your clinician request was decided',
    case when p_approve then 'The clinical lead approved your request.' else 'The clinical lead declined your request.' end,
    jsonb_build_object('request_id', r.id), false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Role-grants history (read only). Admin or users.permissions.grant.
--    current  = every active direct grant and every custom-role bundle holder (who holds which key, now)
--    history  = every grant and revoke row, newest first
--    audit    = the permission.* audit rows the members actions write
-- ---------------------------------------------------------------------------
create function public.permission_grants_history(p_limit integer default 300)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 300), 1), 1000);
begin
  if not (private.is_admin() or private.has_permission('users.permissions.grant')) then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'current', (select coalesce(jsonb_agg(x order by (x ->> 'permission_key'), (x ->> 'holder_name')), '[]'::jsonb) from (
      select jsonb_build_object('permission_key', g.permission_key, 'permission_label', pm.label, 'source', 'direct', 'holder_id', g.profile_id,
        'holder_name', hp.full_name, 'holder_role', hp.role, 'holder_active', hp.is_active, 'granted_at', g.granted_at,
        'granted_by_name', (select full_name from public.profiles where id = g.granted_by), 'expires_at', null) as x
      from public.user_permission_grants g join public.permissions pm on pm.key = g.permission_key join public.profiles hp on hp.id = g.profile_id
      where g.revoked_at is null
      union all
      select jsonb_build_object('permission_key', rp.permission_key, 'permission_label', pm.label, 'source', 'role:' || cr.name, 'holder_id', hp.id,
        'holder_name', hp.full_name, 'holder_role', hp.role, 'holder_active', hp.is_active, 'granted_at', null, 'granted_by_name', null, 'expires_at', null)
      from public.profiles hp join public.custom_roles cr on cr.id = hp.custom_role_id
        join public.role_permissions rp on rp.custom_role_id = cr.id join public.permissions pm on pm.key = rp.permission_key
    ) c),
    'history', (select coalesce(jsonb_agg(h), '[]'::jsonb) from (
      select jsonb_build_object('id', g.id, 'permission_key', g.permission_key, 'holder_id', g.profile_id, 'holder_name', hp.full_name, 'granted_at', g.granted_at,
        'granted_by_name', (select full_name from public.profiles where id = g.granted_by), 'revoked_at', g.revoked_at,
        'revoked_by_name', (select full_name from public.profiles where id = g.revoked_by)) as h
      from public.user_permission_grants g join public.profiles hp on hp.id = g.profile_id
      order by greatest(g.granted_at, coalesce(g.revoked_at, g.granted_at)) desc limit v_limit) hh),
    'audit', (select coalesce(jsonb_agg(a), '[]'::jsonb) from (
      select jsonb_build_object('id', al.id, 'action', al.action, 'created_at', al.created_at, 'actor_name', (select full_name from public.profiles where id = al.actor_id),
        'subject_name', (select full_name from public.profiles where id = al.entity_id), 'permission_key', al.event ->> 'permission_key') as a
      from public.audit_log al where al.action like 'permission.%' or al.action like 'member.role%'
      order by al.created_at desc limit v_limit) aa)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants and self-check
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['clinician_roster()', 'ops_suspend_clinician(uuid, text)', 'request_clinician_change(uuid, text, text, text)',
    'decide_clinician_change(uuid, boolean, text)', 'permission_grants_history(integer)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

do $$
declare f record;
begin
  if has_table_privilege('anon', 'public.clinician_change_requests', 'SELECT') then raise exception 'S36d self-check: anon can read requests'; end if;
  if has_table_privilege('authenticated', 'public.clinician_change_requests', 'INSERT') or has_table_privilege('authenticated', 'public.clinician_change_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.clinician_change_requests', 'DELETE') then raise exception 'S36d self-check: authenticated can write requests directly'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.clinician_change_requests'::regclass) then raise exception 'S36d self-check: RLS is off'; end if;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('clinician_roster', 'ops_suspend_clinician', 'request_clinician_change', 'decide_clinician_change', 'permission_grants_history') loop
    if has_function_privilege('anon', f.sig, 'EXECUTE') then raise exception 'S36d self-check: anon can execute %', f.sig; end if;
  end loop;
end $$;
