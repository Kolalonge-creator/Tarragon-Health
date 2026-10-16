import { type BpAckDelivery } from "@tarragon/shared";
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
