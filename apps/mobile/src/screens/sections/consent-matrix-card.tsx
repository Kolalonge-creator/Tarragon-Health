import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CONSENT_DATA_TYPES, CONSENT_PURPOSES, bundleState, findCell, optionalOnCount, type ConsentMatrix } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import {
  applyConsentBundle,
  loadConsentMatrix,
  loadConsentMatrixHistory,
  setConsentCell,
  withdrawAllOptionalConsents,
  type ConsentHistoryRow,
} from "@/lib/consent-matrix";
import { useLegacyColors } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, SecondaryButton } from "@/ui/legacy-kit";

const key = (k: string) => k as MessageKey;
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });

/**
 * Consent matrix on the phone (v5 1.13): bundles first, every cell under "Every choice". Two taps to turn anything off.
 * A needed-for-care cell has a badge and no switch. The wording is a draft key set and the card says so (OQ-49, OQ-296).
 */
export function ConsentMatrixCard() {
  const colors = useLegacyColors();
  const [matrix, setMatrix] = useState<ConsentMatrix | null>(null);
  const [history, setHistory] = useState<ConsentHistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [m, h] = await Promise.all([loadConsentMatrix(), loadConsentMatrixHistory()]);
    if (!m.ok) {
      setError(m.error);
      return;
    }
    setError(null);
    setMatrix(m.data);
    setHistory(h);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    setArmed(null);
    if (!result.ok) setError(result.error ?? t("consent.matrix.error.generic"));
    await refresh();
  }

  if (!matrix) {
    return <Card>{error ? <ErrorText>{error}</ErrorText> : <MutedText>…</MutedText>}</Card>;
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("consent.matrix.title")}</Text>
      <MutedText>{t("consent.matrix.intro")}</MutedText>
      <MutedText>{t("consent.draft_notice")}</MutedText>
      {error && <ErrorText>{error}</ErrorText>}

      {!advanced &&
        matrix.bundles.map((bundle) => {
          const state = bundleState(matrix, bundle.code);
          const armKey = `bundle:${bundle.code}`;
          return (
            <View key={bundle.code} style={{ gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 13.5, fontWeight: "600", color: colors.ink }}>{t(key(bundle.text_key))}</Text>
                <Badge tone={state === "on" ? "brand" : "neutral"}>{t(key(`consent.bundle.state.${state}`))}</Badge>
              </View>
              <MutedText>{t(key(`${bundle.text_key}.body`))}</MutedText>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {state !== "on" && <SecondaryButton title={t("consent.matrix.turn_on")} disabled={busy} onPress={() => void run(() => applyConsentBundle(bundle.code))} />}
                {state !== "off" &&
                  (armed === armKey ? (
                    <SecondaryButton
                      title={t("consent.matrix.turn_off_confirm")}
                      disabled={busy}
                      onPress={() =>
                        void run(async () => {
                          for (const c of bundle.cells) {
                            const r = await setConsentCell(c.data_type, c.purpose, false);
                            if (!r.ok) return r;
                          }
                          return { ok: true };
                        })
                      }
                    />
                  ) : (
                    <SecondaryButton title={t("consent.matrix.turn_off")} disabled={busy} onPress={() => setArmed(armKey)} />
                  ))}
              </View>
            </View>
          );
        })}

      {advanced &&
        CONSENT_DATA_TYPES.map((dataType) => (
          <View key={dataType} style={{ gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
            <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>{t(key(`consent.data.${dataType}`))}</Text>
            {CONSENT_PURPOSES.map((purpose) => {
              const cell = findCell(matrix, dataType, purpose);
              if (!cell) return null;
              const armKey = `${dataType}:${purpose}`;
              return (
                <View key={armKey} style={{ gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <Text style={{ flex: 1, fontSize: 13, color: colors.ink }}>{t(key(`consent.purpose.${purpose}`))}</Text>
                    {cell.required_for_care ? (
                      <Badge tone="brand">{t("consent.matrix.required")}</Badge>
                    ) : (
                      <Badge tone={cell.granted ? "brand" : "neutral"}>{t(cell.granted ? "consent.matrix.on" : "consent.matrix.off")}</Badge>
                    )}
                  </View>
                  <MutedText>{t(key(cell.text_key))}</MutedText>
                  {!cell.required_for_care &&
                    (cell.granted ? (
                      armed === armKey ? (
                        <SecondaryButton title={t("consent.matrix.turn_off_confirm")} disabled={busy} onPress={() => void run(() => setConsentCell(dataType, purpose, false))} />
                      ) : (
                        <SecondaryButton title={t("consent.matrix.turn_off")} disabled={busy} onPress={() => setArmed(armKey)} />
                      )
                    ) : (
                      <SecondaryButton title={t("consent.matrix.turn_on")} disabled={busy} onPress={() => void run(() => setConsentCell(dataType, purpose, true))} />
                    ))}
                </View>
              );
            })}
          </View>
        ))}

      <Pressable accessibilityRole="button" onPress={() => setAdvanced((v) => !v)} hitSlop={8}>
        <Text style={{ fontSize: 12.5, color: colors.muted, textDecorationLine: "underline" }}>
          {advanced ? t("consent.matrix.simple") : t("consent.matrix.advanced")}
        </Text>
      </Pressable>
      {optionalOnCount(matrix) > 0 &&
        (armed === "all" ? (
          <SecondaryButton title={t("consent.matrix.essentials_only_confirm")} disabled={busy} onPress={() => void run(() => withdrawAllOptionalConsents())} />
        ) : (
          <SecondaryButton title={t("consent.matrix.essentials_only")} disabled={busy} onPress={() => setArmed("all")} />
        ))}
      <MutedText>{t("consent.matrix.care_unchanged")}</MutedText>

      <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.ink }}>{t("consent.matrix.history.title")}</Text>
      {history.length === 0 ? (
        <MutedText>{t("consent.matrix.history.empty")}</MutedText>
      ) : (
        history.map((h, i) => (
          <MutedText key={`${h.at}-${i}`}>
            {when(h.at)} · {t(h.action === "granted" ? "consent.matrix.history.granted" : "consent.matrix.history.withdrawn")} · {t(key(`consent.data.${h.dataType}`))}, {t(key(`consent.purpose.${h.purpose}`))}
          </MutedText>
        ))
      )}
    </Card>
  );
}
