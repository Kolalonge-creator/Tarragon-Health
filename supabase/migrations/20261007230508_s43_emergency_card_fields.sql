-- S43 part 2 of 3: the emergency card's patient-chosen fields (spec 2.7).
-- Design: docs/design/S43.md. Not applied to production by the session that wrote it.
--
-- Share links are NOT in this file. The first draft of S43 also reworked share links (hashed token, PIN, lockout, a status door); S09x
-- (main-dev, #1073) shipped a different PIN-protected design for the same feature, and the decision was that S09x wins. Nothing here touches
-- public.record_shares, record_share_lookups or any share function.
--
-- Emergency card: patient-chosen fields (emergency_card_fields). The shipped public function is RENAMED, not rewritten, and a wrapper with the
-- original name and signature strips what the patient did not choose. That keeps whatever body is live (including later hardening) and means the
-- renamed function can no longer be called by anyone directly, so an excluded field cannot be read around the wrapper.

-- ---------------------------------------------------------------------------
-- 1. Emergency card: patient-chosen fields
-- ---------------------------------------------------------------------------
create table if not exists public.emergency_card_fields (
  patient_id          uuid primary key references public.profiles (id) on delete cascade,
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  show_date_of_birth  boolean not null default true,
  show_sex            boolean not null default true,
  show_patient_number boolean not null default true,
  show_allergies      boolean not null default true,
  show_medications    boolean not null default true,
  show_conditions     boolean not null default true,
  show_blood          boolean not null default true,
  show_emergency_contact boolean not null default true,
  -- opt-in presence on a phone's lock screen: a shared phone shows the card to whoever holds it, so it is off until the person chooses it
  lock_screen_opt_in  boolean not null default false,
  updated_at          timestamptz not null default now()
);
alter table public.emergency_card_fields enable row level security;
create policy emergency_card_fields_own_select on public.emergency_card_fields for select to authenticated using (patient_id = (select auth.uid()));
create policy emergency_card_fields_own_insert on public.emergency_card_fields for insert to authenticated
  with check (patient_id = (select auth.uid()) and organisation_id = (select organisation_id from public.profiles where id = (select auth.uid())));
create policy emergency_card_fields_own_update on public.emergency_card_fields for update to authenticated
  using (patient_id = (select auth.uid())) with check (patient_id = (select auth.uid()));
grant select, insert, update on public.emergency_card_fields to authenticated;
revoke delete on public.emergency_card_fields from authenticated;
revoke all on public.emergency_card_fields from anon;
create trigger emergency_card_fields_set_updated_at before update on public.emergency_card_fields for each row execute function private.set_updated_at();

-- Rename, do not rewrite: the live body (and anything added to it since this file was written) is kept exactly.
do $$
begin
  if to_regprocedure('public.emergency_card_full_by_token(text)') is null then
    alter function public.emergency_card_by_token(text) rename to emergency_card_full_by_token;
  end if;
end $$;
revoke all on function public.emergency_card_full_by_token(text) from public, anon, authenticated;

create or replace function public.emergency_card_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full jsonb;
  v_patient uuid;
  f public.emergency_card_fields%rowtype;
  v_hidden text[] := '{}';
begin
  v_full := public.emergency_card_full_by_token(p_token);   -- does the lookup, the audit row and the patient notice, exactly as before
  if v_full is null then
    return null;
  end if;
  select patient_id into v_patient from public.emergency_cards where token = p_token;
  select * into f from public.emergency_card_fields where patient_id = v_patient;
  if not found then
    return v_full;                                             -- no choice made yet: the card is unchanged
  end if;
  if not f.show_date_of_birth then v_full := v_full - 'date_of_birth'; v_hidden := array_append(v_hidden, 'date_of_birth'); end if;
  if not f.show_sex then v_full := v_full - 'sex'; v_hidden := array_append(v_hidden, 'sex'); end if;
  if not f.show_patient_number then v_full := v_full - 'patient_number'; v_hidden := array_append(v_hidden, 'patient_number'); end if;
  if not f.show_emergency_contact then v_full := v_full || jsonb_build_object('emergency_contact', null); v_hidden := array_append(v_hidden, 'emergency_contact'); end if;
  if not f.show_allergies then v_full := v_full || jsonb_build_object('allergies', '[]'::jsonb); v_hidden := array_append(v_hidden, 'allergies'); end if;
  if not f.show_medications then v_full := v_full || jsonb_build_object('medications', '[]'::jsonb); v_hidden := array_append(v_hidden, 'medications'); end if;
  if not f.show_conditions then v_full := v_full || jsonb_build_object('conditions', '[]'::jsonb); v_hidden := array_append(v_hidden, 'conditions'); end if;
  if not f.show_blood then v_full := v_full || jsonb_build_object('blood', null); v_hidden := array_append(v_hidden, 'blood'); end if;
  return v_full || jsonb_build_object('hidden_fields', to_jsonb(v_hidden));
end;
$$;
revoke all on function public.emergency_card_by_token(text) from public;
grant execute on function public.emergency_card_by_token(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.emergency_card_full_by_token(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.emergency_card_full_by_token(text)', 'EXECUTE') then
    raise exception 'S43 self-check: the renamed full-card function must not be callable by clients';
  end if;
  if not has_function_privilege('anon', 'public.emergency_card_by_token(text)', 'EXECUTE') then
    raise exception 'S43 self-check: the wrapper must stay anon-executable (the public card page)';
  end if;
end $$;
