import { View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import {
  formatGlucose,
  GLUCOSE_UNIT_LABEL,
  isHomeValuePin,
  type GlucoseDisplayUnit,
  type HomePinKey,
  type HomePinVitalValue,
  type HomeValuePinKey,
} from "@tarragon/shared";
import { HOME_PIN_ICON, HOME_PIN_SECTION } from "@/lib/home-pin-targets";
import type { SectionId } from "@/lib/sections";
import type { SummaryStats } from "@/lib/overview";
import { useUiLanguage } from "@/lib/ui-language";
import { space } from "@/ui/design";
import { AppText, Card, Icon, PressableScale } from "@/ui/kit";

interface HomePinTilesProps {
  pins: readonly HomePinKey[];
  stats: SummaryStats;
  glucoseUnit: GlucoseDisplayUnit;
  vitalValues: Partial<Record<HomeValuePinKey, HomePinVitalValue>>;
  /** The vitals read failed: a vitals tile says so instead of "no reading yet". */
  vitalsFailed: boolean;
  onNavigate: (section: SectionId) => void;
}

/** The four tiles every patient has always had keep their original wording; the rest use the pin names. */
const TILE_LABEL: Partial<Record<HomePinKey, MessageKey>> = {
  bp: "home.stat.bp",
  glucose: "home.stat.glucose",
  active_meds: "home.stat.meds",
  doses_today: "home.stat.doses",
};

/** The patient's pinned tiles. Tapping one opens the section behind it. */
export function HomePinTiles({ pins, stats, glucoseUnit, vitalValues, vitalsFailed, onNavigate }: HomePinTilesProps) {
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey) => t(key, locale);
  const dash = "-";

  if (pins.length === 0) return null;

  function content(pin: HomePinKey): { value?: string; unit?: string; hint?: string } {
    switch (pin) {
      case "bp":
        return { value: stats.latestBp ? `${stats.latestBp.systolic}/${stats.latestBp.diastolic}` : dash, unit: "mmHg" };
      case "glucose":
        return {
          value: formatGlucose(stats.latestGlucoseMmolL, glucoseUnit, { withUnit: false }) ?? dash,
          unit: GLUCOSE_UNIT_LABEL[glucoseUnit],
        };
      case "active_meds":
        return { value: String(stats.activeMedicationCount) };
      case "doses_today":
        return { value: `${stats.dosesTaken}/${stats.dosesTotal}` };
      default: {
        if (isHomeValuePin(pin)) {
          const reading = vitalValues[pin];
          return reading ? { value: reading.value, unit: reading.unit } : { hint: tr(vitalsFailed ? "home.pins.load_failed" : "home.pins.no_reading") };
        }
        // A shortcut: the screen it opens has the detail, so the tile does not pretend to a number.
        return { hint: tr("home.pins.open") };
      }
    }
  }

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
      {pins.map((pin) => {
        const label = tr(TILE_LABEL[pin] ?? (`home.pin.${pin}` as MessageKey));
        const c = content(pin);
        const spoken = c.value ? `${label}: ${c.value}${c.unit ? ` ${c.unit}` : ""}` : `${label}: ${c.hint ?? ""}`;
        return (
          <View key={pin} style={{ flexBasis: "47%", flexGrow: 1 }}>
            <PressableScale
              onPress={() => onNavigate(HOME_PIN_SECTION[pin])}
              accessibilityRole="button"
              accessibilityLabel={spoken}
            >
              <Card style={{ gap: space.sm }}>
                <Icon name={HOME_PIN_ICON[pin]} size={18} tone="brandText" />
                <AppText variant="caption" tone="textMuted">
                  {label}
                </AppText>
                {c.value ? (
                  <AppText variant="stat">
                    {c.value}
                    {c.unit ? (
                      <AppText variant="caption" tone="textSubtle">
                        {" "}
                        {c.unit}
                      </AppText>
                    ) : null}
                  </AppText>
                ) : (
                  <AppText variant="body" tone="textSubtle">
                    {c.hint}
                  </AppText>
                )}
              </Card>
            </PressableScale>
          </View>
        );
      })}
    </View>
  );
}
