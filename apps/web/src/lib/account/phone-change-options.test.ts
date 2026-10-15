import { phoneChangeOptions } from "./phone-change-options";

describe("phoneChangeOptions mirrors the database gate", () => {
  it("offers the current number only when it is confirmed, masked", () => {
    const o = phoneChangeOptions({ phone: "2348031234567", phone_confirmed_at: "2026-01-01T00:00:00Z" });
    expect(o.needsConfirmation).toBe(true);
    expect(o.oldPhone?.masked).toBe("+234 *** *** 4567");
    expect(o.email).toBeNull();
    expect(JSON.stringify(o)).not.toContain("8031234567");
  });

  it("offers the email only when it is verified, masked", () => {
    const o = phoneChangeOptions({ email: "ada@example.ng", email_confirmed_at: "2026-01-01T00:00:00Z" });
    expect(o.needsConfirmation).toBe(true);
    expect(o.email?.masked).toBe("a***@example.ng");
    expect(o.oldPhone).toBeNull();
  });

  it("ignores an unverified phone and an unverified email, and then needs no confirmation (nothing to confirm with)", () => {
    const o = phoneChangeOptions({ phone: "2348031234567", phone_confirmed_at: null, email: "ada@example.ng", email_confirmed_at: null });
    expect(o).toEqual({ needsConfirmation: false, oldPhone: null, email: null });
  });

  it("offers both when both are confirmed", () => {
    const o = phoneChangeOptions({
      phone: "+2348031234567",
      phone_confirmed_at: "2026-01-01T00:00:00Z",
      email: "ada@example.ng",
      email_confirmed_at: "2026-01-01T00:00:00Z",
    });
    expect(o.oldPhone).not.toBeNull();
    expect(o.email).not.toBeNull();
  });
});
