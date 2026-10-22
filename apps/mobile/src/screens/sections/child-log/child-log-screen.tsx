import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { t } from "@tarragon/i18n";
import { buildChildTimeline, childCrisisLead, createChildSwitcher, crisisToShow, mayLog, pickerState, type ChildEventRow } from "@tarragon/shared";
import {
  countPendingForChild,
  getSessionChild,
  loadChildEvents,
  loadChildGrowth,
  loadChildren,
  loadChildVaccines,
  setSessionChild,
  type ChildDetail,
  type ChildVaccineData,
  type GrowthRow,
} from "@/lib/child-log";
import { knownCrisisChildren, rememberChildCrisis } from "@/lib/child-crisis-cache";
import type { SectionId } from "@/lib/sections";
import { controllerFor } from "@/lib/private-lock";
import { radius } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { PrivateSection } from "@/ui/private-section";
import { Card, ErrorText, MutedText, SecondaryButton } from "@/ui/legacy-kit";
import { FeedLogCardMobile, LifecycleCardMobile } from "@/screens/sections/maternal-child-card";
import { ChildGrowth, CrisisLead, resultOf } from "./child-growth";
import { ChildTimeline } from "./child-timeline";
import { ChildVaccines } from "./child-vaccines";
import { OneTapRow } from "./one-tap-row";

/**
 * The daily child log (S68b). Flow: "Whose baby is this?" at launch when more than one child is on the phone (asked again every time the app
 * starts) -> the crisis lead if the latest growth result needs one -> one-tap row -> pending count -> timeline -> growth -> vaccines.
 * A second caregiver with a view-only grant sees the same screens with no buttons to add. Anything about the mother sits behind the S66
 * private lock and is locked again whenever the person starts to switch child (see createChildSwitcher).
 *
 * A known crisis is never hidden by a failed read: every successful growth read records whether the latest result was severe (encrypted
 * store), and while the read is loading or failing the lead shows from that record. The picker shows it too.
 */
export function ChildLogScreen({ userId, onNavigate }: { userId: string; onNavigate: (id: SectionId) => void }) {
  const colors = useLegacyColors();
  const [children, setChildren] = useState<ChildDetail[] | null | undefined>(undefined);
  const [chosenId, setChosenId] = useState<string | null>(getSessionChild());
  const [lockKey, setLockKey] = useState(0);
  const [events, setEvents] = useState<ChildEventRow[] | null>(null);
  const [growth, setGrowth] = useState<GrowthRow[] | null>(null);
  const [growthFailed, setGrowthFailed] = useState(false);
  const [vaccines, setVaccines] = useState<ChildVaccineData | null>(null);
  const [vaccinesFailed, setVaccinesFailed] = useState(false);
  const [pending, setPending] = useState(0);
  const [version, setVersion] = useState(0);
  const [knownCrisis, setKnownCrisis] = useState<Set<string>>(new Set());

  const switcher = useMemo(
    () =>
      createChildSwitcher(() => {
        void controllerFor(userId).lock();
        setLockKey((k) => k + 1);
      }),
    [userId],
  );

  useEffect(() => {
    let alive = true;
    void loadChildren(userId).then((c) => alive && setChildren(c));
    void knownCrisisChildren().then((s) => alive && setKnownCrisis(s));
    return () => { alive = false; };
  }, [userId]);

  const state = useMemo(() => (children ? pickerState(children, chosenId) : null), [children, chosenId]);
  const child = state?.kind === "chosen" ? (children?.find((c) => c.profileId === state.child.profileId) ?? null) : null;
  const childId = child?.profileId ?? null;

  // The child now on screen: a different child than before relocks the mother's section.
  useEffect(() => {
    if (childId) switcher.show(childId);
  }, [childId, switcher]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!childId) return;
    let alive = true;
    void Promise.all([loadChildEvents(childId), loadChildGrowth(childId), loadChildVaccines(childId), countPendingForChild(childId)]).then(([e, g, v, p]) => {
      if (!alive) return;
      setEvents(e.ok ? e.data : null);
      setGrowth(g.ok ? g.data : null); setGrowthFailed(!g.ok);
      setVaccines(v.ok ? v.data : null); setVaccinesFailed(!v.ok);
      setPending(p);
      if (g.ok) {
        const last = g.data.length > 0 ? g.data[g.data.length - 1]! : null;
        const severe = last ? childCrisisLead(resultOf(last)) : false;
        void rememberChildCrisis(childId, severe);
        setKnownCrisis((prev) => {
          const next = new Set(prev);
          if (severe) next.add(childId); else next.delete(childId);
          return next;
        });
      }
    });
    return () => { alive = false; };
  }, [childId, version]);

  function choose(next: ChildDetail) {
    setSessionChild(next.profileId);
    setChosenId(next.profileId);
    setEvents(null); setGrowth(null); setGrowthFailed(false); setVaccines(null);
  }

  function startSwitch() {
    // Relock the mother's section the moment a switch starts, before the choice is cleared: this is the step the first version missed.
    switcher.leave();
    setSessionChild(null);
    setChosenId(null);
  }

  const timeline = useMemo(() => {
    const names = new Map((vaccines?.catalog ?? []).map((c) => [c.id, c.name]));
    return buildChildTimeline({
      events: events ?? [],
      growth: (growth ?? []).map((g) => ({ id: g.id, measuredAt: g.measuredAt, weightKg: g.weightKg, heightCm: g.heightCm })),
      vaccines: (vaccines?.records ?? []).map((r) => ({
        id: r.id, name: names.get(r.vaccination_catalog_id) ?? "", doseNumber: r.dose_number, dateAdministered: r.date_administered, verifiedBy: r.verifiedBy, verifiedAt: r.verifiedAt,
      })),
    });
  }, [events, growth, vaccines]);

  const latestGrowth = growth && growth.length > 0 ? growth[growth.length - 1]! : null;
  const readOk = growth !== null && !growthFailed;
  const crisis = childId ? crisisToShow(readOk, latestGrowth ? childCrisisLead(resultOf(latestGrowth)) : false, knownCrisis.has(childId)) : false;

  if (children === undefined) return <Card><MutedText>{t("common.try_again")}</MutedText></Card>;
  if (children === null) return <Card><ErrorText>{t("cdl.log.failed")}</ErrorText></Card>;
  if (state?.kind === "none") return <Card><MutedText>{t("cdl.no_children")}</MutedText></Card>;

  if (state?.kind === "ask" || !child) {
    const inCrisis = (children ?? []).filter((c) => knownCrisis.has(c.profileId));
    return (
      <ScrollView contentContainerStyle={{ gap: 12, padding: 4 }}>
        {inCrisis.length > 0 && (
          <>
            <CrisisLead />
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>{inCrisis.map((c) => c.firstName).join(", ")}</Text>
          </>
        )}
        <Card style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: "800", color: colors.ink }}>{t("cdl.whose.title")}</Text>
          <MutedText>{t("cdl.whose.help")}</MutedText>
          {(children ?? []).map((c) => (
            <Pressable
              key={c.profileId}
              accessibilityRole="button"
              accessibilityLabel={c.firstName}
              onPress={() => choose(c)}
              style={{ minHeight: 64, borderRadius: radius.control, borderWidth: 2, borderColor: colors.brand, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 }}
            >
              <Text style={{ fontSize: 20, fontWeight: "800", color: colors.ink }}>{c.firstName}</Text>
            </Pressable>
          ))}
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ gap: 12, padding: 4 }}>
      {crisis && <CrisisLead />}
      <Card style={{ gap: 6 }}>
        <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: "800", color: colors.ink }}>{child.firstName}</Text>
        {(children?.length ?? 0) > 1 && <SecondaryButton title={t("cdl.whose.switch")} onPress={startSwitch} />}
        {!mayLog(child) && (
          <View style={{ gap: 2 }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>{t("cdl.partner.title")}</Text>
            <MutedText>{t("cdl.partner.body")}</MutedText>
          </View>
        )}
        {pending > 0 && <Text accessibilityLiveRegion="polite" style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>{t("cdl.log.pending_count", "en", { count: pending })}</Text>}
      </Card>
      <OneTapRow userId={userId} child={child} events={events ?? []} onLogged={reload} />
      {events === null && <ErrorText>{t("cdl.log.failed")}</ErrorText>}
      <ChildTimeline items={timeline} />
      <ChildGrowth child={child} rows={growth} failed={growthFailed} onChanged={reload} />
      <ChildVaccines child={child} data={vaccines} failed={vaccinesFailed} />
      {mayLog(child) && child.organisationId && (
        <PrivateSection key={`${userId}-${lockKey}`} accountId={userId} title={t("cdl.mother.section")}>
          <MutedText>{t("cdl.mother.help")}</MutedText>
          <FeedLogCardMobile patientId={userId} organisationId={child.organisationId} />
          <LifecycleCardMobile userId={userId} />
          <SecondaryButton title={t("cdl.mother.open_mood_check")} onPress={() => onNavigate("wellbeing")} />
        </PrivateSection>
      )}
    </ScrollView>
  );
}
