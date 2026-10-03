import { useCallback, useEffect, useState } from "react";
import { Alert, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
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
import { radii, space, useTheme } from "@/ui/design";
import { AppText, Badge, Button, Card, EmptyState, InlineAlert, ListItem, Screen, SegmentedControl, Skeleton, SkeletonGroup, useToast, type BadgeTone } from "@/ui/kit";

const STATUS_KEY: Record<string, MessageKey> = {
  held: "appts.status.held",
  booked: "appts.status.booked",
  confirmed: "appts.status.confirmed",
  checked_in: "appts.status.checked_in",
  in_progress: "appts.status.in_progress",
};
const STATUS_TONE: Record<string, BadgeTone> = {
  confirmed: "positive",
  checked_in: "positive",
  in_progress: "positive",
};

const TYPE_KEY: Partial<Record<AppointmentType, MessageKey>> = {
  telemedicine: "appts.type.telemedicine",
  result_interpretation: "appts.type.result_interpretation",
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
 * Basic native Appointments: book a telemedicine visit or a result
 * interpretation session, see what's upcoming, cancel, or pay for one
 * that's awaiting payment. Everything that needs Zoom/checkout
 * infrastructure this screen doesn't reimplement (setting up a join link,
 * running a card charge, the waiting list) opens the web appointments page
 * in the system browser instead: the same "one real native action, browser
 * for the rest" shape as Labs' camera capture, not a WebView embed.
 */
export function AppointmentsScreen({ patientId, organisationId }: AppointmentsScreenProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);

  const [appointments, setAppointments] = useState<AppointmentWithClinician[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [type, setType] = useState<AppointmentType>("telemedicine");
  const [slots, setSlots] = useState<AvailableSlot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshAppointments = useCallback(async () => {
    const result = await loadUpcomingAppointments(patientId);
    if (!result.ok) {
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setAppointments(result.data);
  }, [patientId]);

  useEffect(() => {
    refreshAppointments().finally(() => setLoading(false));
  }, [refreshAppointments]);

  const refreshSlots = useCallback(
    async (appointmentType: AppointmentType) => {
      setSlotsLoading(true);
      setSlots(null);
      const result = await loadAvailableSlots(organisationId, appointmentType);
      setSlotsLoading(false);
      if (!result.ok) {
        setError(result.error || t("appts.action_failed", locale));
        return;
      }
      setSlots(result.data);
    },
    [organisationId, locale]
  );

  useEffect(() => {
    void refreshSlots(type);
  }, [type, refreshSlots]);

  async function book(slot: AvailableSlot) {
    if (booking) return;
    setBooking(true);
    setError(null);
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
      setError(result.error || tr("appts.action_failed"));
      return;
    }
    const when = formatSlot(slot.slot_start);
    toast.show(
      result.data.status === "confirmed"
        ? { message: tr("appts.booked", { when }), tone: "success" }
        : { message: tr("appts.held", { when }), tone: "info" }
    );
    void refreshAppointments();
    void refreshSlots(type);
  }

  async function payToConfirm(appointmentId: string) {
    await WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/appointments?resume_appointment=${appointmentId}`);
    void refreshAppointments();
  }

  function confirmCancel(appt: AppointmentWithClinician) {
    // Cancelling releases the slot (and may touch a payment), so it is never one stray tap.
    Alert.alert(tr("appts.cancel_confirm.title"), tr("appts.cancel_confirm.body", { when: formatSlot(appt.scheduled_for) }), [
      { text: tr("appts.cancel_confirm.keep"), style: "cancel" },
      { text: tr("appts.cancel_confirm.go"), style: "destructive", onPress: () => void cancel(appt.id) },
    ]);
  }

  async function cancel(appointmentId: string) {
    if (cancellingId) return;
    setCancellingId(appointmentId);
    setError(null);
    const result = await cancelAppointment(appointmentId);
    setCancellingId(null);
    if (!result.ok) {
      setError(result.error || tr("appts.action_failed"));
      return;
    }
    void refreshAppointments();
  }

  function openInBrowser() {
    void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/appointments`);
  }

  const typeLabel = (appointmentType: string) => {
    const key = TYPE_KEY[appointmentType as AppointmentType];
    return key ? tr(key) : appointmentType.replace(/_/g, " ");
  };

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <AppText variant="headline" heading>
          {tr("appts.title")}
        </AppText>
        <AppText variant="body" tone="textMuted">
          {tr("appts.subtitle")}
        </AppText>
      </View>

      {error ? <InlineAlert tone="warn" message={error} /> : null}

      <View style={{ gap: space.md }}>
        <AppText variant="title" heading>
          {tr("appts.upcoming")}
        </AppText>
        {loading ? (
          <SkeletonGroup label={tr("appts.upcoming")}>
            <Card style={{ gap: space.md }}>
              <Skeleton height={20} width="55%" />
              <Skeleton height={16} width="40%" />
            </Card>
          </SkeletonGroup>
        ) : loadFailed ? (
          // A failed read must never look like "no appointments".
          <InlineAlert tone="info" message={tr("appts.load_error")} />
        ) : appointments.length === 0 ? (
          <Card>
            <EmptyState icon="appointment" title={tr("appts.empty")} />
          </Card>
        ) : (
          <Card padded={false}>
            {appointments.map((appt, index) => {
              const statusKey = STATUS_KEY[appt.status];
              const statusLabel = statusKey ? tr(statusKey) : appt.status.replace(/_/g, " ");
              const productCode = paidProductCodeFor(appt.appointment_type);
              const cancellable = ["held", "booked", "confirmed"].includes(appt.status);
              return (
                <View
                  key={appt.id}
                  style={[{ padding: space.lg, gap: space.sm }, index > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : null]}
                >
                  <AppText variant="bodyStrong">{formatSlot(appt.scheduled_for)}</AppText>
                  <AppText variant="body" tone="textMuted">
                    {`${appt.clinician?.full_name ?? tr("appts.care_team")}, ${typeLabel(appt.appointment_type)}`}
                  </AppText>
                  <Badge label={statusLabel} tone={STATUS_TONE[appt.status] ?? "neutral"} />
                  {appt.status === "booked" && productCode ? (
                    <Button title={tr("appts.pay")} variant="secondary" onPress={() => void payToConfirm(appt.id)} />
                  ) : null}
                  {cancellable ? (
                    <Button
                      title={tr("appts.cancel")}
                      variant="ghost"
                      fullWidth={false}
                      loading={cancellingId === appt.id}
                      disabled={cancellingId !== null}
                      onPress={() => confirmCancel(appt)}
                    />
                  ) : null}
                </View>
              );
            })}
          </Card>
        )}
      </View>

      <View style={{ gap: space.md }}>
        <AppText variant="title" heading>
          {tr("appts.book.heading")}
        </AppText>
        <SegmentedControl
          accessibilityLabel={tr("appts.type.group")}
          options={PATIENT_BOOKABLE_APPOINTMENT_TYPES.map((option) => ({ value: option.type, label: typeLabel(option.type) }))}
          value={type}
          onChange={setType}
        />

        {slotsLoading ? (
          <Skeleton height={64} radius={radii.lg} />
        ) : null}
        {!slotsLoading && slots && slots.length === 0 ? (
          <AppText variant="body" tone="textMuted">
            {tr("appts.slots.empty")}
          </AppText>
        ) : null}
        {!slotsLoading && slots && slots.length > 0 ? (
          <Card padded={false}>
            {slots.slice(0, 12).map((slot, index) => (
              <View key={`${slot.clinician_id}-${slot.slot_start}`} style={index > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}>
                <ListItem
                  title={formatSlot(slot.slot_start)}
                  subtitle={slot.clinician_name}
                  trailing={<Button title={tr("appts.book")} fullWidth={false} onPress={() => void book(slot)} disabled={booking} loading={booking} />}
                />
              </View>
            ))}
          </Card>
        ) : null}
      </View>

      <Button title={tr("appts.full_scheduler")} variant="ghost" onPress={openInBrowser} />
    </Screen>
  );
}
