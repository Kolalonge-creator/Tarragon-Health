import { t, type Locale } from "@tarragon/i18n";
import { costFigures, formatNaira, type UsageFigures } from "./data-cost-rules";
import { formatBytes } from "./data-usage";
import type { DataCostConfig } from "./data-cost-config";

/**
 * The words the data meter shows (S06z), built in one place so the settings card and the sync banner
 * agree, and so a test can read every line. Every figure is labelled an estimate by the note beside it.
 */
export interface DataCostView {
  monthLine: string;
  lastSyncLine: string;
  /** Only when some use could not be matched to mobile data or Wi-Fi. */
  unplacedLine: string | null;
  estimateNote: string;
  /** Whether anything has been used on mobile data this month (a banner with nothing to say stays quiet). */
  hasUsage: boolean;
}

export function buildDataCostView(usage: UsageFigures, config: DataCostConfig, locale: Locale): DataCostView {
  const cost = costFigures(usage, config.pricePerMbKobo);
  const monthLine =
    usage.monthBytes > 0
      ? t("datacost.month", locale, { amount: formatBytes(usage.monthBytes), cost: formatNaira(cost.monthKobo) })
      : t("datacost.month_none", locale);
  const lastSyncLine =
    usage.lastSync && usage.lastSync.bytes > 0 && cost.lastSyncKobo !== null
      ? t("datacost.last_sync", locale, { amount: formatBytes(usage.lastSync.bytes), cost: formatNaira(cost.lastSyncKobo) })
      : t("datacost.last_sync_none", locale);
  return {
    monthLine,
    lastSyncLine,
    unplacedLine: usage.unplacedBytes > 0 ? t("datacost.unplaced", locale, { amount: formatBytes(usage.unplacedBytes) }) : null,
    estimateNote: t("datacost.estimate_note", locale, { price: formatNaira(config.pricePerMbKobo) }),
    hasUsage: usage.monthBytes > 0,
  };
}
