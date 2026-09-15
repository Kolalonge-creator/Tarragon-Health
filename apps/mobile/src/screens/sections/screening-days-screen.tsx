import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { koboToNaira } from "@tarragon/shared";
import {
  loadScreeningDays,
  loadScreeningDaySlots,
  loadSelfBookablePanelBundles,
  requestScreeningDay,
  addScreeningDaySlot,
  type ScreeningDay,
  type ScreeningDaySlot,
  type PanelBundleOption,
} from "@/lib/screening-days";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, radius, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/components";

const STATUS_LABEL: Record<ScreeningDay["status"], string> = {
  requested: "Awaiting confirmation",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<ScreeningDay["status"], "brand" | "neutral"> = {
  requested: "neutral",
  confirmed: "brand",
  completed: "brand",
  cancelled: "neutral",
};

const naira = (kobo: number) => `₦${koboToNaira(kobo).toLocaleString("en-NG")}`;

const textInputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: 14,
  color: colors.ink,
} as const;

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" });
}

/**
 * "Bring your church, market association, cooperative, or SME office and get
 * a discounted rate" — mirrors apps/web/.../screening-days/screening-days-
 * panel.tsx. Request + attendee registration are real native forms; the
 * actual Paystack payment step opens the existing web page in the system
 * browser (same pattern as Receipts' invoice download and Appointments'
 * pay-to-confirm) rather than reimplementing checkout initiation natively.
 */
export function ScreeningDaysScreen() {
  const [days, setDays] = useState<ScreeningDay[]>([]);
  const [bundles, setBundles] = useState<PanelBundleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    const result = await loadScreeningDays();
    if (result.ok) setDays(result.data);
  }, []);

  useEffect(() => {
    Promise.all([refresh(), loadSelfBookablePanelBundles()])
      .then(([, bundlesResult]) => {
        if (bundlesResult.ok) setBundles(bundlesResult.data);
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 16 }}
    >
      <View>
        <ScreenTitle>Group screening days</ScreenTitle>
        <MutedText>
          Bring a group — a church, a market association, a cooperative, an office — and get a discounted rate on
          a health check for everyone. One payer covers the whole group upfront; we&apos;ll confirm the price and
          headcount with you first.
        </MutedText>
      </View>

      {loading && <ActivityIndicator color={colors.brand} />}
      {!loading && days.length === 0 && (
        <MutedText>No screening days yet. Request one below and our team will confirm a discounted rate.</MutedText>
      )}
      {days.map((day) => (
        <ScreeningDayCard key={day.id} day={day} onChanged={refresh} />
      ))}

      {showForm ? (
        <RequestForm bundles={bundles} onDone={() => { setShowForm(false); void refresh(); }} />
      ) : (
        <SecondaryButton title="Request a screening day" onPress={() => setShowForm(true)} />
      )}
    </ScrollView>
  );
}

function RequestForm({ bundles, onDone }: { bundles: PanelBundleOption[]; onDone: () => void }) {
  const [hostName, setHostName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [location, setLocation] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [panelBundleId, setPanelBundleId] = useState("");
  const [slotsRequested, setSlotsRequested] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setError(null);
    setMessage(null);
    setPending(true);
    const result = await requestScreeningDay({
      hostName,
      contactPhone,
      location,
      eventDate,
      panelBundleId,
      slotsRequested: Number(slotsRequested),
      notes,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("Request sent. We'll confirm the discounted price and get back to you before anyone needs to pay.");
    setTimeout(onDone, 1200);
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Request a screening day</Text>
      <TextInput value={hostName} onChangeText={setHostName} placeholder="Group name (e.g. Redeemer's Church, Lekki)" style={textInputStyle} />
      <TextInput value={contactPhone} onChangeText={setContactPhone} placeholder="Contact phone" style={textInputStyle} keyboardType="phone-pad" />
      <TextInput value={location} onChangeText={setLocation} placeholder="Where will this happen?" style={textInputStyle} />
      <TextInput value={eventDate} onChangeText={setEventDate} placeholder="Event date (YYYY-MM-DD)" style={textInputStyle} />

      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Which check?</Text>
      <View style={{ gap: 6 }}>
        {bundles.map((b) => {
          const selected = b.id === panelBundleId;
          return (
            <Text
              key={b.id}
              onPress={() => setPanelBundleId(b.id)}
              style={{
                fontSize: 13,
                fontWeight: "600",
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderRadius: radius.control,
                backgroundColor: selected ? colors.brand : colors.groupBg,
                color: selected ? "#FFFFFF" : colors.ink,
              }}
            >
              {b.name} ({b.price_kobo ? naira(b.price_kobo) : "price on request"})
            </Text>
          );
        })}
      </View>

      <TextInput
        value={slotsRequested}
        onChangeText={setSlotsRequested}
        placeholder="How many people?"
        keyboardType="numeric"
        style={textInputStyle}
      />
      <TextInput
        value={notes}
        onChangeText={setNotes}
        placeholder="Anything else we should know? (optional)"
        multiline
        numberOfLines={2}
        style={[textInputStyle, { minHeight: 60, textAlignVertical: "top" }]}
      />

      {error && <ErrorText>{error}</ErrorText>}
      {message && <MutedText>{message}</MutedText>}
      <PrimaryButton title="Request a discounted rate" onPress={submit} loading={pending} />
      <MutedText>
        This reserves nothing and costs nothing yet. Our team confirms the discounted price and headcount with
        you before any payment is needed.
      </MutedText>
    </Card>
  );
}

function ScreeningDayCard({ day, onChanged }: { day: ScreeningDay; onChanged: () => void }) {
  const outstanding = (day.total_kobo ?? 0) - day.amount_paid_kobo;
  const fullyPaid = (day.total_kobo ?? 0) > 0 && day.amount_paid_kobo >= (day.total_kobo ?? 0);

  return (
    <Card style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink, flex: 1 }}>{day.host_name}</Text>
        <Badge tone={STATUS_TONE[day.status]}>{STATUS_LABEL[day.status]}</Badge>
      </View>
      <MutedText>
        {day.location} · {when(day.event_date)}
      </MutedText>
      <MutedText>
        {day.slots_requested} people requested
        {day.slots_confirmed ? ` · ${day.slots_confirmed} confirmed` : ""}
        {day.price_per_head_kobo ? ` at ${naira(day.price_per_head_kobo)} each` : ""}
      </MutedText>
      {day.status === "confirmed" && (
        <MutedText>
          {naira(day.amount_paid_kobo)} paid of {naira(day.total_kobo ?? 0)}
        </MutedText>
      )}
      {day.status === "confirmed" && outstanding > 0 && (
        <SecondaryButton
          title="Pay"
          onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/screening-days`)}
        />
      )}
      {day.status === "confirmed" && fullyPaid && <AddSlotSection day={day} onChanged={onChanged} />}
    </Card>
  );
}

function AddSlotSection({ day, onChanged }: { day: ScreeningDay; onChanged: () => void }) {
  const [slots, setSlots] = useState<ScreeningDaySlot[]>([]);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const result = await loadScreeningDaySlots(day.id);
    if (result.ok) setSlots(result.data);
  }, [day.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remaining = (day.slots_confirmed ?? 0) - slots.filter((s) => s.status !== "removed").length;

  async function submit() {
    setError(null);
    setSaving(true);
    const result = await addScreeningDaySlot({ screeningDayId: day.id, fullName, phone });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFullName("");
    setPhone("");
    void refresh();
    onChanged();
  }

  return (
    <View style={{ gap: 8, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
      <MutedText>
        {slots.length} of {day.slots_confirmed} slots registered ({remaining} left).
      </MutedText>
      {slots.map((s) => (
        <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 13, color: colors.ink }}>{s.full_name ?? "Unnamed"}</Text>
          <Badge tone={s.status === "issued" ? "brand" : "neutral"}>
            {s.status === "issued" ? "Voucher issued" : "Registered"}
          </Badge>
        </View>
      ))}
      {remaining > 0 && (
        <View style={{ gap: 8 }}>
          <TextInput value={fullName} onChangeText={setFullName} placeholder="Attendee name" style={textInputStyle} />
          <TextInput value={phone} onChangeText={setPhone} placeholder="Phone (optional)" style={textInputStyle} keyboardType="phone-pad" />
          {error && <ErrorText>{error}</ErrorText>}
          <SecondaryButton title="Add to the list" onPress={submit} loading={saving} />
        </View>
      )}
    </View>
  );
}
