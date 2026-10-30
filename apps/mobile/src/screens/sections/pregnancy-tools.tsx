import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Switch, TextInput, View } from "react-native";
import {
  birthPlanFlags,
  birthPlanToForm,
  buildBirthPlanFields,
  contractionCard,
  evaluateKickSession,
  gestationalAge,
  INSTANT_GO_SIGNS,
  type BirthPlanForm,
  type Contraction,
  type InstantGoSign,
  type KickEvaluation,
  type ContractionEvaluation,
  type ScheduleEntry,
  type WeekCardState,
} from "@tarragon/clinical";
import { t } from "@tarragon/i18n";
import { PregnancyPrivateSection } from "@/components/pregnancy-private-section";
import { loadMaternalConfig } from "@/lib/maternal-config";
import { listOutbox } from "@/lib/outbox";
import {
  loadBirthPlanState,
  loadSchedule,
  loadWeekCard,
  maternalGuardOpen,
  saveBirthPlan,
  type BirthPlanState,
} from "@/lib/pregnancy-tools-data";
import { pregnancyDangerGuide, DANGER_GUIDE_ACTION } from "@/lib/pregnancy-danger-guide";
import { evaluateContractionsNow, evaluateKickNow, finishContractionSession, finishKickSession, kickCounterOffered } from "@/lib/pregnancy-sessions";
import { todayIsoDate } from "@/lib/medications";
import { placeholderColorFor, useTextInputStyle, useTheme } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

const SIGN_KEY: Record<InstantGoSign, Parameters<typeof t>[0]> = {
  waters_break: "preg.contractions.sign.waters_break",
  vaginal_bleeding: "preg.contractions.sign.vaginal_bleeding",
  reduced_fetal_movement: "preg.contractions.sign.reduced_fetal_movement",
  fit: "preg.contractions.sign.fit",
  severe_headache: "preg.contractions.sign.severe_headache",
};

/**
 * The fixed "contact today" and "go now" cards. Fixed wording, never advice to hold off, draft pending CMO review (OQ-343). They hold no
 * personal figure and are never put behind the PIN lock.
 */
function ActionCard({ variant, extra }: { variant: "contact_today" | "go_now"; extra?: string }) {
  return (
    <Card style={{ borderLeftWidth: 4, borderLeftColor: "#DC2626", gap: 4 }}>
      <AppText variant="bodyLargeStrong" accessibilityRole="alert">
        {variant === "go_now" ? t("preg.card.go_now.title") : t("preg.card.contact_today.title")}
      </AppText>
      <AppText variant="body">{variant === "go_now" ? t("preg.card.go_now.body") : t("preg.card.contact_today.body")}</AppText>
      {extra ? <AppText variant="body">{extra}</AppText> : null}
    </Card>
  );
}

/**
 * The danger-sign guide. Bundled data: opens with no signal, no PIN and no sign-in state to wait for (INV-06). Render it in the
 * `outside` slot of the lock, not inside it.
 */
export function PregnancyDangerGuideCard() {
  const entries = pregnancyDangerGuide();
  return (
    <Card style={{ borderLeftWidth: 4, borderLeftColor: "#DC2626", gap: 6 }}>
      <AppText variant="bodyStrong">{t("preg.ui.offline.title")}</AppText>
      <MutedText>{t("preg.ui.offline.intro")}</MutedText>
      {entries.map((e) => (
        <AppText variant="body" key={e.sign}>{`• ${e.label}`}</AppText>
      ))}
      <AppText variant="bodyStrong">{DANGER_GUIDE_ACTION}</AppText>
    </Card>
  );
}

function KickCounterPanel({ subjectId, organisationId, week }: { subjectId: string; organisationId: string; week: number | null }) {
  const { config } = useMemo(() => loadMaternalConfig(), []);
  const [offered, setOffered] = useState<boolean | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [movements, setMovements] = useState<number[]>([]);
  const [live, setLive] = useState<KickEvaluation | null>(null);
  const [final, setFinal] = useState<KickEvaluation | null>(null);
  const [saveError, setSaveError] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    // The screen's own week is passed, so the offer and the cards never disagree with it; an unknown week still offers the counter.
    void kickCounterOffered(subjectId, Date.now(), week).then(setOffered);
  }, [subjectId, week]);

  const end = useCallback(
    async (start: number, taps: number[], reportedLess: boolean) => {
      if (doneRef.current) return;
      doneRef.current = true;
      try {
        const result = await finishKickSession({ subjectId, organisationId, startedAtMs: start, movementMs: taps, reportedLess, nowMs: Date.now(), week });
        setFinal(result);
      } catch {
        // The result is decided on the phone; if the phone cannot even queue it the card still shows.
        setSaveError(true);
        const at = Date.now();
        try {
          setFinal(await evaluateKickNow({ subjectId, startedAtMs: start, movementMs: taps, reportedLess, nowMs: at }));
        } catch {
          // Last resort, pure and cannot fail: the same rule with no personal normal. Something is always shown.
          setFinal(evaluateKickSession({ startedAtMs: start, movementMs: taps, reportedLess }, at, null, config));
        }
      }
    },
    [subjectId, organisationId, week, config],
  );

  useEffect(() => {
    if (startedAt === null || final) return;
    const id = setInterval(() => {
      void evaluateKickNow({ subjectId, startedAtMs: startedAt, movementMs: movements, nowMs: Date.now() })
        .then((e) => {
          setLive(e);
          if (e.state !== "counting") void end(startedAt, movements, false);
        })
        .catch(() => {});
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt, movements, final, subjectId, end]);

  if (offered === false) {
    return (
      <Card style={{ gap: 6 }}>
        <AppText variant="bodyStrong">{t("preg.kick.title")}</AppText>
        <MutedText>{t("preg.kick.not_yet")}</MutedText>
      </Card>
    );
  }

  const shown = final ?? live;
  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="bodyStrong">{t("preg.kick.title")}</AppText>
      <MutedText>{t("preg.kick.intro")}</MutedText>
      {final?.state === "contact_today" && <ActionCard variant="contact_today" />}
      {final?.state === "target_reached" && <AppText variant="body">{t("preg.kick.done")}</AppText>}
      {final && final.state === "counting" && <MutedText>{t("preg.ui.kick.stopped")}</MutedText>}
      {final && !saveError && <MutedText>{t("preg.ui.kick.saved_offline")}</MutedText>}
      {saveError && <ErrorText>{t("preg.ui.kick.not_saved")}</ErrorText>}
      {startedAt !== null && !final && (
        <View style={{ gap: 4 }}>
          <MutedText>{t("preg.ui.kick.how", "en", { window: config.kicks.windowMinutes, target: config.kicks.movementsTarget })}</MutedText>
          <AppText variant="headline" accessibilityLiveRegion="polite">
            {t("preg.ui.kick.count", "en", { count: shown?.count ?? movements.length, target: config.kicks.movementsTarget })}
          </AppText>
        </View>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {startedAt === null || final ? (
          <PrimaryButton
            title={final ? t("preg.ui.kick.new") : t("preg.kick.start")}
            onPress={() => {
              doneRef.current = false;
              setFinal(null);
              setLive(null);
              setSaveError(false);
              setMovements([]);
              setStartedAt(Date.now());
            }}
          />
        ) : (
          <>
            <PrimaryButton title={t("preg.kick.tap")} onPress={() => setMovements((m) => [...m, Date.now()])} />
            <SecondaryButton title={t("preg.ui.kick.stop")} onPress={() => void end(startedAt, movements, false)} />
          </>
        )}
        {!final && <SecondaryButton title={t("preg.kick.less")} onPress={() => void end(startedAt ?? Date.now(), movements, true)} />}
      </View>
    </Card>
  );
}

function ContractionTimerPanel({ subjectId, organisationId, week, plan, planUnavailable }: { subjectId: string; organisationId: string; week: number | null; plan: BirthPlanState["plan"]; planUnavailable: boolean }) {
  const { config } = useMemo(() => loadMaternalConfig(), []);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [contractions, setContractions] = useState<Contraction[]>([]);
  const [signs, setSigns] = useState<InstantGoSign[]>([]);
  const [evaluation, setEvaluation] = useState<ContractionEvaluation | null>(null);
  const [finished, setFinished] = useState(false);
  // The first "go now" of a session is kept for the rest of it: the live rule counts a run only while the NEWEST contraction is long enough,
  // so the moment the next one starts the live answer would flip back to "keep timing" and the card would vanish.
  const [latched, setLatched] = useState<ContractionEvaluation | null>(null);
  const savedRef = useRef(false);
  const flags = birthPlanFlags(plan);
  // The flags object is new on every render; the effect below depends on its three values so a plan that loads late is picked up.
  const longJourney = flags?.longJourney ?? null;
  const previousFastLabour = flags?.previousFastLabour ?? null;
  const previousBirths = flags?.previousBirths ?? null;
  const running = contractions.length > 0 && contractions[contractions.length - 1]!.endMs === null;

  const persist = useCallback(
    async (start: number, list: Contraction[], chosen: InstantGoSign[], known?: ContractionEvaluation | null) => {
      if (savedRef.current) return;
      savedRef.current = true;
      try {
        await finishContractionSession({ subjectId, organisationId, startedAtMs: start, contractions: list, signs: chosen, flags, nowMs: Date.now(), week, known: known ?? undefined });
      } catch {
        savedRef.current = false;
      }
    },
    [subjectId, organisationId, flags, week],
  );

  useEffect(() => {
    if (startedAt === null) return;
    let alive = true;
    const run = () =>
      void evaluateContractionsNow({ subjectId, contractions, signs, flags, nowMs: Date.now(), week })
        .then((e) => {
          if (!alive) return;
          setEvaluation(e);
          const kept = latched ?? (e.state === "go_now" ? e : null);
          if (e.state === "go_now") setLatched((prev) => prev ?? e);
          if (kept) void persist(startedAt, contractions, signs, kept);
        })
        .catch(() => {});
    run();
    if (finished) return () => { alive = false; };
    const id = setInterval(run, 1000);
    return () => { alive = false; clearInterval(id); };
    // `flags` and `persist` follow from the values below, so they are listed by their parts.
  }, [startedAt, contractions, signs, finished, week, latched, longJourney, previousFastLabour, previousBirths]);

  const shown = latched ?? evaluation;
  const card = shown ? contractionCard(shown) : "none";
  const rule = shown?.pattern === "earlier" ? config.contractions.earlier : config.contractions.standard;

  function toggle() {
    const at = Date.now();
    if (startedAt === null) setStartedAt(at);
    setContractions((cs) => (running ? cs.map((c, i) => (i === cs.length - 1 ? { ...c, endMs: at } : c)) : [...cs, { startMs: at, endMs: null }]));
  }

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="bodyStrong">{t("preg.contractions.title")}</AppText>
      {card === "go_now_sign" && <ActionCard variant="go_now" />}
      {card === "go_now_pattern" && <ActionCard variant="go_now" extra={t("preg.ui.contractions.pattern_body")} />}
      {card === "none" && contractions.length > 0 && !finished && <MutedText>{t("preg.contractions.keep")}</MutedText>}
      {planUnavailable && <MutedText>{t("preg.ui.contractions.plan_unavailable")}</MutedText>}
      {evaluation?.needsGestation && <MutedText>{t("preg.contractions.needs_due_date")}</MutedText>}
      <AppText variant="label">{t("preg.ui.contractions.signs_title")}</AppText>
      <MutedText>{t("preg.ui.contractions.signs_hint")}</MutedText>
      {INSTANT_GO_SIGNS.map((sign) => (
        <View key={sign} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <AppText variant="body" style={{ flex: 1 }}>{t(SIGN_KEY[sign])}</AppText>
          <Switch
            accessibilityLabel={t(SIGN_KEY[sign])}
            value={signs.includes(sign)}
            disabled={finished}
            onValueChange={() => {
              if (startedAt === null) setStartedAt(Date.now());
              setSigns((s) => (s.includes(sign) ? s.filter((x) => x !== sign) : [...s, sign]));
            }}
          />
        </View>
      ))}
      {!finished && (
        <>
          <MutedText>{t("preg.ui.contractions.timing_hint")}</MutedText>
          <PrimaryButton title={running ? t("preg.contractions.stop") : t("preg.contractions.start")} onPress={toggle} />
        </>
      )}
      {contractions.length > 0 && (
        <View style={{ gap: 2 }}>
          <MutedText>{t("preg.ui.contractions.count", "en", { count: contractions.length })}</MutedText>
          {evaluation && evaluation.gapsMinutes.length > 0 && <MutedText>{t("preg.ui.contractions.gaps", "en", { gaps: evaluation.gapsMinutes.join(", ") })}</MutedText>}
          {evaluation && (
            <MutedText>
              {t(evaluation.pattern === "earlier" ? "preg.ui.contractions.pattern_earlier" : "preg.ui.contractions.pattern_standard", "en", {
                interval: rule.intervalMinutes,
                seconds: rule.durationSeconds,
                sustained: rule.sustainedMinutes,
              })}
            </MutedText>
          )}
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {startedAt !== null && !finished && (
          <SecondaryButton
            title={t("preg.ui.contractions.finish")}
            onPress={() => {
              setFinished(true);
              void persist(startedAt, contractions, signs, latched);
            }}
          />
        )}
        {finished && (
          <PrimaryButton
            title={t("preg.ui.contractions.new")}
            onPress={() => {
              savedRef.current = false;
              setStartedAt(null);
              setContractions([]);
              setSigns([]);
              setEvaluation(null);
              setLatched(null);
              setFinished(false);
            }}
          />
        )}
      </View>
    </Card>
  );
}

function BirthPlanPanel({ subjectId, organisationId, state, onSaved }: { subjectId: string; organisationId: string; state: BirthPlanState | null; onSaved: () => void }) {
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [form, setForm] = useState<BirthPlanForm>(birthPlanToForm(null));
  const [errors, setErrors] = useState<{ money: boolean; donorPhone: boolean; escortPhone: boolean } | null>(null);
  const [status, setStatus] = useState<"idle" | "saved" | "failed">("idle");
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (state?.pregnancyId && loadedFor.current !== state.pregnancyId) {
      loadedFor.current = state.pregnancyId;
      setForm(birthPlanToForm(state.plan));
    }
  }, [state]);

  const set = <K extends keyof BirthPlanForm>(key: K, value: BirthPlanForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const field = (label: string, key: "place" | "transport" | "money" | "donorName" | "donorPhone" | "escortName" | "escortPhone" | "previousBirths", opts?: { phone?: boolean; numeric?: boolean }) => (
    <View style={{ gap: 4 }}>
      <AppText variant="label">{label}</AppText>
      <TextInput
        accessibilityLabel={label}
        keyboardAppearance={scheme}
        placeholderTextColor={placeholderColorFor(scheme)}
        keyboardType={opts?.phone ? "phone-pad" : opts?.numeric ? "number-pad" : "default"}
        value={form[key]}
        onChangeText={(v) => set(key, v)}
        style={textInputStyle}
      />
    </View>
  );

  if (!state || state.pregnancyId === null) {
    return (
      <Card style={{ gap: 6 }}>
        <AppText variant="bodyStrong">{t("preg.plan.title")}</AppText>
        <MutedText>{t("preg.ui.plan.no_pregnancy")}</MutedText>
      </Card>
    );
  }
  const pregnancyId = state.pregnancyId;

  async function submit() {
    const built = buildBirthPlanFields(form, state?.plan ?? null);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors(null);
    try {
      await saveBirthPlan({ subjectId, organisationId, pregnancyId, plan: built.plan, nowMs: Date.now() });
      setStatus("saved");
      onSaved();
    } catch {
      setStatus("failed");
    }
  }

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="bodyStrong">{t("preg.plan.title")}</AppText>
      <MutedText>{t("preg.ui.plan.intro")}</MutedText>
      {field(t("preg.plan.place"), "place")}
      {field(t("preg.plan.transport"), "transport")}
      {field(t("preg.plan.money"), "money", { numeric: true })}
      <MutedText>{t("preg.ui.plan.money_hint")}</MutedText>
      {errors?.money && <ErrorText>{t("preg.ui.plan.money_bad")}</ErrorText>}
      {field(`${t("preg.plan.blood_donor")}: ${t("preg.ui.plan.name")}`, "donorName")}
      {field(`${t("preg.plan.blood_donor")}: ${t("preg.ui.plan.phone")}`, "donorPhone", { phone: true })}
      {errors?.donorPhone && <ErrorText>{t("preg.ui.plan.phone_bad")}</ErrorText>}
      {field(`${t("preg.plan.escort")}: ${t("preg.ui.plan.name")}`, "escortName")}
      {field(`${t("preg.plan.escort")}: ${t("preg.ui.plan.phone")}`, "escortPhone", { phone: true })}
      {errors?.escortPhone && <ErrorText>{t("preg.ui.plan.phone_bad")}</ErrorText>}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <AppText variant="body" style={{ flex: 1 }}>{t("preg.plan.long_journey")}</AppText>
        <Switch accessibilityLabel={t("preg.plan.long_journey")} value={form.longJourney} onValueChange={(v) => set("longJourney", v)} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <AppText variant="body" style={{ flex: 1 }}>{t("preg.ui.plan.previous_fast_labour")}</AppText>
        <Switch accessibilityLabel={t("preg.ui.plan.previous_fast_labour")} value={form.previousFastLabour} onValueChange={(v) => set("previousFastLabour", v)} />
      </View>
      {field(t("preg.ui.plan.previous_births"), "previousBirths", { numeric: true })}
      <PrimaryButton title={t("preg.ui.plan.save")} onPress={() => void submit()} />
      {status === "saved" && <MutedText>{t("preg.ui.plan.saved")}</MutedText>}
      {status === "failed" && <ErrorText>{t("preg.ui.plan.save_failed")}</ErrorText>}
    </Card>
  );
}

function WeekCardPanel({ week }: { week: number | null }) {
  const [state, setState] = useState<WeekCardState>({ kind: "unknown_week" });
  useEffect(() => {
    void loadWeekCard(week).then(setState);
  }, [week]);
  return (
    <Card style={{ gap: 6 }}>
      <AppText variant="bodyStrong">{t("preg.ui.week.title")}</AppText>
      {state.kind === "unknown_week" && <MutedText>{t("preg.ui.week.unknown")}</MutedText>}
      {state.kind === "coming_soon" && (
        <>
          <AppText variant="bodyStrong">{t("preg.ui.week.heading", "en", { week: state.week })}</AppText>
          <MutedText>{t("preg.ui.week.coming_soon")}</MutedText>
        </>
      )}
      {state.kind === "content" && (
        <>
          <AppText variant="bodyStrong">{t("preg.ui.week.heading", "en", { week: state.week })}</AppText>
          <AppText variant="bodyLargeStrong">{state.title}</AppText>
          <AppText variant="body">{state.body}</AppText>
        </>
      )}
    </Card>
  );
}

function SchedulePanel({ subjectId }: { subjectId: string }) {
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  useEffect(() => {
    void loadSchedule(subjectId).then(setEntries);
  }, [subjectId]);
  const status = (e: ScheduleEntry): string =>
    e.status === "scheduled" && e.booked
      ? t("preg.ui.schedule.booked")
      : e.status === "completed"
        ? t("preg.ui.schedule.status_completed")
        : e.status === "missed"
          ? t("preg.ui.schedule.status_missed")
          : e.status === "cancelled"
            ? t("preg.ui.schedule.status_cancelled")
            : t("preg.ui.schedule.status_scheduled");
  return (
    <Card style={{ gap: 6 }}>
      <AppText variant="bodyStrong">{t("preg.ui.schedule.title")}</AppText>
      <MutedText>{t("preg.ui.schedule.intro")}</MutedText>
      {entries.length === 0 ? (
        <MutedText>{t("preg.ui.schedule.empty")}</MutedText>
      ) : (
        entries.map((e) => (
          <View key={e.id} style={{ gap: 2 }}>
            <AppText variant="bodyStrong">{t("preg.ui.schedule.visit", "en", { number: e.visitNumber })}</AppText>
            {e.week !== null && <MutedText>{t("preg.ui.schedule.around_week", "en", { week: e.week })}</MutedText>}
            <MutedText>{status(e)}</MutedText>
          </View>
        ))
      )}
    </Card>
  );
}

/**
 * The phone's pregnancy tools (S67 follow-up, OQ-346): week card, antenatal schedule, baby movement counter, contraction timer and birth
 * plan. Put this INSIDE the Women's Health `PrivateSection` (S66) and put `PregnancyDangerGuideCard` in its `outside` slot. Nothing shows
 * until the `maternal_enabled` go-live guard is open for this person (test accounts pass; real patients see nothing while it is off).
 */
export function PregnancyTools({ subjectId, organisationId, lmp, edd }: { subjectId: string; organisationId: string; lmp: string | null; edd: string | null }) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<BirthPlanState | null>(null);
  const week = gestationalAge({ lmp, edd, today: todayIsoDate() })?.weeks ?? null;

  const refreshPlan = useCallback(async () => {
    const pending = (await listOutbox("birth_plan").catch(() => [])).length > 0;
    setPlan(await loadBirthPlanState(subjectId, organisationId, Date.now(), pending));
  }, [subjectId, organisationId]);

  useEffect(() => {
    let alive = true;
    void maternalGuardOpen(subjectId).then((o) => {
      if (!alive) return;
      setOpen(o);
      if (o) void refreshPlan();
    });
    return () => {
      alive = false;
    };
  }, [subjectId, refreshPlan]);

  if (!open) return null;
  return (
    <PregnancyPrivateSection>
      <View style={{ gap: 16 }}>
        <View style={{ gap: 2 }}>
          <AppText variant="bodyLargeStrong">{t("preg.ui.section_title")}</AppText>
          <MutedText>{t("preg.ui.section_intro")}</MutedText>
        </View>
        <WeekCardPanel week={week} />
        <SchedulePanel subjectId={subjectId} />
        <KickCounterPanel subjectId={subjectId} organisationId={organisationId} week={week} />
        <ContractionTimerPanel subjectId={subjectId} organisationId={organisationId} week={week} plan={plan?.plan ?? null} planUnavailable={plan?.loadFailed === true} />
        <BirthPlanPanel subjectId={subjectId} organisationId={organisationId} state={plan} onSaved={() => void refreshPlan()} />
      </View>
    </PregnancyPrivateSection>
  );
}
