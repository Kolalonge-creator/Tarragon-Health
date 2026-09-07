import { useState } from "react";
import { Modal, ScrollView, View } from "react-native";
import type { Ionicons } from "@expo/vector-icons";
import { WebViewScreen } from "@/screens/webview-screen";
import { colors, spacing } from "@/ui/theme";
import { CalloutCard, MutedText, ScreenTitle, SecondaryButton } from "@/ui/components";

interface WebViewHubScreenProps {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  webviewPath: string;
  ctaLabel?: string;
}

/**
 * Shared shell for a section with no native data widgets built yet: real
 * native chrome (header, description, consistent spacing/typography — same
 * as every native screen) around a single card that opens the existing web
 * page in a contained modal, rather than the web page taking over the
 * entire screen as a full-bleed WebView with no native chrome at all. Same
 * "one real native win, browser/WebView for the rest" shape as Labs/Care/
 * Prevention, just without a native win yet for sections whose web page is
 * mostly a large composed dashboard (many sub-widgets) rather than one or
 * two genuinely native-shaped actions — a real, incremental step ahead of a
 * bare WebViewScreen swap, not a placeholder. Native widgets get added here
 * screen-by-screen as each section's own data model is worked through
 * carefully rather than ported in bulk.
 */
export function WebViewHubScreen({ title, description, icon, webviewPath, ctaLabel = "Open" }: WebViewHubScreenProps) {
  const [open, setOpen] = useState(false);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 16 }}
    >
      <View>
        <ScreenTitle>{title}</ScreenTitle>
        <MutedText>{description}</MutedText>
      </View>

      <CalloutCard icon={icon} title={title} subtitle={description} ctaLabel={ctaLabel} onPress={() => setOpen(true)} />

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1 }}>
          <View style={{ padding: spacing.screen, paddingTop: 56 }}>
            <SecondaryButton title="Close" onPress={() => setOpen(false)} />
          </View>
          <WebViewScreen path={webviewPath} />
        </View>
      </Modal>
    </ScrollView>
  );
}
