import { refundIdempotencyKeyFromWebhook } from "./refund-idempotency";
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

  it("keys idempotency exactly as the webhook does for the same refund", async () => {
    const inserts: Insert[] = [];
    await recordRefundLedgerEntry(clientRecording(inserts), base);
    // The webhook derives its key from the refund.* payload through the
    // mirrored refundIdempotencyKeyFromWebhook. If these two ever diverge, a
    // refund issued by a cron and confirmed by the webhook posts the reversal
    // TWICE — which is exactly what the old `refund:${data.id}` key did, since
    // a refund.* payload carries no `id` and the webhook fell through to the
    // request body's byte length.
    expect(inserts[0].provider_event_id).toBe(
      refundIdempotencyKeyFromWebhook({
        transaction_reference: base.chargeReference,
        amount: String(base.amountMinor),
      }),
    );
    expect(inserts[0].provider_event_id).toBe("refund:ref_original_charge:500000");
  });

  it("still records Paystack's refund id, just not as the key", async () => {
    const inserts: Insert[] = [];
    await recordRefundLedgerEntry(clientRecording(inserts), base);
    const payload = inserts[0].raw_payload as { data: { id: string } };
    expect(payload.data.id).toBe("998877");
  });

  it("refuses to post a refund with no original charge reference", async () => {
    const inserts: Insert[] = [];
    const result = await recordRefundLedgerEntry(clientRecording(inserts), {
      ...base,
      chargeReference: "",
    });
    // No reference means no key the webhook could ever agree with. Inventing
    // one would double-post the reversal the moment the webhook arrived.
    expect(result.posted).toBe(false);
    expect(result.error).toMatch(/identified/);
    expect(inserts).toHaveLength(0);
  });

  it("treats a duplicate-key conflict as already-posted, not as a failure", async () => {
    const result = await recordRefundLedgerEntry(
      clientRecording([], { code: "23505", message: "duplicate key" }),
      base,
    );
    expect(result).toEqual({ posted: false, alreadyPosted: true });
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
