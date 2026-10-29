import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Share, Switch, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import {
  createShareLink,
  getLockScreenImageUrl,
  loadLockScreenOptIn,
  loadActiveShareLink,
  loadCachedEmergencyFacts,
  loadEmergencyFacts,
  type EmergencyFacts,
  type ShareLink,
} from "@/lib/emergency";
import { spacing } from "@/ui/theme";
import { lightPalette, useLegacyColors } from "@/ui/design";
import { EmergencyPackView } from "@/screens/emergency-pack-view";
import { EmergencyCardFieldsCard } from "@/screens/sections/emergency-card-fields-card";
import { COVERAGE_SCHEME_LABEL } from "@tarragon/shared";
import { EmergencyCoverageCard } from "./emergency-coverage-card";
import { FreshnessNote } from "@/ui/freshness-note";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

interface EmergencyCardScreenProps {
  patientId: string;
  organisationId: string;
}

export function EmergencyCardScreen({ patientId, organisationId }: EmergencyCardScreenProps) {
  const colors = useLegacyColors();
  const [facts, setFacts] = useState<EmergencyFacts | null>(null);
  const [offline, setOffline] = useState(false);
  const [shareLink, setShareLink] = useState<ShareLink | null | undefined>(undefined);
  // Distinguishes "no active link exists" (shareLink null) from "we don't
  // know" (fetch failed) — the latter must not render the create prompt over
  // a link that may already be live.
  const [shareLinkError, setShareLinkError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);
  const locale = asLocale(useUiLanguage());
  // LSI-1: the lock-screen picture controls appear only when the person's own switch is on (off by default; a failed read counts as off)
  const [lockOptIn, setLockOptIn] = useState(false);
  const [lockConfirmed, setLockConfirmed] = useState(false);
  const [lockMinimum, setLockMinimum] = useState(true);
  const [lockQr, setLockQr] = useState(true);
  const [lockError, setLockError] = useState(false);

  const refreshShareLink = useCallback(() => {
    setShareLinkError(false);
    setShareLink(undefined);
    loadActiveShareLink(patientId)
      .then(setShareLink)
      .catch(() => setShareLinkError(true));
  }, [patientId]);

  // Two loads can overlap (the first one and the one after a save): the newest request wins, so an older answer built from the old choices never
  // lands last and puts a hidden detail back on the card or in the saved copy.
  const latestLoad = useRef(0);
  const [loadFailed, setLoadFailed] = useState(false);
  /** True when the card was read fresh. False means the saved copy (or nothing) is what is on screen. */
  const reloadFacts = useCallback(async (): Promise<boolean> => {
    const mine = ++latestLoad.current;
    try {
      const f = await loadEmergencyFacts(patientId);
      if (mine !== latestLoad.current) return true;
      setOffline(false);
      setLoadFailed(false);
      setFacts(f);
      return true;
    } catch {
      if (mine !== latestLoad.current) return false;
      setOffline(true);
      const cached = await loadCachedEmergencyFacts().catch(() => null);
      if (mine !== latestLoad.current) return false;
      if (cached) {
        setFacts(cached);
        setLoadFailed(false);
      } else {
        // Nothing saved and no read: say so, with a way to try again. Never an empty card, never a spinner that does not end.
        setFacts((current) => {
          if (!current) setLoadFailed(true);
          return current;
        });
      }
      return false;
    }
  }, [patientId]);

  useEffect(() => {
    void reloadFacts();
    refreshShareLink();
    void loadLockScreenOptIn(patientId).then(setLockOptIn);
  }, [patientId, reloadFacts, refreshShareLink]);

  async function openLockScreenPicture() {
    setLockError(false);
    // the switch may have been turned off since this screen opened: check again before opening anything
    if (!(await loadLockScreenOptIn(patientId))) {
      setLockOptIn(false);
      return;
    }
    const r = await getLockScreenImageUrl({ minimum: lockMinimum, qr: lockQr });
    if (!r.ok) {
      setLockError(true);
      return;
    }
    await WebBrowser.openBrowserAsync(r.url).catch(() => setLockError(true));
  }

  async function handleCreateLink() {
    setCreating(true);
    setCreateError(false);
    const result = await createShareLink();
    if (result.error) {
      // Used to just stop the spinner with nothing said — the patient had
      // no way to know the link was never created.
      setCreateError(true);
    } else {
      refreshShareLink();
    }
    setCreating(false);
  }

  if (!facts && loadFailed) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background, padding: spacing.screen, gap: 12 }}>
        <ErrorText>{t("mpass.emergency.load_failed")}</ErrorText>
        <SecondaryButton title={t("common.try_again")} onPress={() => void reloadFacts()} />
      </View>
    );
  }

  if (!facts) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const notShared = (field: NonNullable<typeof facts.hidden>[number]): string | null =>
    facts.hidden?.includes(field) ? "Not shared by the patient" : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
      <AppText variant="title">Emergency card</AppText>
      {offline ? <MutedText>You&apos;re offline, so this is your last saved copy.</MutedText> : null}
      {/* The card keeps its own saved copy (not the read mirror), stamped when it was last fetched. */}
      {offline ? <FreshnessNote lastUpdatedAt={facts.cachedAt} /> : null}

      {/* Fixed red with white text in both schemes: a first responder must recognise this card at a glance. */}
      <View style={{ backgroundColor: lightPalette.dangerText, borderRadius: 14, padding: 16, gap: 10 }}>
        <Text style={{ fontWeight: "700", fontSize: 18, color: "#fff" }}>
          {facts.fullName ?? "—"}
        </Text>
        {/* A detail the person chose not to share says so. It never reads "None on file": a stranger would take that as "has none". */}
        <FactRow label="Blood group" value={notShared("blood") ?? facts.bloodGroup ?? "Not on file"} />
        <FactRow label="Genotype" value={notShared("blood") ?? facts.genotype ?? "Not on file"} />
        <FactRow
          label="Allergies"
          value={notShared("allergies") ?? (facts.allergies.length > 0 ? facts.allergies.map((a) => a.allergen).join(", ") : "None on file")}
        />
        <FactRow
          label="Current medicines"
          value={
            notShared("medications") ??
            ([
              facts.medications.length > 0 ? facts.medications.map((m) => m.drugName).join(", ") : facts.medicinesNotShown ? "" : "None on file",
              facts.medicinesNotShown
                ? facts.medicinesNotShown === 1
                  ? "1 medicine is not shown by the patient. Ask the patient or their family."
                  : `${facts.medicinesNotShown} medicines are not shown by the patient. Ask the patient or their family.`
                : "",
            ]
              .filter(Boolean)
              .join(" "))
          }
        />
        <FactRow label="Conditions" value={notShared("conditions") ?? (facts.conditions.length > 0 ? facts.conditions.join(", ") : "None on file")} />
        <FactRow label="Reproductive and mental health" value={notShared("reproductive") ?? notShared("mental_health") ?? t("mpass.emergency.included_above")} />
        <FactRow
          label="Emergency contact"
          value={
            notShared("emergency_contact") ??
            (facts.emergencyContact
              ? `${facts.emergencyContact.name}${facts.emergencyContact.phone ? " · " + facts.emergencyContact.phone : ""}`
              : "Not on file")
          }
        />
        {/* S09y: shown only when the person filled it in. Absent otherwise, never "none". Patient entered, not checked with the scheme. */}
        {facts.coverage ? (
          <FactRow
            label={`${COVERAGE_SCHEME_LABEL[facts.coverage.scheme]} cover`}
            value={[facts.coverage.plan_name, facts.coverage.member_number ? `no. ${facts.coverage.member_number}` : null].filter(Boolean).join(" · ") + " (patient entered)"}
          />
        ) : null}
      </View>

      {/* undefined means the cover could not be read (not that none is saved): saving then could overwrite real cover, so the form is not offered. */}
      {!offline ? (
        facts.coverage === undefined ? (
          <Card>
            <ErrorText>{t("ecf.coverage.load_failed")}</ErrorText>
          </Card>
        ) : (
          <EmergencyCoverageCard key={facts.coverage ? "filled" : "empty"} initial={facts.coverage} onChanged={reloadFacts} />
        )
      ) : null}

      <Card style={{ alignItems: "center", gap: 8 }}>
        {shareLinkError ? (
          <>
            <MutedText>We couldn&apos;t check your live link right now.</MutedText>
            <SecondaryButton title="Tap to retry" onPress={refreshShareLink} />
          </>
        ) : shareLink === undefined ? (
          <ActivityIndicator color={colors.brand} />
        ) : shareLink ? (
          <>
            <AppText variant="label">Your live link</AppText>
            <AppText variant="caption" tone="brandText" selectable style={{ textAlign: "center" }}>
              {shareLink.url}
            </AppText>
            <MutedText>
              Anyone with this link can view this card with no login, so share it only with people you trust to
              have it. Expires {new Date(shareLink.expiresAt).toLocaleDateString()}.
            </MutedText>
            <SecondaryButton title="Share link" onPress={() => void Share.share({ message: shareLink.url }).catch(() => {})} />
          </>
        ) : (
          <>
            <MutedText>
              Create a no-login link so a first responder can view this card without your phone unlocked.
            </MutedText>
            {createError ? (
              <ErrorText>We couldn&apos;t create the link just now. Please try again.</ErrorText>
            ) : null}
            <PrimaryButton title="Create a live link" onPress={handleCreateLink} loading={creating} />
          </>
        )}
      </Card>

      {/* The person chooses what the card shows. After a save the facts are read again, so the saved copy on this phone holds only what they chose. */}
      <EmergencyCardFieldsCard patientId={patientId} organisationId={organisationId} onSaved={async () => {
          void loadLockScreenOptIn(patientId).then(setLockOptIn);
          return reloadFacts();
        }} />

      {lockOptIn ? (
        <Card style={{ gap: 10 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{t("lsi.title", locale)}</Text>
          <MutedText>{t("lsi.intro", locale)}</MutedText>
          <ErrorText>{t("lsi.warning", locale)}</ErrorText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Switch value={lockConfirmed} onValueChange={setLockConfirmed} accessibilityLabel={t("lsi.confirm", locale)} />
            <AppText variant="body" style={{ flex: 1 }}>{t("lsi.confirm", locale)}</AppText>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Switch value={lockMinimum} onValueChange={setLockMinimum} accessibilityLabel={t("lsi.minimum", locale)} />
            <AppText variant="body" style={{ flex: 1 }}>{t("lsi.minimum", locale)}</AppText>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Switch value={lockQr} onValueChange={setLockQr} accessibilityLabel={t("lsi.qr", locale)} />
            <AppText variant="body" style={{ flex: 1 }}>{t("lsi.qr", locale)}</AppText>
          </View>
          {lockConfirmed ? <PrimaryButton title={t("lsi.download", locale)} onPress={() => void openLockScreenPicture()} /> : <MutedText>{t("lsi.needs_confirm", locale)}</MutedText>}
          {lockError ? <ErrorText>{t("lsi.error", locale)}</ErrorText> : null}
          <MutedText>{t("lsi.mobile_how_to", locale)}</MutedText>
          <MutedText>{t("lsi.how_to", locale)}</MutedText>
        </Card>
      ) : null}

      <EmergencyPackView />
    </ScrollView>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
      <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff", flexShrink: 1, textAlign: "right" }}>{value}</Text>
    </View>
  );
}
