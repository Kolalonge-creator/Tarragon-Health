import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { t, type MessageKey } from "@tarragon/i18n";
import { loadImmunisationCard } from "@/lib/immunisation";
import { loadOutsideRecords, uploadOutsideRecord, type OutsideRecordRow, type OutsideRecordType } from "@/lib/outside-records";
import type { ImmunisationCard } from "@tarragon/shared";
import { PLATFORM_URL } from "@/lib/platform-url";
import { useLegacyColors } from "@/ui/design";
import { Card, ChoiceChip, ErrorText, GroupedList, GroupedListRow, MutedText, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

const TRUST_KEY = {
  verified: "my_health.immunisation.trust.verified",
  waiting: "my_health.immunisation.trust.waiting",
  self_reported: "my_health.immunisation.trust.self_reported",
  rejected: "my_health.immunisation.trust.self_reported",
} as const satisfies Record<string, MessageKey>;

const formatDate = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
};

/**
 * The immunisation card in the My Health section (S09y): a read-only summary of the vaccination module's own data, with the printable version one tap
 * away on the web. Adding or verifying a dose stays where it is. A failed read says so; it never draws an empty card.
 */
export function ImmunisationSummary({ patientId }: { patientId: string }) {
  const colors = useLegacyColors();
  const [card, setCard] = useState<ImmunisationCard | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void loadImmunisationCard(patientId).then((r) => {
      if (!live) return;
      if (r.ok) {
        setCard(r.card);
        setFailed(false);
      } else {
        setFailed(true);
      }
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [patientId]);

  return (
    <View style={{ gap: 8 }}>
      <AppText variant="title">{t("my_health.immunisation.title")}</AppText>
      <MutedText>{t("my_health.immunisation.description")}</MutedText>
      {loading ? (
        <ActivityIndicator color={colors.brand} />
      ) : failed || !card ? (
        <ErrorText>{t("my_health.immunisation.failed")}</ErrorText>
      ) : card.vaccines.length === 0 ? (
        <Card>
          <MutedText>{t("my_health.immunisation.none")}</MutedText>
        </Card>
      ) : (
        <GroupedList>
          {card.vaccines.flatMap((v) =>
            v.doses.map((d) => (
              <GroupedListRow
                key={d.id}
                title={`${v.vaccine} · ${t("my_health.immunisation.dose", "en", { n: String(d.doseNumber) })}`}
                subtitle={[formatDate(d.date), d.provider, t(TRUST_KEY[d.trust])].filter(Boolean).join(" · ")}
                trailing="none"
              />
            )),
          )}
        </GroupedList>
      )}
      {card && card.counts.rejected > 0 ? <MutedText>{t("my_health.immunisation.rejected_note", "en", { count: String(card.counts.rejected) })}</MutedText> : null}
      {card && card.next.length > 0 ? (
        <MutedText>{`${t("my_health.immunisation.next")}: ${card.next.map((n) => `${n.vaccine} ${formatDate(n.dueDate)}`).join(", ")}`}</MutedText>
      ) : null}
      <SecondaryButton title={t("my_health.immunisation.print_on_web")} onPress={() => void Linking.openURL(`${PLATFORM_URL}/patient/my-health/immunisation-card`)} />
    </View>
  );
}

const TYPES: OutsideRecordType[] = ["previous_hospital_record", "discharge_summary", "prescription", "specialist_letter", "vaccination_card", "other"];

/**
 * Records from other hospitals (S09y): add a photo, and see what each one may say about itself. A record stays "supplied by you, not yet checked"
 * until a care-team doctor checks it; nothing is read out of the photo and nothing is added to the clinical record by uploading.
 */
export function OutsideRecordsSection({ patientId }: { patientId: string }) {
  const colors = useLegacyColors();
  const [rows, setRows] = useState<OutsideRecordRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<OutsideRecordType>("previous_hospital_record");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await loadOutsideRecords(patientId);
    if (r.ok) {
      setRows(r.rows);
      setFailed(false);
    } else {
      setFailed(true);
    }
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function add(source: "camera" | "library") {
    setError(null);
    setMessage(null);
    if (source === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError(t("outside_records.err.camera"));
        return;
      }
    }
    const picked =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({ quality: 0.8, mediaTypes: ["images"] })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, mediaTypes: ["images"] });
    if (picked.canceled || !picked.assets[0]) return;
    const a = picked.assets[0];
    setBusy(true);
    const result = await uploadOutsideRecord(
      { uri: a.uri, mimeType: a.mimeType ?? "image/jpeg", fileName: a.fileName ?? `record-${Date.now()}.jpg`, sizeBytes: a.fileSize ?? null },
      type,
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.reason === "too_big" ? t("outside_records.err.too_big") : result.reason === "type" ? t("outside_records.err.type") : t("outside_records.err.upload"));
      return;
    }
    setMessage(t("outside_records.saved"));
    void reload();
  }

  return (
    <View style={{ gap: 8 }}>
      <AppText variant="title">{t("outside_records.title")}</AppText>
      <MutedText>{t("outside_records.description")}</MutedText>
      <MutedText>{t("outside_records.type_label")}</MutedText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {TYPES.map((k) => (
          <ChoiceChip key={k} title={`${type === k ? "✓ " : ""}${t(`outside_records.type.${k}` as MessageKey)}`} onPress={() => setType(k)} />
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <SecondaryButton title={t("outside_records.take_photo")} onPress={() => void add("camera")} disabled={busy} />
        <SecondaryButton title={t("outside_records.choose_photo")} onPress={() => void add("library")} disabled={busy} />
      </View>
      <MutedText>{t("outside_records.pdf_on_web")}</MutedText>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {message ? <MutedText>{message}</MutedText> : null}
      {loading ? (
        <ActivityIndicator color={colors.brand} />
      ) : failed ? (
        <ErrorText>{t("outside_records.failed")}</ErrorText>
      ) : rows.length === 0 ? (
        <Card>
          <MutedText>{t("outside_records.none")}</MutedText>
        </Card>
      ) : (
        <GroupedList>
          {rows.map((r) => (
            <GroupedListRow
              key={r.id}
              title={t(`outside_records.type.${r.documentType}` as MessageKey)}
              subtitle={[formatDate(r.createdAt), r.filename, labelText(r)].filter(Boolean).join(" · ")}
              trailing="none"
            />
          ))}
        </GroupedList>
      )}
    </View>
  );
}

function labelText(r: OutsideRecordRow): string | null {
  const l = r.label;
  if (l.kind === "none") return null;
  if (l.kind === "unchecked") return t("outside_records.status.unchecked");
  if (l.kind === "verified") {
    return l.reviewerName
      ? t("outside_records.status.verified_by", "en", { name: l.reviewerName, date: l.date })
      : t("outside_records.status.verified_by_team", "en", { date: l.date });
  }
  return [t("outside_records.status.not_verified"), l.note].filter(Boolean).join(" ");
}
