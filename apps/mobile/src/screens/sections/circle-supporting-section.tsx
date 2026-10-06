import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { loadOpenAlerts, loadSupported, loadSupporterView, revokeMember } from "@/lib/care-circle/api";
import type { OpenAlert, SupportedPerson, SupporterView } from "@/lib/care-circle/parse";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { MembershipSection } from "./membership-section";

function lagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}
function lagosDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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

  const dir = view.bpTrend?.direction ?? null;
  return (
    <View style={{ gap: 12 }}>
      <SecondaryButton title={t("circle.supporting.title", locale)} onPress={onBack} />
      <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>{view.name}</Text>
      <MutedText>{t("circle.view.privacy", locale, { name: view.name })}</MutedText>
      <MutedText>{t("circle.view.shared_until", locale, { date: lagosDate(view.sharedUntil) })}</MutedText>

      {view.adherence ? (
        <Card style={{ gap: 4 }}>
          <Text style={{ fontWeight: "700", color: colors.ink }}>{t("circle.view.adherence.title", locale)}</Text>
          {view.adherence.due === 0 || view.adherence.percent === null ? (
            <MutedText>{t("circle.view.adherence.none", locale)}</MutedText>
          ) : (
            <Text style={{ color: colors.ink }}>{t("circle.view.adherence.line", locale, { taken: view.adherence.taken, due: view.adherence.due, percent: view.adherence.percent })}</Text>
          )}
        </Card>
      ) : null}

      {view.bpTrend ? (
        <Card style={{ gap: 4 }}>
          <Text style={{ fontWeight: "700", color: colors.ink }}>{t("circle.view.bp.title", locale)}</Text>
          {view.bpTrend.weeks.length === 0 ? <MutedText>{t("circle.view.bp.none", locale)}</MutedText> : null}
          {view.bpTrend.weeks.map((w) => (
            <Text key={w.weekStart} style={{ color: colors.ink }}>{t("circle.view.bp.row", locale, { date: lagosDate(w.weekStart), systolic: w.systolic, diastolic: w.diastolic, count: w.readings })}</Text>
          ))}
          {dir ? <Text style={{ fontWeight: "600", color: colors.ink }}>{t(`circle.view.bp.${dir}`, locale)}</Text> : null}
        </Card>
      ) : null}

      {view.appointments ? (
        <Card style={{ gap: 4 }}>
          <Text style={{ fontWeight: "700", color: colors.ink }}>{t("circle.view.appt.title", locale)}</Text>
          <Text style={{ color: colors.ink }}>{view.appointments.nextAt ? t("circle.view.appt.next", locale, { date: lagosDateTime(view.appointments.nextAt) }) : t("circle.view.appt.none", locale)}</Text>
          <MutedText>{t("circle.view.appt.missed", locale, { count: view.appointments.missed30d })}</MutedText>
        </Card>
      ) : null}

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
      {alerts.map((a) => (
        <Card key={a.patientId} style={{ gap: 4 }}>
          <Text accessibilityRole="alert" style={{ fontWeight: "700", color: colors.ink }}>{t("circle.alert.title", locale, { name: a.name })}</Text>
          <Text style={{ color: colors.ink }}>{t("circle.alert.body", locale, { name: a.name })}</Text>
        </Card>
      ))}
      <Text style={{ fontSize: 18, fontWeight: "700", color: colors.ink }}>{t("circle.supporting.title", locale)}</Text>
      {people.map((p) => (
        <Card key={p.memberId} style={{ gap: 6 }}>
          <Text style={{ fontWeight: "700", color: colors.ink }}>{p.name}</Text>
          <MutedText>{`${t("circle.supporting.relationship", locale, { relationship: p.relationship })} · ${t("circle.view.shared_until", locale, { date: lagosDate(p.expiresAt) })}`}</MutedText>
          <PrimaryButton title={t("circle.supporting.open", locale)} onPress={() => setOpen(p)} />
        </Card>
      ))}
    </View>
  );
}
