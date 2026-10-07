import { loadServicesState, type ServicePurchaseWithProduct } from "./services";

function isCoverCode(code: string | undefined): boolean {
  return !!code && code.startsWith("continuous_monitoring_");
}

/**
 * Mirrors apps/web/src/components/monitoring-cover-card.tsx's own filter
 * exactly: whether a doctor is currently told about this patient's readings,
 * granted by Continuous Monitoring (which carries the
 * vitals_red_flag_doctor_escalation feature). Reuses loadServicesState rather
 * than a second query — same active-purchases data the Services screen
 * already reads.
 */
export async function loadMonitoringCover(): Promise<ServicePurchaseWithProduct | null> {
  const result = await loadServicesState();
  if (!result.ok) return null;
  const cover = result.data.active
    .filter((purchase) => isCoverCode(purchase.service_product?.code))
    .sort((a, b) => (b.expires_at ?? "").localeCompare(a.expires_at ?? ""))[0];
  return cover ?? null;
}
