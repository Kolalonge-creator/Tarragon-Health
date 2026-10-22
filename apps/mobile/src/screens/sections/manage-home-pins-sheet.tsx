import { useEffect, useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import {
  HOME_PIN_GROUP,
  HOME_PIN_GROUPS,
  HOME_PIN_KEYS,
  MAX_HOME_PINS,
  movePin,
  togglePin,
  type HomePinKey,
} from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { space, useTheme } from "@/ui/design";
import { AppText, Button, InlineAlert, PressableScale, Sheet } from "@/ui/kit";

interface ManageHomePinsSheetProps {
  visible: boolean;
  onClose: () => void;
  pins: readonly HomePinKey[];
  lockedPins: readonly HomePinKey[];
  /** Resolves true when saved; false shows the error line and keeps the sheet open. */
  onSave: (pins: HomePinKey[]) => Promise<boolean>;
}

const pinLabel = (key: HomePinKey) => `home.pin.${key}` as MessageKey;

/**
 * Choose which tiles stay on the home screen and in what order. Pins the care
 * plan relies on (today's doses, for anyone taking a medication) are shown but
 * cannot be switched off.
 */
export function ManageHomePinsSheet({ visible, onClose, pins, lockedPins, onSave }: ManageHomePinsSheetProps) {
  const { colors } = useTheme();
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  const [draft, setDraft] = useState<HomePinKey[]>([...pins]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  // Start from what is saved each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setDraft([...pins]);
      setFailed(false);
    }
  }, [visible, pins]);

  async function save() {
    setSaving(true);
    setFailed(false);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) onClose();
    else setFailed(true);
  }

  const atLimit = draft.length >= MAX_HOME_PINS;

  return (
    <Sheet visible={visible} onClose={onClose} title={tr("home.pins.sheet_title")}>
      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: space.lg, paddingBottom: space.md }}>
        <AppText variant="body" tone="textMuted">
          {tr("home.pins.sheet_body", { max: MAX_HOME_PINS })}
        </AppText>

        {draft.length > 0 ? (
          <View style={{ gap: space.xs }}>
            <AppText variant="label" tone="textMuted">
              {tr("home.pins.showing")}
            </AppText>
            {draft.map((key, index) => (
              <View key={key} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
                <AppText variant="body" style={{ flex: 1 }}>
                  {tr(pinLabel(key))}
                </AppText>
                <View style={{ flexDirection: "row", gap: space.xs }}>
                  <MoveButton
                    label={tr("home.pins.up")}
                    a11y={tr("home.pins.move_up", { name: tr(pinLabel(key)) })}
                    disabled={index === 0}
                    onPress={() => setDraft((d) => movePin(d, key, "up"))}
                  />
                  <MoveButton
                    label={tr("home.pins.down")}
                    a11y={tr("home.pins.move_down", { name: tr(pinLabel(key)) })}
                    disabled={index === draft.length - 1}
                    onPress={() => setDraft((d) => movePin(d, key, "down"))}
                  />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {HOME_PIN_GROUPS.map((group) => (
          <View key={group} style={{ gap: space.xs }}>
            <AppText variant="label" tone="textMuted">
              {tr(`home.pins.group.${group}` as MessageKey)}
            </AppText>
            {HOME_PIN_KEYS.filter((key) => HOME_PIN_GROUP[key] === group).map((key) => {
              const checked = draft.includes(key);
              const locked = lockedPins.includes(key);
              return (
                <View key={key} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48, gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="body">{tr(pinLabel(key))}</AppText>
                    {locked ? (
                      <AppText variant="caption" tone="textSubtle">
                        {tr("home.pins.locked")}
                      </AppText>
                    ) : null}
                  </View>
                  <Switch
                    value={checked}
                    disabled={locked || (!checked && atLimit)}
                    onValueChange={() => setDraft((d) => togglePin(d, key, lockedPins))}
                    accessibilityLabel={tr(pinLabel(key))}
                    trackColor={{ true: colors.brand, false: colors.border }}
                  />
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>

      {failed ? <InlineAlert tone="info" message={tr("home.pins.error")} /> : null}
      <Button title={saving ? tr("home.pins.saving") : tr("home.pins.save")} onPress={() => void save()} loading={saving} />
    </Sheet>
  );
}

function MoveButton({ label, a11y, disabled, onPress }: { label: string; a11y: string; disabled: boolean; onPress: () => void }) {
  return (
    <PressableScale
      onPress={disabled ? undefined : onPress}
      withHaptic={false}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      style={{ minWidth: 56, minHeight: 44, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : 1 }}
    >
      <AppText variant="label" tone="brandText">
        {label}
      </AppText>
    </PressableScale>
  );
}
