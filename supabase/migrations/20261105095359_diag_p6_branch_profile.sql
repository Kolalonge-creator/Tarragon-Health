-- Diagnostic directory Phase 6: the public branch profile a patient opens from search (design §12 P6).
--
--   public.diagnostic_branch_profile(branch_listing_id)  one LISTED branch of a LISTED provider: public fields, the tests it
--      passes every check for today (same eligibility as search), whether it is a Tarragon Preferred Partner, and when its
--      location was last checked. A draft, suspended or deactivated listing returns null, as does a test listing for a real
--      user. Never returned: notes, evidence, verifier names, contract status, commercial terms, credential numbers.
--      Same gate as search: signed in, directory open.

create or replace function public.diagnostic_branch_profile(p_branch_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_test boolean;
  v_out jsonb;
begin
  if v_uid is null then raise exception 'sign in to see the directory' using errcode = '42501'; end if;
  if not private.go_live_directory_open(v_uid) then raise exception 'the directory is not open yet' using errcode = '55000'; end if;
  select coalesce(is_test, false) into v_test from public.profiles where id = v_uid;

  select jsonb_build_object(
           'branch_listing_id', b.id,
           'kind', case when p.lab_provider_id is not null then 'lab' else 'imaging' end,
           'provider_name', coalesce(lp.name, ip.name),
           'branch_name', coalesce(ll.name, il.name),
           'address', coalesce(ll.address, il.address),
           'neighbourhood', b.neighbourhood,
           'town', coalesce(b.town, ll.town),
           'lga', b.lga,
           'state', coalesce(ll.state, il.state),
           'phone', coalesce(ll.contact_phone, il.contact_phone),
           'email', b.email,
           'website', b.website,
           'latitude', coalesce(ll.latitude, il.latitude),
           'longitude', coalesce(ll.longitude, il.longitude),
           'location_checked_on', (b.location_verified_at at time zone 'Africa/Lagos')::date,
           'is_partner', private.diagnostic_branch_is_partner(b.id),
           'services', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'concept_id', rc.id, 'test', rc.display, 'availability', s.availability,
                      'appointment_required', s.appointment_required, 'preparation_note', s.preparation_note,
                      'performed_elsewhere', s.performed <> 'onsite')
                    order by rc.display)
               from public.diagnostic_branch_services s
               join public.reference_concepts rc on rc.id = s.concept_id
              where s.branch_listing_id = b.id and private.diagnostic_service_eligible(s.id)), '[]'::jsonb))
    into v_out
    from public.diagnostic_branch_listings b
    join public.diagnostic_provider_listings p on p.id = b.provider_listing_id and p.directory_status = 'listed'
    left join public.lab_provider_locations ll on ll.id = b.lab_location_id
    left join public.imaging_provider_locations il on il.id = b.imaging_location_id
    left join public.lab_providers lp on lp.id = p.lab_provider_id
    left join public.imaging_providers ip on ip.id = p.imaging_provider_id
   where b.id = p_branch_listing_id
     and b.directory_status = 'listed'
     and coalesce(ll.is_active, il.is_active, false)
     and ((not b.is_test and not p.is_test) or v_test or private.can_verify_diagnostic_directory());
  return v_out;
end;
$$;
revoke all on function public.diagnostic_branch_profile(uuid) from public, anon;
grant execute on function public.diagnostic_branch_profile(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.diagnostic_branch_profile(uuid)', 'EXECUTE') then
    raise exception 'anon must not execute diagnostic_branch_profile';
  end if;
end;
$$;
