import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { loadTodaysDoses, logDose, type DoseChecklistItem, type DoseStatus } from "@/lib/medications";
import { syncReminders } from "@/lib/reminder-notifications";
import { radii, space, useTheme } from "@/ui/design";
import { AppText, Badge, Button, Card, EmptyState, Icon, InlineAlert, LegacySheet, ListItem, PressableScale, Screen, Skeleton, SkeletonGroup, useToast } from "@/ui/kit";
import { SyncBanner } from "@/screens/sync-banner";
import { MedicineCabinetScreen } from "@/screens/sections/medicine-cabinet-screen";

interface MedicationsScreenProps {
  patientId: string;
  organisationId: string;
  /** Set to the supported person's name when acting for someone
   * (home-shell.tsx), so the heading never implies these are the device
   * owner's own doses while marking somebody else's. */
  subjectName?: string;
}

const doseKey = (item: DoseChecklistItem) => `${item.medicationId}-${item.time}`;

export function MedicationsScreen({ patientId, organisationId, subjectName }: MedicationsScreenProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);

  const [doses, setDoses] = useState<DoseChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed dose fetch must never render as "No scheduled doses today" —
  // that reads as a clinical fact. loadError renders an explicit retry
  // state in place of both the list and the empty state.
  const [loadError, setLoadError] = useState(false);
  const [cabinetOpen, setCabinetOpen] = useState(false);
  // medication_logs is append-only (20260830224528): a rapid double-tap used
  // to converge to one upserted row for the same slot; now each tap is its
  // own permanent row, so a double-tap here would leave a duplicate in the
  // clinician's dose log history rather than being harmlessly absorbed.
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  // Per-row save failures — the optimistic tick used to just silently
  // revert, which reads as the app ignoring the tap.
  const [rowErrors, setRowErrors] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const result = await loadTodaysDoses(patientId);
    if (!result.ok) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setDoses(result.data);
    void syncReminders({ askPermission: true, doses: result.data });
  }, [patientId]);

  useEffect(() => {
    load()
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [load]);

  function retryLoad() {
    setLoading(true);
    load()
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }

  async function toggle(item: DoseChecklistItem) {
    const key = doseKey(item);
    if (pendingKeys.has(key)) return;
    setPendingKeys((prev) => new Set(prev).add(key));
    setRowErrors((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

    const nextStatus: Exclude<DoseStatus, "pending"> = item.status === "taken" ? "missed" : "taken";
    // Optimistic — this is the highest-frequency native write in the app.
    const next: DoseChecklistItem[] = doses.map((d) => (d === item ? { ...d, status: nextStatus } : d));
    setDoses(next);
    void syncReminders({ doses: next });
    // Put this one row back to what it was. Reloading instead could flip the whole
    // screen to "couldn't load" while offline, hiding the row's own error.
    const revert = () => {
      setDoses((prev) => {
        const restored = prev.map((d) => (doseKey(d) === key ? { ...d, status: item.status } : d));
        void syncReminders({ doses: restored });
        return restored;
      });
    };
    try {
      const result = await logDose(patientId, organisationId, item, nextStatus);
      if (result.error) {
        // Revert to what the server actually has, and say so — a silent
        // revert looks like the tap never registered.
        setRowErrors((prev) => new Set(prev).add(key));
        revert();
      } else if (result.synced === false) {
        // Queued on this phone, not yet at the server: say so, never imply it was sent.
        toast.show({ message: tr("outbox.saved_on_phone"), tone: "info" });
      } else {
        toast.show({ message: tr(nextStatus === "taken" ? "meds.toast.taken" : "meds.toast.undone"), tone: "success" });
      }
    } catch {
      setRowErrors((prev) => new Set(prev).add(key));
      revert();
    } finally {
      setPendingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  const takenCount = doses.filter((d) => d.status === "taken").length;
  const progressRatio = doses.length === 0 ? 0 : takenCount / doses.length;

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <AppText variant="headline" heading>
          {subjectName ? tr("meds.title.for", { name: subjectName }) : tr("meds.title")}
        </AppText>
        <AppText variant="body" tone="textMuted">
          {subjectName ? tr("meds.subtitle.for", { name: subjectName }) : tr("meds.subtitle")}
        </AppText>
      </View>

      <SyncBanner />

      <View style={{ gap: space.md }}>
        <AppText variant="title" heading>
          {tr("meds.doses.heading")}
        </AppText>

        {loading ? (
          <SkeletonGroup label={tr("meds.loading")}>
            <Card style={{ gap: space.lg }}>
              <Skeleton height={20} width="45%" />
              <Skeleton height={44} />
              <Skeleton height={44} />
            </Card>
          </SkeletonGroup>
        ) : loadError ? (
          <Card style={{ gap: space.md }}>
            <InlineAlert tone="info" message={`${tr("meds.load_error.title")}. ${tr("meds.load_error.body")}`} />
            <Button title={tr("meds.load_error.retry")} variant="secondary" onPress={retryLoad} />
          </Card>
        ) : doses.length === 0 ? (
          <Card>
            <EmptyState icon="medication" title={tr("meds.empty.title")} body={tr("meds.empty.body")} />
          </Card>
        ) : (
          <>
            <Card style={{ gap: space.sm }}>
              <AppText variant="bodyStrong" accessibilityLiveRegion="polite">
                {tr("meds.progress", { taken: takenCount, total: doses.length })}
              </AppText>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{ height: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted, overflow: "hidden" }}
              >
                <View style={{ height: 6, width: `${Math.round(progressRatio * 100)}%`, backgroundColor: colors.brand }} />
              </View>
            </Card>

            <Card padded={false}>
              {doses.map((item, index) => {
                const key = doseKey(item);
                const taken = item.status === "taken";
                return (
                  <View key={key} style={index > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}>
                    <PressableScale
                      onPress={() => void toggle(item)}
                      disabled={pendingKeys.has(key)}
                      scaleTo={0.99}
                      accessibilityRole="checkbox"
                      accessibilityLabel={tr("meds.row.a11y", { drug: item.drugName, time: item.time })}
                      accessibilityHint={tr(taken ? "meds.row.hint_undo" : "meds.row.hint_take")}
                      accessibilityState={{ checked: taken, disabled: pendingKeys.has(key) }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg }}>
                        <View
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: radii.pill,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: taken ? colors.brand : "transparent",
                            borderWidth: taken ? 0 : 2,
                            borderColor: colors.textSubtle,
                          }}
                        >
                          {taken ? <Icon name="done" size={16} tone="textOnBrand" /> : null}
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <AppText variant="bodyStrong">{item.drugName}</AppText>
                          <AppText variant="caption" tone="textMuted">
                            {item.time}
                          </AppText>
                          {taken ? <Badge label={tr("meds.status.taken")} tone="positive" /> : null}
                        </View>
                      </View>
                    </PressableScale>
                    {rowErrors.has(key) ? (
                      <PressableScale
                        onPress={() => void toggle(item)}
                        accessibilityRole="button"
                        accessibilityLabel={tr("meds.row.error_a11y", { drug: item.drugName })}
                      >
                        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
                          <AppText variant="caption" tone="dangerText">
                            {tr("meds.row.error")}
                          </AppText>
                        </View>
                      </PressableScale>
                    ) : null}
                  </View>
                );
              })}
            </Card>
          </>
        )}
      </View>

      <Card padded={false}>
        <ListItem
          icon="medication"
          title={tr("meds.cabinet.title")}
          subtitle={tr("meds.cabinet.subtitle")}
          onPress={() => setCabinetOpen(true)}
          accessibilityHint={tr("meds.cabinet.a11y_hint")}
        />
      </Card>

      <LegacySheet visible={cabinetOpen} onClose={() => setCabinetOpen(false)} closeLabel={tr("kit.close")} forceLight={false}>
        <MedicineCabinetScreen patientId={patientId} organisationId={organisationId} />
      </LegacySheet>
    </Screen>
  );
}
