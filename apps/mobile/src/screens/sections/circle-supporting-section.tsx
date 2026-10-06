import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { ackAlert, loadOpenAlerts, loadSupported, loadSupporterView, revokeMember, setAlertMode } from "@/lib/care-circle/api";
import { ALERT_MODES, type AlertMode, type OpenAlert, type SupportedPerson, type SupporterView } from "@/lib/care-circle/parse";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { MembershipSection } from "./membership-section";
import { SupporterBlocks } from "./supporter-blocks";

function lagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/** One read about one person: only the blocks the database sent. Read only: no export, no copy, no raw readings. */
function PersonView({ person, onBack, onLeft }: { person: SupportedPerson; onBack: () => void; onLeft: () => void }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [view, setView] = useState<SupporterView | null | undefined>(undefined);
  const [paying, setPaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void loadSupporterView(person.patientId).then((r) => {
      if (r.ok) setView(r.data);
      else setFailed(true);
    });
  }, [person.patientId]);

  if (paying) {
    return (
      <View style={{ gap: 12 }}>
        <SecondaryButton title={person.name} onPress={() => setPaying(false)} />
        <MembershipSection beneficiary={{ id: person.patientId, name: person.name }} />
      </View>
    );
  }
  if (failed) return <ErrorText>{t("circle.error.unknown", locale)}</ErrorText>;
  if (view === undefined) return <ActivityIndicator />;
  if (view === null) {
    return (
      <View style={{ gap: 12 }}>
        <ErrorText>{t("circle.view.not_found", locale)}</ErrorText>
        <SecondaryButton title={t("circle.supporting.title", locale)} onPress={onBack} />
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <SecondaryButton title={t("circle.supporting.title", locale)} onPress={onBack} />
      <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>{view.name}</Text>
      <MutedText>{t("circle.view.privacy", locale, { name: view.name })}</MutedText>
      <MutedText>{t("circle.view.shared_until", locale, { date: lagosDate(view.sharedUntil) })}</MutedText>

      <SupporterBlocks view={view} />

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

const MODE_KEYS = { push_and_app: "circle.supporting.alert_mode.push_and_app", app_only: "circle.supporting.alert_mode.app_only" } as const;

/** A check-in request: a name and a request to call. "I called them" is one status, no text, private to this supporter. */
function AlertCard({ alert, onChanged }: { alert: OpenAlert; onChanged: () => void }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <Card style={{ gap: 6 }}>
      <Text accessibilityRole="alert" style={{ fontWeight: "700", color: colors.ink }}>{t("circle.alert.title", locale, { name: alert.name })}</Text>
      <Text style={{ color: colors.ink }}>{t("circle.alert.body", locale, { name: alert.name })}</Text>
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
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontWeight: "600", color: colors.ink }}>{t("circle.supporting.alert_mode", locale, { name: person.name })}</Text>
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

/** The Care Circle half of the supporter's home (S29): an open check-in request first, then the people who have shared something. */
export function CircleSupportingSection() {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const [people, setPeople] = useState<SupportedPerson[] | null>(null);
  const [alerts, setAlerts] = useState<OpenAlert[]>([]);
  const [open, setOpen] = useState<SupportedPerson | null>(null);

  const refresh = useCallback(async () => {
    const [p, a] = await Promise.all([loadSupported(), loadOpenAlerts()]);
    setPeople(p.ok ? p.data : []);
    if (a.ok) setAlerts(a.data);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (open) return <PersonView person={open} onBack={() => setOpen(null)} onLeft={() => { setOpen(null); void refresh(); }} />;
  if (people === null) return <ActivityIndicator />;
  if (people.length === 0 && alerts.length === 0) return null;

  return (
    <View style={{ gap: 12 }}>
      {alerts.map((a) => <AlertCard key={a.patientId} alert={a} onChanged={() => void refresh()} />)}
      <Text style={{ fontSize: 18, fontWeight: "700", color: colors.ink }}>{t("circle.supporting.title", locale)}</Text>
      {people.map((p) => (
        <Card key={p.memberId} style={{ gap: 6 }}>
          <Text style={{ fontWeight: "700", color: colors.ink }}>{alerts.some((a) => a.patientId === p.patientId && !a.called) ? `${p.name} · ${t("circle.supporting.needs_attention", locale)}` : p.name}</Text>
          <MutedText>{`${t("circle.supporting.relationship", locale, { relationship: p.relationship })} · ${t("circle.view.shared_until", locale, { date: lagosDate(p.expiresAt) })}`}</MutedText>
          <PrimaryButton title={t("circle.supporting.open", locale)} onPress={() => setOpen(p)} />
          {p.permissions.includes("red_alerts") ? <AlertModePicker person={p} onChanged={() => void refresh()} /> : null}
        </Card>
      ))}
    </View>
  );
}
