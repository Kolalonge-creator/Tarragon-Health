import { t } from "./translate";

/**
 * The one plain sentence for one line of the child timeline (S68b), shared by the web page and the phone so they read the same. Structural input
 * (it matches @tarragon/shared's TimelineItem) so this package does not depend on the shared one.
 */
export interface TimelineLineInput {
  readonly kind: string;
  readonly feedType?: string | null;
  readonly sleepMinutes?: number | null;
  readonly weightKg?: number | null;
  readonly heightCm?: number | null;
  readonly vaccineName?: string;
  readonly doseNumber?: number;
}

export function childDuration(minutes: number): string {
  return minutes < 60
    ? t("cdl.duration.minutes", "en", { minutes })
    : t("cdl.duration.hours", "en", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export function childTimelineLine(item: TimelineLineInput): string {
  switch (item.kind) {
    case "feed":
      return item.feedType === "breast" ? t("cdl.timeline.feed_breast") : item.feedType === "bottle" ? t("cdl.timeline.feed_bottle") : t("cdl.timeline.feed_other");
    case "sleep_start":
      return item.sleepMinutes != null
        ? `${t("cdl.timeline.sleep_start")}. ${t("cdl.timeline.sleep_start_for", "en", { duration: childDuration(item.sleepMinutes) })}`
        : t("cdl.timeline.sleep_start");
    case "sleep_stop":
      return t("cdl.timeline.sleep_stop");
    case "nappy_wet":
      return t("cdl.timeline.nappy_wet");
    case "nappy_dirty":
      return t("cdl.timeline.nappy_dirty");
    case "growth":
      if (item.weightKg != null && item.heightCm != null) return t("cdl.timeline.growth_both", "en", { weight: item.weightKg, height: item.heightCm });
      if (item.weightKg != null) return t("cdl.timeline.growth_weight", "en", { weight: item.weightKg });
      return t("cdl.timeline.growth_height", "en", { height: item.heightCm ?? "" });
    case "vaccine":
      return t("cdl.timeline.vaccine", "en", { name: item.vaccineName ?? "", dose: item.doseNumber ?? 1 });
    default:
      return "";
  }
}
