// Dynamic Expo config layered on app.json (S13 R4). app.json stays the single source; this only adds iPhone notification
// entitlements, and only when the build asks for them, so a build never breaks before Apple has approved anything.
//
//   IOS_TIME_SENSITIVE=1             adds the Time Sensitive Notifications capability (no Apple approval needed). A red alert
//                                    can then break through Focus. Needs a fresh `eas build` (native), so bump runtimeVersion.
//   IOS_CRITICAL_ALERTS_ENTITLEMENT=1  adds the Critical Alerts entitlement. Set ONLY after Apple grants it (request at
//                                    developer.apple.com/contact/request/notifications-critical-alerts-entitlement/); without
//                                    the grant a provisioning profile that lists it is rejected. The server is told separately
//                                    with the IOS_CRITICAL_ALERTS_ENABLED secret on send-pending-notifications.
// Android needs nothing here: the "urgent" channel is created at run time (src/lib/notification-channels.ts), and full-screen
// intents are deliberately not used (Google Play restricts them to calling and alarm apps).
module.exports = ({ config }) => {
  const entitlements = { ...(config.ios?.entitlements ?? {}) };
  if (process.env.IOS_TIME_SENSITIVE === "1") {
    entitlements["com.apple.developer.usernotifications.time-sensitive"] = true;
  }
  if (process.env.IOS_CRITICAL_ALERTS_ENTITLEMENT === "1") {
    entitlements["com.apple.developer.usernotifications.critical-alerts"] = true;
  }
  if (Object.keys(entitlements).length === 0) return config;
  return { ...config, ios: { ...config.ios, entitlements } };
};
