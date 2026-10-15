import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, Switch, Text, View } from "react-native";
import { getProposedConfig } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import {
  describeAccessEntry,
  loadAccessLog,
  loadPassState,
  setPassEnabled,
  type AccessLogEntry,
  type PassState,
} from "@/lib/my-health";
import { PLATFORM_URL } from "@/lib/platform-url";
import type { SectionId } from "@/lib/sections";
import { spacing } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, GroupedList, GroupedListRow, MutedText, ScreenTitle, SecondaryButton } from "@/ui/legacy-kit";

const PAGE_SIZE = (getProposedConfig("my_health.sharing_and_access_log").value as unknown as { access_log: { page_size: number } }).access_log.page_size;

const formatWhen = (value: string) =>
  new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

interface MyHealthScreenProps {
  /** The signed-in person. The access log and the pass setting are for this account only, never for someone being acted for. */
  userId: string;
  acting: boolean;
  onNavigate: (section: SectionId) => void;
}

export function MyHealthScreen({ userId, acting, onNavigate }: MyHealthScreenProps) {
  const colors = useLegacyColors();
  const [entries, setEntries] = useState<AccessLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(true);
  const [logError, setLogError] = useState(false);
  const [more, setMore] = useState(false);
  const [pass, setPass] = useState<PassState | null>(null);
  const [passError, setPassError] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadFirst = useCallback(async () => {
    if (acting) {
      setLogLoading(false);
      return;
    }
    setLogLoading(true);
    const [log, passResult] = await Promise.all([loadAccessLog(), loadPassState(userId)]);
    if (log.ok) {
      setEntries(log.entries);
      setMore(log.entries.length >= PAGE_SIZE);
      setLogError(false);
    } else {
      setLogError(true);
    }
    if (passResult.ok) {
      setPass(passResult.state);
      setPassError(false);
    } else {
      setPassError(true);
    }
    setLogLoading(false);
  }, [acting, userId]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadOlder = async () => {
    const last = entries[entries.length - 1];
    if (!last) return;
    const r = await loadAccessLog({ at: last.at, rid: last.rid });
    if (!r.ok) {
      setLogError(true);
      return;
    }
    setEntries((prev) => [...prev, ...r.entries]);
    setMore(r.entries.length >= PAGE_SIZE);
  };

  const toggle = async (next: boolean) => {
    setSaving(true);
    const r = await setPassEnabled(next, userId);
    if (r.error) setPassError(true);
    else {
      setPassError(false);
      const fresh = await loadPassState(userId);
      if (fresh.ok) setPass(fresh.state);
    }
    setSaving(false);
  };

  const enabled = pass?.facts.enabled === true;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <View>
        <ScreenTitle>{t("my_health.title")}</ScreenTitle>
        <MutedText>{t("my_health.description")}</MutedText>
      </View>

      <GroupedList>
        <GroupedListRow title={t("my_health.card.timeline")} subtitle={t("my_health.card.timeline_body")} trailing="chevron" onPress={() => onNavigate("timeline")} />
        <GroupedListRow title={t("my_health.card.emergency")} subtitle={t("my_health.card.emergency_body")} trailing="chevron" onPress={() => onNavigate("emergency")} />
        <GroupedListRow title={t("my_health.card.passport")} subtitle={t("my_health.card.passport_body")} trailing="chevron" onPress={() => onNavigate("passport")} />
        <GroupedListRow
          title={t("my_health.card.shares")}
          subtitle={t("my_health.card.shares_body")}
          trailing="chevron"
          onPress={() => void Linking.openURL(`${PLATFORM_URL}/patient/share-records`)}
        />
      </GroupedList>

      {acting ? (
        <Card>
          <MutedText>{t("my_health.log.acting")}</MutedText>
        </Card>
      ) : (
        <>
          <Card>
            <Text style={{ color: colors.ink, fontWeight: "600", fontSize: 16 }}>{t("my_health.pass.title")}</Text>
            <MutedText>{t("my_health.pass.description")}</MutedText>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
              <Text style={{ color: colors.ink, flex: 1, marginRight: 12 }}>{t("my_health.pass.toggle")}</Text>
              <Switch
                value={enabled}
                disabled={saving || !pass}
                onValueChange={(v) => void toggle(v)}
                accessibilityLabel={t("my_health.pass.toggle")}
              />
            </View>
            <MutedText>{enabled ? t("my_health.pass.on_hint") : t("my_health.pass.off_hint")}</MutedText>
            <MutedText>{t("my_health.pass.shared_phone")}</MutedText>
            {pass && pass.facts.fields_signed !== true ? <MutedText>{t("my_health.pass.unsigned")}</MutedText> : null}
            {enabled && pass?.cardPayload ? (
              <View style={{ marginTop: 8, gap: 4 }}>
                <Text style={{ color: colors.ink, fontWeight: "600" }}>{t("my_health.pass.preview")}</Text>
                {pass.cardPayload.rows.map((r) => (
                  <Text key={r.key} style={{ color: colors.ink }}>
                    {r.label}: {r.value}
                  </Text>
                ))}
              </View>
            ) : null}
            {passError ? <ErrorText>{t("my_health.pass.failed")}</ErrorText> : null}
          </Card>

          <View>
            <Text style={{ color: colors.ink, fontWeight: "600", fontSize: 18 }}>{t("my_health.log.title")}</Text>
            <MutedText>{t("my_health.log.description")}</MutedText>
          </View>
          {logLoading ? (
            <ActivityIndicator color={colors.brand} />
          ) : logError ? (
            <ErrorText>{t("my_health.log.failed")}</ErrorText>
          ) : entries.length === 0 ? (
            <Card>
              <MutedText>{t("my_health.log.empty")}</MutedText>
            </Card>
          ) : (
            <>
              <GroupedList>
                {entries.map((e) => {
                  const d = describeAccessEntry(e);
                  return (
                    <GroupedListRow
                      key={e.rid}
                      title={d.title}
                      subtitle={[d.who, formatWhen(e.at), d.what, d.status].filter(Boolean).join(" · ")}
                      trailing="none"
                    />
                  );
                })}
              </GroupedList>
              {more ? <SecondaryButton title={t("my_health.log.more")} onPress={() => void loadOlder()} /> : null}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
