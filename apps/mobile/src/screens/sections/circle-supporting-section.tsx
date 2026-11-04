import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { space, useTheme } from "@/ui/design";
import { hasSharedBlocks, mergePeople } from "@/lib/care-circle/supporter-home";
import type { SupportedPerson as ManagedPerson } from "@/lib/acting";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { ackAlert, ackUnanswered, checkInWindowOpen, loadOpenAlerts, loadSupported, loadUnanswered, loadSupporterView, requestCheckIn, revokeMember, setAlertMode } from "@/lib/care-circle/api";
import { ALERT_MODES, minutesLeft, type AlertMode, type OpenAlert, type SupportedPerson, type SupporterView, type UnansweredCheckIn } from "@/lib/care-circle/parse";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { CallInvitesSection } from "./call-invites-section";
import { MembershipSection } from "./membership-section";
import { SupporterBlocks } from "./supporter-blocks";
import { DigestCard, NudgesCard, TasksCard, useToolsStatus } from "./circle-tools";
import { AppText } from "@/ui/kit/AppText";

function lagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/**
 * One person's page, on its own screen: only the blocks the database sent. Read only: no export, no copy, no raw readings.
 * When nothing is shared right now (ended, never existed, or paused) it says one calm, neutral thing: a pause is deliberately
 * indistinguishable from a removal (docs/design/S29.md section 7), so the words never suggest either.
 */
function PersonView({ person, onBack, onLeft }: { person: SupportedPerson; onBack: () => void; onLeft: () => void }) {
  const locale = asLocale(useUiLanguage());
  const [view, setView] = useState<SupporterView | null | undefined>(undefined);
  const [paying, setPaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const tools = useToolsStatus();

  const load = useCallback(() => {
    setFailed(false);
    setView(undefined);
    void loadSupporterView(person.patientId).then((r) => {
      if (r.ok) setView(r.data);
      else setFailed(true);
    });
  }, [person.patientId]);
  useEffect(() => load(), [load]);

  const back = <SecondaryButton title={t("supporterjoin.error.open_people", locale)} onPress={onBack} />;

  if (paying) {
    return (
      <View style={{ gap: 12 }}>
        <SecondaryButton title={person.name} onPress={() => setPaying(false)} />
        <MembershipSection beneficiary={{ id: person.patientId, name: person.name }} />
      </View>
    );
  }
  if (failed) {
    return (
      <View style={{ gap: 12 }}>
        {back}
        <ErrorText>{t("supporterjoin.view.load_failed", locale)}</ErrorText>
        <PrimaryButton title={t("supporterjoin.view.retry", locale)} onPress={load} />
      </View>
    );
  }
  if (view === undefined) {
    return (
      <View style={{ gap: 12 }} accessible accessibilityLabel={t("supporterjoin.view.loading", locale)}>
        <ActivityIndicator />
      </View>
    );
  }
  if (view === null) {
    return (
      <View style={{ gap: 12 }}>
        {back}
        <Card style={{ gap: 6 }}>
          <AppText variant="bodyStrong" accessibilityRole="header">{t("supporterjoin.view.nothing_now", locale)}</AppText>
          <MutedText>{t("supporterjoin.view.nothing_now_body", locale)}</MutedText>
        </Card>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {back}
      <AppText variant="title" accessibilityRole="header">{t("supporterjoin.view.title", locale, { name: view.name })}</AppText>
      <MutedText>{t("circle.view.privacy", locale, { name: view.name })}</MutedText>
      <MutedText>{t("circle.view.shared_until", locale, { date: lagosDate(view.sharedUntil) })}</MutedText>

      {hasSharedBlocks(view, locale) ? (
        <SupporterBlocks view={view} />
      ) : (
        <Card style={{ gap: 4 }}>
          <AppText variant="body">{t("supporterjoin.view.empty", locale, { name: view.name })}</AppText>
          {person.permissions.includes("red_alerts") ? <MutedText>{t("supporterjoin.view.empty_alerts", locale)}</MutedText> : null}
          {view.canPay ? <MutedText>{t("supporterjoin.view.empty_pay", locale)}</MutedText> : null}
        </Card>
      )}
      <DigestCard patientId={person.patientId} tools={tools} />
      <TasksCard patientId={person.patientId} tools={tools} />

      {view.canPay ? <PrimaryButton title={t("circle.view.pay", locale)} onPress={() => setPaying(true)} /> : null}
      <SecondaryButton
        title={t("circle.view.leave", locale)}
        onPress={() =>
          Alert.alert(t("circle.view.leave", locale), t("circle.view.leave_confirm", locale, { name: view.name }), [
            { text: t("circle.invite.done", locale), style: "cancel" },
            { text: t("circle.view.leave", locale), style: "destructive", onPress: () => { void revokeMember(person.memberId).then(onLeft); } },
          ])
        }
      />
    </View>
  );
}

/** The person's page as its own full screen, over the list, so going back returns exactly where they were. */
function PersonScreen({ person, onClose, onLeft }: { person: SupportedPerson | null; onClose: () => void; onLeft: () => void }) {
  const { colors, reducedMotion } = useTheme();
  return (
    <Modal
      visible={person !== null}
      animationType={reducedMotion ? "none" : "slide"}
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView edges={["top", "left", "right", "bottom"]} style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
          {person ? <PersonView person={person} onBack={onClose} onLeft={onLeft} /> : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const MODE_KEYS = { push_and_app: "circle.supporting.alert_mode.push_and_app", app_only: "circle.supporting.alert_mode.app_only" } as const;

/** A check-in request: a name and a request to call. "I called them" is one status, no text, private to this supporter. */
function AlertCard({ alert, onChanged }: { alert: OpenAlert; onChanged: () => void }) {
  const locale = asLocale(useUiLanguage());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <Card style={{ gap: 6 }}>
      <AppText variant="bodyStrong" accessibilityRole="alert">{t("circle.alert.title", locale, { name: alert.name })}</AppText>
      <AppText variant="body">{t("circle.alert.body", locale, { name: alert.name })}</AppText>
      {alert.called ? (
        <MutedText>{t("circle.alert.called_done", locale)}</MutedText>
      ) : (
        <PrimaryButton
          title={t("circle.alert.called", locale)}
          disabled={busy}
          onPress={() => {
            setBusy(true);
            setFailed(false);
            void ackAlert(alert.patientId).then((ok) => {
              setBusy(false);
              if (ok) onChanged();
              else setFailed(true);
            });
          }}
        />
      )}
      {failed ? <ErrorText>{t("circle.alert.error", locale)}</ErrorText> : null}
    </Card>
  );
}

/** Only for someone who can receive check-in requests: drop the push, never the request in the app, and no quiet hours. */
function AlertModePicker({ person, onChanged }: { person: SupportedPerson; onChanged: () => void }) {
  const locale = asLocale(useUiLanguage());
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="bodyStrong">{t("circle.supporting.alert_mode", locale, { name: person.name })}</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {ALERT_MODES.map((m: AlertMode) => (
          <SecondaryButton
            key={m}
            title={`${person.alertMode === m ? "● " : ""}${t(MODE_KEYS[m], locale)}`}
            disabled={busy}
            onPress={() => {
              if (person.alertMode === m) return;
              setBusy(true);
              void setAlertMode(person.patientId, m).then(() => {
                setBusy(false);
                onChanged();
              });
            }}
          />
        ))}
      </View>
      {person.alertMode === "app_only" ? <MutedText>{t("circle.supporting.alert_mode.note", locale)}</MutedText> : null}
    </View>
  );
}

/**
 * S29e: ask a person to check in. Not an emergency path: the person is asked first and has a few minutes before the circle is told.
 * Shown only while the Chief Medical Officer's go-live is on (a failed read means off).
 */
function CheckInAsk({ person, open }: { person: SupportedPerson; open: boolean }) {
  const locale = asLocale(useUiLanguage());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!open) return null;
  return (
    <View style={{ gap: 6 }}>
      <SecondaryButton
        title={t("checkin.ask", locale)}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          setMessage(null);
          void requestCheckIn(person.patientId).then((r) => {
            setBusy(false);
            if (r === null) setMessage(t("checkin.error", locale));
            else if (r.ok) {
              const minutes = minutesLeft(r.windowEndsAt, Date.now());
              setMessage(minutes === null ? t("checkin.asked_soon", locale) : t("checkin.asked", locale, { minutes }));
            }
            else setMessage(t(r.reason === "limit" ? "checkin.limit" : "checkin.already_waiting", locale));
          });
        }}
      />
      {message ? <MutedText>{message}</MutedText> : null}
    </View>
  );
}

/**
 * The supporter's home list on the phone (S29, supporter join path): open check-in requests first, then ONE card per person,
 * combining their Care Circle membership and any account access they gave (mergePeople). `managed` is that second list (null while
 * it loads); `renderManaged` draws its half of a card; `empty` is shown only when there is truly nobody.
 */
export function CircleSupportingSection({
  managed,
  renderManaged,
  empty,
}: {
  managed: ManagedPerson[] | null;
  renderManaged: (person: ManagedPerson) => ReactNode;
  empty: ReactNode;
}) {
  const locale = asLocale(useUiLanguage());
  const [people, setPeople] = useState<SupportedPerson[] | null>(null);
  const [alerts, setAlerts] = useState<OpenAlert[]>([]);
  const [missed, setMissed] = useState<UnansweredCheckIn[]>([]);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [open, setOpen] = useState<SupportedPerson | null>(null);
  const tools = useToolsStatus();

  const refresh = useCallback(async () => {
    const [p, a, u] = await Promise.all([loadSupported(), loadOpenAlerts(), loadUnanswered()]);
    setPeople(p.ok ? p.data : []);
    if (a.ok) setAlerts(a.data);
    if (u.ok) setMissed(u.data);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // One read of the go-live for the whole section (a failed read means closed).
  useEffect(() => {
    let alive = true;
    void checkInWindowOpen().then((o) => {
      if (alive) setCheckInOpen(o === true);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (people === null || managed === null) return <ActivityIndicator accessibilityLabel={t("supporterjoin.view.loading", locale)} />;
  const rows = mergePeople(people, managed);

  return (
    <View style={{ gap: 12 }}>
      <CallInvitesSection />
      <NudgesCard tools={tools} onOpen={(id) => { const p = people.find((x) => x.patientId === id); if (p) setOpen(p); }} />
      {alerts.map((a) => <AlertCard key={a.patientId} alert={a} onChanged={() => void refresh()} />)}
      {missed.map((m) => (
        <Card key={m.patientId} style={{ gap: 6 }}>
          <AppText variant="bodyStrong" accessibilityRole="alert">{t("checkin.unanswered_title", locale, { name: m.name })}</AppText>
          <AppText variant="body">{t("checkin.unanswered_body", locale, { name: m.name })}</AppText>
          <PrimaryButton title={t("circle.alert.called", locale)} onPress={() => { void ackUnanswered(m.patientId).then((ok) => { if (ok) void refresh(); }); }} />
        </Card>
      ))}
      {rows.length === 0 ? empty : null}
      {rows.map((row) => {
        const c = row.circle;
        const needsAttention = alerts.some((a) => a.patientId === row.id && !a.called);
        return (
          <Card key={row.id} style={{ gap: 8 }}>
            <AppText variant="bodyStrong" accessibilityRole="header">
              {needsAttention ? `${row.name} · ${t("circle.supporting.needs_attention", locale)}` : row.name}
            </AppText>
            {c ? (
              <>
                <MutedText>{`${t("circle.supporting.relationship", locale, { relationship: c.relationship })} · ${t("circle.view.shared_until", locale, { date: lagosDate(c.expiresAt) })}`}</MutedText>
                <PrimaryButton title={t("supporterjoin.view.title", locale, { name: c.name })} onPress={() => setOpen(c)} />
                {c.permissions.includes("red_alerts") ? <AlertModePicker person={c} onChanged={() => void refresh()} /> : null}
                {c.permissions.includes("red_alerts") ? <CheckInAsk person={c} open={checkInOpen} /> : null}
              </>
            ) : null}
            {row.managed ? renderManaged(row.managed) : null}
          </Card>
        );
      })}
      <PersonScreen
        person={open}
        onClose={() => setOpen(null)}
        onLeft={() => {
          setOpen(null);
          void refresh();
        }}
      />
    </View>
  );
}
