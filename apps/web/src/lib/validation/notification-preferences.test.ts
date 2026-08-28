import { describe, expect, it } from "@jest/globals";
import { notificationPreferencesSchema } from "./notification-preferences";

const BASE = {
  preferred_channel: "whatsapp" as const,
  frequency: "normal" as const,
  quiet_hours_start: "",
  quiet_hours_end: "",
  email_enabled: true,
  sms_enabled: true,
  push_enabled: true,
  whatsapp_enabled: true,
  in_app_enabled: true,
};

describe("notificationPreferencesSchema", () => {
  it("accepts a full valid payload", () => {
    const result = notificationPreferencesSchema.safeParse(BASE);
    expect(result.success).toBe(true);
  });

  it("accepts booleans read by checkbox presence (matches the server action's raw shape)", () => {
    const result = notificationPreferencesSchema.safeParse({
      ...BASE,
      email_enabled: false,
      sms_enabled: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email_enabled).toBe(false);
      expect(result.data.sms_enabled).toBe(false);
    }
  });

  it("rejects an unknown channel", () => {
    const result = notificationPreferencesSchema.safeParse({ ...BASE, preferred_channel: "carrier_pigeon" });
    expect(result.success).toBe(false);
  });

  it("accepts a matched quiet-hours start/end pair", () => {
    const result = notificationPreferencesSchema.safeParse({
      ...BASE,
      quiet_hours_start: "22:00",
      quiet_hours_end: "07:00",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a quiet-hours start with no end", () => {
    const result = notificationPreferencesSchema.safeParse({ ...BASE, quiet_hours_start: "22:00" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed quiet-hours time", () => {
    const result = notificationPreferencesSchema.safeParse({
      ...BASE,
      quiet_hours_start: "10pm",
      quiet_hours_end: "07:00",
    });
    expect(result.success).toBe(false);
  });
});
