import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
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
import { asLocale, en, t, type MessageKey } from "@tarragon/i18n";
import { formatNaira, panelIncluded, UPGRADE_CODE } from "@tarragon/commerce";
import { YEARLY_PANEL_TESTS, testingDaysOffer, type TestingDaysOffer } from "@tarragon/shared";
import { loadCatalogue } from "@/lib/commerce/api";
import { useUiLanguage } from "@/lib/ui-language";
import { PLATFORM_URL } from "@/lib/platform-url";
import { spacing } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/legacy-kit";
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
 * Testing days for Members: see the upcoming days with places left, hold one, change or cancel it. Mirrors
 * apps/web/.../patient/testing-days. A Free account sees what Membership includes; the rules themselves live in the database.
 */
export function TestingDaysScreen() {
  const colors = useLegacyColors();
  const [days, setDays] = useState<TestingDay[]>([]);
  const [bookings, setBookings] = useState<MyTestingBooking[]>([]);
  const [poc, setPoc] = useState<PocReleased>({ results: [], ecgs: [] });
  const [notMember, setNotMember] = useState(false);
  const [offer, setOffer] = useState<TestingDaysOffer>({ options: [], showPanelTests: false });
  const locale = asLocale(useUiLanguage());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [d, b, p] = await Promise.all([loadTestingDays(), loadMyTestingBookings(), loadReleasedPocResults()]);
    if (d.ok) {
      setDays(d.data.days);
      setNotMember(d.data.notMember);
      // A Free account is shown what Membership includes and costs, from the shop's own catalogue. A failed read leaves only the prompt.
      if (d.data.notMember) {
        const c = await loadCatalogue();
        if (c.ok) setOffer(testingDaysOffer(c.data.map((i) => ({ code: i.code, kind: i.kind, name_key: i.nameKey, amount_kobo: i.amountKobo })), panelIncluded, (code) => code === UPGRADE_CODE));
      }
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
          <AppText variant="bodyStrong">Testing days are part of Membership</AppText>
          {offer.showPanelTests ? (
            <View style={{ gap: 4 }}>
              <MutedText>With Membership Plus, your yearly blood tests are taken at a testing day. They cover:</MutedText>
              {YEARLY_PANEL_TESTS.map((g) => (
                <AppText key={g.heading} variant="body">
                  <AppText variant="bodyStrong">{g.heading}: </AppText>
                  {g.tests.join(", ")}
                </AppText>
              ))}
            </View>
          ) : null}
          {offer.options.map((o) => (
            <View key={o.code} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <AppText variant="body" style={{ flex: 1 }}>{Object.hasOwn(en, o.nameKey) ? t(o.nameKey as MessageKey, locale) : "Membership"}</AppText>
              <AppText variant="bodyStrong">{`₦${formatNaira(o.amountKobo)}`}</AppText>
            </View>
          ))}
          <SecondaryButton title="See what Membership includes" onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/membership`)} />
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

      {!notMember && (
        <View style={{ gap: 10 }}>
          <AppText variant="bodyLargeStrong">{live ? "Other days" : "Upcoming testing days"}</AppText>
          {!loading && others.length === 0 && <MutedText>No other days are open right now. Please check back soon.</MutedText>}
          {others.map((d) => (
            <Card key={d.id} style={{ gap: 6 }}>
              <AppText variant="bodyStrong">{when(d.event_date)}</AppText>
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
