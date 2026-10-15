// S85 journey harness: notification capture.
//
// The platform's notifications are rows in public.notifications (the outbox). The edge function that sends them
// (send-pending-notifications) is NOT run by the harness and the local stack has no push or email provider, so nothing is ever
// sent anywhere. "Capture" is therefore reading those rows: recipient, channel, template, priority and payload. It lets a
// journey assert who was told, on which channel, how urgently, and (INV-07) that nothing clinical is in the text.

import { sqlRows, lit } from "./sql";

export interface CapturedNotification {
  readonly id: string;
  readonly recipient_id: string;
  readonly channel: string;
  readonly template: string | null;
  readonly priority: string | null;
  readonly payload: unknown;
  readonly created_at: string;
}

export function captureNotifications(recipientIds: readonly string[], sinceIso: string): CapturedNotification[] {
  if (recipientIds.length === 0) return [];
  const ids = recipientIds.map(lit).join(",");
  return sqlRows<CapturedNotification>(
    `select id, recipient_id, channel::text as channel, template, priority::text as priority, payload, created_at
       from public.notifications
      where recipient_id in (${ids}) and created_at >= ${lit(sinceIso)}::timestamptz
      order by created_at, id`,
  );
}

/**
 * INV-07: a notification never names a condition, a reading or a result. This is the harness's own check over a captured row
 * (the production lint runs over the templates; this proves what was actually written for a real event). `forbidden` is a
 * word list; numbers are caught separately so a reading cannot ride along in a payload.
 */
const FORBIDDEN =
  /blood pressure|hypertens|diabet|glucose|stroke|heart|mmhg|systolic|diastolic|reading|result|symptom|headache|chest pain|emergency|red grade|\bred\b/i;

export function neutralityViolations(rows: readonly CapturedNotification[], knownReadings: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const n of rows) {
    const text = JSON.stringify({ template: n.template, payload: n.payload });
    const hit = text.match(FORBIDDEN);
    if (hit) out.push(`${n.template ?? "?"} (${n.channel}) contains "${hit[0]}"`);
    for (const r of knownReadings) if (text.includes(r)) out.push(`${n.template ?? "?"} (${n.channel}) contains the reading ${r}`);
  }
  return out;
}
