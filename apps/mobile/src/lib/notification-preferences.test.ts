jest.mock("./supabase", () => ({ supabase: {} }));

import { channelTogglesFromRow } from "./notification-preferences";

describe("channelTogglesFromRow", () => {
  it("defaults every channel on when there is no row", () => {
    expect(channelTogglesFromRow(undefined)).toEqual({ email: true, sms: true, push: true });
  });

  it("reflects the stored email, sms and push values", () => {
    expect(channelTogglesFromRow({ email_enabled: false, sms_enabled: true, push_enabled: false })).toEqual({
      email: false,
      sms: true,
      push: false,
    });
  });

  it("ignores unknown or legacy columns such as whatsapp_enabled", () => {
    const legacy = { email_enabled: true, sms_enabled: true, push_enabled: true, whatsapp_enabled: true };
    const result = channelTogglesFromRow(legacy);
    expect(Object.keys(result).sort()).toEqual(["email", "push", "sms"]);
  });
});
