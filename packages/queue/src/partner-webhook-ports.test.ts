import { describe, expect, it, jest } from "@jest/globals";
import { partnerWebhookPorts } from "../../../supabase/functions/process-events/queue-ports";

describe("partnerWebhookPorts (S10x)", () => {
  it("calls the database function with the delivery id and returns how many rows were queued", async () => {
    const rpc = jest.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: 2, error: null }));
    expect(await partnerWebhookPorts({ rpc }).enqueue("d1")).toBe(2);
    expect(rpc).toHaveBeenCalledWith("partner_webhook_enqueue_for_delivery", { p_delivery_id: "d1" });
  });

  it("treats a non-number answer as zero", async () => {
    expect(await partnerWebhookPorts({ rpc: async () => ({ data: null, error: null }) }).enqueue("d1")).toBe(0);
  });

  it("raises a database error so the bus retries the delivery", async () => {
    await expect(partnerWebhookPorts({ rpc: async () => ({ data: null, error: { message: "boom" } }) }).enqueue("d1")).rejects.toThrow(
      "partner_webhook_enqueue_for_delivery: boom",
    );
  });
});
