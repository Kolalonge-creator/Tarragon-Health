import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  loadUpcomingAppointments,
  loadAvailableSlots,
  bookAppointment,
  cancelAppointment,
  paidProductCodeFor,
  PATIENT_BOOKABLE_APPOINTMENT_TYPES,
  type AppointmentWithClinician,
  type AvailableSlot,
  type AppointmentType,
} from "@/lib/appointments";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, radius, spacing } from "@/ui/theme";
import {
  Badge,
  Card,
  ErrorText,
  GroupedList,
  GroupedListRow,
  MutedText,
  PrimaryButton,
  SecondaryButton,
} from "@/ui/components";

const STATUS_LABEL: Record<string, { label: string; tone: "brand" | "neutral" }> = {
  held: { label: "Holding your slot…", tone: "neutral" },
  booked: { label: "Awaiting payment", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "brand" },
  checked_in: { label: "Checked in", tone: "brand" },
  in_progress: { label: "In progress", tone: "brand" },
};

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

interface AppointmentsScreenProps {
  patientId: string;
  organisationId: string;
}

/**
 * Basic native Appointments — book a telemedicine visit or a result
 * interpretation session, see what's upcoming, cancel, or pay for one
 * that's awaiting payment. Everything that needs Zoom/checkout
 * infrastructure this screen doesn't reimplement (setting up a join link,
 * running a card charge, the waiting list) opens the web appointments page
 * in the system browser instead — the same "one real native action, browser
 * for the rest" shape as Labs' camera capture, not a WebView embed.
 */
export function AppointmentsScreen({ patientId, organisationId }: AppointmentsScreenProps) {
  const [appointments, setAppointments] = useState<AppointmentWithClinician[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [type, setType] = useState<AppointmentType>("telemedicine");
  const [slots, setSlots] = useState<AvailableSlot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const refreshAppointments = useCallback(async () => {
    const result = await loadUpcomingAppointments(patientId);
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setLoadError(null);
    setAppointments(result.data);
  }, [patientId]);

  useEffect(() => {
    refreshAppointments().finally(() => setLoading(false));
  }, [refreshAppointments]);

  const refreshSlots = useCallback(
    async (t: AppointmentType) => {
      setSlotsLoading(true);
      setSlots(null);
      const result = await loadAvailableSlots(organisationId, t);
      setSlotsLoading(false);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setSlots(result.data);
    },
    [organisationId]
  );

  useEffect(() => {
    void refreshSlots(type);
  }, [type, refreshSlots]);

  async function book(slot: AvailableSlot) {
    setBooking(true);
    setMessage(null);
    const result = await bookAppointment({
      organisationId,
      patientId,
      clinicianId: slot.clinician_id,
      appointmentType: type,
      scheduledFor: slot.slot_start,
      endsAt: slot.slot_end,
    });
    setBooking(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    setMessage(
      result.data.status === "confirmed"
        ? { tone: "success", text: `Booked for ${formatSlot(slot.slot_start)}.` }
        : { tone: "success", text: `Time held for ${formatSlot(slot.slot_start)}. Pay to confirm below.` }
    );
    void refreshAppointments();
    void refreshSlots(type);
  }

  async function payToConfirm(appointmentId: string) {
    await WebBrowser.openBrowserAsync(
      `${PLATFORM_URL}/patient/appointments?resume_appointment=${appointmentId}`
    );
    void refreshAppointments();
  }

  async function cancel(appointmentId: string) {
    setMessage(null);
    const result = await cancelAppointment(appointmentId);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    void refreshAppointments();
  }

  function openInBrowser() {
    void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/appointments`);
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 18 }}
    >
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>Appointments</Text>
        <MutedText>
          A video or audio visit, or a result consultation, always with a Tarragon doctor.
        </MutedText>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>Your upcoming appointments</Text>
        {loading && <ActivityIndicator color={colors.brand} />}
        {loadError && <ErrorText>{loadError}</ErrorText>}
        {!loading && !loadError && appointments.length === 0 && (
          <MutedText>No upcoming appointments yet.</MutedText>
        )}
        {appointments.length > 0 && (
          <GroupedList>
            {appointments.map((appt) => {
              const status = STATUS_LABEL[appt.status] ?? { label: appt.status.replace(/_/g, " "), tone: "neutral" as const };
              const productCode = paidProductCodeFor(appt.appointment_type);
              return (
                <View key={appt.id} style={{ padding: spacing.card, gap: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 14.5, fontWeight: "600", color: colors.ink }}>
                      {formatSlot(appt.scheduled_for)}
                    </Text>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </View>
                  <MutedText>{appt.clinician?.full_name ?? "Care team"} · Telemedicine</MutedText>
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                    {appt.status === "booked" && productCode && (
                      <SecondaryButton title="Pay to confirm" onPress={() => void payToConfirm(appt.id)} />
                    )}
                    {["held", "booked", "confirmed"].includes(appt.status) && (
                      <Pressable onPress={() => void cancel(appt.id)}>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.danger }}>Cancel</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </GroupedList>
        )}
      </View>

      <View style={{ gap: 10 }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>Book a new appointment</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {PATIENT_BOOKABLE_APPOINTMENT_TYPES.map((option) => {
            const selected = option.type === type;
            return (
              <Pressable
                key={option.type}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setType(option.type)}
                style={{
                  flex: 1,
                  borderRadius: radius.control,
                  paddingVertical: 10,
                  paddingHorizontal: 10,
                  backgroundColor: selected ? colors.brandTint : colors.groupBg,
                  borderWidth: selected ? 1 : 0,
                  borderColor: colors.brand,
                }}
              >
                <Text
                  style={{
                    fontSize: 12.5,
                    fontWeight: "700",
                    textAlign: "center",
                    color: selected ? colors.brandPressed : colors.ink,
                  }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {message && (
          <Card style={{ backgroundColor: message.tone === "error" ? colors.status.warnBg : colors.brandTint }}>
            <Text style={{ fontSize: 13, color: message.tone === "error" ? colors.status.warn : colors.brandPressed }}>
              {message.text}
            </Text>
          </Card>
        )}

        {slotsLoading && <ActivityIndicator color={colors.brand} />}
        {!slotsLoading && slots && slots.length === 0 && (
          <MutedText>
            No open times in the next two weeks for this type. Try the other type, or open the full
            scheduler to join the waiting list.
          </MutedText>
        )}
        {!slotsLoading && slots && slots.length > 0 && (
          <GroupedList>
            {slots.slice(0, 12).map((slot) => (
              <GroupedListRow
                key={`${slot.clinician_id}-${slot.slot_start}`}
                title={formatSlot(slot.slot_start)}
                subtitle={slot.clinician_name}
                trailing={
                  <PrimaryButton
                    title="Book"
                    onPress={() => void book(slot)}
                    disabled={booking}
                    loading={booking}
                  />
                }
              />
            ))}
          </GroupedList>
        )}
      </View>

      <Pressable onPress={openInBrowser}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.brand, textAlign: "center" }}>
          Manage all appointments in the full scheduler
        </Text>
      </Pressable>
    </ScrollView>
  );
}
