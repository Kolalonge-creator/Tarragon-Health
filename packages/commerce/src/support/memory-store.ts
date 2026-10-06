import { fail, ok, type ProviderResult } from "../../../../supabase/functions/_shared/integrations/result.ts";
import type { MismatchInput, OpenOrder, OrderStore, RecordOutcome, RecordPaymentInput } from "../../../../supabase/functions/_shared/commerce/orders.ts";

/**
 * In-memory stand-in for the database writers, with the same rules `record_order_payment` enforces in SQL (exact price,
 * one payment, one entitlement, one event per order), so the flows can be proved over webhook fixtures without a database.
 * The real functions are proved in packages/db/tests/s25_catalogue_orders_payments.sql.
 */
export interface MemOrder { reference: string; id: string; amountKobo: number; state: "created" | "paid" | "failed" | "cancelled"; expired: boolean; checkoutUrl: string | null }

export class MemoryStore implements OrderStore {
  readonly orders = new Map<string, MemOrder>();
  readonly payments: RecordPaymentInput[] = [];
  readonly entitlements: string[] = [];
  readonly events: string[] = [];
  readonly mismatches: MismatchInput[] = [];
  failNext = false;

  add(o: Partial<MemOrder> & { reference: string; amountKobo: number }): MemOrder {
    const order: MemOrder = { id: `order-${this.orders.size + 1}`, state: "created", expired: false, checkoutUrl: null, ...o };
    this.orders.set(order.reference, order);
    return order;
  }

  private dropped(): ProviderResult<never> | null {
    if (!this.failNext) return null;
    this.failNext = false;
    return fail("network", "db down");
  }

  async record(i: RecordPaymentInput): Promise<ProviderResult<RecordOutcome>> {
    const d = this.dropped();
    if (d) return d;
    const o = this.orders.get(i.reference);
    if (!o) return ok({ result: "not_found", orderId: null, reason: null });
    if (o.state === "paid") return ok({ result: "replay", orderId: o.id, reason: null });
    if (i.amountKobo !== o.amountKobo || i.currency !== "NGN" || i.totalKobo !== i.amountKobo + i.feeKobo) {
      this.mismatches.push({ reference: i.reference, reason: "amount", amountKobo: i.amountKobo, feeKobo: i.feeKobo, totalKobo: i.totalKobo, source: i.source, eventKey: i.eventKey, raw: i.raw });
      return ok({ result: "mismatch", orderId: o.id, reason: "amount" });
    }
    o.state = "paid";
    this.payments.push(i);
    this.entitlements.push(o.id);
    this.events.push(`order.paid:${o.id}`);
    return ok({ result: "paid", orderId: o.id, reason: null });
  }

  async flagMismatch(i: MismatchInput): Promise<ProviderResult<RecordOutcome>> {
    const d = this.dropped();
    if (d) return d;
    const o = this.orders.get(i.reference);
    if (!o) return ok({ result: "not_found", orderId: null, reason: null });
    if (o.state === "paid") return ok({ result: "replay", orderId: o.id, reason: null });
    this.mismatches.push(i);
    return ok({ result: "mismatch", orderId: o.id, reason: i.reason });
  }

  async close(reference: string): Promise<ProviderResult<boolean>> {
    const d = this.dropped();
    if (d) return d;
    const o = this.orders.get(reference);
    if (!o || o.state !== "created") return ok(false);
    o.state = "failed";
    return ok(true);
  }

  async listOpen(limit: number): Promise<ProviderResult<readonly OpenOrder[]>> {
    const d = this.dropped();
    if (d) return d;
    return ok([...this.orders.values()].filter((o) => o.state === "created").slice(0, limit).map((o) => ({ reference: o.reference, orderId: o.id, expired: o.expired })));
  }

  async setCheckoutUrl(reference: string, url: string): Promise<ProviderResult<boolean>> {
    const o = this.orders.get(reference);
    if (!o) return ok(false);
    o.checkoutUrl = url;
    return ok(true);
  }
}
