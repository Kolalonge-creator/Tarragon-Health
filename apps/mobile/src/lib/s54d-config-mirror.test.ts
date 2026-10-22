import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getProposedConfig } from "@tarragon/shared";
import { en } from "@tarragon/i18n";
import { DOSE_REASONS, NAFDAC_HELPER_CONFIG, REMINDER_RELIABILITY_CONFIG, RUNWAY_CONFIG } from "@tarragon/medicines";
import { loadMedicineRules, loadNafdacHelperConfig, loadReminderReliability, loadRunwayConfig } from "./medicines-config";

describe("S54d versioned config mirrors", () => {
  it("medicines.reminder_reliability equals the compiled-in values", () => {
    expect(getProposedConfig("medicines.reminder_reliability").value).toEqual({ ...REMINDER_RELIABILITY_CONFIG });
    expect(loadReminderReliability()).toEqual(REMINDER_RELIABILITY_CONFIG);
  });
  it("medicines.dose_reasons equals the compiled-in list", () => {
    expect(getProposedConfig("medicines.dose_reasons").value).toEqual(DOSE_REASONS.map((r) => ({ ...r })));
  });
  it("medicines.runway_and_stock_freshness equals the compiled-in values", () => {
    expect(getProposedConfig("medicines.runway_and_stock_freshness").value).toEqual({ ...RUNWAY_CONFIG });
    expect(loadRunwayConfig()).toEqual(RUNWAY_CONFIG);
    expect(RUNWAY_CONFIG.lowSupplyDays).toBe(loadMedicineRules().lowSupplyDays);
  });
  it("medicines.nafdac_verify_helper equals the compiled-in values, and the short code is still marked unverified", () => {
    expect(getProposedConfig("medicines.nafdac_verify_helper").value).toEqual(NAFDAC_HELPER_CONFIG);
    expect(loadNafdacHelperConfig()).toEqual(NAFDAC_HELPER_CONFIG);
    expect(NAFDAC_HELPER_CONFIG.mas.verified).toBe(false);
  });
  it("the SQL function that decides which dose reasons are private covers every private reason in the config", () => {
    const sql = readFileSync(join(__dirname, "../../../../supabase/migrations/20261022093825_s54d_private_dose_reasons_and_nafdac_helper_guard.sql"), "utf8");
    const m = /select p_code in \(([^)]*)\)/.exec(sql);
    expect(m).not.toBeNull();
    const sqlCodes = (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/'/g, ""));
    for (const r of DOSE_REASONS.filter((x) => x.private)) expect(sqlCodes).toContain(r.code);
  });
});

describe("reminder wording stays generic (INV-07)", () => {
  const strings = [
    en["medicines.notify.title"], en["medicines.notify.body"], en["medicines.notify.follow_up_title"], en["medicines.notify.follow_up_body"],
    en["medicines.notify.test_title"], en["medicines.notify.test_body"],
  ];
  it("names no medicine, dose or condition placeholder", () => {
    for (const s of strings) expect(s).not.toMatch(/\{(drug|medicine|medication|dose)/i);
  });
  it("the ran-out and NAFDAC strings avoid em dashes and never say a registration match proves a pack", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("meds.ran_out.") || k.startsWith("medicines.nafdac.helper.") || k.startsWith("reliability."));
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) expect(en[k as keyof typeof en]).not.toContain("—");
    expect(en["medicines.nafdac.helper.not_proof"]).toBe("A registration match is not proof that a pack is genuine.");
  });
});
