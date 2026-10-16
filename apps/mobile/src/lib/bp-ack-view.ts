import { type BpAckDelivery, type BpRowState } from "@tarragon/shared";
import { t, type Locale } from "@tarragon/i18n";

/**
 * The words for the acknowledgement under the Save button (docs/design/BP-immediate-acknowledgement.md).
 * One state at a time, in words (colour never carries it). `refused` and `not_saved` return null on purpose: the screen already shows the
 * outbox's own refusal line (with the support code) or the save error, and a second line would only repeat it.
 * Nothing here says a person has seen the reading or says when anyone will answer.
 */
export function bpAckMessage(delivery: BpAckDelivery | null, locale: Locale): string | null {
  if (!delivery) return null;
  switch (delivery.kind) {
    case "received":
      return `${t("bpack.received", locale)} ${t("bpack.received_note", locale)}`;
    case "waiting":
      return `${t("outbox.saved_on_phone", locale)} ${t("bpack.waiting_note", locale)}`;
    default:
      return null;
  }
}

/** The part of an outbox row the acknowledgement needs. */
export interface OutboxRowLike {
  readonly clientId: string;
  readonly state: string;
  readonly supportCode?: string | null | undefined;
}

/**
 * Where one blood pressure row stands, from the rows still in the outbox. A row that is no longer there was accepted by the server (the outbox removes
 * a row only after the server accepts it); a rejected row stays and is never retried; anything else is still waiting.
 */
export function bpRowState(clientId: string, outbox: readonly OutboxRowLike[]): { state: BpRowState; supportCode: string | null } {
  const row = outbox.find((r) => r.clientId === clientId);
  if (!row) return { state: "sent", supportCode: null };
  if (row.state === "rejected") return { state: "rejected", supportCode: row.supportCode ?? null };
  return { state: "waiting", supportCode: null };
}
