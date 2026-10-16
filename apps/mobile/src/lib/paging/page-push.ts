/**
 * Reading an on-call page out of whatever the phone hands us (S19e). Pure: no native module, no network.
 *
 * The server's page and test-page pushes carry `data: { url: "/clinician/on-call", notificationId }`
 * (supabase/functions/send-pending-notifications/templates.ts, index.ts). The payload reaches JS in three shapes, so this reads all of
 * them: a foreground notification (`request.content.data`), a tap (same), and a background task payload where the data arrives as
 * `data.dataString` (a JSON string) and, for an Expo push relayed through FCM, our fields sit inside a string called `body`.
 * Nothing here reads, keeps or returns any other field, so nothing about a case can leak into a log or a receipt (INV-07).
 */
export const PAGE_URL = "/clinician/on-call";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DEPTH = 4;

export interface PagePush {
  readonly notificationId: string;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseJson(v: unknown): Record<string, unknown> | null {
  if (typeof v !== "string" || v.length > 20_000) return null;
  try {
    return asRecord(JSON.parse(v));
  } catch {
    return null;
  }
}

/** The first object in the payload (searched a few levels down) that carries our two fields. */
function findFields(v: unknown, depth: number): { url: string; notificationId: string } | null {
  const rec = asRecord(v);
  if (!rec || depth > MAX_DEPTH) return null;
  if (typeof rec.url === "string" && typeof rec.notificationId === "string") return { url: rec.url, notificationId: rec.notificationId };
  for (const key of ["data", "request", "content", "notification", "trigger", "remoteMessage"]) {
    const hit = findFields(rec[key], depth + 1);
    if (hit) return hit;
  }
  for (const key of ["dataString", "body"]) {
    const hit = findFields(parseJson(rec[key]), depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** The page notification this payload describes, or null when it is anything else (a patient reminder, a malformed payload). */
export function readPagePush(payload: unknown): PagePush | null {
  const f = findFields(payload, 0);
  if (!f || f.url !== PAGE_URL || !UUID.test(f.notificationId)) return null;
  return { notificationId: f.notificationId };
}
