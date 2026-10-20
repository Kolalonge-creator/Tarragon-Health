import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  ANCHOR_IDS,
  anchorBaseTime,
  addDays,
  isValidTime,
  lagosLocalDate,
  type AnchoredDose,
  type AnchorId,
  type AnchorProfile,
} from "@tarragon/medicines";
import { anchorPhrase, anchorTitle, asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { useLegacyColors, useTheme } from "@/ui/design";
import { MutedText, SectionLabel } from "@/ui/legacy-kit";
import { loadDoseAnchorConfig } from "@/lib/anchor-config";
import { anchorProfileFor, refreshAnchorProfile, type DayShiftRow } from "@/lib/anchor-profile";
import { endDayShift, saveAnchorTimes, startDayShift } from "@/lib/anchor-actions";
import { readLocalShiftRows } from "@/lib/offline-store";
import { listOutbox } from "@/lib/outbox";

/**
 * Screens for dose times tied to the patient's day (S08z): the picker used when adding a medicine, and the "My day" section
 * where the patient sets the time of each anchor they use and shifts their day for a run of dates. Plain words, 44 point
 * targets, every state shown. Nothing here is advice about when to take anything.
 */

function OptionChip({ title, selected, onPress, disabled }: { title: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  const colors = useLegacyColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        minWidth: 44,
        justifyContent: "center",
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: selected ? colors.brand : colors.border,
        backgroundColor: selected ? colors.brandTint : "transparent",
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontSize: 14, fontWeight: selected ? "700" : "500", color: colors.ink }}>{title}</Text>
    </Pressable>
  );
}

function ActionButton({ title, onPress, disabled, tone }: { title: string; onPress: () => void; disabled?: boolean; tone?: "primary" | "plain" }) {
  const colors = useLegacyColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 18,
        borderRadius: 12,
        backgroundColor: tone === "plain" ? "transparent" : colors.brand,
        borderWidth: tone === "plain" ? 1.5 : 0,
        borderColor: colors.border,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ fontSize: 15, fontWeight: "700", color: tone === "plain" ? colors.ink : "#fff" }}>{title}</Text>
    </Pressable>
  );
}

/** "08:15" typed by hand. Returns the zero-padded form or null. */
export function normaliseClock(value: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hh = String(Number(m[1])).padStart(2, "0");
  const time = `${hh}:${m[2]}`;
  return isValidTime(time) ? time : null;
}

/** Loads (and keeps fresh) the profile for one person. */
export function useAnchorProfile(patientId: string): { profile: AnchorProfile; reload: () => Promise<void> } {
  const [profile, setProfile] = useState<AnchorProfile>(() => anchorProfileFor(patientId));
  const reload = useCallback(async () => {
    setProfile(await refreshAnchorProfile(patientId));
  }, [patientId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { profile, reload };
}

// --- The picker used when adding a medicine ----------------------------------------------------------------------------------

export interface AnchorPickerProps {
  patientId: string;
  value: AnchoredDose[];
  onChange: (next: AnchoredDose[]) => void;
  /** Times the patient has typed for anchors in this form, not yet saved. */
  drafts: Partial<Record<AnchorId, string>>;
  onDrafts: (next: Partial<Record<AnchorId, string>>) => void;
}

export function AnchorPicker({ patientId, value, onChange, drafts, onDrafts }: AnchorPickerProps) {
  const colors = useLegacyColors();
  const { scheme } = useTheme();
  const locale = asLocale(useUiLanguage());
  const { profile } = useAnchorProfile(patientId);
  const config = useMemo(() => loadDoseAnchorConfig(), []);
  const chosen = ANCHOR_IDS.filter((id) => value.some((a) => a.anchor === id));

  function toggleAnchor(id: AnchorId) {
    if (chosen.includes(id)) {
      onChange(value.filter((a) => a.anchor !== id));
      const { [id]: _drop, ...rest } = drafts;
      void _drop;
      onDrafts(rest);
    } else {
      onChange([...value, { anchor: id, offsetMinutes: 0 }]);
    }
  }

  function toggleOffset(id: AnchorId, offset: number) {
    const has = value.some((a) => a.anchor === id && a.offsetMinutes === offset);
    const others = value.filter((a) => a.anchor === id && a.offsetMinutes !== offset);
    // At least one offset stays: removing the last one removes the anchor, which the chip above does.
    if (has && others.length === 0) return;
    onChange(has ? value.filter((a) => !(a.anchor === id && a.offsetMinutes === offset)) : [...value, { anchor: id, offsetMinutes: offset }]);
  }

  return (
    <View style={{ gap: 8 }} accessibilityLabel={t("doseanchor.pick_title", locale)}>
      <SectionLabel>{t("doseanchor.pick_title", locale)}</SectionLabel>
      <MutedText>{t("doseanchor.pick_help", locale)}</MutedText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {ANCHOR_IDS.map((id) => (
          <OptionChip key={id} title={anchorTitle(id, locale)} selected={chosen.includes(id)} onPress={() => toggleAnchor(id)} />
        ))}
      </View>
      {chosen.length === 0 ? <MutedText>{t("doseanchor.pick_none", locale)}</MutedText> : null}
      {chosen.map((id) => {
        const current = drafts[id] ?? anchorBaseTime(profile, id);
        const confirmed = (profile.times[id] ?? []).length > 0;
        return (
          <View key={id} style={{ gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
            <MutedText>{t("doseanchor.pick_offset", locale, { name: t(`doseanchor.name.${id}` as MessageKey, locale) })}</MutedText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {config.offsetChoices.map((off) => (
                <OptionChip
                  key={off}
                  title={anchorPhrase(id, off, locale)}
                  selected={value.some((a) => a.anchor === id && a.offsetMinutes === off)}
                  onPress={() => toggleOffset(id, off)}
                />
              ))}
            </View>
            <MutedText>{confirmed ? t("doseanchor.pick_at_time", locale, { time: current }) : t("doseanchor.pick_confirm_time", locale, { time: current, name: t(`doseanchor.name.${id}` as MessageKey, locale) })}</MutedText>
            <TextInput
              keyboardAppearance={scheme}
              accessibilityLabel={t("doseanchor.myday.time_label", locale, { name: anchorTitle(id, locale) })}
              value={drafts[id] ?? current}
              onChangeText={(v) => onDrafts({ ...drafts, [id]: v })}
              placeholder="HH:MM"
              placeholderTextColor={colors.subtle}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              style={{ minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, color: colors.ink, fontSize: 16 }}
            />
          </View>
        );
      })}
    </View>
  );
}

// --- My day ----------------------------------------------------------------------------------------------------------------------

type Notice = { kind: "ok" | "error"; text: string } | null;

export function MyDaySection({ patientId }: { patientId: string }) {
  const colors = useLegacyColors();
  const { scheme } = useTheme();
  const locale = asLocale(useUiLanguage());
  const config = useMemo(() => loadDoseAnchorConfig(), []);
  const { profile, reload } = useAnchorProfile(patientId);
  const [open, setOpen] = useState(false);
  const [times, setTimes] = useState<Partial<Record<AnchorId, string>>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [shifts, setShifts] = useState<DayShiftRow[]>([]);
  const today = lagosLocalDate(Date.now());

  // Shifts: the server's copy plus any still waiting to be sent, newest last.
  const loadShifts = useCallback(async () => {
    const [server, pending] = await Promise.all([readLocalShiftRows<DayShiftRow>(patientId), listOutbox()]);
    const waiting: DayShiftRow[] = pending
      .filter((i) => i.kind === "day_shift" && i.subjectId === patientId && i.state === "pending")
      .map((i) => {
        const p = i.payload as { starts_on: string; ends_on: string; offsets: Record<string, number> };
        return { id: i.clientId, starts_on: p.starts_on, ends_on: p.ends_on, offsets: p.offsets, cancelled_from: null, created_at: i.createdAt };
      });
    const ended = new Map(
      pending.filter((i) => i.kind === "day_shift_end" && i.subjectId === patientId && i.state === "pending").map((i) => {
        const p = i.payload as { shift_id: string; cancelled_from: string };
        return [p.shift_id, p.cancelled_from] as const;
      })
    );
    setShifts(
      [...server, ...waiting]
        .map((s) => (ended.has(s.id) ? { ...s, cancelled_from: ended.get(s.id) ?? s.cancelled_from } : s))
        .filter((s) => s.ends_on >= today && (s.cancelled_from === null || s.cancelled_from > today))
        .sort((a, b) => (a.starts_on < b.starts_on ? -1 : 1))
    );
  }, [patientId, today]);
  useEffect(() => {
    void loadShifts();
  }, [loadShifts, profile]);

  async function saveTimes() {
    const clean: Partial<Record<AnchorId, string>> = {};
    for (const [k, v] of Object.entries(times) as [AnchorId, string][]) {
      const norm = normaliseClock(v);
      if (norm === null) {
        setNotice({ kind: "error", text: t("doseanchor.myday.error", locale) });
        return;
      }
      if (norm !== anchorBaseTime(profile, k) || (profile.times[k] ?? []).length === 0) clean[k] = norm;
    }
    if (Object.keys(clean).length === 0) {
      setNotice({ kind: "ok", text: t("doseanchor.myday.saved_now", locale) });
      return;
    }
    setBusy(true);
    const result = await saveAnchorTimes(patientId, clean);
    setBusy(false);
    if (!result.ok) {
      setNotice({ kind: "error", text: result.error === "window_overlap" ? t("doseanchor.window_overlap", locale) : t("doseanchor.myday.error", locale) });
      return;
    }
    setTimes({});
    setNotice({ kind: "ok", text: result.startsTomorrow ? t("doseanchor.myday.saved_tomorrow", locale) : t("doseanchor.myday.saved_now", locale) });
    await reload();
  }

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <SectionLabel>{t("doseanchor.myday.title", locale)}</SectionLabel>
        <OptionChip title={open ? t("doseanchor.myday.hide", locale) : t("doseanchor.myday.show", locale)} selected={open} onPress={() => setOpen((v) => !v)} />
      </View>
      {shifts.map((s) => (
        <View key={s.id} style={{ gap: 6 }} accessibilityRole="summary">
          <MutedText>
            {s.starts_on <= today
              ? t("doseanchor.myday.shift_active", locale, { date: s.ends_on })
              : t("doseanchor.myday.shift_upcoming", locale, { from: s.starts_on, to: s.ends_on })}
          </MutedText>
          <ActionButton
            tone="plain"
            title={t("doseanchor.myday.shift_end", locale)}
            onPress={async () => {
              const r = await endDayShift(patientId, s);
              setNotice(r.ok ? { kind: "ok", text: t("doseanchor.myday.shift_ended", locale) } : { kind: "error", text: t("doseanchor.myday.error", locale) });
              await reload();
              await loadShifts();
            }}
          />
        </View>
      ))}
      {open ? (
        <View style={{ gap: 10 }}>
          <MutedText>{t("doseanchor.myday.intro", locale)}</MutedText>
          {ANCHOR_IDS.map((id) => {
            const set = (profile.times[id] ?? []).length > 0;
            const base = anchorBaseTime(profile, id);
            return (
              <View key={id} style={{ gap: 4 }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>{anchorTitle(id, locale)}</Text>
                {!set ? <MutedText>{t("doseanchor.myday.not_set", locale, { time: base })}</MutedText> : null}
                <TextInput
                  keyboardAppearance={scheme}
                  accessibilityLabel={t("doseanchor.myday.time_label", locale, { name: anchorTitle(id, locale) })}
                  value={times[id] ?? base}
                  onChangeText={(v) => setTimes((prev) => ({ ...prev, [id]: v }))}
                  placeholder="HH:MM"
                  placeholderTextColor={colors.subtle}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  style={{ minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, color: colors.ink, fontSize: 16 }}
                />
              </View>
            );
          })}
          <ActionButton title={t("doseanchor.myday.save", locale)} onPress={() => void saveTimes()} disabled={busy} />
          <ShiftSheet patientId={patientId} maxDays={config.maxShiftDays} choices={config.shiftOffsetChoices} onDone={async (n) => {
            setNotice(n);
            await reload();
            await loadShifts();
          }} />
        </View>
      ) : null}
      {notice ? (
        <View accessibilityLiveRegion="polite">
          <Text style={{ fontSize: 14, color: notice.kind === "error" ? colors.danger : colors.ink }}>{notice.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** "My day has shifted": which parts of the day moved, by how much, for which dates. Returns to normal by itself afterwards. */
function ShiftSheet({ patientId, maxDays, choices, onDone }: { patientId: string; maxDays: number; choices: readonly number[]; onDone: (n: Notice) => Promise<void> }) {
  const colors = useLegacyColors();
  const { scheme } = useTheme();
  const locale = asLocale(useUiLanguage());
  const today = lagosLocalDate(Date.now());
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 29));
  const [offsets, setOffsets] = useState<Partial<Record<AnchorId, number>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    const r = await startDayShift(patientId, { startsOn: from.trim(), endsOn: to.trim(), offsets });
    setBusy(false);
    if (!r.ok) {
      setError(
        r.error === "offsets"
          ? t("doseanchor.myday.shift_error_none", locale)
          : r.error === "not_signed_in"
            ? t("doseanchor.myday.error", locale)
            : t("doseanchor.myday.shift_error_dates", locale, { days: maxDays })
      );
      return;
    }
    setOpen(false);
    setOffsets({});
    await onDone({
      kind: "ok",
      text: t(r.startsTomorrow ? "doseanchor.myday.shift_saved_tomorrow" : "doseanchor.myday.shift_saved_now", locale, { date: r.endsOn }),
    });
  }

  if (!open) return <ActionButton tone="plain" title={t("doseanchor.myday.shift_title", locale)} onPress={() => setOpen(true)} />;
  return (
    <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }} accessibilityLabel={t("doseanchor.myday.shift_title", locale)}>
      <SectionLabel>{t("doseanchor.myday.shift_title", locale)}</SectionLabel>
      <MutedText>{t("doseanchor.myday.shift_help", locale)}</MutedText>
      <MutedText>{t("doseanchor.myday.shift_from", locale)}</MutedText>
      <TextInput
        keyboardAppearance={scheme}
        accessibilityLabel={t("doseanchor.myday.shift_from", locale)}
        value={from}
        onChangeText={setFrom}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.subtle}
        style={{ minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, color: colors.ink, fontSize: 16 }}
      />
      <MutedText>{t("doseanchor.myday.shift_to", locale)}</MutedText>
      <TextInput
        keyboardAppearance={scheme}
        accessibilityLabel={t("doseanchor.myday.shift_to", locale)}
        value={to}
        onChangeText={setTo}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.subtle}
        style={{ minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, color: colors.ink, fontSize: 16 }}
      />
      {ANCHOR_IDS.map((id) => (
        <View key={id} style={{ gap: 6 }}>
          <MutedText>{t("doseanchor.myday.shift_move", locale, { name: t(`doseanchor.name.${id}` as MessageKey, locale) })}</MutedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {choices.map((m) => (
              <OptionChip
                key={m}
                title={m === 0 ? t("doseanchor.myday.shift_no_move", locale) : m > 0 ? t("doseanchor.myday.shift_minutes_later", locale, { minutes: m }) : t("doseanchor.myday.shift_minutes_earlier", locale, { minutes: -m })}
                selected={(offsets[id] ?? 0) === m}
                onPress={() => setOffsets((prev) => ({ ...prev, [id]: m }))}
              />
            ))}
          </View>
        </View>
      ))}
      {error ? <Text style={{ fontSize: 14, color: colors.danger }} accessibilityLiveRegion="polite">{error}</Text> : null}
      <ActionButton title={t("doseanchor.myday.shift_save", locale)} onPress={() => void submit()} disabled={busy} />
      <ActionButton tone="plain" title={t("doseanchor.myday.cancel", locale)} onPress={() => setOpen(false)} />
    </View>
  );
}
