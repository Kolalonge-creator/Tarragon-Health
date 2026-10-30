import { useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { loadLocationConsent, revokeLocationConsent, sendHelpAlert, type HelpAlertResult } from "@/lib/care-circle/help-alert";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

/**
 * The one-tap "ask my Care Circle for help" card (S65, spec 15.15). One deliberate tap tells the people in the circle who can receive
 * alerts. It never depends on the send succeeding for the person to get help: when it fails, the card says to call someone they trust or
 * go to the nearest hospital. The phone sends no location (see lib/care-circle/help-alert.ts), so it never offers to share one; it only
 * lets a person who turned sharing on from the web turn it off.
 */
export function HelpAlertCard() {
  const locale = asLocale(useUiLanguage());
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<HelpAlertResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [notOpen, setNotOpen] = useState(false);
  const [sharingOn, setSharingOn] = useState(false);
  const [consentFailed, setConsentFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadLocationConsent().then((on) => {
      if (alive) setSharingOn(on);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function tap() {
    setSending(true);
    setFailed(false);
    setNotOpen(false);
    const out = await sendHelpAlert();
    setSending(false);
    if (out.ok) setResult(out.result);
    else if (out.notOpen) setNotOpen(true);
    else setFailed(true);
  }

  async function turnOff() {
    setConsentFailed(false);
    if (await revokeLocationConsent()) setSharingOn(false);
    else setConsentFailed(true);
  }

  return (
    <Card style={{ gap: 8 }}>
      <AppText variant="bodyStrong">{t("circle.help.title", locale)}</AppText>
      <MutedText>{t("circle.help.intro", locale)}</MutedText>
      <PrimaryButton title={t("circle.help.button", locale)} onPress={() => void tap()} loading={sending} />
      {notOpen ? <MutedText>{t("circle.help.not_open", locale)}</MutedText> : null}
      {failed ? <ErrorText>{t("circle.help.error", locale)}</ErrorText> : null}
      {result ? (
        <View style={{ gap: 4 }}>
          <AppText variant="body">
            {result.alreadySent
              ? t("circle.help.already", locale)
              : result.recipientsTold > 0
                ? t("circle.help.sent", locale, { count: String(result.recipientsTold) })
                : t("circle.help.sent_none", locale)}
          </AppText>
          <MutedText>{result.locationShared ? t("circle.help.location_on", locale) : t("circle.help.location_off", locale)}</MutedText>
        </View>
      ) : null}
      {sharingOn ? (
        <View style={{ gap: 6 }}>
          <MutedText>{t("circle.help.consent.on", locale)}</MutedText>
          <SecondaryButton title={t("circle.help.consent.turn_off", locale)} onPress={() => void turnOff()} />
          {consentFailed ? <ErrorText>{t("circle.help.consent.error", locale)}</ErrorText> : null}
        </View>
      ) : null}
    </Card>
  );
}
