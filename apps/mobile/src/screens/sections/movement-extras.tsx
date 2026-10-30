import { useEffect, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { t, type MessageKey } from "@tarragon/i18n";
import { readinessMessageKeys, type ReadinessResult } from "@tarragon/clinical/activity-readiness";
import { activityGateMessageKey, type ActivityGateResult } from "@tarragon/clinical/activity-gate";
import { loadActivityGate } from "@/lib/exercise";
import { loadReadiness, saveWeeklyGoal } from "@/lib/activity-movement";
import { loadRouteRecordingStatus, saveRoute, listMyRoutes, deleteMyRoute, type MyRoute } from "@/lib/routes/route-store";
import { getLocationSource } from "@/lib/routes/location-source";
import { startRouteSession, type RouteSession } from "@/lib/routes/route-session";
import { summarise, type RouteState } from "@/lib/routes/route-recorder";
import { radius } from "@/ui/theme";
import { useLegacyColors, useTheme, textStyles } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, SecondaryButton, SectionLabel } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit";

/**
 * What the activity safety gate says right now, in care-team words ("Rest" / "Gentle only"; colour is always paired with the word). The database
 * function public.activity_gate() is the enforcing answer; this only shows it. Logging something that already happened is never blocked.
 */
export function ActivityGateCard({ gate }: { gate: { gate: ActivityGateResult; unavailable: boolean } | null }) {
  if (!gate || gate.gate.decision === "allow") return null;
  const resting = gate.gate.decision === "rest";
  return (
    <Card style={{ gap: 8 }}>
      <Badge tone={resting ? "brand" : "neutral"}>{resting ? "Rest" : "Gentle only"}</Badge>
      <MutedText>{gate.unavailable ? t("activity.gate.unavailable") : t(activityGateMessageKey(gate.gate) as MessageKey)}</MutedText>
    </Card>
  );
}

/** Loads the gate for the Movement screen. */
export function MovementGate() {
  const [gate, setGate] = useState<{ gate: ActivityGateResult; unavailable: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadActivityGate().then((g) => alive && setGate(g)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return <ActivityGateCard gate={gate} />;
}

/** Edit the weekly active-minutes goal (5.1). A setting, so it needs a connection and says so plainly. */
export function WeeklyGoalEditor({ patientId, current, onSaved }: { patientId: string; current: number | null; onSaved: () => Promise<void> }) {
  const colors = useLegacyColors();
  const { scheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await saveWeeklyGoal(patientId, value);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    await onSaved();
  }

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <SectionLabel>Weekly goal</SectionLabel>
        <SecondaryButton title={open ? "Close" : "Change"} onPress={() => setOpen((v) => !v)} />
      </View>
      <MutedText>{current != null ? `${current} active minutes a week.` : "Set the minutes of activity you would like each week."}</MutedText>
      {open ? (
        <View style={{ gap: 8 }}>
          <TextInput
            keyboardAppearance={scheme}
            accessibilityLabel="Active minutes a week"
            value={value}
            onChangeText={setValue}
            keyboardType="number-pad"
            placeholder="Minutes a week, like 150"
            placeholderTextColor={colors.subtle}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 12, ...textStyles.bodyLarge, color: colors.ink }}
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <PrimaryButton title="Save goal" loading={saving} onPress={() => void save()} />
        </View>
      ) : null}
    </Card>
  );
}

/** Device bands (5.6). Says nothing at all when there is no device data: dormant until a provider is connected. Always labelled an estimate. */
export function ReadinessCard({ patientId }: { patientId: string }) {
  const [result, setResult] = useState<ReadinessResult | null>(null);
  useEffect(() => {
    let alive = true;
    void loadReadiness(patientId, Date.now()).then((r) => alive && setResult(r)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!result) return null;
  const keys = readinessMessageKeys(result);
  const lines = [keys.recovery, keys.sleep, keys.load].filter((k): k is string => k !== null);
  return (
    <Card style={{ gap: 6 }}>
      <SectionLabel>{t("activity.readiness.title")}</SectionLabel>
      {lines.map((k) => (
        <AppText variant="body" key={k}>
          {t(k as MessageKey)}
        </AppText>
      ))}
      <MutedText>{t("activity.readiness.estimate")}</MutedText>
    </Card>
  );
}

/**
 * Private route recording (5.7). Shown ONLY when the go-live guard is on and the person's own switch is on (both off today), so by default this
 * renders nothing. Owner-only: no sharing, no map, no export. With no native location module yet it says recording needs a newer app.
 */
export function RouteRecorderCard({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<RouteSession | null>(null);
  // A finished route whose save failed stays here so "Try again" has something to save; it is dropped when saved, discarded or the screen closes.
  const [unsaved, setUnsaved] = useState<RouteState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const sessionRef = useRef<RouteSession | null>(null);
  sessionRef.current = session;

  // Closing the screen mid-recording stops the location source and forgets the route: nothing keeps listening in the background.
  useEffect(
    () => () => {
      void sessionRef.current?.discard();
    },
    [],
  );
  const [routes, setRoutes] = useState<MyRoute[]>([]);

  useEffect(() => {
    let alive = true;
    void loadRouteRecordingStatus().then(async (on) => {
      if (!alive) return;
      setOpen(on);
      if (on) setRoutes(await listMyRoutes());
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!open) return null;

  async function start() {
    setMessage(null);
    const res = await startRouteSession(getLocationSource());
    if (!res.ok) {
      setMessage(t("activity.routes.unavailable"));
      return;
    }
    setSession(res.session);
  }

  async function persist(state: RouteState) {
    const saved = await saveRoute(patientId, organisationId, state, null);
    if (saved.error) {
      setUnsaved(state);
      setMessage(t("activity.routes.save_failed"));
      return;
    }
    setUnsaved(null);
    const sum = summarise(state);
    setMessage(`${t("activity.routes.saved")} ${(sum.distanceM / 1000).toFixed(2)} km.${state.capped ? ` ${t("activity.routes.capped")}` : ""}`);
    setRoutes(await listMyRoutes());
  }

  async function stop() {
    if (!session) return;
    const state = await session.stop();
    setSession(null);
    await persist(state);
  }

  async function discard() {
    await session?.discard();
    setSession(null);
  }

  return (
    <Card style={{ gap: 8 }}>
      <SectionLabel>{t("activity.routes.title")}</SectionLabel>
      <MutedText>{t("activity.routes.private")}</MutedText>
      {session ? (
        <View style={{ gap: 8 }}>
          <PrimaryButton title={t("activity.routes.stop")} onPress={() => void stop()} />
          <SecondaryButton title={t("activity.routes.discard")} onPress={() => void discard()} />
        </View>
      ) : (
        <PrimaryButton title={t("activity.routes.start")} onPress={() => void start()} />
      )}
      {unsaved ? (
        <View style={{ gap: 8 }}>
          <PrimaryButton title={t("activity.routes.retry")} onPress={() => void persist(unsaved)} />
          <SecondaryButton title={t("activity.routes.discard")} onPress={() => { setUnsaved(null); setMessage(null); }} />
        </View>
      ) : null}
      {message ? <MutedText>{message}</MutedText> : null}
      {routes.map((r) => (
        <View key={r.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <MutedText>{new Date(r.createdAt).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" })}</MutedText>
          <SecondaryButton
            title={t("activity.routes.delete")}
            onPress={() => void deleteMyRoute(r.id).then(async () => setRoutes(await listMyRoutes()))}
          />
        </View>
      ))}
    </Card>
  );
}
