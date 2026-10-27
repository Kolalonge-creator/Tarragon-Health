import { useState } from "react";
import { View } from "react-native";
import { t } from "@tarragon/i18n";
import { isPickable, lastSevenDays, monthGrid, shiftMonth } from "@/lib/cycle-ui";
import { MIN_TARGET, radii, space, useTheme } from "@/ui/design";
import { AppText, Button, PressableScale, Sheet } from "@/ui/kit";
import { CycleListen } from "@/ui/cycle-parts";

/**
 * Choosing the day to log without typing a date (UI-A): the last seven days as big tap targets, then "Pick another date" for a month
 * grid in a sheet. `loggedDays` are days with a log (a small dot) and `periodDays` are days of a logged period (a filled circle); the
 * marks are explained in "What do these marks mean?", by shape and word, never colour alone.
 */

const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

interface PickerProps {
  today: string;
  selected: string;
  onSelect: (iso: string) => void;
  loggedDays: ReadonlySet<string>;
  periodDays: ReadonlySet<string>;
}

function dayLabel(iso: string, extras: { period: boolean; logged: boolean; isToday: boolean }): string {
  const spoken = new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
  return [spoken, extras.isToday ? t("cycle.log.today") : null, extras.period ? t("cycle.legend.period") : null, extras.logged ? t("cycle.legend.note") : null]
    .filter(Boolean)
    .join(". ");
}

export function CycleWeekStrip({ today, selected, onSelect, loggedDays, periodDays }: PickerProps) {
  const { colors } = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const days = lastSevenDays(today);
  return (
    <View style={{ gap: space.md }}>
      <AppText variant="label" tone="textMuted">
        {t("cycle.log.week_label")}
      </AppText>
      <View style={{ flexDirection: "row", gap: space.xs }}>
        {days.map((d) => {
          const isSel = d.iso === selected;
          const period = periodDays.has(d.iso);
          const logged = loggedDays.has(d.iso);
          return (
            <PressableScale
              key={d.iso}
              onPress={() => onSelect(d.iso)}
              accessibilityRole="button"
              accessibilityLabel={dayLabel(d.iso, { period, logged, isToday: d.isToday })}
              accessibilityState={{ selected: isSel }}
              scaleTo={0.96}
              style={{
                flex: 1,
                minHeight: 64,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radii.md,
                backgroundColor: isSel ? colors.brand : period ? colors.brandTint : colors.surfaceMuted,
                borderWidth: d.isToday ? 2 : 1,
                borderColor: isSel ? colors.brand : d.isToday ? colors.text : colors.border,
              }}
            >
              <View style={{ alignItems: "center", gap: 2 }}>
                <AppText variant="caption" tone={isSel ? "textOnBrand" : "textMuted"}>
                  {d.weekday}
                </AppText>
                <AppText variant="bodyStrong" tone={isSel ? "textOnBrand" : "text"}>
                  {d.day}
                </AppText>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: logged ? (isSel ? colors.textOnBrand : colors.text) : "transparent" }} />
              </View>
            </PressableScale>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        <Button title={t("cycle.log.pick_other")} variant="ghost" fullWidth={false} onPress={() => setPickerOpen(true)} />
        <Button title={t("cycle.legend.link")} variant="ghost" fullWidth={false} onPress={() => setLegendOpen(true)} />
      </View>

      <MonthSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        today={today}
        selected={selected}
        loggedDays={loggedDays}
        periodDays={periodDays}
        onSelect={(iso) => {
          onSelect(iso);
          setPickerOpen(false);
        }}
      />
      <LegendSheet visible={legendOpen} onClose={() => setLegendOpen(false)} />
    </View>
  );
}

function MonthSheet({ visible, onClose, today, selected, onSelect, loggedDays, periodDays }: PickerProps & { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), monthIndex: Number(today.slice(5, 7)) - 1 }));
  const rows = monthGrid(cursor.year, cursor.monthIndex);
  const title = new Date(Date.UTC(cursor.year, cursor.monthIndex, 1)).toLocaleDateString("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
  return (
    <Sheet visible={visible} onClose={onClose} title={t("cycle.log.pick_title")}>
      <View style={{ gap: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Button title={t("cycle.log.prev_month")} variant="ghost" fullWidth={false} onPress={() => setCursor((c) => shiftMonth(c.year, c.monthIndex, -1))} />
          <AppText variant="bodyStrong" accessibilityLiveRegion="polite">
            {title}
          </AppText>
          <Button title={t("cycle.log.next_month")} variant="ghost" fullWidth={false} onPress={() => setCursor((c) => shiftMonth(c.year, c.monthIndex, 1))} />
        </View>
        <View style={{ flexDirection: "row" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {WEEKDAY_INITIALS.map((w, i) => (
            <View key={`${w}-${i}`} style={{ flex: 1, alignItems: "center" }}>
              <AppText variant="caption" tone="textSubtle">
                {w}
              </AppText>
            </View>
          ))}
        </View>
        {rows.map((row, r) => (
          <View key={r} style={{ flexDirection: "row" }}>
            {row.map((cell, c) => {
              if (!cell) return <View key={c} style={{ flex: 1, minHeight: MIN_TARGET }} />;
              const pickable = isPickable(cell.iso, today);
              const period = periodDays.has(cell.iso);
              const logged = loggedDays.has(cell.iso);
              const isSel = cell.iso === selected;
              return (
                <PressableScale
                  key={c}
                  onPress={pickable ? () => onSelect(cell.iso) : undefined}
                  accessibilityRole="button"
                  accessibilityLabel={dayLabel(cell.iso, { period, logged, isToday: cell.iso === today })}
                  accessibilityState={{ selected: isSel, disabled: !pickable }}
                  style={{ flex: 1, minHeight: MIN_TARGET, alignItems: "center", justifyContent: "center" }}
                >
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 19,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: isSel ? colors.brand : period ? colors.brandTint : "transparent",
                      borderWidth: cell.iso === today ? 2 : period ? 1 : 0,
                      borderColor: cell.iso === today ? colors.text : colors.brand,
                      opacity: pickable ? 1 : 0.35,
                    }}
                  >
                    <AppText variant="body" tone={isSel ? "textOnBrand" : "text"}>
                      {cell.day}
                    </AppText>
                    {logged ? <View style={{ position: "absolute", bottom: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: isSel ? colors.textOnBrand : colors.text }} /> : null}
                  </View>
                </PressableScale>
              );
            })}
          </View>
        ))}
      </View>
    </Sheet>
  );
}

/** "What do these marks mean?": shape plus word. The phone calendar shows logged periods, days with notes, and today. */
export function LegendSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const rows: { key: string; text: string; mark: React.ReactNode }[] = [
    { key: "period", text: t("cycle.legend.period"), mark: <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brandTint, borderWidth: 1, borderColor: colors.brand }} /> },
    { key: "note", text: t("cycle.legend.note"), mark: <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.text }} /> },
    { key: "today", text: t("cycle.legend.today"), mark: <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.text }} /> },
  ];
  return (
    <Sheet visible={visible} onClose={onClose} title={t("cycle.legend.title")}>
      <View style={{ gap: space.md }}>
        <CycleListen card="legend" />
        {rows.map((r) => (
          <View key={r.key} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <View style={{ width: 28, alignItems: "center" }}>{r.mark}</View>
            <AppText variant="body" style={{ flex: 1 }}>
              {r.text}
            </AppText>
          </View>
        ))}
      </View>
    </Sheet>
  );
}
