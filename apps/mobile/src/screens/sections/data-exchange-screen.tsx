import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, View } from "react-native";
import { t, type MessageKey } from "@tarragon/i18n";
import { grantConsent, loadExchange, withdrawConsent, type ExchangeData, type ExchangeDirection, type ExchangeWrite } from "@/lib/data-exchange";
import { formatPassportDate } from "@/lib/passport-format";
import { PLATFORM_URL } from "@/lib/platform-url";
import { space, useTheme } from "@/ui/design";
import { AppText, Button, Card, Chip, Field, InlineAlert, Screen } from "@/ui/kit";
import { LoadFailed, PassportHeader, StaleNotice } from "@/screens/sections/passport-parts";

interface Props {
  userId: string;
  /** Only the person themselves manages this, so it is not offered while acting for someone else. */
  acting: boolean;
}

type State = { kind: "loading" } | { kind: "failed"; offline: boolean; refused: boolean } | { kind: "ready"; data: ExchangeData; stale: { offline: boolean; savedAt: string } | null };

const DIRECTIONS: ExchangeDirection[] = ["import", "export", "both"];

function failure(r: Extract<ExchangeWrite, { ok: false }>): string {
  if (r.reason === "offline") return t("mpass.needs_connection");
  if (r.reason === "name_needed") return t("mpass.exch.source_needed");
  return t("exchange.failed");
}

/**
 * Records from other places (S44, spec 2.10 and 2.11). Which named outside systems may send records to the person (or receive theirs), what was
 * received (kept for a care team member to review, never added to the record by itself), and who made a copy of their record. The consent wording
 * is a placeholder until counsel approves it, and the screen says so.
 */
export function DataExchangeScreen({ userId, acting }: Props) {
  const { colors } = useTheme();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [source, setSource] = useState("");
  const [direction, setDirection] = useState<ExchangeDirection>("import");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const latest = useRef(0);

  /** True when the lists on screen were freshly read. After a change a refresh that could not reach the server leaves them as they are (and the caller says so). */
  const load = useCallback(
    async (quiet = false): Promise<boolean> => {
      const mine = ++latest.current;
      const r = await loadExchange(userId);
      if (mine !== latest.current) return true;
      if (quiet && (!r.ok || r.stale)) return false;
      if (!r.ok) setState({ kind: "failed", offline: r.offline, refused: r.refused });
      else setState({ kind: "ready", data: r.data, stale: r.stale ? { offline: r.offline, savedAt: r.savedAt } : null });
      return r.ok && !r.stale;
    },
    [userId]
  );

  useEffect(() => {
    if (!acting) void load();
  }, [acting, load]);

  const live = state.kind === "ready" && state.stale === null;

  async function grant() {
    setMessage(null);
    setBusy(true);
    const r = await grantConsent(source, direction);
    setBusy(false);
    if (!r.ok) {
      setMessage({ tone: r.reason === "offline" ? "info" : "danger", text: failure(r) });
      return;
    }
    setSource("");
    const fresh = await load(true);
    setMessage({ tone: "info", text: fresh ? t("exchange.saved") : t("mpass.exch.saved_not_refreshed") });
  }

  function confirmWithdraw(id: string, name: string) {
    Alert.alert(t("mpass.exch.withdraw_title"), t("mpass.exch.withdraw_body"), [
      { text: t("mpass.exch.keep"), style: "cancel" },
      {
        text: t("exchange.withdraw"),
        style: "destructive",
        onPress: () =>
          void (async () => {
            setMessage(null);
            const r = await withdrawConsent(id);
            if (!r.ok) {
              setMessage({ tone: r.reason === "offline" ? "info" : "danger", text: failure(r) });
              return;
            }
            // The system is shown as stopped at once, whatever the refresh does next.
            setState((prev) => (prev.kind === "ready" ? { ...prev, data: { ...prev.data, consents: prev.data.consents.map((c) => (c.id === id ? { ...c, withdrawnAt: new Date().toISOString() } : c)) } } : prev));
            const fresh = await load(true);
            setMessage({ tone: "info", text: fresh ? t("exchange.saved") : t("mpass.exch.saved_not_refreshed") });
          })(),
      },
    ]);
    void name;
  }

  if (acting) {
    return (
      <Screen edges={[]}>
        <PassportHeader title={t("exchange.title")} />
        <InlineAlert tone="info" message={t("exchange.own_only")} />
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <PassportHeader title={t("exchange.title")} description={t("exchange.description")} />
      {message ? <InlineAlert tone={message.tone} message={message.text} /> : null}

      <Card style={{ gap: space.md }}>
        <AppText variant="title" heading>
          {t("exchange.download_title")}
        </AppText>
        <AppText>{t("exchange.download_body")}</AppText>
        <AppText variant="caption" tone="textMuted">
          {t("mpass.exch.download_note")}
        </AppText>
        <Button title={t("mpass.exch.open_site")} variant="secondary" onPress={() => void Linking.openURL(`${PLATFORM_URL}/patient/data-exchange`)} />
      </Card>

      {state.kind === "loading" ? <ActivityIndicator color={colors.brand} accessibilityLabel={t("mpass.loading")} /> : null}
      {state.kind === "failed" ? <LoadFailed offline={state.offline} refused={state.refused} onRetry={() => void load()} /> : null}

      {state.kind === "ready" ? (
        <>
          {state.stale ? <StaleNotice offline={state.stale.offline} savedAt={state.stale.savedAt} /> : null}

          <Card style={{ gap: space.md }}>
            <AppText variant="title" heading>
              {t("exchange.consents_title")}
            </AppText>
            {state.data.consents.length === 0 ? (
              <AppText tone="textMuted">{t("exchange.consents_none")}</AppText>
            ) : (
              state.data.consents.map((c) => (
                <View key={c.id} style={{ gap: space.xs }}>
                  <AppText variant="bodyStrong">{c.sourceSystem}</AppText>
                  <AppText variant="caption" tone="textMuted">
                    {t(`exchange.direction.${c.direction}` as MessageKey)}. {c.withdrawnAt ? t("exchange.withdrawn_on", "en", { date: formatPassportDate(c.withdrawnAt) }) : t("exchange.granted_on", "en", { date: formatPassportDate(c.grantedAt) })}
                  </AppText>
                  {c.withdrawnAt ? null : (
                    <Button
                      title={t("exchange.withdraw")}
                      accessibilityLabel={t("mpass.exch.withdraw_aria", "en", { name: c.sourceSystem })}
                      variant="secondary"
                      fullWidth={false}
                      disabled={!live}
                      onPress={() => confirmWithdraw(c.id, c.sourceSystem)}
                    />
                  )}
                </View>
              ))
            )}

            <InlineAlert tone="info" message={t("exchange.consent_placeholder")} />
            <Field label={t("exchange.source_label")} hint={t("exchange.source_help")} value={source} onChangeText={setSource} maxLength={120} editable={live} />
            <AppText variant="label" tone="textMuted">
              {t("exchange.direction_label")}
            </AppText>
            <View accessibilityRole="radiogroup" style={{ gap: space.sm }}>
              {DIRECTIONS.map((d) => (
                <Chip key={d} label={t(`exchange.direction.${d}` as MessageKey)} selected={direction === d} onPress={() => setDirection(d)} />
              ))}
            </View>
            {!live ? <InlineAlert tone="info" message={t("mpass.needs_connection")} /> : null}
            <Button title={t("exchange.grant")} loading={busy} disabled={!live || source.trim().length < 2} onPress={() => void grant()} />
          </Card>

          <Card style={{ gap: space.sm }}>
            <AppText variant="title" heading>
              {t("exchange.received_title")}
            </AppText>
            {state.data.received.length === 0 ? (
              <AppText tone="textMuted">{t("exchange.received_none")}</AppText>
            ) : (
              state.data.received.map((r) => (
                <AppText key={r.id}>
                  {t("mpass.exch.received_line", "en", {
                    date: formatPassportDate(r.importedAt),
                    type: r.resourceType,
                    source: r.sourceSystem,
                    state: r.supersededAt ? t("exchange.received.replaced") : t(`exchange.received.${r.disposition === "proposed" ? "proposed" : "stored_only"}` as MessageKey),
                  })}
                </AppText>
              ))
            )}
          </Card>

          <Card style={{ gap: space.sm }}>
            <AppText variant="title" heading>
              {t("exchange.copies_title")}
            </AppText>
            {state.data.copies.length === 0 ? (
              <AppText tone="textMuted">{t("exchange.copies_none")}</AppText>
            ) : (
              state.data.copies.map((c) => (
                <AppText key={c.id}>
                  {t("mpass.exch.copy_line", "en", { date: formatPassportDate(c.createdAt), who: t(`exchange.copy.${c.requesterKind === "supporter" || c.requesterKind === "staff" ? c.requesterKind : "self"}` as MessageKey) })}
                </AppText>
              ))
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
