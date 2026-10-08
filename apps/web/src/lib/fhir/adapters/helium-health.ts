import type { AdapterResult, ExternalRecordAdapter } from "./types";

/**
 * Helium Health adapter: a placeholder that does nothing and says so (S44, spec 2.11).
 *
 * Public API availability for a third party is UNVERIFIED (docs/research/S44.md). This class exists so that the first real conversation with a
 * facility has a place to land, not to suggest an integration exists. Every call returns `not_configured`; no network request is made and no
 * credential is read. Turning it into a real adapter needs: a pilot facility's written agreement, the vendor's API terms, the person's import
 * consent for this source name, and a CMO-approved scope (docs/plans/S44-helium-health-pilot.md).
 */
export const HELIUM_HEALTH_SOURCE = "helium health";

function notConfigured<T>(): AdapterResult<T> {
  return { ok: false, reason: "not_configured", message: "No integration with Helium Health is configured. Nothing was sent or received." };
}

export const heliumHealthAdapter: ExternalRecordAdapter = {
  sourceSystem: HELIUM_HEALTH_SOURCE,
  status: "not_configured",
  async fetchRecords() {
    return notConfigured();
  },
  async sendSummary() {
    return notConfigured();
  },
};
