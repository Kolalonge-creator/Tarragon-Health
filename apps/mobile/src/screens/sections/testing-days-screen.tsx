import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  bookTestingDay,
  cancelTestingBooking,
  loadMyTestingBookings,
  loadReleasedPocResults,
  loadTestingDays,
  rescheduleTestingBooking,
  seatsLabel,
  type MyTestingBooking,
  type PocReleased,
  type TestingDay,
} from "@/lib/testing-days";
import { PLATFORM_URL } from "@/lib/platform-url";
import { spacing } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/legacy-kit";

const STATE_LABEL: Record<MyTestingBooking["state"], string> = {
  confirmed: "Your place is held",
  waitlisted: "On the waiting list",
  cancelled: "Cancelled",
  checked_in: "Checked in",
  no_show: "Missed",
};

function when(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

const ECG_CLASS_LABEL = { normal: "Normal", abnormal: "Needs a closer look", urgent: "Your care team will contact you" } as const;

/**
 * Testing days for Members: see the upcoming days with places left, hold one, change or cancel it. Mirrors
 * apps/web/.../patient/testing-days. A Free account sees what Membership includes; the rules themselves live in the database.
 */
export function TestingDaysScreen() {
  const colors = useLegacyColors();
  const [days, setDays] = useState<TestingDay[]>([]);
  const [bookings, setBookings] = useState<MyTestingBooking[]>([]);
  const [poc, setPoc] = useState<PocReleased>({ results: [], ecgs: [] });
  const [notMember, setNotMember] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [d, b, p] = await Promise.all([loadTestingDays(), loadMyTestingBookings(), loadReleasedPocResults()]);
    if (d.ok) {
      setDays(d.data.days);
      setNotMember(d.data.notMember);
    } else setError(d.error);
    if (b.ok) setBookings(b.data);
    if (p.ok) setPoc(p.data);
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  const live = bookings.find((b) => b.state === "confirmed" || b.state === "waitlisted");
  const others = days.filter((d) => d.my_state === null);

  async function run(key: string, action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setError(null);
    setMessage(null);
    setBusy(key);
    const r = await action();
    setBusy(null);
    if (!r.ok) {
      setError(r.error ?? "Something went wrong. Please try again.");
      return;
    }
    setMessage(done);
    await refresh();
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <View>
        <ScreenTitle>Testing days</ScreenTitle>
        <MutedText>Your yearly health check happens at a testing day near you. Pick a day, hold your place, and we will remind you.</MutedText>
      </View>

      {loading && <ActivityIndicator color={colors.brand} />}
      {error && <ErrorText>{error}</ErrorText>}
      {message && <MutedText>{message}</MutedText>}

      {notMember && (
        <Card style={{ gap: 8 }}>
          <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Testing days are part of Membership</Text>
          <SecondaryButton title="See what Membership includes" onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/membership`)} />
        </Card>
      )}

      {live && (
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink, flex: 1 }}>Your place</Text>
            <Badge tone={live.state === "confirmed" ? "brand" : "neutral"}>{STATE_LABEL[live.state]}</Badge>
          </View>
          <Text style={{ color: colors.ink }}>{when(live.event_date)}</Text>
          <MutedText>
            {live.venue_name}, {live.address}, {live.city}
          </MutedText>
          {live.state === "waitlisted" && live.waitlist_position ? <MutedText>You are number {live.waitlist_position} on the waiting list.</MutedText> : null}
          <MutedText>Arrive on the day and ask for the registration desk. We will remind you a week before and the day before.</MutedText>
          <SecondaryButton
            title="Cancel my place"
            loading={busy === "cancel"}
            onPress={() => void run("cancel", () => cancelTestingBooking(live.booking_id), "Your booking is cancelled.")}
          />
        </Card>
      )}

      {!notMember && (
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{live ? "Other days" : "Upcoming testing days"}</Text>
          {!loading && others.length === 0 && <MutedText>No other days are open right now. Please check back soon.</MutedText>}
          {others.map((d) => (
            <Card key={d.id} style={{ gap: 6 }}>
              <Text style={{ fontWeight: "700", color: colors.ink }}>{when(d.event_date)}</Text>
              <MutedText>
                {d.venue_name}, {d.address}, {d.city}
                {d.lga ? ` (${d.lga})` : ""}
              </MutedText>
              <MutedText>{seatsLabel(d)}</MutedText>
              {live ? (
                <SecondaryButton
                  title="Change to this day"
                  loading={busy === d.id}
                  onPress={() => void run(d.id, () => rescheduleTestingBooking(live.booking_id, d.id), "Your place is moved.")}
                />
              ) : (
                <PrimaryButton
                  title={d.full ? "Join waiting list" : "Hold my place"}
                  loading={busy === d.id}
                  onPress={() => void run(d.id, () => bookTestingDay(d.id), d.full ? "You are on the waiting list." : "Your place is held.")}
                />
              )}
            </Card>
          ))}
        </View>
      )}

      {(poc.results.length > 0 || poc.ecgs.length > 0) && (
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>Results from your visit</Text>
          {poc.results.map((r) => (
            <Card key={r.id} style={{ gap: 4 }}>
              <Text style={{ fontWeight: "700", color: colors.ink }}>{r.kind === "urinalysis" ? "Urine test" : "Sugar control (HbA1c)"}</Text>
              {(r.items ?? []).map((i) => (
                <MutedText key={i.analyte_code}>
                  {i.analyte_code}: {i.value_numeric ?? i.value_text} {i.unit} ({i.flag})
                </MutedText>
              ))}
            </Card>
          ))}
          {poc.ecgs.map((e) => (
            <Card key={e.id} style={{ gap: 4 }}>
              <Text style={{ fontWeight: "700", color: colors.ink }}>Heart tracing (ECG)</Text>
              {e.interpretation_class ? <Text style={{ color: colors.ink }}>{ECG_CLASS_LABEL[e.interpretation_class]}</Text> : null}
              <MutedText>{e.interpretation}</MutedText>
              <MutedText>Read by a doctor.</MutedText>
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
