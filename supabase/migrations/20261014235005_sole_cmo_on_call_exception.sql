-- Sole-CMO on-call exception (founder decision 2026-10-15).
--
-- Problem: public.grant_clinician_competency refuses a self grant, so an organisation with exactly ONE Chief Medical Officer can never give
-- that CMO the on_call competency, and the on-call rota (two different people per shift) cannot include the CMO.
-- Fix, as narrow as possible: a documented exception, signed by the CMO, that lets the sole CMO grant THEMSELVES the on_call competency
-- and nothing else, only while they are the organisation's only active CMO, only until it expires (12 months) or is revoked.
-- Every other path in grant_clinician_competency is unchanged. Live definition read with pg_get_functiondef on 2026-10-15 before rewriting.
-- No data conversion: the table is new and empty.

create table public.sole_cmo_exceptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  competency_code text not null check (competency_code = 'on_call'),
  reason text not null check (char_length(btrim(reason)) >= 40),
  signed_by uuid not null references public.profiles(id) on delete restrict,
  signed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete restrict,
  revoke_reason text,
  is_test boolean not null default false,
  constraint sole_cmo_exceptions_expiry_after_signing check (expires_at > signed_at),
  constraint sole_cmo_exceptions_revoke_complete check ((revoked_at is null) = (revoked_by is null) and (revoked_at is null) = (revoke_reason is null))
);
alter table public.sole_cmo_exceptions alter column expires_at set default (now() + interval '12 months');
create unique index sole_cmo_exceptions_one_unrevoked on public.sole_cmo_exceptions (organisation_id, competency_code) where revoked_at is null;

alter table public.sole_cmo_exceptions enable row level security;
revoke all on public.sole_cmo_exceptions from public, anon, authenticated;
grant select on public.sole_cmo_exceptions to authenticated;

-- Number of active, same-class (real or test) Chief Medical Officers in an organisation. Test and real rows never count towards each other.
create function private.sole_cmo_count(p_org uuid, p_is_test boolean) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.clinical_staff
  where organisation_id = p_org and active and status = 'active' and doctor_tier = 'chief_medical_officer' and is_test is not distinct from p_is_test
$$;

-- The id of the exception that is in force for this signer right now, or null. Checked at use, never cached.
create function private.sole_cmo_exception_active(p_org uuid, p_code text, p_signer uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select e.id from public.sole_cmo_exceptions e
  join public.clinical_staff cs on cs.profile_id = p_signer and cs.organisation_id = p_org
  where e.organisation_id = p_org and e.competency_code = p_code and e.signed_by = p_signer
    and e.revoked_at is null and e.expires_at > now()
    and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer'
    and private.sole_cmo_count(p_org, cs.is_test) = 1
  limit 1
$$;

create function private.sole_cmo_exception_can_read(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and organisation_id = p_org and is_active and role = 'admin')
      or exists (select 1 from public.clinical_staff where profile_id = (select auth.uid()) and organisation_id = p_org and active and status = 'active' and doctor_tier = 'chief_medical_officer')
$$;

create policy sole_cmo_exceptions_select on public.sole_cmo_exceptions for select to authenticated
  using (private.sole_cmo_exception_can_read(organisation_id));

create function public.sign_sole_cmo_exception(p_competency text, p_reason text, p_confirm text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cs public.clinical_staff%rowtype; v_id uuid; v_reason text := btrim(coalesce(p_reason, '')); v_exp timestamptz;
begin
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign this exception' using errcode = '42501'; end if;
  select * into cs from public.clinical_staff where profile_id = auth.uid() and active and status = 'active' and doctor_tier = 'chief_medical_officer' limit 1;
  if p_competency is distinct from 'on_call' then raise exception 'this exception only exists for the on_call competency' using errcode = '22023'; end if;
  if upper(btrim(coalesce(p_confirm, ''))) <> 'SIGN' then raise exception 'type SIGN to confirm; nothing was signed' using errcode = '22023'; end if;
  if char_length(v_reason) < 40 then raise exception 'write the reason in at least 40 characters' using errcode = '23514'; end if;
  if private.sole_cmo_count(cs.organisation_id, cs.is_test) <> 1 then
    raise exception 'a second chief medical officer exists, so the normal grant applies and this exception is not available' using errcode = '23514';
  end if;
  -- an exception that ran out is closed here so the one-active-row rule never blocks a fresh signature
  -- a row that ran out, or whose signer is no longer an active CMO, can never work again: close it so it cannot lock the current CMO out
  update public.sole_cmo_exceptions e set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = 'expired or signer no longer an active chief medical officer, replaced by a new signature'
    where e.organisation_id = cs.organisation_id and e.competency_code = p_competency and e.revoked_at is null
      and (e.expires_at <= now() or not exists (select 1 from public.clinical_staff x where x.profile_id = e.signed_by and x.organisation_id = e.organisation_id
            and x.active and x.status = 'active' and x.doctor_tier = 'chief_medical_officer'));
  if exists (select 1 from public.sole_cmo_exceptions where organisation_id = cs.organisation_id and competency_code = p_competency and revoked_at is null) then
    raise exception 'an exception is already in force for this competency' using errcode = '23514';
  end if;
  insert into public.sole_cmo_exceptions (organisation_id, competency_code, reason, signed_by, is_test)
    values (cs.organisation_id, p_competency, v_reason, auth.uid(), cs.is_test) returning id, expires_at into v_id, v_exp;
  perform private.credential_audit(cs.organisation_id, auth.uid(), 'sole_cmo_exception.signed', 'sole_cmo_exception', v_id,
    jsonb_build_object('competency', p_competency, 'expires_at', v_exp, 'confirmed_by_typing', 'SIGN'));
  perform private.credential_notify_reviewers(cs.organisation_id, 'Sole chief medical officer exception signed',
    'The chief medical officer signed a documented exception that lets them grant themselves the on-call competency while they are the only one. It ends on ' || to_char(v_exp at time zone 'Africa/Lagos', 'DD Mon YYYY') || ' or sooner if revoked or a second chief medical officer becomes active, and then needs a new signature. A competency already granted stays until it is removed.',
    jsonb_build_object('kind', 'sole_cmo_exception_signed', 'exception_id', v_id));
  return v_id;
end $$;

create function public.revoke_sole_cmo_exception(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.sole_cmo_exceptions%rowtype; v_org uuid; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not (private.credential_is_cmo() or private.is_admin()) then raise exception 'only the chief medical officer or an admin can revoke this exception' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = auth.uid();
  select * into e from public.sole_cmo_exceptions where id = p_id and organisation_id = v_org;
  if not found then raise exception 'exception not found' using errcode = 'P0002'; end if;
  if char_length(v_reason) < 10 then raise exception 'write the reason in at least 10 characters' using errcode = '23514'; end if;
  if e.revoked_at is not null then raise exception 'this exception is already revoked' using errcode = '23514'; end if;
  update public.sole_cmo_exceptions set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = v_reason where id = e.id;
  perform private.credential_audit(e.organisation_id, auth.uid(), 'sole_cmo_exception.revoked', 'sole_cmo_exception', e.id, jsonb_build_object('competency', e.competency_code));
  perform private.credential_notify_reviewers(e.organisation_id, 'Sole chief medical officer exception revoked',
    'The documented sole chief medical officer exception for the on-call competency was revoked. The chief medical officer can no longer grant themselves that competency. A competency already granted stays until it is removed.',
    jsonb_build_object('kind', 'sole_cmo_exception_revoked', 'exception_id', e.id));
end $$;

revoke all on function private.sole_cmo_count(uuid, boolean) from public, anon, authenticated;
revoke all on function private.sole_cmo_exception_active(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.sole_cmo_exception_can_read(uuid) from public, anon;
grant execute on function private.sole_cmo_exception_can_read(uuid) to authenticated;
revoke all on function public.sign_sole_cmo_exception(text, text, text) from public, anon;
revoke all on function public.revoke_sole_cmo_exception(uuid, text) from public, anon;
grant execute on function public.sign_sole_cmo_exception(text, text, text) to authenticated;
grant execute on function public.revoke_sole_cmo_exception(uuid, text) to authenticated;

-- A second active CMO ENDS the exception (it is revoked, not merely paused): if the organisation later drops back to one CMO it needs a fresh signature.
create function private.sole_cmo_exception_end_on_second_cmo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.doctor_tier = 'chief_medical_officer' and new.active and new.status = 'active'
     and private.sole_cmo_count(new.organisation_id, new.is_test) > 1 then
    for r in
      with u as (
        update public.sole_cmo_exceptions set revoked_at = now(), revoked_by = signed_by,
          revoke_reason = 'a second chief medical officer became active, so the exception ended'
        where organisation_id = new.organisation_id and revoked_at is null and is_test is not distinct from new.is_test
        returning id, organisation_id)
      select * from u
    loop
      perform private.credential_audit(r.organisation_id, auth.uid(), 'sole_cmo_exception.ended_second_cmo', 'sole_cmo_exception', r.id, jsonb_build_object('clinical_staff_id', new.id));
      perform private.credential_notify_reviewers(r.organisation_id, 'Sole chief medical officer exception ended',
        'A second chief medical officer became active, so the documented sole chief medical officer exception ended. A competency already granted stays until it is removed.',
        jsonb_build_object('kind', 'sole_cmo_exception_ended', 'exception_id', r.id));
    end loop;
  end if;
  return null;
end $$;
revoke all on function private.sole_cmo_exception_end_on_second_cmo() from public, anon, authenticated;
create trigger sole_cmo_exception_end_on_second_cmo after insert or update of active, status, doctor_tier, is_test on public.clinical_staff
  for each row execute function private.sole_cmo_exception_end_on_second_cmo();

-- grant_clinician_competency: identical to the live definition except the self-grant refusal now has one documented way through.
create or replace function public.grant_clinician_competency(p_staff uuid, p_code text)
returns void language plpgsql security definer set search_path to '' as $$
declare s public.clinical_staff%rowtype; c public.competencies%rowtype; v_ex uuid; v_n integer;
begin
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can grant a competency' using errcode = '42501'; end if;
  select * into s from public.clinical_staff where id = p_staff;
  if not found then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  if s.profile_id = auth.uid() then
    v_ex := private.sole_cmo_exception_active(s.organisation_id, p_code, auth.uid());
    if v_ex is null then raise exception 'you cannot grant your own competencies' using errcode = '42501'; end if;
  end if;
  select * into c from public.competencies where code = p_code and is_active;
  if not found then raise exception 'unknown competency' using errcode = 'P0002'; end if;
  if c.requires_level > coalesce(s.credentialing_level, 0) then raise exception '% needs credentialing level %', p_code, c.requires_level using errcode = '23514'; end if;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
    values (s.organisation_id, p_staff, p_code, auth.uid(), s.is_test) on conflict do nothing;
  get diagnostics v_n = row_count;
  -- a repeated self grant that changed nothing leaves no audit, notice or event
  if v_ex is not null and v_n = 0 then return; end if;
  if v_ex is null then
    perform private.credential_audit(s.organisation_id, auth.uid(), 'clinician_competency.granted', 'clinical_staff', s.id, jsonb_build_object('code', p_code));
  else
    perform private.credential_audit(s.organisation_id, auth.uid(), 'clinician_competency.self_granted_under_exception', 'clinical_staff', s.id,
      jsonb_build_object('code', p_code, 'exception_id', v_ex));
    perform private.credential_notify_reviewers(s.organisation_id, 'Chief medical officer granted themselves a competency',
      'Under the signed sole chief medical officer exception, the chief medical officer granted themselves the ' || p_code || ' competency.',
      jsonb_build_object('kind', 'sole_cmo_self_grant', 'exception_id', v_ex, 'code', p_code));
  end if;
  perform private.emit_domain_event('clinician.competency_changed', s.organisation_id, jsonb_build_object('clinical_staff_id', s.id, 'code', p_code, 'change', 'granted'),
    'clinician.competency_changed:' || s.id || ':' || p_code || ':granted:' || extract(epoch from clock_timestamp())::text);
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'public.sign_sole_cmo_exception(text,text,text)', 'EXECUTE') then raise exception 'anon can execute sign'; end if;
  if has_function_privilege('anon', 'public.revoke_sole_cmo_exception(uuid,text)', 'EXECUTE') then raise exception 'anon can execute revoke'; end if;
  if has_function_privilege('anon', 'public.grant_clinician_competency(uuid,text)', 'EXECUTE') then raise exception 'anon can execute grant'; end if;
  if not has_function_privilege('authenticated', 'public.sign_sole_cmo_exception(text,text,text)', 'EXECUTE') then raise exception 'authenticated cannot sign'; end if;
  if has_table_privilege('authenticated', 'public.sole_cmo_exceptions', 'INSERT') or has_table_privilege('authenticated', 'public.sole_cmo_exceptions', 'UPDATE') then raise exception 'client write grant present'; end if;
end $$;
