import { describe, expect, it } from "@jest/globals";
import { en } from "./en";

const keys = Object.keys(en).filter((k) => k.startsWith("preg.")) as (keyof typeof en)[];

describe("S67 pregnancy wording", () => {
  it("has the cards", () => {
    expect(keys.length).toBeGreaterThan(20);
    expect(en["preg.card.contact_today.body"]).toMatch(/today/);
  });
  it.each(keys)("%s has no em dash, never says wait, never promises a cure and says care team not doctor", (k) => {
    const text = en[k];
    expect(text).not.toMatch(/[–—]/);
    expect(text).not.toMatch(/\bwait\b|tomorrow|cure|instant doctor|free healthcare|your doctor/i);
  });
  it("the reminder names no condition, reading or result (INV-07)", () => {
    expect(en["preg.reminder.visit"]).not.toMatch(/pregnan|blood pressure|baby|antenatal|contraction|kick|reading|result/i);
  });
  it("the contact-today and go-now cards give an action, not advice to hold off", () => {
    expect(en["preg.card.contact_today.body"]).toMatch(/Contact your care team or go to a health facility today/);
    expect(en["preg.card.go_now.body"]).toMatch(/Go to your health facility now/);
  });
  it("the medicine default is ask-first", () => {
    expect(en["preg.medicine.default"]).toMatch(/^Ask your care team before/);
  });
});
