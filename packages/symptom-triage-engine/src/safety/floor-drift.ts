import { SEED_PATHWAYS } from "../protocols/index";
import type { PresentingComplaintProtocol } from "../types/index";

/**
 * The bundled on-device red-flag floor (SEED_PATHWAYS, also used by the mobile app) is kept equal to the SIGNED protocol. When the CMO
 * signs a version whose red flags differ (for example the S59b chest pain draft with no severity floor) the bundled copy and
 * db-seed-fixture.json must be updated in the same change. This returns the keys of every pathway whose signed red flags differ from the
 * bundled ones, so the server can report drift loudly (a looser floor on the phone than the signed protocol is a safety gap offline).
 * Pathways with no bundled copy are not drift (the floor simply has nothing for them). Pure.
 */
export function bundledFloorDrift(signedPathways: readonly PresentingComplaintProtocol[]): string[] {
  const drift: string[] = [];
  for (const signed of signedPathways) {
    const bundled = SEED_PATHWAYS.find((p) => p.key === signed.key);
    if (!bundled) continue;
    if (JSON.stringify(bundled.redFlagScreen) !== JSON.stringify(signed.redFlagScreen)) drift.push(signed.key);
  }
  return drift;
}
