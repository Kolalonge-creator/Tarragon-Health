-- S57b: registers the platform feature flag mobile_offline_downloads, OFF, so the phone's offline audio downloads can be switched on from the
-- admin Feature flags screen once (a) a new EAS native build with expo-file-system and expo-network is installed (runtimeVersion bump; see
-- docs/design/S57b-offline-downloads.md) and (b) real, reviewed audio exists. Nothing is downloaded while it is off or while the build lacks the
-- native modules. Rows added: 1 (none exists before). The key does not match the clinical-safety rail on feature_flags.
insert into public.feature_flags (key, label, description, category, status, rollout_percent)
values ('mobile_offline_downloads', 'Offline audio downloads on the phone',
        'Lets the app download calm and sleep audio over Wi-Fi for offline listening (size caps from the library config; deleted on expiry and sign-out). Needs the native build that includes the file and network modules. Keep OFF until that build is out and audio is approved.',
        'mobile', 'off', 0)
on conflict (key) do nothing;

do $$
begin
  if not exists (select 1 from public.feature_flags where key = 'mobile_offline_downloads' and status = 'off') then
    raise exception 'FAIL: mobile_offline_downloads is missing or not off';
  end if;
end $$;
