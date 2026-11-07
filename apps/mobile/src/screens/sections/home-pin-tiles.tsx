import { View } from "react-native";
import type { GlucoseDisplayUnit, HomePinKey, HomePinVitalValue, HomeValuePinKey } from "@tarragon/shared";
import { HOME_PIN_ICON, HOME_PIN_SECTION } from "@/lib/home-pin-targets";
import { homeTileContent, type TileInputs } from "@/lib/home-tile-content";
import type { SectionId } from "@/lib/sections";
import type { SummaryStats } from "@/lib/overview";
import { space } from "@/ui/design";
import { BigNumberTile } from "@/ui/big-number-tile";
import { DoseBars } from "@/ui/reading-charts";

interface HomePinTilesProps {
  pins: readonly HomePinKey[];
  stats: SummaryStats;
  glucoseUnit: GlucoseDisplayUnit;
  vitalValues: Partial<Record<HomeValuePinKey, HomePinVitalValue>>;
  /** The vitals read failed: a vitals tile says so instead of "no reading yet". */
  vitalsFailed: boolean;
  /** The trend lines and doses history; null while loading (the tiles show their numbers without a line). */
  trends: TileInputs["trends"];
  onNavigate: (section: SectionId) => void;
}

/**
 * The patient's pinned tiles as big numbers (founder, 2026-11-06, as on the web): the latest value, when it was taken, a 30-day
 * trend line and the plain trend word. Tapping one opens the section behind it.
 */
export function HomePinTiles({ pins, stats, glucoseUnit, vitalValues, vitalsFailed, trends, onNavigate }: HomePinTilesProps) {
  if (pins.length === 0) return null;
  const input: TileInputs = { stats, glucoseUnit, vitalValues, vitalsFailed, trends };
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
      {pins.map((pin) => {
        const c = homeTileContent(pin, input);
        return (
          <View key={pin} style={{ flexBasis: "47%", flexGrow: 1 }}>
            <BigNumberTile
              icon={HOME_PIN_ICON[pin]}
              label={c.label}
              value={c.value}
              unit={c.unit}
              empty={c.empty}
              detail={c.detail}
              points={c.points}
              chart={c.doseDays ? <DoseBars days={c.doseDays} compact /> : undefined}
              onPress={() => onNavigate(HOME_PIN_SECTION[pin])}
            />
          </View>
        );
      })}
    </View>
  );
}
