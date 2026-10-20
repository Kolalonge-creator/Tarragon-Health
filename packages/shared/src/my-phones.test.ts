import { describe, expect, it } from "@jest/globals";
import { buildPhoneViews, cleanPhoneName, phoneUpdateArgs, defaultPhoneName, parsePhoneRows, phoneStatus, type PhoneRow } from "./my-phones";

const NOW = new Date("2026-10-20T10:00:00Z");
const row = (o: Partial<PhoneRow> & { device_id: string }): PhoneRow => ({
  platform: "android",
  last_checkin_at: "2026-10-19T10:00:00Z",
  lease_expires_at: "2026-11-18T10:00:00Z",
  ...o,
});

describe("my phones", () => {
  it("reads status from the row", () => {
    expect(phoneStatus(row({ device_id: "a" }), NOW)).toBe("active");
    expect(phoneStatus(row({ device_id: "a", lease_expires_at: "2026-10-01T00:00:00Z" }), NOW)).toBe("lapsed");
    expect(phoneStatus(row({ device_id: "a", revoked_at: "2026-10-19T00:00:00Z" }), NOW)).toBe("removal_pending");
    expect(phoneStatus(row({ device_id: "a", revoked_at: "x", wipe_confirmed_at: "y" }), NOW)).toBe("wiped");
  });

  it("falls back to a plain name and marks this phone", () => {
    const v = buildPhoneViews([row({ device_id: "a", platform: "ios" }), row({ device_id: "b", device_label: "  Mum's Tecno " })], NOW, "b");
    expect(v.find((p) => p.deviceId === "a")).toMatchObject({ name: "iPhone", nameIsDefault: true, isThisPhone: false });
    expect(v.find((p) => p.deviceId === "b")).toMatchObject({ name: "Mum's Tecno", nameIsDefault: false, isThisPhone: true });
    expect(defaultPhoneName("android")).toBe("Android phone");
  });

  it("web passes no phone id, so nothing is called this phone", () => {
    expect(buildPhoneViews([row({ device_id: "a" })], NOW, null)[0]?.isThisPhone).toBe(false);
  });

  it("orders pending removal first, wiped last, hides retired silent phones", () => {
    const v = buildPhoneViews(
      [
        row({ device_id: "wiped", revoked_at: "x", wipe_confirmed_at: "y", unsent_at_wipe: 3, danger_at_wipe: 1 }),
        row({ device_id: "old", last_checkin_at: "2026-10-01T00:00:00Z" }),
        row({ device_id: "new" }),
        row({ device_id: "pending", revoked_at: "x" }),
        row({ device_id: "retired", retired_at: "2026-09-01T00:00:00Z" }),
      ],
      NOW,
      null
    );
    expect(v.map((p) => p.deviceId)).toEqual(["pending", "new", "old", "wiped"]);
    expect(v[3]).toMatchObject({ unsentAtWipe: 3, urgentAtWipe: 1 });
  });

  it("drops malformed rows and says how many", () => {
    const r = parsePhoneRows([row({ device_id: "a" }), { device_id: 5 }, null]);
    expect(r.rows).toHaveLength(1);
    expect(r.dropped).toBe(2);
    expect(parsePhoneRows(undefined)).toEqual({ rows: [], dropped: 0 });
  });

  it("cleans a typed name", () => {
    expect(cleanPhoneName("  my\nphone \t ")).toBe("my phone");
    expect(cleanPhoneName("   ")).toBeNull();
    expect(cleanPhoneName("a".repeat(60))).toHaveLength(40);
    expect(cleanPhoneName("ab\u0085cd")).toBe("ab cd");
    // an emoji at the boundary is kept whole or dropped, never split
    const cut = cleanPhoneName("a".repeat(39) + "😀😀") ?? "";
    expect(Array.from(cut).length).toBeLessThanOrEqual(40);
    expect(cut.endsWith("😀")).toBe(true);
  });

  it("builds update arguments with only what changed", () => {
    expect(phoneUpdateArgs("d", { shared: false })).toEqual({ p_device: "d", p_shared: false });
    expect(phoneUpdateArgs("d", { label: null })).toEqual({ p_device: "d", p_clear_label: true });
    expect(phoneUpdateArgs("d", { label: "Mum" })).toEqual({ p_device: "d", p_label: "Mum" });
  });
});
