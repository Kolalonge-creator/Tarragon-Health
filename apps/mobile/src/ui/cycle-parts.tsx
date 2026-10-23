import { View } from "react-native";
import { t } from "@tarragon/i18n";
import type { CycleConfidence } from "@tarragon/shared";
import { confidenceDots } from "@tarragon/shared";
import { confidenceDotsLabel } from "@/lib/cycle-ui";
import { listenClipsFor, type CycleListenCard } from "@/lib/cycle-listen";
import { MIN_TARGET, radii, space, useTheme } from "@/ui/design";
import { AppText, Badge, Icon, ListenButton, PressableScale } from "@/ui/kit";

/** Small cycle-screen parts built on the kit (UI-A): a tick-and-word chip, the three-dot scale, Listen, and the save note. */

/**
 * A multi-choice chip: the word is always shown, and a tick appears when it is chosen, so the choice never depends on colour alone.
 * `group` marks a one-of-many set (flow) so a screen reader hears radio semantics.
 */
export function CycleChip({ label, selected, onPress, group = false }: { label: string; selected: boolean; onPress: () => void; group?: boolean }) {
  const { colors } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole={group ? "radio" : "checkbox"}
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }}
      scaleTo={0.96}
      style={{
        minHeight: MIN_TARGET,
        justifyContent: "center",
        paddingHorizontal: space.lg,
        borderRadius: radii.pill,
        backgroundColor: selected ? colors.brandTint : colors.surfaceMuted,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.brand : colors.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
        {selected ? <Icon name="done" size={16} tone="brandText" /> : null}
        <AppText variant="label" tone={selected ? "brandText" : "text"}>
          {label}
        </AppText>
      </View>
    </PressableScale>
  );
}

/** An action button at 16 points (the kit Button is 14): the main actions on the cycle screen. Same look, same 52 point target. */
export function CycleActionButton({ title, onPress, variant = "primary", loading = false }: { title: string; onPress: () => void; variant?: "primary" | "secondary"; loading?: boolean }) {
  const { colors } = useTheme();
  const primary = variant === "primary";
  return (
    <PressableScale
      onPress={loading ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: loading, busy: loading }}
      style={{
        minHeight: 52,
        borderRadius: radii.md,
        paddingHorizontal: space.xl,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: primary ? colors.brand : colors.surface,
        borderWidth: primary ? 0 : 1,
        borderColor: colors.border,
        opacity: loading ? 0.6 : 1,
      }}
    >
      <AppText variant="bodyLarge" tone={primary ? "textOnBrand" : "text"} style={{ fontWeight: "600" }}>
        {title}
      </AppText>
    </PressableScale>
  );
}

/** Three dots, filled from the engine's own confidence level. Read aloud as "Confidence: 2 of 3 dots." */
export function ConfidenceDots({ confidence }: { confidence: CycleConfidence }) {
  const { colors } = useTheme();
  const filled = confidenceDots(confidence);
  return (
    <View accessible accessibilityLabel={confidenceDotsLabel(confidence)} style={{ flexDirection: "row", gap: space.xs, alignItems: "center" }}>
      {[1, 2, 3].map((n) => (
        <View
          key={n}
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: colors.brand,
            backgroundColor: n <= filled ? colors.brand : "transparent",
          }}
        />
      ))}
    </View>
  );
}

/** Listen for a card that explains something. Renders nothing until a recorded, signed-off clip exists; the words are never replaced. */
export function CycleListen({ card }: { card: CycleListenCard }) {
  const ids = listenClipsFor(card);
  if (!ids) return null;
  return <ListenButton clipIds={ids} lang="en" />;
}

/**
 * The line under a log button. "Saved on this phone..." is shown only when a log really is held on the phone (`heldOnPhone`); a failed
 * save while offline says it was not sent. `pending` is the queue badge.
 */
export function CycleSaveNote({ state, pending }: { state: "idle" | "saved" | "queued" | "not_sent_offline" | "failed"; pending: number }) {
  const showBadge = pending > 0;
  if (state === "idle" && !showBadge) return null;
  return (
    <View style={{ gap: space.sm }}>
      {state === "queued" ? (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: space.sm }}>
          <Icon name="offline" size={16} tone="warnText" />
          <AppText variant="body" tone="warnText" style={{ flex: 1 }}>
            {t("cycle.offline.saved")}
          </AppText>
        </View>
      ) : null}
      {state === "not_sent_offline" ? (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: space.sm }}>
          <Icon name="offline" size={16} tone="warnText" />
          <AppText variant="body" tone="warnText" style={{ flex: 1 }}>
            {t("cycle.offline.not_sent")}
          </AppText>
        </View>
      ) : null}
      {state === "failed" ? (
        <AppText variant="body" tone="dangerText" accessibilityRole="alert">
          {t("cycle.log.save_failed")}
        </AppText>
      ) : null}
      {state === "saved" ? (
        <AppText variant="body" tone="brandText" accessibilityLiveRegion="polite">
          {t("cycle.log.saved")}
        </AppText>
      ) : null}
      {showBadge ? <Badge tone="warn" label={pending === 1 ? t("cycle.offline.waiting_one") : t("cycle.offline.waiting_many", undefined, { count: pending })} /> : null}
    </View>
  );
}
