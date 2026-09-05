import { recordRefundLedgerEntry } from "./refund-posting";

type Insert = Record<string, unknown>;

function clientRecording(inserts: Insert[], error: { code?: string; message: string } | null = null) {
  return {
    from(table: string) {
      expect(table).toBe("payment_transactions");
      return {
        insert(row: Insert) {
          inserts.push(row);
          return Promise.resolve({ error });
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const base = {
  refundId: "998877",
  chargeReference: "ref_original_charge",
  amountMinor: 500_000,
  currency: "NGN" as const,
  organisationId: "11111111-1111-1111-1111-111111111111",
  source: "video_visit_request",
  sourceId: "22222222-2222-2222-2222-222222222222",
};

describe("recordRefundLedgerEntry", () => {
  it("writes the row shape private.finance_post_from_payment's refund branch needs", async () => {
    const inserts: Insert[] = [];
    const result = await recordRefundLedgerEntry(clientRecording(inserts), base);

    expect(result).toEqual({ posted: true });
    expect(inserts).toHaveLength(1);
    const row = inserts[0];

    // event_type must match the branch's `ilike '%refund%'` test...
    expect(row.event_type).toBe("refund.processed");
    // ...and processed_at must be set, because the branch returns early
    // without it and finance_post_payment_processed never fires.
    expect(typeof row.processed_at).toBe("string");
    // The amount and org scope the Dr 4900 / Cr 1020 lines.
    expect(row.amount_minor).toBe(500_000);
    expect(row.currency).toBe("NGN");
    expect(row.organisation_id).toBe(base.organisationId);
  });

  it("keys idempotency on the refund id, matching what the webhook derives", async () => {
    const inserts: Insert[] = [];
    await recordRefundLedgerEntry(clientRecording(inserts), base);
    // supabase/functions/paystack-webhook/index.ts builds `refund:${data.id}`
    // for a refund.* event. If these two ever diverge, a refund issued by a
    // cron and confirmed by the webhook posts the reversal TWICE.
    expect(inserts[0].provider_event_id).toBe("refund:998877");
  });

  it("treats a duplicate-key conflict as already-posted, not as a failure", async () => {
    const result = await recordRefundLedgerEntry(
      clientRecording([], { code: "23505", message: "duplicate key" }),
      base,
    );
    expect(result).toEqual({ posted: false });
    expect(result.error).toBeUndefined();
  });

  it("reports any other insert failure rather than swallowing it", async () => {
    const result = await recordRefundLedgerEntry(
      clientRecording([], { code: "42501", message: "permission denied" }),
      base,
    );
    expect(result.posted).toBe(false);
    expect(result.error).toBe("permission denied");
  });

  it("refuses a non-positive amount instead of writing a row that posts nothing", async () => {
    const inserts: Insert[] = [];
    const result = await recordRefundLedgerEntry(clientRecording(inserts), { ...base, amountMinor: 0 });
    // finance_post_from_payment returns early on amount <= 0, so such a row
    // would be an audit record that silently moves no money.
    expect(result.posted).toBe(false);
    expect(result.error).toMatch(/positive/);
    expect(inserts).toHaveLength(0);
  });
});
