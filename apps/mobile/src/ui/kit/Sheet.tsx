import type { ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { elevation, radii, space, useTheme } from "../design";
import { AppText } from "./AppText";
import { Icon } from "./Icon";
import { PressableScale } from "./PressableScale";

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  closeLabel?: string;
}

/**
 * A bottom sheet. The backdrop closes it, the close button is always reachable,
 * the title is announced, and focus is held inside (accessibilityViewIsModal).
 * Motion is a short slide and fade; under reduced motion it appears instantly.
 */
export function Sheet({ visible, onClose, title, children, closeLabel }: SheetProps) {
  const { colors, scheme, reducedMotion } = useTheme();
  const locale = asLocale(useUiLanguage());
  const closeText = closeLabel ?? t("kit.close", locale);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end" }} accessibilityViewIsModal>
        <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(140)} exiting={reducedMotion ? undefined : FadeOut.duration(120)} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={closeText} onPress={onClose} style={{ flex: 1, backgroundColor: colors.scrim }} />
        </Animated.View>
        <Animated.View
          entering={reducedMotion ? undefined : SlideInDown.springify().damping(22).stiffness(220)}
          exiting={reducedMotion ? undefined : SlideOutDown.duration(180)}
          style={[
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              paddingHorizontal: space.xl,
              paddingTop: space.md,
              paddingBottom: insets.bottom + space.xl,
              maxHeight: "88%",
            },
            elevation(scheme, 2),
          ]}
        >
          <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: radii.pill, backgroundColor: colors.border, marginBottom: space.md }} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.md }}>
            <AppText variant="title" heading style={{ flex: 1 }}>
              {title}
            </AppText>
            <PressableScale onPress={onClose} withHaptic={false} accessibilityRole="button" accessibilityLabel={closeText} style={{ width: 44, alignItems: "center", justifyContent: "center" }}>
              <Icon name="close" size={22} tone="textMuted" />
            </PressableScale>
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}
