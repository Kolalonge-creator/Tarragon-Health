-- ===== subscriptions =====
alter table subscriptions enable row level security;
create policy subscriptions_select on subscriptions for select using (
  payer_profile_id = auth.uid() or private.actor_role() in ('ops_admin','superadmin')
);
create policy subscriptions_insert on subscriptions for insert with check (
  payer_profile_id = auth.uid() or private.actor_role() in ('ops_admin','superadmin')
);
create policy subscriptions_update on subscriptions for update using (
  payer_profile_id = auth.uid() or private.actor_role() in ('ops_admin','superadmin')
);

-- ===== wallets =====
alter table wallets enable row level security;
create policy wallets_select on wallets for select using (
  owner_profile_id = auth.uid() or private.actor_role() in ('ops_admin','superadmin')
);
create policy wallets_insert on wallets for insert with check (owner_profile_id = auth.uid());
create policy wallets_update on wallets for update using (
  private.actor_role() in ('ops_admin','superadmin')
);

-- ===== wallet_transactions =====
alter table wallet_transactions enable row level security;
create policy wallet_transactions_select on wallet_transactions for select using (
  exists (select 1 from wallets w where w.id = wallet_transactions.wallet_id and w.owner_profile_id = auth.uid())
  or (beneficiary_patient_id is not null and private.is_own_or_dependant(beneficiary_patient_id))
  or private.actor_role() in ('ops_admin','superadmin')
);
create policy wallet_transactions_insert on wallet_transactions for insert with check (
  exists (select 1 from wallets w where w.id = wallet_transactions.wallet_id and w.owner_profile_id = auth.uid())
  or private.actor_role() in ('ops_admin','superadmin')
);

-- ===== invoice_lines ===== (org-scoped billing; institution_admin org-linkage gap, see organisations)
alter table invoice_lines enable row level security;
create policy invoice_lines_staff on invoice_lines for all using (
  private.actor_role() in ('ops_admin','superadmin')
) with check (
  private.actor_role() in ('ops_admin','superadmin')
);

-- ===== escalation_slas ===== (static config)
alter table escalation_slas enable row level security;
create policy escalation_slas_select on escalation_slas for select using (auth.uid() is not null);
create policy escalation_slas_write on escalation_slas for all using (
  private.actor_role() = 'superadmin'
) with check (
  private.actor_role() = 'superadmin'
);

-- ===== app_config ===== (accountability model + go-live guards)
alter table app_config enable row level security;
create policy app_config_select on app_config for select using (
  private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);
create policy app_config_write on app_config for update using (
  private.actor_role() = 'superadmin'
) with check (
  private.actor_role() = 'superadmin'
);

-- ===== audit_log ===== (break-glass governance; superadmin read only, no client insert path --
-- writes only via the SECURITY DEFINER trigger function, which runs as table owner)
alter table audit_log enable row level security;
create policy audit_log_superadmin_read on audit_log for select using (
  private.actor_role() = 'superadmin'
);

