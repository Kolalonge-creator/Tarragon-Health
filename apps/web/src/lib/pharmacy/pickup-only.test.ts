import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { PHARMACY_DELIVERY_ENABLED } from "./pickup-only";
import { nairaFromKobo, priceRowsSchema, stockKey } from "@/lib/pharmacy-collection/model";

const SRC = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("S54 D5: no home delivery for patients", () => {
  it("the switch is off", () => {
    expect(PHARMACY_DELIVERY_ENABLED).toBe(false);
  });

  it("an order is always created as pickup and no delivery fee is added to its total", () => {
    const src = read("lib/queries/pharmacy-orders.ts");
    expect(src).toContain('fulfilment_method: "pickup"');
    expect(src).toContain("const totalKobo = medication.price_kobo * quantity;");
    expect(src).not.toMatch(/fulfilmentMethod === "delivery"/);
  });

  it("the patient catalogue no longer shows a delivery option", () => {
    const src = read("app/(dashboard)/patient/pharmacy-catalogue.tsx");
    expect(src).not.toMatch(/Delivery\s*·\s*coming soon/);
    expect(src).not.toMatch(/Home delivery is coming soon/);
  });

  it("the delivery address form, the delivery fee line and the staff courier controls sit behind the switch", () => {
    const list = read("app/(dashboard)/patient/pharmacy-orders-list.tsx");
    expect(list).toMatch(/PHARMACY_DELIVERY_ENABLED\s*&&\s*\n?\s*order\.fulfilment_method === "delivery"/);
    expect(list).toMatch(/PHARMACY_DELIVERY_ENABLED && order\.status === "delivery_failed" && <DeliveryAddressForm/);
    expect(list).toMatch(/PHARMACY_DELIVERY_ENABLED \? \(order\.logistics_partner\?\.delivery_fee_kobo/);
    const staff = read("app/(dashboard)/clinician/orders/page.tsx");
    expect(staff).toMatch(/PHARMACY_DELIVERY_ENABLED && order\.status === "delivery_failed" && <AssignLogisticsForm/);
    expect(staff).toMatch(/PHARMACY_DELIVERY_ENABLED &&\s*\n\s*\(order\.status === "payment_confirmed"/);
  });

  it("the admin pharmacy page no longer advertises delivery", () => {
    expect(read("app/(dashboard)/admin/settings/partners/pharmacies/pharmacies-manager.tsx")).not.toContain('<Badge variant="blue">Delivery</Badge>');
  });

  it("the migration keeps the database to pickup", () => {
    const dir = join(SRC, "..", "..", "..", "supabase", "migrations");
    const file = readdirSync(dir).find((f: string) => f.endsWith("_s54_pharmacy_price_compare_quality_chat_pickup_only.sql")) as string;
    const sql = readFileSync(join(dir, file), "utf8");
    expect(sql).toMatch(/add constraint pharmacy_orders_pickup_only check \(fulfilment_method = 'pickup'/);
    expect(sql).toMatch(/pharmacy_orders 0 \(so 0 with a non-pickup fulfilment_method/);
    expect(sql).not.toMatch(/drop table/i);
  });
});

describe("S54 8.9 price comparison display helpers", () => {
  it("shows integer kobo as naira without inventing precision", () => {
    expect(nairaFromKobo(250000)).toBe("₦2,500");
    expect(nairaFromKobo(250050)).toBe("₦2,500.50");
    expect(nairaFromKobo(0)).toBe("₦0");
  });
  it("maps every stock value, treating anything unknown as not confirmed", () => {
    expect(stockKey("in_stock")).toBe("pharmprice.in_stock");
    expect(stockKey("low_stock")).toBe("pharmprice.low_stock");
    expect(stockKey("unavailable")).toBe("pharmprice.unavailable");
    expect(stockKey("unknown")).toBe("pharmprice.unknown_stock");
    expect(stockKey("anything else")).toBe("pharmprice.unknown_stock");
  });
  it("the price row has no earning field and a malformed row fails the parse", () => {
    const keys = Object.keys(priceRowsSchema.element.shape);
    expect(keys.some((k) => /commission|margin|earn|rate/i.test(k))).toBe(false);
    expect(priceRowsSchema.safeParse([{ partner_id: "x" }]).success).toBe(false);
  });
});
