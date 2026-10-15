// S14x: POST /functions/v1/provider-event-drain. Runs what the provider event inbox is waiting on: events that failed and are past
// their backoff, and events whose lease expired (a crash mid-handler), including events an admin replayed. Each event goes to the same
// handler that would have run it on first delivery. Shared-secret header; fails closed without its secret. Not scheduled yet (needs a
// vault secret and a cron entry: a deploy step, see the closeout).
import { constantTimeEqual } from "../_shared/integrations/crypto.ts";
import { drainInbox, type Dispatch, type InboxProvider, type InboxStore } from "../_shared/integrations/webhook-inbox.ts";

export interface DrainDeps {
  readonly secret: string | null;
  readonly store: InboxStore;
  readonly dispatchers: Readonly<Record<InboxProvider, Dispatch>>;
  readonly limit?: number;
}

export async function handleDrain(req: Request, deps: DrainDeps): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  if (!deps.secret) return Response.json({ error: "not configured" }, { status: 503 });
  if (!constantTimeEqual(req.headers.get("x-provider-drain-secret") ?? "", deps.secret)) return Response.json({ error: "unauthorised" }, { status: 401 });
  const out = await drainInbox(deps.store, deps.dispatchers, deps.limit ?? 20);
  return out.ok ? Response.json(out.data) : Response.json({ error: "drain_failed" }, { status: 502 });
}
