import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const insert = jest.fn<(row: Record<string, unknown>) => Promise<{ error: null }>>(() =>
  Promise.resolve({ error: null })
);
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ from: () => ({ insert }) }),
}));

import { createLifestyleMessagingGateway } from "./messaging-gateway";

describe("createLifestyleMessagingGateway", () => {
  beforeEach(() => {
    insert.mockClear();
  });

  it("queues a nudge on the in_app channel", async () => {
    const gateway = createLifestyleMessagingGateway("org-1");
    const result = await gateway.send({
      patientId: "patient-1",
      templateKey: "lifestyle_nudge",
      messageClass: "coaching_nudge",
      variables: { message: "A short walk today could feel good." },
    });
    expect(result).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0]![0]).toMatchObject({
      organisation_id: "org-1",
      recipient_id: "patient-1",
      channel: "in_app",
      template: "lifestyle_nudge",
    });
  });

  it("refuses to queue copy that fails toneGuard", async () => {
    const gateway = createLifestyleMessagingGateway("org-1");
    const result = await gateway.send({
      patientId: "patient-1",
      templateKey: "lifestyle_nudge",
      messageClass: "coaching_nudge",
      variables: { message: "Don't be lazy." },
    });
    expect(result).toEqual({ ok: false });
    expect(insert).not.toHaveBeenCalled();
  });
});
