import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { space, useTheme } from "@/ui/design";
import { hasSharedBlocks, mergePeople, showPersonSwitcher } from "@/lib/care-circle/supporter-home";
import { Chip } from "@/ui/kit/Chip";
import type { SupportedPerson as ManagedPerson } from "@/lib/acting";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { ackAlert, ackUnanswered, checkInWindowOpen, loadOpenAlerts, loadShareOffers, loadSupported, loadUnanswered, loadSupporterView, requestCheckIn, respondToShareOffer, revokeMember, setAlertMode } from "@/lib/care-circle/api";
import { ALERT_MODES, minutesLeft, permissionKey, type AlertMode, type OpenAlert, type ShareOffer, type SupportedPerson, type SupporterView, type UnansweredCheckIn } from "@/lib/care-circle/parse";
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
function PersonView({ person, people, onSwitch, onBack, onLeft }: {
  person: SupportedPerson; people: readonly SupportedPerson[]; onSwitch: (p: SupportedPerson) => void; onBack: () => void; onLeft: () => void;
}) {
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

  const back = (
    <>
      <SecondaryButton title={t("supporterjoin.error.open_people", locale)} onPress={onBack} />
      <PersonSwitcher people={people} current={person.patientId} onSwitch={onSwitch} />
    </>
  );

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
        <SupporterBlocks view={view} name={view.name} />
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

/**
 * Care Circle P2 (spec 5.1): someone who supports more than one person moves between them here. Each person is a separate read (the
 * page is keyed by the patient id and the database gate is checked again on every read), so nothing from one person's page is ever shown
 * on another's. Hidden for a supporter of one person.
 */
function PersonSwitcher({ people, current, onSwitch }: { people: readonly SupportedPerson[]; current: string; onSwitch: (p: SupportedPerson) => void }) {
  const locale = asLocale(useUiLanguage());
  if (!showPersonSwitcher(people)) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="radiogroup" accessibilityLabel={t("circlep2.switcher.label", locale)} contentContainerStyle={{ gap: 8 }}>
      {people.map((p) => (
        <Chip
          key={p.patientId}
          label={p.name}
          accessibilityLabel={p.relationship ? `${p.name} (${p.relationship})` : p.name}
          selected={p.patientId === current}
          onPress={() => {
            if (p.patientId !== current) onSwitch(p);
          }}
        />
      ))}
    </ScrollView>
  );
}

/**
 * Care Circle P1 (founder decision D3, 2026-11-04): someone this person paid for has asked them to join their Care Circle. Nothing is
 * shown to them until they say yes here. Hidden when there is nothing to answer, and when the read fails (an offer is never a required step).
 */
function ShareOffers({ refreshKey, onAnswered }: { refreshKey: number; onAnswered: () => void }) {
  const [offers, setOffers] = useState<ShareOffer[]>([]);
  // an answered offer leaves the database's open list; its confirmation stays on screen until the section is left
  const [answered, setAnswered] = useState<Readonly<Record<string, "accepted" | "declined">>>({});
  const answeredRef = useRef(answered);
  answeredRef.current = answered;
  useEffect(() => {
    let alive = true;
    void loadShareOffers().then((next) => {
      if (!alive) return;
      setOffers((cur) => [...next, ...cur.filter((o) => answeredRef.current[o.memberId] && !next.some((n) => n.memberId === o.memberId))]);
    });
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  if (offers.length === 0) return null;
  return (
    <>
      {offers.map((o) => (
        <OfferCard
          key={o.memberId}
          offer={o}
          answer={answered[o.memberId] ?? null}
          onAnswer={(a) => {
            setAnswered((cur) => ({ ...cur, [o.memberId]: a }));
            onAnswered();
          }}
        />
      ))}
    </>
  );
}

function OfferCard({ offer, answer, onAnswer }: { offer: ShareOffer; answer: "accepted" | "declined" | null; onAnswer: (a: "accepted" | "declined") => void }) {
  const locale = asLocale(useUiLanguage());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function answerWith(accept: boolean) {
    setBusy(true);
    setFailed(false);
    const r = await respondToShareOffer(offer.memberId, accept);
    setBusy(false);
    if (!r) {
      setFailed(true);
      return;
    }
    onAnswer(r.accepted ? "accepted" : "declined");
  }
  if (answer) {
    return (
      <Card style={{ gap: 6 }}>
        <AppText variant="body" accessibilityLiveRegion="polite">
          {answer === "accepted" ? t("circlep1.offer.accepted", locale, { name: offer.name }) : t("circlep1.offer.declined", locale)}
        </AppText>
      </Card>
    );
  }
  return (
    <Card style={{ gap: 8 }}>
      <AppText variant="bodyStrong" accessibilityRole="header">{t("circlep1.offer.title", locale, { name: offer.name })}</AppText>
      <AppText variant="body">{t("circlep1.offer.body", locale)}</AppText>
      {/* what they would see, in the same words the patient chose from; anything unrecognised was already dropped when parsed */}
      {offer.permissions.map((p) => <AppText variant="body" key={p}>{`• ${t(permissionKey(p), locale)}`}</AppText>)}
      <MutedText>{t("circlep1.offer.answer_by", locale, { date: lagosDate(offer.answerBy) })}</MutedText>
      {failed ? <ErrorText>{t("circlep1.offer.error", locale)}</ErrorText> : null}
      <PrimaryButton title={t("circlep1.offer.accept", locale)} disabled={busy} onPress={() => void answerWith(true)} />
      <SecondaryButton title={t("circlep1.offer.decline", locale)} disabled={busy} onPress={() => void answerWith(false)} />
    </Card>
  );
}

/** The person's page as its own full screen, over the list, so going back returns exactly where they were. */
function PersonScreen({ person, people, onSwitch, onClose, onLeft }: {
  person: SupportedPerson | null; people: readonly SupportedPerson[]; onSwitch: (p: SupportedPerson) => void; onClose: () => void; onLeft: () => void;
}) {
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
          {/* keyed by the person, so switching starts a fresh read and nothing from the last page lingers */}
          {person ? <PersonView key={person.patientId} person={person} people={people} onSwitch={onSwitch} onBack={onClose} onLeft={onLeft} /> : null}
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

  const [refreshCount, setRefreshCount] = useState(0);
  const refresh = useCallback(async () => {
    setRefreshCount((n) => n + 1);
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
      <ShareOffers refreshKey={refreshCount} onAnswered={() => void refresh()} />
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
        people={people}
        onSwitch={setOpen}
        onClose={() => setOpen(null)}
        onLeft={() => {
          setOpen(null);
          void refresh();
        }}
      />
    </View>
  );
}
