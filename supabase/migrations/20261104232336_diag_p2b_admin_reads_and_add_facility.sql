-- Verified lab and imaging directory, Phase 2b: what the admin screens read, and adding an uncontracted facility.
-- Builds on 20261104230924 (Phase 2a). Screens: /admin/ops/diagnostic-directory and /admin/ops/diagnostic-directory/[id].
--
--   admin_dx_overview()               the work queue and the provider list (verifiers only)
--   admin_dx_provider_detail(id)      one provider listing with every branch, service (with its eligibility reasons),
--                                     credential, incident and the last 50 audit events (verifiers only)
--   admin_dx_create_facility(...)     a new UNCONTRACTED lab or imaging provider with its first branch, both listings in draft
--   admin_dx_add_branch(...)          another branch for an UNCONTRACTED provider
--
-- Why adding a branch is refused for a contracted provider: a new active lab_provider_locations row under the contracted
-- laboratory would appear in list_lab_test_locations and become orderable at once. Contracted branches are added on the partner
-- labs screen; this one only lists them (admin_dx_upsert_branch_listing).
-- New providers are created with is_active = false: listed is not contracted (DIR design §5).
-- Counts at write time: no listings exist live.

create or replace function public.admin_dx_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.lagos_today();
  v_soon integer := private.diagnostic_directory_rule('credential_due_soon_days');
  v_svc_days integer := private.diagnostic_directory_rule('service_confirm_days');
begin
  perform private.diagnostic_require_verifier();
  return jsonb_build_object(
    'providers', coalesce((
      select jsonb_agg(x order by x ->> 'name') from (
        select jsonb_build_object(
          'listing_id', pl.id,
          'kind', case when pl.lab_provider_id is not null then 'lab' else 'imaging' end,
          'name', coalesce(lp.name, ip.name),
          'contracted', coalesce(lp.is_active, ip.is_active, false),
          'directory_status', pl.directory_status,
          'branches', (select count(*) from public.diagnostic_branch_listings b where b.provider_listing_id = pl.id),
          'listed_branches', (select count(*) from public.diagnostic_branch_listings b where b.provider_listing_id = pl.id and b.directory_status = 'listed'),
          'services', (select count(*) from public.diagnostic_branch_services s join public.diagnostic_branch_listings b on b.id = s.branch_listing_id where b.provider_listing_id = pl.id),
          'eligible_services', (select count(*) from public.diagnostic_branch_services s join public.diagnostic_branch_listings b on b.id = s.branch_listing_id
                                 where b.provider_listing_id = pl.id and private.diagnostic_service_eligible(s.id))
        ) as x
        from public.diagnostic_provider_listings pl
        left join public.lab_providers lp on lp.id = pl.lab_provider_id
        left join public.imaging_providers ip on ip.id = pl.imaging_provider_id
      ) q), '[]'::jsonb),
    'unlisted', coalesce((
      select jsonb_agg(jsonb_build_object('kind', u.kind, 'provider_id', u.id, 'name', u.name, 'contracted', u.is_active) order by u.name)
        from (
          select 'lab' as kind, lp.id, lp.name, lp.is_active from public.lab_providers lp
           where not exists (select 1 from public.diagnostic_provider_listings pl where pl.lab_provider_id = lp.id)
          union all
          select 'imaging', ip.id, ip.name, ip.is_active from public.imaging_providers ip
           where not exists (select 1 from public.diagnostic_provider_listings pl where pl.imaging_provider_id = ip.id)
        ) u), '[]'::jsonb),
    'queue', jsonb_build_object(
      'credentials_pending', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'listing_id', coalesce(c.provider_listing_id, b.provider_listing_id),
                                            'regulator', c.regulator, 'identifier', c.identifier, 'recorded_at', c.recorded_at) order by c.recorded_at)
          from public.diagnostic_credentials c left join public.diagnostic_branch_listings b on b.id = c.branch_listing_id
         where c.status = 'pending'), '[]'::jsonb),
      'credentials_expiring', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'listing_id', coalesce(c.provider_listing_id, b.provider_listing_id),
                                            'regulator', c.regulator, 'identifier', c.identifier, 'expires_on', c.expires_on,
                                            'expired', c.expires_on < v_today) order by c.expires_on)
          from public.diagnostic_credentials c left join public.diagnostic_branch_listings b on b.id = c.branch_listing_id
         where c.expires_on is not null and c.expires_on <= v_today + v_soon
           and c.status not in ('withdrawn', 'failed', 'suspended')), '[]'::jsonb),
      'services_overdue', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'listing_id', b.provider_listing_id, 'test', rc.display,
                                            'confirmed_at', s.confirmed_at) order by s.confirmed_at)
          from public.diagnostic_branch_services s
          join public.diagnostic_branch_listings b on b.id = s.branch_listing_id
          join public.reference_concepts rc on rc.id = s.concept_id
         where s.availability <> 'discontinued' and s.confirmed_at < now() - make_interval(days => v_svc_days)), '[]'::jsonb),
      'performer_unknown', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'listing_id', b.provider_listing_id, 'test', rc.display))
          from public.diagnostic_branch_services s
          join public.diagnostic_branch_listings b on b.id = s.branch_listing_id
          join public.reference_concepts rc on rc.id = s.concept_id
         where s.performed <> 'onsite' and s.performing_branch_listing_id is null and s.availability <> 'discontinued'), '[]'::jsonb),
      'incidents_open', coalesce((
        select jsonb_agg(jsonb_build_object('id', i.id, 'severity', i.severity, 'suspends', i.suspends, 'opened_at', i.opened_at,
                                            'description', i.description,
                                            'listing_id', coalesce(i.provider_listing_id, b1.provider_listing_id, b2.provider_listing_id))
                         order by i.opened_at)
          from public.diagnostic_listing_incidents i
          left join public.diagnostic_branch_listings b1 on b1.id = i.branch_listing_id
          left join public.diagnostic_branch_services s on s.id = i.service_id
          left join public.diagnostic_branch_listings b2 on b2.id = s.branch_listing_id
         where i.status = 'open'), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.admin_dx_provider_detail(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pl public.diagnostic_provider_listings%rowtype;
  v_kind text;
  v_today date := private.lagos_today();
begin
  perform private.diagnostic_require_verifier();
  select * into pl from public.diagnostic_provider_listings where id = p_listing_id;
  if pl.id is null then
    return null;
  end if;
  v_kind := case when pl.lab_provider_id is not null then 'lab' else 'imaging' end;

  return jsonb_build_object(
    'listing_id', pl.id,
    'kind', v_kind,
    'provider_id', coalesce(pl.lab_provider_id, pl.imaging_provider_id),
    'name', coalesce((select name from public.lab_providers where id = pl.lab_provider_id),
                     (select name from public.imaging_providers where id = pl.imaging_provider_id)),
    'contracted', coalesce((select is_active from public.lab_providers where id = pl.lab_provider_id),
                           (select is_active from public.imaging_providers where id = pl.imaging_provider_id), false),
    'directory_status', pl.directory_status,
    'status_reason', pl.status_reason,
    'is_test', pl.is_test,
    'branches', coalesce((
      select jsonb_agg(br order by br ->> 'name') from (
        select jsonb_build_object(
          'location_id', loc.id,
          'branch_listing_id', b.id,
          'name', loc.name, 'state', loc.state, 'town', coalesce(b.town, loc.town), 'lga', b.lga,
          'neighbourhood', b.neighbourhood, 'address', loc.address, 'phone', loc.contact_phone,
          'latitude', loc.latitude, 'longitude', loc.longitude, 'open', loc.is_active,
          'email', b.email, 'website', b.website,
          'directory_status', b.directory_status,
          'location_verified_at', b.location_verified_at,
          'location_verified_by', (select full_name from public.profiles where id = b.location_verified_by),
          'location_source', b.location_source,
          'services', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'id', s.id, 'concept_id', s.concept_id, 'test', rc.display, 'availability', s.availability,
                     'performed', s.performed, 'performing_branch_listing_id', s.performing_branch_listing_id,
                     'appointment_required', s.appointment_required, 'evidence_source', s.evidence_source,
                     'confirmed_at', s.confirmed_at,
                     'confirmed_by', (select full_name from public.profiles where id = s.confirmed_by),
                     'reasons', to_jsonb(private.diagnostic_service_eligibility(s.id)))
                   order by rc.display)
              from public.diagnostic_branch_services s join public.reference_concepts rc on rc.id = s.concept_id
             where s.branch_listing_id = b.id), '[]'::jsonb)
        ) as br
        from (
          select l.id, l.name, l.state, l.town, l.address, l.contact_phone, l.latitude, l.longitude, l.is_active
            from public.lab_provider_locations l where v_kind = 'lab' and l.lab_provider_id = pl.lab_provider_id
          union all
          select l.id, l.name, l.state, null, l.address, l.contact_phone, l.latitude, l.longitude, l.is_active
            from public.imaging_provider_locations l where v_kind = 'imaging' and l.imaging_provider_id = pl.imaging_provider_id
        ) loc
        left join public.diagnostic_branch_listings b
          on (v_kind = 'lab' and b.lab_location_id = loc.id) or (v_kind = 'imaging' and b.imaging_location_id = loc.id)
      ) q), '[]'::jsonb),
    'credentials', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'level', case when c.provider_listing_id is not null then 'provider' else 'branch' end,
               'branch_listing_id', c.branch_listing_id, 'regulator', c.regulator, 'issuer', c.issuer,
               'accreditation_body', c.accreditation_body, 'state', c.state, 'identifier', c.identifier,
               'scope', (select coalesce(jsonb_agg(rc.display order by rc.display), '[]'::jsonb)
                           from public.reference_concepts rc where rc.id = any (coalesce(c.scope_concept_ids, '{}'))),
               'issued_on', c.issued_on, 'expires_on', c.expires_on, 'source_url', c.source_url,
               'status', c.status,
               'effective_status', private.diagnostic_credential_effective_status(c.status, c.expires_on),
               'verified_at', c.verified_at,
               'verified_by', (select full_name from public.profiles where id = c.verified_by),
               'verification_note', c.verification_note)
             order by c.recorded_at desc)
        from public.diagnostic_credentials c
       where c.provider_listing_id = pl.id
          or c.branch_listing_id in (select id from public.diagnostic_branch_listings where provider_listing_id = pl.id)), '[]'::jsonb),
    'incidents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'status', i.status, 'severity', i.severity, 'suspends', i.suspends, 'description', i.description,
               'branch_listing_id', i.branch_listing_id, 'service_id', i.service_id, 'opened_at', i.opened_at,
               'decision', i.decision, 'reinstated', i.reinstated, 'closed_at', i.closed_at)
             order by i.opened_at desc)
        from public.diagnostic_listing_incidents i
       where i.provider_listing_id = pl.id
          or i.branch_listing_id in (select id from public.diagnostic_branch_listings where provider_listing_id = pl.id)
          or i.service_id in (select s.id from public.diagnostic_branch_services s join public.diagnostic_branch_listings b
                                on b.id = s.branch_listing_id where b.provider_listing_id = pl.id)), '[]'::jsonb),
    -- Branches of OTHER providers, so a test sent elsewhere can name the laboratory or centre that really does it.
    'other_branches', coalesce((
      select jsonb_agg(jsonb_build_object('branch_listing_id', o.id, 'label', o.label) order by o.label) from (
        select b.id, coalesce(lp.name, ip.name) || ': ' || coalesce(ll.name, il.name) || ', ' || coalesce(ll.state, il.state) as label
          from public.diagnostic_branch_listings b
          join public.diagnostic_provider_listings op on op.id = b.provider_listing_id
          left join public.lab_providers lp on lp.id = op.lab_provider_id
          left join public.imaging_providers ip on ip.id = op.imaging_provider_id
          left join public.lab_provider_locations ll on ll.id = b.lab_location_id
          left join public.imaging_provider_locations il on il.id = b.imaging_location_id
         where b.provider_listing_id <> pl.id and b.directory_status in ('draft', 'listed')
         limit 500) o), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(e order by e ->> 'at' desc) from (
        select jsonb_build_object('at', ev.at, 'action', ev.action, 'subject_table', ev.subject_table, 'from', ev.from_value,
                                  'to', ev.to_value, 'note', ev.note,
                                  'actor', (select full_name from public.profiles where id = ev.actor)) as e
          from public.diagnostic_directory_events ev
         where ev.subject_id = pl.id
            or ev.subject_id in (select id from public.diagnostic_branch_listings where provider_listing_id = pl.id)
            or ev.subject_id in (select s.id from public.diagnostic_branch_services s join public.diagnostic_branch_listings b
                                   on b.id = s.branch_listing_id where b.provider_listing_id = pl.id)
            or ev.subject_id in (select c.id from public.diagnostic_credentials c
                                  where c.provider_listing_id = pl.id
                                     or c.branch_listing_id in (select id from public.diagnostic_branch_listings where provider_listing_id = pl.id))
            or ev.subject_id in (select i.id from public.diagnostic_listing_incidents i
                                  where i.provider_listing_id = pl.id
                                     or i.branch_listing_id in (select id from public.diagnostic_branch_listings where provider_listing_id = pl.id)
                                     or i.service_id in (select s.id from public.diagnostic_branch_services s join public.diagnostic_branch_listings b
                                                           on b.id = s.branch_listing_id where b.provider_listing_id = pl.id))
         order by ev.at desc
         limit 50) q), '[]'::jsonb),
    'today', v_today
  );
end;
$$;

-- Shared by the two creators: one new branch row for an UNCONTRACTED provider plus its draft branch listing.
create or replace function private.diagnostic_new_branch(
  p_provider_listing_id uuid, p_branch_name text, p_state text, p_town text, p_lga text, p_address text, p_phone text,
  p_latitude double precision, p_longitude double precision)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.diagnostic_provider_listings%rowtype;
  v_loc uuid;
  v_branch uuid;
begin
  select * into pl from public.diagnostic_provider_listings where id = p_provider_listing_id;
  if pl.id is null then raise exception 'unknown provider listing' using errcode = '23503'; end if;
  if exists (select 1 from public.lab_providers where id = pl.lab_provider_id and is_active)
     or exists (select 1 from public.imaging_providers where id = pl.imaging_provider_id and is_active) then
    raise exception 'add a contracted provider''s branches on the partner screen; this screen only lists them' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_town, ''))) < 2 or char_length(btrim(coalesce(p_address, ''))) < 5 then
    raise exception 'a branch needs a town and an address' using errcode = '22023';
  end if;
  if pl.lab_provider_id is not null then
    insert into public.lab_provider_locations (lab_provider_id, name, state, town, address, contact_phone, latitude, longitude, is_active)
    values (pl.lab_provider_id, btrim(p_branch_name), btrim(p_state), btrim(p_town), btrim(p_address), p_phone, p_latitude, p_longitude, true)
    returning id into v_loc;
  else
    insert into public.imaging_provider_locations (imaging_provider_id, name, state, address, contact_phone, latitude, longitude, is_active)
    values (pl.imaging_provider_id, btrim(p_branch_name), btrim(p_state), btrim(p_address), p_phone, p_latitude, p_longitude, true)
    returning id into v_loc;
  end if;
  v_branch := public.admin_dx_upsert_branch_listing(pl.id, v_loc, p_lga, p_town, null, null, null, pl.is_test);
  return v_branch;
end;
$$;
revoke all on function private.diagnostic_new_branch(uuid, text, text, text, text, text, text, double precision, double precision) from public;

create or replace function public.admin_dx_create_facility(
  p_kind text, p_name text, p_branch_name text, p_state text, p_town text, p_lga text, p_address text, p_phone text,
  p_latitude double precision, p_longitude double precision, p_is_test boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider uuid;
  v_listing uuid;
begin
  perform private.diagnostic_require_verifier();
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'give the facility''s name' using errcode = '22023'; end if;
  if p_kind = 'lab' then
    insert into public.lab_providers (name, is_active) values (btrim(p_name), false) returning id into v_provider;
  elsif p_kind = 'imaging' then
    insert into public.imaging_providers (name, is_active) values (btrim(p_name), false) returning id into v_provider;
  else
    raise exception 'kind must be lab or imaging' using errcode = '22023';
  end if;
  v_listing := public.admin_dx_create_provider_listing(p_kind, v_provider, p_is_test);
  perform private.diagnostic_new_branch(v_listing, p_branch_name, p_state, p_town, p_lga, p_address, p_phone, p_latitude, p_longitude);
  return v_listing;
end;
$$;

create or replace function public.admin_dx_add_branch(
  p_provider_listing_id uuid, p_branch_name text, p_state text, p_town text, p_lga text, p_address text, p_phone text,
  p_latitude double precision, p_longitude double precision)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.diagnostic_require_verifier();
  return private.diagnostic_new_branch(p_provider_listing_id, p_branch_name, p_state, p_town, p_lga, p_address, p_phone,
                                       p_latitude, p_longitude);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_dx_overview()',
    'public.admin_dx_provider_detail(uuid)',
    'public.admin_dx_create_facility(text, text, text, text, text, text, text, text, double precision, double precision, boolean)',
    'public.admin_dx_add_branch(uuid, text, text, text, text, text, text, double precision, double precision)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  if has_function_privilege('anon', 'public.admin_dx_overview()', 'EXECUTE') then
    raise exception 'anon can execute admin_dx_overview';
  end if;
end;
$$;
