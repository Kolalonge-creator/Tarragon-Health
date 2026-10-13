import { enqueue, flushOutbox, listOutbox, type OutboxItem } from "./outbox";
import type { RedCarePayload } from "./outbox";

/**
 * "I have sought care" / "I could not get care" on the red guidance screen (S13 R4, CMO Q13).
 *
 * The answer is durable on the phone before any network call (the same outbox as readings), is sent oldest first so it always
 * follows the reading that raised the alert, and is idempotent by the outbox client id. It is shown to the on-call clinician
 * and never stops paging: only a clinician acknowledgement does. Nothing here blocks the guidance, and nothing needs a
 * notification to succeed.
 */
export type RedCareAnswer = RedCarePayload["response"];
export type RedCareOutcome = "saved" | "queued" | "failed";

export async function answerRedCare(
  subjectId: string,
  response: RedCareAnswer,
  port: { enqueue: typeof enqueue; flush: typeof flushOutbox } = { enqueue, flush: flushOutbox },
): Promise<RedCareOutcome> {
  let item: OutboxItem;
  try {
    item = await port.enqueue({ kind: "red_care", subjectId, payload: { response }, danger: true });
  } catch {
    return "failed"; // not signed in or the phone store is unavailable: nothing was saved, say so
  }
  try {
    await port.flush();
  } catch {
    return "queued";
  }
  // flushOutbox deletes a sent row. If the network was down the row simply stays queued on the phone.
  try {
    const row = (await listOutbox("red_care")).find((r) => r.clientId === item.clientId);
    if (!row) return "saved";
    // A row the server refused stays on the phone as rejected and will never go: say so, do not promise it will be sent.
    return row.state === "rejected" ? "failed" : "queued";
  } catch {
    return "queued";
  }
}
