import { t } from "@tarragon/i18n";
import { buildDataCostView } from "./data-cost-view";
import { loadDataCostConfig } from "./data-cost-config";
import { formatNaira } from "./data-cost-rules";

const config = loadDataCostConfig();

describe("the words the data meter shows", () => {
  it("states use and an estimated cost in naira, labelled as an estimate", () => {
    const v = buildDataCostView({ monthBytes: 12_500_000, unplacedBytes: 0, lastSync: { bytes: 340_000, at: 1 } }, config, "en");
    expect(v.monthLine).toContain("12.5 MB");
    expect(v.monthLine).toContain("₦");
    expect(v.lastSyncLine).toContain("340 KB");
    expect(v.estimateNote.toLowerCase()).toContain("estimate");
    expect(v.estimateNote).toContain(formatNaira(config.pricePerMbKobo));
    expect(v.unplacedLine).toBeNull();
    expect(v.hasUsage).toBe(true);
  });

  it("says plainly when nothing has been used, never a figure of zero naira as if it were a measurement", () => {
    const v = buildDataCostView({ monthBytes: 0, unplacedBytes: 0, lastSync: null }, config, "en");
    expect(v.monthLine).toBe(t("datacost.month_none", "en"));
    expect(v.lastSyncLine).toBe(t("datacost.last_sync_none", "en"));
    expect(v.hasUsage).toBe(false);
  });

  it("does not show a last-sync cost for a sync that used no mobile data", () => {
    const v = buildDataCostView({ monthBytes: 5_000, unplacedBytes: 0, lastSync: { bytes: 0, at: 1 } }, config, "en");
    expect(v.lastSyncLine).toBe(t("datacost.last_sync_none", "en"));
  });

  it("reports use it could not place, never hides it", () => {
    const v = buildDataCostView({ monthBytes: 3_000_000, unplacedBytes: 1_000_000, lastSync: null }, config, "en");
    expect(v.unplacedLine).toContain("1.0 MB");
  });
});

describe("the copy", () => {
  const keys = [
    "datacost.title",
    "datacost.estimate",
    "datacost.month",
    "datacost.month_none",
    "datacost.last_sync",
    "datacost.last_sync_none",
    "datacost.unplaced",
    "datacost.estimate_note",
    "datacost.how_we_count",
    "datacost.use_less_title",
    "datacost.use_less_lowdata",
    "datacost.use_less_wifi",
    "datacost.use_less_media",
    "datacost.wifi_only.title",
    "datacost.wifi_only.subtitle",
    "datacost.wifi_only.body",
    "datacost.wifi_only.waiting",
    "datacost.send_now",
    "datacost.web.faq_question",
    "datacost.web.faq_answer",
  ] as const;

  it("has no em dash, no fear wording and no medicine or condition name", () => {
    for (const k of keys) {
      const text = t(k, "en");
      expect(text).not.toMatch(/—|–/);
      expect(text).not.toMatch(/warning|danger|insulin|metformin|amlodipine|diabetes|hypertension|blood pressure/i);
    }
  });

  it("tells the patient urgent entries are never held", () => {
    expect(t("datacost.wifi_only.body", "en", { hours: 6 })).toMatch(/never held/i);
    expect(t("datacost.web.faq_answer", "en", { price: "₦0.80", hours: 6 })).toMatch(/straight away/i);
  });

  it("says the estimate is an estimate wherever a naira figure appears", () => {
    expect(t("datacost.estimate_note", "en", { price: "₦0.80" })).toMatch(/estimate/i);
    expect(t("datacost.web.faq_answer", "en", { price: "₦0.80", hours: 6 })).toMatch(/estimate/i);
  });
});
