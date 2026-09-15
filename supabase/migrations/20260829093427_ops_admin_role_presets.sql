-- Tarragon Health — Named operations-administrator role presets (Module 30.2)
--
-- "Do not have one universal administrator." The RBAC machinery to avoid that
-- has existed since 20260718230000 — permissions, custom_roles (named bundles),
-- per-user grants — but public.custom_roles has never been seeded, so in
-- practice every operator has been given the `admin` account role, which holds
-- every capability implicitly. That is the universal administrator the spec
-- warns against, arrived at by inertia rather than by decision.
--
-- This migration seeds the seven named bundles, each one a real least-privilege
-- set built only from capability keys that already gate a real surface. There
-- is deliberately NO 'Super administrator' preset: the super admin is the
-- existing `admin` account role (private.is_admin()), it is intentionally
-- restricted to the founder, and modelling it as an assignable bundle would
-- make handing out full control a two-click mistake.
--
-- On base_role: it is the account role used ONLY for dashboard routing and the
-- RLS surface a member sits on — never a claim of clinical authority (that
-- lives in clinical_staff.doctor_tier). The choices below are least-privilege:
--   clinician         only where the work genuinely needs patient context
--   care_coordinator  employed non-clinical operations staff, org-staff read,
--                     no medication / escalation-resolution / protocol writes
--   finance           back-office; private.is_org_staff() excludes it, so no
--                     patient base-table access
--   analyst           the MOST PHI-restricted staff role on the platform —
--                     also excluded from is_org_staff(), with no broad RLS
--                     grants at all, every read going through a gated
--                     aggregate RPC. That is why content, technical and data
--                     administrators sit on it: none of them has any business
--                     reading a patient row.
--
-- Sizing note: at this headcount one person will hold several of these at once.
-- That is fine and is the point — the bundles keep the boundary explicit and
-- auditable, so splitting the work later is an assignment change rather than a
-- rebuild. It also means each bundle must stand on its own; none of them
-- assumes another is also held.

do $$
declare
  v_role_id uuid;
  v_preset  record;
  v_key     text;
  v_missing text;
  v_preset_names text[] := array[
    'Clinical administrator', 'Provider network administrator', 'Finance administrator',
    'Customer support administrator', 'Content administrator', 'Technical administrator',
    'Data & analytics administrator'
  ];
begin
  for v_preset in
    select * from (values
      (
        'Clinical administrator',
        'clinician'::public.user_role,
        'Clinical operations: staff records and verification, protocol versions, condition programmes, and the clinical side of the incident register.',
        array[
          'clinical_staff.manage', 'protocols.manage', 'conditions.manage',
          'ops.console.view', 'incidents.view', 'incidents.manage', 'analytics.view'
        ]
      ),
      (
        'Provider network administrator',
        'care_coordinator'::public.user_role,
        'The partner network: labs, pharmacies, facilities, specialists, home-visit and logistics providers, plus the organisations and service regions they operate in.',
        array[
          'partners.labs.manage', 'partners.pharmacies.manage', 'partners.facilities.manage',
          'partners.specialists.manage', 'partners.home_visit.manage', 'partners.logistics.manage',
          'orgs.manage', 'orgs.hmo.manage', 'orgs.corporate.manage',
          'service_regions.manage', 'logistics.orders.manage',
          'ops.console.view', 'incidents.view'
        ]
      ),
      (
        'Finance administrator',
        'finance'::public.user_role,
        'Payments, settlements, partner payouts, the general ledger, tax and reconciliation exceptions. No patient-record access.',
        array[
          'finance.view', 'finance.gl.post', 'finance.periods.manage', 'finance.reconcile',
          'finance.tax.manage', 'finance.export', 'commissions.view', 'subscriptions.manage',
          'ops.console.view', 'incidents.view'
        ]
      ),
      (
        'Customer support administrator',
        'care_coordinator'::public.user_role,
        'Patient support: the inbound inbox, administrative contact details, lead follow-up, and raising an incident when a patient problem turns out to be a platform problem.',
        array[
          'support.manage', 'users.contact.edit', 'leads.manage',
          'ops.console.view', 'incidents.view', 'incidents.manage'
        ]
      ),
      (
        'Content administrator',
        'analyst'::public.user_role,
        'Health-education content, public impact metrics and outbound announcements. Deliberately has no patient-record access at all.',
        array[
          'health_education.manage', 'impact_metrics.manage', 'broadcasts.send', 'leads.manage'
        ]
      ),
      (
        'Technical administrator',
        'analyst'::public.user_role,
        'System operations: feature flags and rollout, partner integration credentials, system health, and technical incidents.',
        array[
          'feature_flags.manage', 'integrations.manage', 'analytics.view',
          'ops.console.view', 'incidents.view', 'incidents.manage'
        ]
      ),
      (
        'Data & analytics administrator',
        'analyst'::public.user_role,
        'Reporting across the platform: the analytics console, member activity, and financial export. Aggregates only.',
        array[
          'analytics.view', 'members.activity.view', 'finance.export', 'ops.console.view'
        ]
      )
    ) as t(name, base_role, description, permission_keys)
  loop
    -- Every key must already exist in the catalogue. A typo here would create
    -- a bundle that silently grants nothing, which is worse than a failure.
    foreach v_key in array v_preset.permission_keys loop
      if not exists (select 1 from public.permissions where key = v_key) then
        raise exception 'Preset "%" references unknown permission key "%"', v_preset.name, v_key;
      end if;
    end loop;

    insert into public.custom_roles (name, base_role, description)
    values (v_preset.name, v_preset.base_role, v_preset.description)
    on conflict (name) do update
      set description = excluded.description,
          base_role   = excluded.base_role
    returning id into v_role_id;

    -- Additive: an operator may have widened a preset for their own team, and
    -- a re-run of this migration must not silently take that away.
    insert into public.role_permissions (custom_role_id, permission_key)
    select v_role_id, k
    from unnest(v_preset.permission_keys) k
    on conflict (custom_role_id, permission_key) do nothing;
  end loop;

  -- Assertions ---------------------------------------------------------------
  -- Scoped to the seven names this migration owns. A custom role somebody
  -- created by hand is theirs, not this migration's to fail on.
  if (select count(*) from public.custom_roles where name = any(v_preset_names)) <> 7 then
    raise exception 'Expected 7 seeded role presets, found %',
      (select count(*) from public.custom_roles where name = any(v_preset_names));
  end if;

  -- No preset may be a back door to super admin.
  if exists (
    select 1 from public.custom_roles
    where name = any(v_preset_names) and base_role = 'admin'
  ) then
    raise exception 'A role preset was seeded with base_role admin — that is the universal administrator this migration exists to avoid';
  end if;

  -- A hand-made bundle on base_role admin is the same hazard arrived at a
  -- different way. Not this migration's to delete, but it should be said out
  -- loud rather than discovered during an incident.
  select string_agg(name, ', ') into v_missing
  from public.custom_roles
  where base_role = 'admin' and name <> all(v_preset_names);
  if v_missing is not null then
    raise warning 'Custom role(s) % use base_role admin and therefore hold every capability implicitly — review them.', v_missing;
  end if;

  -- Every preset must actually carry permissions.
  select string_agg(name, ', ') into v_missing
  from public.custom_roles cr
  where cr.name = any(v_preset_names)
    and not exists (
      select 1 from public.role_permissions rp where rp.custom_role_id = cr.id
    );
  if v_missing is not null then
    raise exception 'Role preset(s) seeded with no permissions: %', v_missing;
  end if;

  -- The one capability that can change what a patient sees without a deploy
  -- belongs to exactly one preset.
  if exists (
    select 1
    from public.custom_roles cr
    join public.role_permissions rp on rp.custom_role_id = cr.id
    where cr.name = any(v_preset_names)
      and rp.permission_key = 'feature_flags.manage'
      and cr.name <> 'Technical administrator'
  ) then
    raise exception 'feature_flags.manage leaked into a preset other than Technical administrator';
  end if;
end;
$$;

-- The description column existed but was never populated for a seeded role;
-- these are read straight into the /admin/settings/members role picker, so
-- they are UI copy, not just documentation.
comment on table public.custom_roles is
  'Named permission bundles (Module 30.2). Seeded with seven least-privilege operations-administrator presets in 20260829100253. base_role is dashboard routing + RLS surface only — never a claim of clinical authority, which lives in clinical_staff.doctor_tier. There is intentionally no Super administrator preset: that is the `admin` account role itself.';
