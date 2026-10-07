import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { breathPositionAt } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { refreshMediaDownloads } from "@/lib/offline-downloads";
import { groupBySeries, loadLibrary, recordSession, scriptSteps, type LibraryItem } from "@/lib/calm-library";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

/**
 * Calm and sleep library (S57). Lives inside the wellbeing screen's shared-phone gate. Exercises and breathing are reviewed static scripts
 * and always show the care-team and stop-and-seek-care notes. Audio sessions need the native audio module (a later app build): until
 * then the item says so honestly instead of pretending to play.
 */
export function CalmLibraryCard() {
  const colors = useLegacyColors();
  const [items, setItems] = useState<LibraryItem[] | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<LibraryItem | null>(null);

  const load = useCallback(async () => setItems(await loadLibrary()), []);
  useEffect(() => {
    if (open && items === undefined) {
      void load();
      // Offline downloads (S57b): a no-op unless this build has the native modules AND the flag mobile_offline_downloads is on for this person.
      void refreshMediaDownloads().catch(() => undefined);
    }
  }, [open, items, load]);

  if (!open) {
    return (
      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("library.title")}</Text>
        <MutedText>{t("library.intro")}</MutedText>
        <SecondaryButton title={t("library.open")} onPress={() => setOpen(true)} />
      </Card>
    );
  }
  if (current) return <ItemView item={current} onBack={() => setCurrent(null)} />;
  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("library.title")}</Text>
      {items === undefined ? (
        <ActivityIndicator color={colors.brand} />
      ) : items === null ? (
        <ErrorText>{t("library.error")}</ErrorText>
      ) : items.length === 0 ? (
        <MutedText>{t("library.empty")}</MutedText>
      ) : (
        groupBySeries(items).map((g) => (
          <View key={g.series} style={{ gap: 6 }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase" }}>{t(`library.series.${g.series}` as MessageKey)}</Text>
            {g.items.map((i) => (
              <SecondaryButton key={i.id} title={`${i.title} (${t(`library.kind.${i.kind}` as MessageKey)})`} onPress={() => setCurrent(i)} />
            ))}
          </View>
        ))
      )}
      <SecondaryButton title={t("library.back")} onPress={() => setOpen(false)} />
    </Card>
  );
}

function ItemView({ item, onBack }: { item: LibraryItem; onBack: () => void }) {
  const colors = useLegacyColors();
  const steps = scriptSteps(item);
  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{item.title}</Text>
      {item.summary && <MutedText>{item.summary}</MutedText>}
      {item.kind === "exercise" && <Stepper item={item} steps={steps} />}
      {item.kind === "breathing" && <Breathing item={item} steps={steps} />}
      {(item.kind === "meditation" || item.kind === "sleep_story" || item.kind === "soundscape") && <MutedText>{t("library.audio_needs_update")}</MutedText>}
      {(item.kind === "exercise" || item.kind === "breathing") && <MutedText>{t(item.kind === "exercise" ? "library.exercise.note" : "breathing.safety")}</MutedText>}
      {item.reviewed_by_name && item.reviewed_at && <MutedText>{t("library.reviewed", "en", { name: item.reviewed_by_name, date: item.reviewed_at })}</MutedText>}
      <SecondaryButton title={t("library.back")} onPress={onBack} />
    </Card>
  );
}

function Stepper({ item, steps }: { item: LibraryItem; steps: string[] }) {
  const colors = useLegacyColors();
  const [i, setI] = useState(0);
  const [done, setDone] = useState(false);
  if (steps.length === 0) return null;
  if (done) return <Text accessibilityRole="alert" style={{ color: colors.ink }}>{t("library.player.done")}</Text>;
  const last = i === steps.length - 1;
  return (
    <View style={{ gap: 8 }}>
      <MutedText>{t("library.exercise.step", "en", { n: i + 1, total: steps.length })}</MutedText>
      <Text style={{ fontSize: 15, color: colors.ink }}>{steps[i]}</Text>
      <PrimaryButton title={last ? t("library.exercise.finish") : t("library.exercise.next")} onPress={() => { if (last) { setDone(true); void recordSession(item.id, 600); } else setI(i + 1); }} />
    </View>
  );
}

function Breathing({ item, steps }: { item: LibraryItem; steps: string[] }) {
  const colors = useLegacyColors();
  const p = item.script?.pattern;
  const total = item.duration_seconds ?? 0;
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(0);
  const recorded = useRef(false);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const e = (Date.now() - started.current) / 1000;
      setElapsed(e);
      if (e >= total) {
        setRunning(false);
        if (!recorded.current) { recorded.current = true; void recordSession(item.id, total); }
      }
    }, 250);
    return () => clearInterval(id);
  }, [running, total, item.id]);
  if (!p?.inhale_s || !p.exhale_s || total <= 0) return null;
  const pos = breathPositionAt({ inhale_s: p.inhale_s, hold_s: p.hold_s ?? 0, exhale_s: p.exhale_s }, total, elapsed);
  const finished = !running && elapsed >= total;
  // Words only: a clear text instruction works with no animation, on a small or low-power phone.
  return (
    <View style={{ gap: 8 }}>
      {steps.map((s, i) => (<MutedText key={i}>{s}</MutedText>))}
      <Text accessibilityLiveRegion="polite" style={{ fontSize: 22, fontWeight: "700", color: colors.ink }}>
        {running && pos.phase ? `${t(`breathing.phase.${pos.phase}` as MessageKey)} ${pos.secondsLeft}` : finished ? t("breathing.done") : ""}
      </Text>
      {running ? (
        <SecondaryButton title={t("breathing.stop")} onPress={() => setRunning(false)} />
      ) : (
        <PrimaryButton title={t("breathing.start_in_app")} onPress={() => { started.current = Date.now(); recorded.current = false; setElapsed(0); setRunning(true); }} />
      )}
    </View>
  );
}
