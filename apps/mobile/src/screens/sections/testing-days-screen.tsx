import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
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
import { Badge, Card, ErrorText, MutedText, ScreenTitle, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

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
 * Testing days (T2-02, 2026-11-04): Tarragon-run public testing days are closed to new bookings. Someone who already holds a place
 * still sees it and can cancel it or move it to another scheduled day; released results still show. Everyone else is told plainly
 * where yearly tests happen now (any reputable laboratory, paid directly, report uploaded for a doctor to review). Mirrors
 * apps/web/.../patient/testing-days; the rules themselves live in the database.
 */
export function TestingDaysScreen() {
  const colors = useLegacyColors();
  const [days, setDays] = useState<TestingDay[]>([]);
  const [bookings, setBookings] = useState<MyTestingBooking[]>([]);
  const [poc, setPoc] = useState<PocReleased>({ results: [], ecgs: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [d, b, p] = await Promise.all([loadTestingDays(), loadMyTestingBookings(), loadReleasedPocResults()]);
    // The day list is only used to move a place someone already holds; a Free account gets none, which is fine.
    if (d.ok) setDays(d.data.days);
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
        <MutedText>If you already hold a place at a testing day, it is shown here and we will remind you before it.</MutedText>
      </View>

      {loading && <ActivityIndicator color={colors.brand} />}
      {error && <ErrorText>{error}</ErrorText>}
      {message && <MutedText>{message}</MutedText>}

      {!loading && !live && (
        <Card style={{ gap: 8 }}>
          <AppText variant="bodyStrong">We are not taking new bookings for Tarragon testing days.</AppText>
          <MutedText>
            You can do your yearly tests at any reputable laboratory near you. Download a lab request form, take it to the laboratory and pay
            them directly (contact the laboratory for current pricing). Then upload the report: a doctor reviews it and it is kept in your
            health record with your trends.
          </MutedText>
          <SecondaryButton title="Get a lab request form" onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/labs`)} />
        </Card>
      )}

      {live && (
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <AppText variant="bodyStrong" style={{ flex: 1 }}>Your place</AppText>
            <Badge tone={live.state === "confirmed" ? "brand" : "neutral"}>{STATE_LABEL[live.state]}</Badge>
          </View>
          <AppText variant="body">{when(live.event_date)}</AppText>
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

      {live && others.length > 0 && (
        <View style={{ gap: 10 }}>
          <AppText variant="bodyLargeStrong">Other days you can move to</AppText>
          {others.map((d) => (
            <Card key={d.id} style={{ gap: 6 }}>
              <AppText variant="bodyStrong">{when(d.event_date)}</AppText>
              <MutedText>
                {d.venue_name}, {d.address}, {d.city}
                {d.lga ? ` (${d.lga})` : ""}
              </MutedText>
              <MutedText>{seatsLabel(d)}</MutedText>
              <SecondaryButton
                title="Change to this day"
                loading={busy === d.id}
                onPress={() => void run(d.id, () => rescheduleTestingBooking(live.booking_id, d.id), "Your place is moved.")}
              />
            </Card>
          ))}
        </View>
      )}

      {(poc.results.length > 0 || poc.ecgs.length > 0) && (
        <View style={{ gap: 10 }}>
          <AppText variant="bodyLargeStrong">Results from your visit</AppText>
          {poc.results.map((r) => (
            <Card key={r.id} style={{ gap: 4 }}>
              <AppText variant="bodyStrong">{r.kind === "urinalysis" ? "Urine test" : "Sugar control (HbA1c)"}</AppText>
              {(r.items ?? []).map((i) => (
                <MutedText key={i.analyte_code}>
                  {i.analyte_code}: {i.value_numeric ?? i.value_text} {i.unit} ({i.flag})
                </MutedText>
              ))}
            </Card>
          ))}
          {poc.ecgs.map((e) => (
            <Card key={e.id} style={{ gap: 4 }}>
              <AppText variant="bodyStrong">Heart tracing (ECG)</AppText>
              {e.interpretation_class ? <AppText variant="body">{ECG_CLASS_LABEL[e.interpretation_class]}</AppText> : null}
              <MutedText>{e.interpretation}</MutedText>
              <MutedText>Read by a doctor.</MutedText>
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
