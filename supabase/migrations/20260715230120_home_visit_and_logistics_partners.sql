-- Tarragon Health — Home collection + delivery logistics partners (Workstream 3)
--
-- Two new global partner catalogues, mirroring lab_providers/pharmacy_partners
-- exactly (no organisation_id — platform-global reference data, authenticated
-- read, admin write). Deliberately seeded with zero *active* rows: the
-- patient-facing "coming soon in your area" state is the default until ops
-- adds a real active partner row for a region — no feature flag, no separate
-- marketing page. The moment a real active row exists for a matching
-- region/sample-type, the same code path renders the real booking/tracking
-- UI automatically.

create table public.home_visit_providers (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null unique,
  regions               text[] not null default '{}',
  sample_types          text[] not null default '{}',
  home_visit_fee_kobo   bigint not null default 0,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now()
);

create table public.logistics_partners (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null unique,
  regions                   text[] not null default '{}',
  delivery_fee_kobo         bigint not null default 0,
  estimated_delivery_hours  integer,
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS — same posture as lab_providers/pharmacy_partners/specialist_providers:
-- authenticated read, admin write.
-- ---------------------------------------------------------------------------

alter table public.home_visit_providers enable row level security;
alter table public.logistics_partners   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['home_visit_providers', 'logistics_partners']
  loop
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated using (true);
      create policy %1$s_insert on public.%1$I
        for insert to authenticated with check (private.is_admin());
      create policy %1$s_update on public.%1$I
        for update to authenticated using (private.is_admin()) with check (private.is_admin());
      create policy %1$s_delete on public.%1$I
        for delete to authenticated using (private.is_admin());
    $f$, t);
  end loop;
end;
$$;

grant select on public.home_visit_providers, public.logistics_partners to authenticated;
grant insert, update, delete on public.home_visit_providers, public.logistics_partners to authenticated;

-- ---------------------------------------------------------------------------
-- Documentation/testing placeholder rows — is_active = false, so they never
-- surface the real booking UI on their own. Ops flips a row to is_active =
-- true (or adds a new one) once a real partner contract exists, which is the
-- literal mechanism that turns the patient-facing feature on.
-- ---------------------------------------------------------------------------

insert into public.home_visit_providers (name, regions, sample_types, home_visit_fee_kobo, is_active) values
  ('[Placeholder] Home Phlebotomy Partners', array['Lagos'], array['blood', 'urine'], 500000, false);

insert into public.logistics_partners (name, regions, delivery_fee_kobo, estimated_delivery_hours, is_active) values
  ('[Placeholder] Last-Mile Logistics Partners', array['Lagos'], 200000, 24, false);
