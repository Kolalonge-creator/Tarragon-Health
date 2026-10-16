import { assistedRefusalMessage, classifyAssistedRefusal, type AssistedRefusal } from "@tarragon/shared";

/**
 * A helper's reading refused by the database's assisted-entry guard (not allowed, too many, not typed or device-sourced, too old), turned into
 * something a client can act on. Null when the error is not one of ours, so the caller keeps its own handling. The phone's outbox reads
 * 403 and 422 as "will never succeed" and 429 and 503 as "try again later", which is exactly the difference between these refusals.
 */
const STATUS: Record<AssistedRefusal, number> = {
  not_permitted: 403,
  rate_limited: 429,
  source: 422,
  too_old: 422,
  unavailable: 503,
};

export function assistedRefusalResponse(
  error: { code?: string | null; message?: string | null } | null | undefined,
): { status: number; message: string; kind: AssistedRefusal } | null {
  const kind = classifyAssistedRefusal(error);
  if (!kind) return null;
  return { status: STATUS[kind], message: assistedRefusalMessage(kind), kind };
}
