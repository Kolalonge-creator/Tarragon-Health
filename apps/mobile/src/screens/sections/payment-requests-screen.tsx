import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Share, Text, View } from "react-native";
import { asLocale, en, t, type MessageKey } from "@tarragon/i18n";
import { paymentRequestLink, requestErrorKey, type PaymentRequestRow } from "@tarragon/commerce";
import { useUiLanguage } from "@/lib/ui-language";
import { PLATFORM_URL } from "@/lib/platform-url";
import { cancelPaymentRequest, createPaymentRequest, loadCatalogue, loadPaymentRequests } from "@/lib/commerce/api";
import type { CatalogueItem } from "@/lib/commerce/parse";
import { spacing } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/legacy-kit";

const isKey = (k: string): k is MessageKey => Object.hasOwn(en, k);
const lagos = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });

/**
 * Ask someone to pay (S72, 19.13). The link is made on the server, shown ONCE, and shared with the phone's OWN share sheet (React Native's Share); this is not a
 * messaging integration, and nothing about the person's health is in the link or the message (INV-07). Only the full yearly Membership can be asked for, because
 * nothing smaller can be paid for someone else. The link page, not this screen, shows the supporter the generic item and the itemised price.
 */
export function PaymentRequestsScreen() {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const tr = useCallback((key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params), [locale]);
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [rows, setRows] = useState<PaymentRequestRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [c, r] = await Promise.all([loadCatalogue(), loadPaymentRequests()]);
    if (c.ok) setItems(c.data.filter((i) => i.kind === "membership"));
    if (r.ok) setRows(r.data);
    setLoaded(true);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function make(code: string) {
    setBusy(true); setError(null); setLink(null);
    const r = await createPaymentRequest(code);
    setBusy(false);
    if (!r.ok) { const k = requestErrorKey(r.code); setError(isKey(k) ? k : "request.error.unknown"); return; }
    setLink(paymentRequestLink(PLATFORM_URL, r.request.code));
    await refresh();
  }

  async function share(url: string) {
    // The phone's own share sheet (it also offers Copy); the message says what it is and nothing else. No extra native module is needed.
    try {
      await Share.share({ title: tr("request.share.title"), message: tr("request.share.message", { link: url }) });
    } catch {
      setError("request.error.unknown");
    }
  }

  async function cancel(id: string) {
    setError(null);
    const res = await cancelPaymentRequest(id);
    if (res === "payment_in_progress") setError("request.cancel.in_progress");
    await refresh();
  }

  if (!loaded) return <ActivityIndicator color={colors.brand} />;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
      <ScreenTitle>{tr("request.title")}</ScreenTitle>
      <MutedText>{tr("request.intro")}</MutedText>
      <MutedText>{tr("request.only_year")}</MutedText>
      {items.map((i) => (
        <Card key={i.code}>
          <Text style={{ fontWeight: "700", color: colors.ink }}>{isKey(i.nameKey) ? t(i.nameKey, locale) : i.code}</Text>
          <PrimaryButton title={busy ? tr("request.creating") : tr("request.create")} onPress={() => void make(i.code)} disabled={busy} />
        </Card>
      ))}
      {error ? <ErrorText>{tr(error)}</ErrorText> : null}
      {link ? (
        <Card>
          <Text accessibilityRole="header" style={{ fontWeight: "700", color: colors.ink }}>{tr("request.link_ready")}</Text>
          <MutedText>{tr("request.link_once")}</MutedText>
          <Text selectable accessibilityLabel={tr("request.link_ready")} style={{ color: colors.ink }}>{link}</Text>
          <PrimaryButton title={tr("request.share")} onPress={() => void share(link)} />
        </Card>
      ) : null}
      <Card>
        <Text accessibilityRole="header" style={{ fontWeight: "700", color: colors.ink }}>{tr("request.list.title")}</Text>
        {rows.length === 0 ? <MutedText>{tr("request.list.empty")}</MutedText> : null}
        {rows.map((r) => {
          const sk = `request.status.${r.status}`;
          return (
            <View key={r.id} style={{ paddingVertical: 8, gap: 6 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: colors.ink, flexShrink: 1 }}>{isKey(r.nameKey) ? t(r.nameKey, locale) : r.itemCode}</Text>
                <Badge tone={r.status === "paid" ? "brand" : "neutral"}>{isKey(sk) ? t(sk, locale) : ""}</Badge>
              </View>
              {r.status === "open" ? <MutedText>{tr("request.expires_on", { date: lagos(r.expiresAt) })}</MutedText> : null}
              {r.status === "open" ? <SecondaryButton title={tr("request.cancel")} onPress={() => void cancel(r.id)} /> : null}
            </View>
          );
        })}
      </Card>
    </ScrollView>
  );
}
