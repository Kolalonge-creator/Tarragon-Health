import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const insert = jest.fn<(row: Record<string, unknown>) => Promise<{ error: null }>>(() =>
  Promise.resolve({ error: null })
);
const rpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>(() =>
  Promise.resolve({ data: [], error: null })
);
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ from: () => ({ insert }), rpc }),
}));

import { createLifestyleMessagingGateway } from "./messaging-gateway";

describe("createLifestyleMessagingGateway", () => {
  beforeEach(() => {
    insert.mockClear();
    rpc.mockClear();
    rpc.mockImplementation(() => Promise.resolve({ data: [], error: null }));
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

  // OQ-94: the INV-07 term list at write time
  it("runs the term list over the free text and queues when clean", async () => {
    const gateway = createLifestyleMessagingGateway("org-1");
    await gateway.send({ patientId: "p1", templateKey: "lifestyle_nudge", messageClass: "coaching_nudge", variables: { message: "A short walk today could feel good." } });
    expect(rpc).toHaveBeenCalledWith("check_notification_text", { p_text: "A short walk today could feel good." });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("refuses a message the term list flags (a condition named) and queues nothing", async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: ["term:blood pressure"], error: null }));
    const gateway = createLifestyleMessagingGateway("org-1");
    const result = await gateway.send({ patientId: "p1", templateKey: "lifestyle_nudge", messageClass: "coaching_nudge", variables: { message: "Your blood pressure may improve with a walk." } });
    expect(result).toEqual({ ok: false });
    expect(insert).not.toHaveBeenCalled();
  });

  it("fails closed when the check itself fails", async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: "down" } }));
    const gateway = createLifestyleMessagingGateway("org-1");
    await expect(gateway.send({ patientId: "p1", templateKey: "lifestyle_nudge", messageClass: "coaching_nudge", variables: { message: "A short walk today could feel good." } })).resolves.toEqual({ ok: false });
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not call the check when there is no free text", async () => {
    const gateway = createLifestyleMessagingGateway("org-1");
    await gateway.send({ patientId: "p1", templateKey: "lifestyle_nudge", messageClass: "coaching_nudge" });
    expect(rpc).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
