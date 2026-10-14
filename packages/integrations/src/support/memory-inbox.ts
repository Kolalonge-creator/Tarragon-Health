import { fail, ok } from "../../../../supabase/functions/_shared/integrations/result.ts";
import { sha256Hex } from "../../../../supabase/functions/_shared/integrations/crypto.ts";
import type { ClaimedEvent, InboxProvider, InboxStore } from "../../../../supabase/functions/_shared/integrations/webhook-inbox.ts";

/**
 * An in-memory copy of the provider_events rules in the database (migration s14x): one row per (provider, key), a bad signature is
 * stored 'rejected' under a body-hash key and can never be claimed, a claim takes a lease, complete/fail need the lease token,
 * failures back off, attempts are capped. The SQL proof (packages/db/tests/s14x_*.sql) is what proves the real thing; this copy lets
 * the handler logic be tested without a database. The two are kept honest by testing the same scenarios in both.
 */
export interface MemoryRow {
  id: string;
  provider: InboxProvider;
  eventType: string;
  key: string;
  rawBody: string;
  sha: string;
  verified: boolean;
  status: "received" | "processing" | "processed" | "failed" | "dead" | "rejected";
  attempts: number;
  deliveries: number;
  lease: string | null;
  lockedUntilMs: number | null;
  nextAttemptMs: number;
  lastError: string | null;
  entity: string | null;
  replays: number;
}

export interface MemoryInbox extends InboxStore {
  readonly rows: MemoryRow[];
  advance(ms: number): void;
  /** What the admin replay does (admin only, audited, in the database). */
  replay(id: string): boolean;
  /** Makes the next call of that kind fail, the way a dropped connection or an unapplied migration does. */
  failNext(fn: "record" | "claim" | "claimDue" | "complete" | "fail"): void;
}

export function createMemoryInbox(opts: { maxAttempts?: number; leaseMs?: number; backoffMs?: number } = {}): MemoryInbox {
  const maxAttempts = opts.maxAttempts ?? 8;
  const leaseMs = opts.leaseMs ?? 120_000;
  const backoffMs = opts.backoffMs ?? 30_000;
  const rows: MemoryRow[] = [];
  const failing = new Set<string>();
  let clock = 1_000_000;
  let seq = 0;
  const tripped = (fn: string): boolean => failing.delete(fn);

  const claimable = (r: MemoryRow, byId: boolean): boolean => {
    if (!r.verified || r.status === "processed" || r.status === "rejected" || r.status === "dead") return false;
    if (r.status === "processing") return (r.lockedUntilMs ?? 0) < clock;
    return byId || r.nextAttemptMs <= clock;
  };
  const take = (r: MemoryRow): string => {
    r.status = "processing";
    r.lease = `lease-${(seq += 1)}`;
    r.lockedUntilMs = clock + leaseMs;
    r.attempts += 1;
    return r.lease;
  };

  return {
    rows,
    advance(ms) {
      clock += ms;
    },
    replay(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || !r.verified || r.status === "rejected" || (r.status === "processing" && (r.lockedUntilMs ?? 0) >= clock)) return false;
      r.status = "received";
      r.attempts = 0;
      r.nextAttemptMs = clock;
      r.lease = null;
      r.lockedUntilMs = null;
      r.lastError = null;
      r.replays += 1;
      return true;
    },
    failNext(fn) {
      failing.add(fn);
    },
    async record(i) {
      if (tripped("record")) return fail("vendor_error", "record_provider_event failed", true);
      const sha = await sha256Hex(i.rawBody);
      const key = i.verified ? i.idempotencyKey : `unverified:${sha}`;
      const existing = rows.find((r) => r.provider === i.provider && r.key === key);
      if (existing) {
        existing.deliveries += 1;
        return ok({ id: existing.id, status: existing.status, duplicate: true, verified: existing.verified, bodyDiffers: existing.sha !== sha });
      }
      const row: MemoryRow = {
        id: `evt-${(seq += 1)}`, provider: i.provider, eventType: i.eventType, key, rawBody: i.rawBody, sha, verified: i.verified,
        status: i.verified ? "received" : "rejected", attempts: 0, deliveries: 1, lease: null, lockedUntilMs: null, nextAttemptMs: clock, lastError: null, entity: null, replays: 0,
      };
      rows.push(row);
      return ok({ id: row.id, status: row.status, duplicate: false, verified: row.verified, bodyDiffers: false });
    },
    async claim(id) {
      if (tripped("claim")) return fail("network", "claim_provider_event could not be reached");
      const r = rows.find((x) => x.id === id);
      if (!r || !claimable(r, true)) return ok(null);
      if (r.attempts >= maxAttempts) {
        r.status = "dead";
        return ok(null);
      }
      return ok(take(r));
    },
    async claimDue(limit) {
      if (tripped("claimDue")) return fail("vendor_error", "claim_provider_events failed", true);
      const out: ClaimedEvent[] = [];
      for (const r of [...rows].sort((a, b) => a.nextAttemptMs - b.nextAttemptMs)) {
        if (out.length >= limit) break;
        if (!claimable(r, false)) continue;
        if (r.attempts >= maxAttempts) {
          r.status = "dead";
          continue;
        }
        const lease = take(r);
        out.push({ id: r.id, leaseToken: lease, provider: r.provider, eventType: r.eventType, idempotencyKey: r.key, rawBody: r.rawBody, attemptCount: r.attempts });
      }
      return ok(out);
    },
    async complete(id, leaseToken, entity) {
      if (tripped("complete")) return fail("vendor_error", "complete_provider_event failed", true);
      const r = rows.find((x) => x.id === id);
      if (!r || r.lease !== leaseToken || r.status !== "processing") return ok(false);
      r.status = "processed";
      r.lease = null;
      r.lockedUntilMs = null;
      r.entity = entity ? `${entity.type}:${entity.id}` : r.entity;
      return ok(true);
    },
    async fail(id, leaseToken, error, permanent) {
      if (tripped("fail")) return fail("vendor_error", "fail_provider_event failed", true);
      const r = rows.find((x) => x.id === id);
      if (!r || r.lease !== leaseToken || r.status !== "processing") return ok("stale");
      r.lease = null;
      r.lockedUntilMs = null;
      r.lastError = error;
      if (permanent || r.attempts >= maxAttempts) {
        r.status = "dead";
        return ok("dead");
      }
      r.status = "failed";
      r.nextAttemptMs = clock + backoffMs * 2 ** (r.attempts - 1);
      return ok("failed");
    },
  };
}
