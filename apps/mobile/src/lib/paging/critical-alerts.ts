import Constants from "expo-constants";

/**
 * iPhone Critical Alerts (S19e). Apple grants the entitlement per app after a request (docs/runbooks/ios-critical-alerts-request.md);
 * until then asking for the permission, or claiming the entitlement in a build, is rejected. So this is OFF unless the build was made
 * with IOS_CRITICAL_ALERTS_ENTITLEMENT=1, which app.config.js turns into `extra.iosCriticalAlerts`. The server has its own switch
 * (the IOS_CRITICAL_ALERTS_ENABLED secret on send-pending-notifications). Both stay off until Apple says yes and the CMO agrees
 * which events may be critical (proposed: an unacknowledged page and its expiry, to on-call clinicians only; never to patients).
 */
export function criticalAlertsRequested(extra: unknown = Constants.expoConfig?.extra): boolean {
  return typeof extra === "object" && extra !== null && (extra as { iosCriticalAlerts?: unknown }).iosCriticalAlerts === true;
}
