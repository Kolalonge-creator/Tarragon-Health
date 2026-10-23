import { useMemo } from "react";
import { Pressable, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { asLocale, plainStatement } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { Card, MutedText, SectionLabel } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit";
import { readPlainStatementInput } from "@/lib/plain-statement-input";

const PUBLIC_SITE = "https://tarragonhealth.ng";

/**
 * Settings: the one-page plain "Pricing and accessibility" statement (privacy first). The wording is shared with the website and the
 * web Settings through `plainStatement`; the price is read from versioned configuration, never typed here.
 */
export function PlainStatementSection() {
  const locale = asLocale(useUiLanguage());
  const s = useMemo(() => plainStatement({ ...readPlainStatementInput(), surface: "app" }, locale), [locale]);
  const open = (path: string) => () => void WebBrowser.openBrowserAsync(`${PUBLIC_SITE}${path}`).catch(() => {});

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>{s.title}</SectionLabel>
      <MutedText>{s.intro}</MutedText>

      <Card style={{ gap: 6 }}>
        <AppText variant="title" heading>{s.privacy.title}</AppText>
        {s.privacy.points.map((p) => (
          <MutedText key={p}>{p}</MutedText>
        ))}
        <Link label={s.privacy.fullLink} onPress={open("/privacy")} />
      </Card>

      <Card style={{ gap: 6 }}>
        <AppText variant="title" heading>{s.pricing.title}</AppText>
        <AppText>{s.pricing.freeHead}</AppText>
        <MutedText>{s.pricing.freeBody}</MutedText>
        <AppText>{s.pricing.paidHead}</AppText>
        <MutedText>{s.pricing.offerDescription}</MutedText>
        {s.pricing.offerIncludes.map((line) => (
          <MutedText key={line}>{line}</MutedText>
        ))}
        <MutedText>{s.pricing.noRenew}</MutedText>
        <AppText>{s.pricing.priceLine}</AppText>
        {s.pricing.refundLine ? <MutedText>{s.pricing.refundLine}</MutedText> : null}
        <MutedText>{s.pricing.noTricks}</MutedText>
        <Link label={s.pricing.seePage} onPress={open("/pricing")} />
      </Card>

      <Card style={{ gap: 6 }}>
        <AppText variant="title" heading>{s.access.title}</AppText>
        {s.access.points.map((p) => (
          <MutedText key={p}>{p}</MutedText>
        ))}
        <MutedText>{s.access.limits}</MutedText>
        <Link label={s.access.fullLink} onPress={open("/accessibility")} />
      </Card>

      <Card style={{ gap: 6 }}>
        <AppText variant="title" heading>{s.ads.title}</AppText>
        <MutedText>{s.ads.body}</MutedText>
      </Card>
    </View>
  );
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: "center" }}
    >
      <MutedText>{label}</MutedText>
    </Pressable>
  );
}
