import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  loadOpenVideoVisitSlots,
  loadVideoVisitPrice,
  loadMyVideoVisitRequests,
  requestVideoVisitWithPlatformCredit,
  cancelVideoVisitRequest,
  selectVideoVisitAlternateSlot,
  type ConsultSlotWithClinician,
  type VideoVisitPrice,
  type VideoVisitRequestWithSlots,
} from "@/lib/video-visit-booking";
import { loadPlatformCreditState } from "@/lib/platform-credit";
import { formatPrice } from "@/lib/services";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, radius } from "@/ui/theme";
import {
  Badge,
  Card,
  GroupedList,
  GroupedListRow,
  MutedText,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
} from "@/ui/components";
import type { Currency } from "@tarragon/shared";

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const REQUEST_STATUS: Record<string, { label: string; tone: "brand" | "neutral"; note?: string }> = {
  requested: { label: "Awaiting payment", tone: "neutral" },
  pending_payment: { label: "Awaiting payment", tone: "neutral" },
  payment_confirmed: {
    label: "Paid, waiting for a doctor to accept",
    tone: "brand",
    note: "Your payment is held by Tarragon and only goes through once a time is confirmed. A doctor will accept your time (or offer a different one that works) within 48 hours. If nobody can, you're refunded in full.",
  },
  alternate_proposed: {
    label: "Your doctor offered different times",
    tone: "brand",
    note: "Your original time didn't work, so your doctor offered these instead. Pick one below within 24 hours or you're refunded in full.",
  },
  accepted: { label: "Booked", tone: "brand" },
  declined: {
    label: "Not available",
    tone: "neutral",
    note: "A doctor couldn't take this visit. Your payment is being refunded in full automatically.",
  },
  expired: {
    label: "Not accepted in time",
    tone: "neutral",
    note: "Nobody confirmed a time in time. Your payment will be refunded in full.",
  },
  cancelled: { label: "Cancelled", tone: "neutral" },
  refunded: { label: "Refunded", tone: "neutral" },
};

interface VideoVisitBookingSectionProps {
  patientId: string;
  organisationId: string;
  /** Pushes the existing native "manage this visit" screen (join link, prep
   * notes, summary) once a request reaches 'accepted' — see
   * video-visit-screen.tsx, already wired for the overview tab's "Details"
   * button via home-shell.tsx's openVideoVisitId. */
  onOpenVideoVisit: (consultationId: string) => void;
}

/**
 * Native slot-pick-and-pay Video Visit booking — replaces the
 * browser-only "Book a video visit" callout that used to be the one
 * remaining gap here (see care-support-screen.tsx's header comment).
 * Two payment paths, same as web's BookVideoVisit:
 *
 * 1. Reserve with Platform Credit, in-app end to end (checks the balance
 *    covers the price, reserves the request, never actually spends — see
 *    video-visit-booking.ts's header for why).
 * 2. Otherwise, pay by card — opens the existing web booking page in the
 *    system browser for the Paystack checkout, same "system browser for a
 *    real card charge" pattern every other paid mobile flow here uses
 *    (App Store Review 3.1.1). No native card-entry UI is built here.
 *
 * A doctor accepting the request (or the patient picking one of the
 * doctor's proposed alternate times, both handled below) is what actually
 * creates the booked video_consultations row — this screen shows every
 * stage of that lifecycle (requested/paid/offered-alternates/booked/
 * declined/expired), matching web's BookVideoVisit status list.
 */
export function VideoVisitBookingSection({
  patientId,
  organisationId,
  onOpenVideoVisit,
}: VideoVisitBookingSectionProps) {
  const [slots, setSlots] = useState<ConsultSlotWithClinician[] | null>(null);
  const [price, setPrice] = useState<VideoVisitPrice | null>(null);
  const [requests, setRequests] = useState<VideoVisitRequestWithSlots[]>([]);
  const [creditBalanceKobo, setCreditBalanceKobo] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [reserving, setReserving] = useState(false);
  const [alternatePicking, setAlternatePicking] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const [slotsResult, priceResult, requestsResult, creditResult] = await Promise.all([
      loadOpenVideoVisitSlots(),
      loadVideoVisitPrice(organisationId),
      loadMyVideoVisitRequests(patientId),
      loadPlatformCreditState(),
    ]);
    if (slotsResult.ok) setSlots(slotsResult.data);
    if (priceResult.ok) setPrice(priceResult.data);
    if (requestsResult.ok) setRequests(requestsResult.data);
    if (creditResult.ok) setCreditBalanceKobo(creditResult.data.balanceKobo);
  }, [organisationId, patientId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const hasEnoughCredit = !!price && creditBalanceKobo >= price.amount_minor;

  async function reserveWithCredit() {
    if (!selectedSlotId) return;
    setReserving(true);
    setMessage(null);
    const result = await requestVideoVisitWithPlatformCredit(selectedSlotId);
    setReserving(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    setSelectedSlotId(null);
    setMessage({
      tone: "success",
      text: "Reserved from your platform credit. You'll only be charged once a doctor accepts.",
    });
    void refresh();
  }

  async function payByCard() {
    await WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/care#book-video-visit`);
    void refresh();
  }

  async function cancelRequest(requestId: string) {
    setCancellingId(requestId);
    setMessage(null);
    const result = await cancelVideoVisitRequest(requestId);
    setCancellingId(null);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    void refresh();
  }

  async function pickAlternate(requestId: string, slotId: string) {
    setAlternatePicking(`${requestId}:${slotId}`);
    setMessage(null);
    const result = await selectVideoVisitAlternateSlot(requestId, slotId);
    setAlternatePicking(null);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    setMessage({ tone: "success", text: "Booked." });
    void refresh();
  }

  const hasSlots = (slots ?? []).length > 0 && !!price;
  const hasRequests = requests.length > 0;

  if (loading) {
    return (
      <View style={{ gap: 10 }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Book a video visit</Text>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <SectionLabel>Book a video visit</SectionLabel>
      <MutedText>A paid, self-serve 15-minute online consultation with a Tarragon doctor, over video.</MutedText>

      <View style={{ backgroundColor: "#FEF2F2", borderRadius: radius.card, padding: 12 }}>
        <Text style={{ color: "#B91C1C", fontSize: 13.5, fontWeight: "600" }}>
          Not for emergencies. If this is an emergency, go to the nearest emergency department now.
        </Text>
      </View>

      {message && (
        <Card style={{ backgroundColor: message.tone === "error" ? colors.status.warnBg : colors.brandTint }}>
          <Text style={{ fontSize: 13, color: message.tone === "error" ? colors.status.warn : colors.brandPressed }}>
            {message.text}
          </Text>
        </Card>
      )}

      {hasRequests && (
        <View style={{ gap: 10 }}>
          {requests.map((req) => {
            const status = REQUEST_STATUS[req.status] ?? { label: req.status, tone: "neutral" as const };
            const canCancel = req.status === "requested" || req.status === "pending_payment";
            const canManage = req.status === "accepted" && !!req.video_consultation_id;
            return (
              <Card key={req.id} style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>
                    {req.slot?.slot_start ? formatSlot(req.slot.slot_start) : "Requested visit"}
                  </Text>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </View>
                {status.note && <MutedText>{status.note}</MutedText>}
                {req.status === "declined" && req.declined_reason && (
                  <MutedText>Doctor&apos;s note: {req.declined_reason}</MutedText>
                )}
                {req.status === "alternate_proposed" && req.proposedSlots.length > 0 && (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                    {req.proposedSlots.map((slot) => (
                      <SecondaryButton
                        key={slot.id}
                        title={formatSlot(slot.slot_start)}
                        loading={alternatePicking === `${req.id}:${slot.id}`}
                        disabled={alternatePicking !== null}
                        onPress={() => void pickAlternate(req.id, slot.id)}
                      />
                    ))}
                  </View>
                )}
                {canManage && req.video_consultation_id && (
                  <View style={{ marginTop: 4 }}>
                    <SecondaryButton
                      title="Prepare / manage this visit"
                      onPress={() => onOpenVideoVisit(req.video_consultation_id!)}
                    />
                  </View>
                )}
                {canCancel && (
                  <Pressable onPress={() => void cancelRequest(req.id)} style={{ marginTop: 4 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.danger }}>
                      {cancellingId === req.id ? "Cancelling…" : "Cancel request"}
                    </Text>
                  </Pressable>
                )}
              </Card>
            );
          })}
        </View>
      )}

      {hasSlots && (
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>
            Pick a time: {formatPrice(price!.amount_minor, price!.currency as Currency)} per visit
          </Text>
          <GroupedList>
            {(slots ?? []).slice(0, 12).map((slot) => {
              const selected = selectedSlotId === slot.id;
              return (
                <GroupedListRow
                  key={slot.id}
                  title={formatSlot(slot.slot_start)}
                  subtitle={slot.clinician?.full_name ? `Dr. ${slot.clinician.full_name}` : undefined}
                  onPress={() => setSelectedSlotId(selected ? null : slot.id)}
                  trailing={
                    selected ? (
                      <Badge tone="brand">Selected</Badge>
                    ) : undefined
                  }
                />
              );
            })}
          </GroupedList>

          <PrimaryButton
            title={
              hasEnoughCredit
                ? "Reserve with Platform Credit"
                : price
                  ? `Need ₦${Math.ceil((price.amount_minor - creditBalanceKobo) / 100).toLocaleString()} more credit`
                  : "Reserve with Platform Credit"
            }
            onPress={() => void reserveWithCredit()}
            disabled={!selectedSlotId || reserving || !hasEnoughCredit}
            loading={reserving}
          />
          <MutedText>
            You&apos;re only charged from your platform credit once a doctor accepts — never at request time.
          </MutedText>
          <SecondaryButton
            title={selectedSlotId ? "Pay by card instead" : "Pick a time, then pay by card"}
            onPress={() => void payByCard()}
            disabled={!selectedSlotId}
          />
          {!hasEnoughCredit && (
            <MutedText>Card payment opens the booking page in your browser to complete checkout.</MutedText>
          )}
        </View>
      )}

      {!hasSlots && !hasRequests && (
        <MutedText>No open times right now. Check back soon, or open the full booking page.</MutedText>
      )}

      <Pressable onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/care#book-video-visit`)}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.brand, textAlign: "center" }}>
          Open the full booking page in your browser
        </Text>
      </Pressable>
    </View>
  );
}
