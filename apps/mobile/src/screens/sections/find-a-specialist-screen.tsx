import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { fromMinorUnits, nairaToKobo } from "@tarragon/shared";
import {
  searchSpecialistProviders,
  loadPatientLocation,
  SPECIALIST_TYPES,
  type SpecialistProvider,
  type SpecialistType,
} from "@/lib/find-a-specialist";
import { colors, radius, spacing } from "@/ui/theme";
import { Badge, Card, MutedText, ScreenTitle } from "@/ui/components";

const textInputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: 14,
  color: colors.ink,
} as const;

function specialtyLabel(t: SpecialistType): string {
  return t.replace(/_/g, " ");
}

interface FindASpecialistScreenProps {
  patientId: string;
}

/**
 * Browse Tarragon's specialist network — mirrors apps/web/.../
 * find-a-specialist/find-a-specialist.tsx: same filters (specialty,
 * state/city, telemedicine, max fee, language), same read-only/informational
 * shape (a patient messages their care team to actually arrange a referral,
 * never picks a provider directly here).
 */
export function FindASpecialistScreen({ patientId }: FindASpecialistScreenProps) {
  const [specialistType, setSpecialistType] = useState<SpecialistType>("cardiology");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [requireTelemedicine, setRequireTelemedicine] = useState(false);
  const [maxFeeNaira, setMaxFeeNaira] = useState("");
  const [language, setLanguage] = useState("");
  const [providers, setProviders] = useState<SpecialistProvider[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPatientLocation(patientId).then(({ state: s, city: c }) => {
      if (s) setState(s);
      if (c) setCity(c);
    });
  }, [patientId]);

  const search = useCallback(async () => {
    setLoading(true);
    const result = await searchSpecialistProviders({
      specialistType,
      state: state || undefined,
      city: city || undefined,
      requireTelemedicine,
      maxFeeKobo: maxFeeNaira ? nairaToKobo(Number(maxFeeNaira)) : undefined,
      language: language || undefined,
    });
    setLoading(false);
    if (result.ok) setProviders(result.data);
  }, [specialistType, state, city, requireTelemedicine, maxFeeNaira, language]);

  useEffect(() => {
    void search();
  }, [search]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 16 }}
    >
      <View>
        <ScreenTitle>Find a specialist</ScreenTitle>
        <MutedText>Browse Tarragon&apos;s specialist network by specialty, location, and language.</MutedText>
      </View>

      <Card style={{ gap: 10 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {SPECIALIST_TYPES.map((t) => {
            const selected = t === specialistType;
            return (
              <Pressable
                key={t}
                onPress={() => setSpecialistType(t)}
                style={{
                  borderRadius: 999,
                  paddingVertical: 7,
                  paddingHorizontal: 12,
                  backgroundColor: selected ? colors.brand : colors.groupBg,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: selected ? "#FFFFFF" : colors.ink }}>
                  {specialtyLabel(t)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            value={state}
            onChangeText={setState}
            placeholder="State (e.g. Lagos)"
            style={[textInputStyle, { flex: 1 }]}
          />
          <TextInput
            value={city}
            onChangeText={setCity}
            placeholder="City (e.g. Ikeja)"
            style={[textInputStyle, { flex: 1 }]}
          />
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            value={maxFeeNaira}
            onChangeText={setMaxFeeNaira}
            placeholder="Max fee (₦, optional)"
            keyboardType="numeric"
            style={[textInputStyle, { flex: 1 }]}
          />
          <TextInput
            value={language}
            onChangeText={setLanguage}
            placeholder="Language (optional)"
            style={[textInputStyle, { flex: 1 }]}
          />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 13.5, color: colors.ink }}>Telemedicine only</Text>
          <Switch value={requireTelemedicine} onValueChange={setRequireTelemedicine} />
        </View>
      </Card>

      {loading && <ActivityIndicator color={colors.brand} />}
      {!loading && providers.length === 0 && (
        <MutedText>
          No specialists match yet. Your care team is growing the network in your area. Message them and they can
          help arrange a referral.
        </MutedText>
      )}
      {providers.map((p) => (
        <Card key={p.id} style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>{p.name}</Text>
            <Badge>{p.specialist_type ? specialtyLabel(p.specialist_type) : "Specialist"}</Badge>
            {p.subspecialty && <Badge tone="brand">{p.subspecialty}</Badge>}
            {p.supports_telemedicine && <Badge tone="brand">Telemedicine</Badge>}
          </View>
          <MutedText>
            {[p.city, p.state].filter(Boolean).join(", ") || "Location on file"}
            {p.consultation_fee_kobo != null
              ? `, ₦${fromMinorUnits(p.consultation_fee_kobo, "NGN").toLocaleString()}`
              : ""}
            {p.years_of_experience != null ? ` · ${p.years_of_experience} yrs experience` : ""}
          </MutedText>
          {!!p.qualifications?.length && <MutedText>{p.qualifications.join(", ")}</MutedText>}
          {!!p.clinical_interests?.length && <MutedText>Focus: {p.clinical_interests.join(", ")}</MutedText>}
          {!!p.languages?.length && <MutedText>Languages: {p.languages.join(", ")}</MutedText>}
        </Card>
      ))}
      <MutedText>Interested in seeing one of these specialists? Message your care team and they&apos;ll arrange the referral.</MutedText>
    </ScrollView>
  );
}
