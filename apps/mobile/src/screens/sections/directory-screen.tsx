import { useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { asLocale, t, type Locale } from "@tarragon/i18n";
import { directionsHref, telHref } from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { reportListing, searchDirectory } from "@/lib/directory/api";
import {
  EMPTY_FILTERS, hmoKey, nairaFromKobo, nhiaKey, REPORT_FIELDS, tierKey,
  type DirectoryRow, type ReportField, type SearchFilters,
} from "@/lib/directory/model";
import { spacing } from "@/ui/theme";
import { placeholderColorFor, useLegacyColors, useTextInputStyle, useTheme } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

function lagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

function openLink(href: string): void {
  // A link that cannot be opened (no maps or dialler app) does nothing rather than crashing; the address and number are on the card.
  void Linking.openURL(href).catch(() => undefined);
}

function ReportBox({ row, locale }: { row: DirectoryRow; locale: Locale }) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [field, setField] = useState<ReportField>("phone");
  const [detail, setDetail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  if (state === "sent") return <MutedText>{t("directory.report.thanks", locale)}</MutedText>;
  return (
    <Card style={{ gap: 8 }}>
      <AppText variant="bodyStrong">{t("directory.report.title", locale)}</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {REPORT_FIELDS.map((f) => {
          const selected = f === field;
          return (
            <Pressable
              key={f}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setField(f)}
              style={{ borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, minHeight: 44, justifyContent: "center", backgroundColor: selected ? colors.brand : colors.groupBg }}
            >
              <Text style={{ fontSize: 12.5, fontWeight: "600", color: selected ? colors.onBrand : colors.ink }}>{t(`directory.report.field.${f}` as const, locale)}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        keyboardAppearance={scheme}
        placeholderTextColor={placeholderColorFor(scheme)}
        value={detail}
        onChangeText={setDetail}
        maxLength={500}
        placeholder={t("directory.report.detail", locale)}
        style={textInputStyle}
      />
      {state === "failed" ? <ErrorText>{t("directory.report.error", locale)}</ErrorText> : null}
      <PrimaryButton
        title={t("directory.report.send", locale)}
        loading={state === "sending"}
        onPress={() => {
          setState("sending");
          void reportListing({ listingTable: row.listing_table, listingId: row.listing_id, field, detail }).then((ok) => setState(ok ? "sent" : "failed"));
        }}
      />
    </Card>
  );
}

function Listing({ row, hmo, locale }: { row: DirectoryRow; hmo: string; locale: Locale }) {
  const colors = useLegacyColors();
  const [reporting, setReporting] = useState(false);
  const tel = telHref(row.phone);
  const maps = directionsHref(
    { latitude: row.latitude, longitude: row.longitude, name: row.name, address: row.address },
    Platform.OS === "ios" ? "ios" : "android",
  );
  const price = nairaFromKobo(row.price_kobo);
  const hmoLine = hmoKey(row.hmo_status);
  const nhiaLine = nhiaKey(row.nhia_status);
  return (
    <Card style={{ gap: 6 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{row.name}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <Badge tone={row.tier === "seed_only" ? "neutral" : "brand"}>{t(tierKey(row.tier), locale)}</Badge>
        <MutedText>{row.last_verified_at ? t("directory.last_verified", locale, { date: lagosDate(row.last_verified_at) }) : t("directory.never_verified", locale)}</MutedText>
      </View>
      <MutedText>{[row.address, row.city, row.state].filter(Boolean).join(", ")}</MutedText>
      {row.open_now !== null ? <AppText variant="body">{row.open_now ? t("directory.open_now", locale) : t("directory.closed_now", locale)}</AppText> : null}
      {row.hours_text ? <MutedText>{row.hours_text}</MutedText> : null}
      <AppText variant="body">{price ? t("directory.price.per_item", locale, { amount: price }) : t("directory.price.unknown", locale)}</AppText>
      {hmoLine ? <MutedText>{t(hmoLine, locale, { hmo })}</MutedText> : null}
      {nhiaLine ? <MutedText>{t(nhiaLine, locale)}</MutedText> : null}
      {row.rating_count > 0 ? (
        <MutedText>
          {row.rating_average !== null ? `${t("directory.rating.average", locale, { average: String(row.rating_average) })} · ` : ""}
          {t("directory.rating.count", locale, { count: String(row.rating_count) })}
        </MutedText>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {maps ? <SecondaryButton title={t("directory.directions", locale)} onPress={() => openLink(maps)} /> : null}
        {tel ? <SecondaryButton title={t("directory.call", locale)} onPress={() => openLink(tel)} /> : null}
        <SecondaryButton title={t("directory.report", locale)} onPress={() => setReporting((v) => !v)} />
      </View>
      {reporting ? <ReportBox row={row} locale={locale} /> : null}
    </Card>
  );
}

/**
 * Find care near you (S65, spec 15.8, 15.10, 15.11, 15.16, 15.17): search the directory by state, service, language, HMO, NHIA and
 * "open now"; every listing shows its tier and last-checked date, opens the phone's own maps and dialler, and can be reported as wrong.
 * Same database function and rules as the web page. Not on the phone yet: sorting by distance (needs a location module, a new native build)
 * and asking for a visit (use the web page).
 */
export function DirectoryScreen() {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const locale = asLocale(useUiLanguage());
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<DirectoryRow[] | null>(null);
  const [hmoSearched, setHmoSearched] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "not_open" | "error">("idle");
  const set = <K extends keyof SearchFilters>(k: K, v: SearchFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  async function search() {
    setLoading(true);
    setStatus("idle");
    const out = await searchDirectory(filters);
    setLoading(false);
    if (out.ok) {
      setRows(out.data);
      setHmoSearched(filters.hmo.trim());
    } else {
      setRows(null);
      setStatus(out.notOpen ? "not_open" : "error");
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <View>
        <ScreenTitle>{t("directory.title", locale)}</ScreenTitle>
        <MutedText>{t("directory.intro", locale)}</MutedText>
      </View>

      <Card style={{ gap: 10 }}>
        {(["state", "service", "language", "hmo"] as const).map((k) => (
          <TextInput
            key={k}
            keyboardAppearance={scheme}
            placeholderTextColor={placeholderColorFor(scheme)}
            value={filters[k]}
            onChangeText={(v) => set(k, v)}
            placeholder={t(`directory.filter.${k}` as const, locale)}
            accessibilityLabel={t(`directory.filter.${k}` as const, locale)}
            style={textInputStyle}
          />
        ))}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
          <AppText variant="body">{t("directory.filter.nhia", locale)}</AppText>
          <Switch accessibilityLabel={t("directory.filter.nhia", locale)} value={filters.nhia} onValueChange={(v) => set("nhia", v)} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
          <AppText variant="body">{t("directory.filter.open_now", locale)}</AppText>
          <Switch accessibilityLabel={t("directory.filter.open_now", locale)} value={filters.openNow} onValueChange={(v) => set("openNow", v)} />
        </View>
        <PrimaryButton title={t("directory.search", locale)} onPress={() => void search()} loading={loading} />
      </Card>

      {loading ? <ActivityIndicator color={colors.brand} /> : null}
      {status === "not_open" ? <MutedText>{t("directory.not_open", locale)}</MutedText> : null}
      {status === "error" ? <ErrorText>{t("directory.error", locale)}</ErrorText> : null}
      {rows !== null && rows.length === 0 ? <MutedText>{t("directory.none", locale)}</MutedText> : null}
      {(rows ?? []).map((row) => (
        <Listing key={`${row.listing_table}-${row.listing_id}`} row={row} hmo={hmoSearched} locale={locale} />
      ))}
    </ScrollView>
  );
}
