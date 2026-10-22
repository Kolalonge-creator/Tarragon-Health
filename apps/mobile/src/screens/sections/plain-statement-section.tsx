import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { asLocale, plainStatement } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { Card, MutedText, SectionLabel } from "@/ui/legacy-kit";
import { readPlainStatementInput } from "@/lib/plain-statement-input";

const PUBLIC_SITE = "https://tarragonhealth.ng";

/**
 * Settings: the one-page plain "Pricing and accessibility" statement (privacy first). The wording is shared with the website and the
 * web Settings through `plainStatement`; the price is read from versioned configuration, never typed here.
 */
export function PlainStatementSection() {
  const locale = asLocale(useUiLanguage());
  const s = useMemo(() => plainStatement(readPlainStatementInput(), locale), [locale]);
  const open = (path: string) => () => void WebBrowser.openBrowserAsync(`${PUBLIC_SITE}${path}`).catch(() => {});

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>{s.title}</SectionLabel>
      <MutedText>{s.intro}</MutedText>

      <Card style={{ gap: 6 }}>
        <Text accessibilityRole="header">{s.privacy.title}</Text>
        {s.privacy.points.map((p) => (
          <MutedText key={p}>{p}</MutedText>
        ))}
        <Link label={s.privacy.fullLink} onPress={open("/privacy")} />
      </Card>

      <Card style={{ gap: 6 }}>
        <Text accessibilityRole="header">{s.pricing.title}</Text>
        <Text>{s.pricing.freeHead}</Text>
        <MutedText>{s.pricing.freeBody}</MutedText>
        <Text>{s.pricing.paidHead}</Text>
        <MutedText>{s.pricing.paidBody}</MutedText>
        <Text>{s.pricing.priceLine}</Text>
        {s.pricing.refundLine ? <MutedText>{s.pricing.refundLine}</MutedText> : null}
        <MutedText>{s.pricing.medicines}</MutedText>
        <MutedText>{s.pricing.noTricks}</MutedText>
        <Link label={s.pricing.seePage} onPress={open("/pricing")} />
      </Card>

      <Card style={{ gap: 6 }}>
        <Text accessibilityRole="header">{s.access.title}</Text>
        {s.access.points.map((p) => (
          <MutedText key={p}>{p}</MutedText>
        ))}
        <MutedText>{s.access.limits}</MutedText>
        <Link label={s.access.fullLink} onPress={open("/accessibility")} />
      </Card>

      <Card style={{ gap: 6 }}>
        <Text accessibilityRole="header">{s.ads.title}</Text>
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
