create or replace function private.audit_row_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor_profile_id uuid;
  v_actor_role user_role;
begin
  begin
    v_actor_profile_id := auth.uid();
  exception when others then
    v_actor_profile_id := null;
  end;
  if v_actor_profile_id is not null then
    select role into v_actor_role from profiles where id = v_actor_profile_id;
  end if;

  insert into audit_log (actor_profile_id, actor_role, action, table_name, row_id, before, after)
  values (
    v_actor_profile_id,
    v_actor_role,
    tg_op,
    tg_table_name,
    case when tg_op = 'DELETE' then (old.id)::uuid else (new.id)::uuid end,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
  audited_tables text[] := array[
    'patients','devices','readings','triage_classifications','clinical_contacts',
    'clinical_notes','escalations','referrals','consent_records','proof_log',
    'notification_sends','medications','medication_dispenses','lab_orders',
    'screening_participants','wallet_transactions'
  ];
begin
  foreach t in array audited_tables loop
    execute format(
      'create trigger audit_%1$s after insert or update or delete on %1$s
       for each row execute function private.audit_row_change()', t
    );
  end loop;
end $$;

