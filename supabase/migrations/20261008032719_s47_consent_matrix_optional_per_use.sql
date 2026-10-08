-- S47 (chat decision 2026-10-07; NOT a signature): in the consent matrix, "required for care" now applies ONLY to vitals and documents.
-- Reproductive health, mental health and device data become OPTIONAL PER USE for the care purpose: the person is asked when they first use that feature,
-- can withdraw at any time, and withdrawing stops that feature and its processing only, never the rest of care.
--
-- Counted first: consent_matrix_cells / consent_matrix_events are created by S42 (migration 20261007230822), which is not applied to production, so the live
-- counts are 0 withdrawn matrix consents and 0 rows in either table; there is nothing to convert. In the older patient_consents table 0 rows are withdrawn
-- for these types. No data migration, only policy rows.
--
-- What changes:
--   1. consent_matrix_cells: required_for_care = false for (reproductive | mental_health | device_data) x care; a new consent_timing column ('at_account'
--      or 'on_first_use'); the three cells are 'on_first_use'; policy_version 2 for those rows. The CHECK that only the care purpose can be required stays.
--      private.consent_in_force is data-driven, so those cells are now in force only after a grant event.
--   2. The withdrawal trigger (enforce_consent_matrix_event) is data-driven too: it now lets those three cells be withdrawn and still refuses vitals and
--      documents. Restated here so the refusal text and the policy version are explicit.
--   3. public.my_consent_matrix also returns consent_timing, so the privacy centre (web and phone) can say "we ask when you first use this".
--   4. public.feature_consent_state(data_type): has the person been asked, and is it on, for a feature that needs one of the three.
--   Care access functions still never read the matrix (the S42 proof scans their source for it; this migration adds no reader).

alter table public.consent_matrix_cells add column consent_timing text not null default 'at_account' check (consent_timing in ('at_account', 'on_first_use'));

update public.consent_matrix_cells
   set required_for_care = false, consent_timing = 'on_first_use', policy_version = 2
 where purpose = 'care' and data_type in ('reproductive', 'mental_health', 'device_data');

comment on column public.consent_matrix_cells.consent_timing is
  'S47: at_account = asked with the account (required cells need no event at all); on_first_use = optional per use, asked the first time the feature is used, withdrawable, and withdrawing stops that feature only.';

create or replace function private.enforce_consent_matrix_event() returns trigger
language plpgsql set search_path = ''
as $$
declare c public.consent_matrix_cells%rowtype;
begin
  select * into c from public.consent_matrix_cells where data_type = new.data_type and purpose = new.purpose;
  if c.data_type is null then raise exception 'consent_cell_unknown' using errcode = '23514'; end if;
  -- Only a cell that is required for care (vitals and documents, S47) can never be withdrawn. An optional-per-use cell can: that stops its own feature.
  if new.action = 'withdrawn' and c.required_for_care then
    raise exception 'consent_required_for_care' using errcode = '23514',
      detail = 'This consent is needed to give you care. To stop it, use the account closure options in Privacy.';
  end if;
  new.policy_version := c.policy_version;
  return new;
end $$;
revoke all on function private.enforce_consent_matrix_event() from public, anon, authenticated;

create or replace function public.my_consent_matrix() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'consent_not_authorised' using errcode = '42501'; end if;
  return jsonb_build_object(
    'cells', coalesce((select jsonb_agg(jsonb_build_object(
        'data_type', c.data_type, 'purpose', c.purpose, 'required_for_care', c.required_for_care, 'sensitive', c.sensitive,
        'text_key', c.text_key, 'wording_status', c.wording_status, 'consent_timing', c.consent_timing,
        'granted', private.consent_in_force(v_uid, c.data_type, c.purpose),
        'changed_at', (select max(e.created_at) from public.consent_matrix_events e
                        where e.patient_id = v_uid and e.data_type = c.data_type and e.purpose = c.purpose))
        order by c.sort_order) from public.consent_matrix_cells c), '[]'::jsonb),
    'bundles', coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'text_key', b.text_key,
        'cells', (select jsonb_agg(jsonb_build_object('data_type', bc.data_type, 'purpose', bc.purpose) order by bc.data_type, bc.purpose)
                    from public.consent_bundle_cells bc where bc.bundle_code = b.code)) order by b.sort_order)
        from public.consent_bundles b), '[]'::jsonb));
end $$;
revoke all on function public.my_consent_matrix() from public, anon;
grant execute on function public.my_consent_matrix() to authenticated;

-- For a feature screen: has this person been asked for the feature's care consent, and is it on? Never used by a care access function.
create function public.feature_consent_state(p_data_type text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); c public.consent_matrix_cells%rowtype; v_asked boolean;
begin
  if v_uid is null then raise exception 'consent_not_authorised' using errcode = '42501'; end if;
  select * into c from public.consent_matrix_cells where data_type = p_data_type and purpose = 'care' and consent_timing = 'on_first_use';
  if c.data_type is null then raise exception 'consent_cell_unknown' using errcode = '22023'; end if;
  select exists (select 1 from public.consent_matrix_events e where e.patient_id = v_uid and e.data_type = p_data_type and e.purpose = 'care') into v_asked;
  return jsonb_build_object('data_type', p_data_type, 'text_key', c.text_key, 'on', private.consent_in_force(v_uid, p_data_type, 'care'), 'asked_before', v_asked);
end $$;
revoke all on function public.feature_consent_state(text) from public, anon;
grant execute on function public.feature_consent_state(text) to authenticated;

do $$
begin
  if (select count(*) from public.consent_matrix_cells where required_for_care) <> 2
     or exists (select 1 from public.consent_matrix_cells where required_for_care and data_type not in ('vitals', 'documents')) then
    raise exception 'S47 self-check: only vitals and documents may be required for care';
  end if;
  if (select count(*) from public.consent_matrix_cells where consent_timing = 'on_first_use') <> 3 then raise exception 'S47 self-check: three cells must be optional per use'; end if;
  if has_function_privilege('anon', 'public.feature_consent_state(text)', 'EXECUTE') then raise exception 'S47 self-check: feature_consent_state reachable by anon'; end if;
end $$;
