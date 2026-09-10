import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { koboToNaira, type Enums } from "@tarragon/shared";
import {
  loadTherapyDirectory,
  loadMyTherapySessions,
  requestTherapySession,
  type TherapyProvider,
  type TherapySession,
} from "@/lib/therapy";
import { colors, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, ScreenTitle, SecondaryButton } from "@/ui/components";

const MODALITY_LABEL: Record<Enums<"therapy_modality">, string> = {
  video: "Video",
  audio: "Voice call",
  in_person: "In person",
};

function naira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString("en-NG")}`;
}

interface ProviderRowProps {
  provider: TherapyProvider;
  organisationId: string;
  patientId: string;
}

function ProviderRow({ provider, organisationId, patientId }: ProviderRowProps) {
  const modalities: Enums<"therapy_modality">[] = [
    ...(provider.supports_telemedicine ? (["video", "audio"] as const) : []),
    ...(provider.supports_in_person ? (["in_person"] as const) : []),
  ];
  const [modality, setModality] = useState<Enums<"therapy_modality">>(
    provider.supports_telemedicine ? "video" : "in_person"
  );
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function request() {
    if (!provider.id) return;
    setRequesting(true);
    setError(null);
    const result = await requestTherapySession({
      organisationId,
      patientId,
      providerId: provider.id,
      feeKobo: provider.consultation_fee_kobo ?? 0,
      modality,
    });
    setRequesting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSent(true);
  }

  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink, flexShrink: 1 }}>
          {provider.name}
        </Text>
        <Badge>{provider.specialist_type === "psychiatry" ? "Psychiatrist" : "Psychologist"}</Badge>
        {provider.needs_doctor_approval ? <Badge>A doctor reviews this first</Badge> : null}
      </View>
      <MutedText>
        {[
          provider.qualifications?.join(", ") || null,
          provider.subspecialty,
          provider.years_of_experience ? `${provider.years_of_experience} years` : null,
          [provider.city, provider.state].filter(Boolean).join(", ") || null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </MutedText>
      {provider.clinical_interests?.length ? <MutedText>{provider.clinical_interests.join(", ")}</MutedText> : null}
      {provider.languages?.length ? <MutedText>Speaks {provider.languages.join(", ")}</MutedText> : null}
      {/* Deliberately shown, mirrors therapy-network.tsx: a registration
          number is what lets somebody check this practitioner with the
          regulator before paying them. */}
      {provider.license_number ? (
        <MutedText>
          {provider.license_type ?? "Registration"} {provider.license_number}, verifiable with the
          regulator
        </MutedText>
      ) : null}
      {provider.consultation_fee_kobo ? (
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>
          {naira(provider.consultation_fee_kobo)} a session
        </Text>
      ) : null}
      {modalities.length > 1 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {modalities.map((option) => (
            <Text
              key={option}
              onPress={() => setModality(option)}
              style={{
                fontSize: 11.5,
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 999,
                backgroundColor: modality === option ? colors.brand : colors.groupBg,
                color: modality === option ? "#FFFFFF" : colors.ink,
                overflow: "hidden",
              }}
            >
              {MODALITY_LABEL[option]}
            </Text>
          ))}
        </View>
      ) : null}
      {sent ? (
        <MutedText>
          Requested.{" "}
          {provider.needs_doctor_approval
            ? "A doctor on your care team will review it and come back to you."
            : "They will confirm a time with you."}
        </MutedText>
      ) : (
        <SecondaryButton title="Request a session" onPress={request} disabled={requesting} loading={requesting} />
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}

interface TherapyNetworkScreenProps {
  organisationId: string;
  patientId: string;
  onClose: () => void;
}

/**
 * Native "See an independent therapist" — mirrors
 * apps/web/src/components/therapy-network.tsx. Tarragon does not employ
 * these practitioners: they are psychologists and psychiatrists whose
 * registration Tarragon has verified; Tarragon takes the booking and earns a
 * commission on it. Replaces the "Book a therapy session" button on the
 * Wellbeing screen, which used to just navigate to the generic Appointments
 * screen — that screen has no therapist-picking or self-booking logic at
 * all, so the button promised a flow that did not exist.
 *
 * A patient with an open crisis alert is refused by the database
 * (private.enforce_therapy_session_rules), and the refusal message is shown
 * verbatim in ProviderRow rather than swallowed — hiding the button instead
 * would leave someone in crisis staring at a screen that silently does
 * nothing.
 */
export function TherapyNetworkScreen({ organisationId, patientId, onClose }: TherapyNetworkScreenProps) {
  const [providers, setProviders] = useState<TherapyProvider[]>([]);
  const [sessions, setSessions] = useState<TherapySession[]>([]);
  const [type, setType] = useState<Enums<"specialist_type"> | undefined>(undefined);
  const [telemedicineOnly, setTelemedicineOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [providersResult, sessionsResult] = await Promise.all([
      loadTherapyDirectory({ specialistType: type, telemedicineOnly }),
      loadMyTherapySessions(),
    ]);
    if (!providersResult.ok) {
      setError(providersResult.error);
      return;
    }
    setError(null);
    setProviders(providersResult.data);
    if (sessionsResult.ok) setSessions(sessionsResult.data);
  }, [type, telemedicineOnly]);

  useEffect(() => {
    setLoading(true);
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refresh]);

  const openSessions = sessions.filter((session) =>
    ["requested", "awaiting_clinician_approval", "confirmed"].includes(session.status)
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
      <View style={{ paddingTop: 44 }}>
        <SecondaryButton title="Close" onPress={onClose} />
      </View>
      <View>
        <ScreenTitle>See an independent therapist</ScreenTitle>
        <MutedText>
          Psychologists and psychiatrists in private practice whose registration we have checked. They
          do not work for Tarragon; we verify them, take the booking, and keep it on your record. You
          pay their fee.
        </MutedText>
      </View>

      {openSessions.length > 0 ? (
        <Card style={{ gap: 4 }}>
          {openSessions.map((session) => (
            <MutedText key={session.id}>
              {session.status === "awaiting_clinician_approval"
                ? "Waiting for a doctor on your care team to review this request."
                : session.status === "confirmed"
                  ? "Session confirmed."
                  : "Request sent. They will be in touch."}
            </MutedText>
          ))}
        </Card>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(
          [
            { label: "Everyone", value: undefined },
            { label: "Psychologists", value: "psychology" as const },
            { label: "Psychiatrists", value: "psychiatry" as const },
          ] as const
        ).map((option) => (
          <Text
            key={option.label}
            onPress={() => setType(option.value)}
            style={{
              fontSize: 12,
              paddingVertical: 6,
              paddingHorizontal: 10,
              borderRadius: 999,
              backgroundColor: type === option.value ? colors.navy : colors.groupBg,
              color: type === option.value ? "#FFFFFF" : colors.ink,
              overflow: "hidden",
            }}
          >
            {option.label}
          </Text>
        ))}
        <Text
          onPress={() => setTelemedicineOnly((v) => !v)}
          style={{
            fontSize: 12,
            paddingVertical: 6,
            paddingHorizontal: 10,
            borderRadius: 999,
            backgroundColor: telemedicineOnly ? colors.navy : colors.groupBg,
            color: telemedicineOnly ? "#FFFFFF" : colors.ink,
            overflow: "hidden",
          }}
        >
          Online only
        </Text>
      </View>

      {loading ? <ActivityIndicator color={colors.brand} /> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {!loading && !error && providers.length === 0 ? (
        <MutedText>
          No verified practitioners match that yet. We only list people whose registration we have
          checked, so this list grows slowly on purpose.
        </MutedText>
      ) : null}

      {providers.map((provider) => (
        <ProviderRow key={provider.id} provider={provider} organisationId={organisationId} patientId={patientId} />
      ))}
    </ScrollView>
  );
}
