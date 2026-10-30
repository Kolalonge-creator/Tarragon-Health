import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { space } from "../design";
import { AppText } from "./AppText";
import { Card } from "./Card";
import { Icon } from "./Icon";
import { PressableScale } from "./PressableScale";

interface DisclosureProps {
  title: string;
  /** One quiet line under the title saying what is inside. */
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * A titled card that is folded until tapped. Keeps a long screen short: the main task stays above, the rarely needed material goes
 * inside. The web Disclosure's counterpart. The content stays mounted while folded, so a half-typed form keeps its text.
 */
export function Disclosure({ title, hint, defaultOpen = false, children }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card padded={false}>
      <PressableScale
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={hint ? `${title}. ${hint}` : title}
        scaleTo={0.99}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, minHeight: 48 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyStrong">{title}</AppText>
            {hint ? (
              <AppText variant="caption" tone="textMuted">
                {hint}
              </AppText>
            ) : null}
          </View>
          <Icon name={open ? "collapse" : "expand"} size={18} tone="textSubtle" />
        </View>
      </PressableScale>
      <View style={{ display: open ? "flex" : "none", gap: space.md, padding: space.lg, paddingTop: space.sm }}>{children}</View>
    </Card>
  );
}
