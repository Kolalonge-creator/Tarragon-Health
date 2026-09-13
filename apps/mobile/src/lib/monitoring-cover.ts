import { loadServicesState, type ServicePurchaseWithProduct } from "./services";

const COVER_PREFIXES = ["continuous_monitoring_", "weight_management_"];

function isCoverCode(code: string | undefined): boolean {
  return !!code && COVER_PREFIXES.some((prefix) => code.startsWith(prefix));
}

/**
 * Mirrors apps/web/src/components/monitoring-cover-card.tsx's own filter
 * exactly: whether a doctor is currently told about this patient's readings,
 * granted by either Continuous Monitoring or Supervised Weight Management
 * (both carry the vitals_red_flag_doctor_escalation feature). Reuses
 * loadServicesState rather than a second query — same active-purchases data
 * the Services screen already reads.
 */
export async function loadMonitoringCover(): Promise<ServicePurchaseWithProduct | null> {
  const result = await loadServicesState();
  if (!result.ok) return null;
  const cover = result.data.active
    .filter((purchase) => isCoverCode(purchase.service_product?.code))
    .sort((a, b) => (b.expires_at ?? "").localeCompare(a.expires_at ?? ""))[0];
  return cover ?? null;
}
