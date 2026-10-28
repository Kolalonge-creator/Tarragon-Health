import { assessDeviceSync } from "@tarragon/shared";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";

/**
 * The "Synced 3 hours ago" line for a paired device, and whether the list should add the calm note that nothing new has come
 * from it for a while. Wording only (packages/shared device-sync-freshness decides the level; no clinical rule reads it).
 * The earlier list showed a bare date, which hides a gap of a few days and reads as "today" to anyone who only glances.
 */
export interface DeviceSyncLine {
  text: string;
  showNote: boolean;
}

export function deviceSyncLine(lastSyncedAt: string | null | undefined, nowMs: number, locale: Locale): DeviceSyncLine {
  const a = assessDeviceSync(lastSyncedAt, nowMs);
  return { text: t(a.label.key as MessageKey, locale, a.label.params), showNote: a.showNote };
}
