// S10 event bus: the processor loop, with every outside call injected so it can be tested without
// a database or a network. Used by supabase/functions/process-events and tested from packages/events.
//
// Delivery is at least once. A handler must therefore be safe to run twice: use ctx.once(name, fn)
// for any side effect that must not repeat (it is keyed by event, subscriber and name, and survives
// a replay), and read patient records through the audited path, never from the event payload (INV-10).

export interface BusEvent {
  deliveryId: string;
  leaseToken: string;
  attempt: number;
  eventId: string;
  eventType: string;
  eventVersion: number;
  organisationId: string;
  patientId: string | null;
  aggregateType: string | null;
  aggregateId: string | null;
  payload: Record<string, unknown>;
  priority: "normal" | "urgent";
  isTest: boolean;
  occurredAt: string;
  subscriberKey: string;
  handlerKey: string;
}

export interface BusPorts {
  claim(limit: number, urgentOnly: boolean): Promise<BusEvent[]>;
  complete(deliveryId: string, leaseToken: string): Promise<boolean>;
  fail(deliveryId: string, leaseToken: string, message: string, permanent: boolean): Promise<string>;
  recordEffect(deliveryId: string, effectKey: string): Promise<boolean>;
  releaseEffect(deliveryId: string, effectKey: string): Promise<boolean>;
  now(): number;
  log?(level: "info" | "error", message: string, fields: Record<string, unknown>): void;
}

export interface HandlerContext {
  /** Runs fn once per (event, subscriber, name), even across retries and replays. If fn throws, the record is undone so the retry runs it again. */
  once(name: string, fn: () => Promise<void>): Promise<boolean>;
}

export type Handler = (event: BusEvent, ctx: HandlerContext) => Promise<void>;
export type HandlerRegistry = Readonly<Record<string, Handler>>;

/** Throw this for a failure a retry cannot fix (malformed payload, a record that no longer exists). The delivery goes straight to the dead letter. */
export class PermanentHandlerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentHandlerError";
  }
}

export interface RunOptions {
  urgentOnly: boolean;
  batchSize: number;
  maxBatches: number;
  /** Stop starting new batches after this many milliseconds. */
  budgetMs: number;
}

export interface RunSummary {
  batches: number;
  claimed: number;
  done: number;
  retried: number;
  dead: number;
  lostLease: number;
  errors: number;
  claimFailed: boolean;
}

const MAX_ERROR_LENGTH = 500;

function errorText(e: unknown): string {
  const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return text.slice(0, MAX_ERROR_LENGTH);
}

async function runOne(ports: BusPorts, handlers: HandlerRegistry, ev: BusEvent, summary: RunSummary): Promise<void> {
  const handler = Object.prototype.hasOwnProperty.call(handlers, ev.handlerKey) ? handlers[ev.handlerKey] : undefined;
  if (!handler) {
    const status = await ports.fail(ev.deliveryId, ev.leaseToken, `no handler registered for ${ev.handlerKey}`, true);
    if (status === "stale") summary.lostLease += 1;
    else summary.dead += 1;
    return;
  }

  const ctx: HandlerContext = {
    async once(name, fn) {
      const key = `${ev.eventId}:${ev.subscriberKey}:${name}`;
      const first = await ports.recordEffect(ev.deliveryId, key);
      if (!first) return false;
      try {
        await fn();
      } catch (e) {
        await ports.releaseEffect(ev.deliveryId, key);
        throw e;
      }
      return true;
    },
  };

  try {
    await handler(ev, ctx);
  } catch (e) {
    const permanent = e instanceof PermanentHandlerError;
    const status = await ports.fail(ev.deliveryId, ev.leaseToken, errorText(e), permanent);
    if (status === "stale") summary.lostLease += 1;
    else if (status === "dead") summary.dead += 1;
    else summary.retried += 1;
    return;
  }

  if (await ports.complete(ev.deliveryId, ev.leaseToken)) summary.done += 1;
  else summary.lostLease += 1;
}

export async function runBatches(ports: BusPorts, handlers: HandlerRegistry, opts: RunOptions): Promise<RunSummary> {
  const summary: RunSummary = { batches: 0, claimed: 0, done: 0, retried: 0, dead: 0, lostLease: 0, errors: 0, claimFailed: false };
  const started = ports.now();

  while (summary.batches < opts.maxBatches && ports.now() - started < opts.budgetMs) {
    let batch: BusEvent[];
    try {
      batch = await ports.claim(opts.batchSize, opts.urgentOnly);
    } catch (e) {
      summary.claimFailed = true;
      ports.log?.("error", "claim failed", { error: errorText(e) });
      break;
    }
    if (batch.length === 0) break;
    summary.batches += 1;
    summary.claimed += batch.length;

    for (const ev of batch) {
      try {
        await runOne(ports, handlers, ev, summary);
      } catch (e) {
        // The report back to the database failed. The lease will expire and the delivery will be reclaimed.
        summary.errors += 1;
        ports.log?.("error", "could not record a delivery outcome", { deliveryId: ev.deliveryId, error: errorText(e) });
      }
    }
    if (batch.length < opts.batchSize) break;
  }

  if (summary.dead > 0) ports.log?.("error", "deliveries went to the dead letter", { dead: summary.dead });
  return summary;
}

/** The only handler S10 ships: it does nothing. Used by tests and to prove the pipe end to end. */
export const noopHandler: Handler = async () => {};
