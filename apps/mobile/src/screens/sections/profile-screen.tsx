import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { colors, inkAlpha, radius, spacing } from "@/ui/theme";
import {
  Card,
  ErrorText,
  GroupedList,
  GroupedListRow,
  MutedText,
  PrimaryButton,
  ScreenTitle,
  SecondaryButton,
  SectionDivider,
  SectionLabel,
} from "@/ui/components";
import { supabase } from "@/lib/supabase";
import { PLATFORM_URL } from "@/lib/platform-url";
import {
  createCorrectionRequest,
  createDeletionRequest,
  isValidE164,
  loadCorrectionRequests,
  loadDeletionRequests,
  loadLatestIdentityVerification,
  loadProfile,
  updateConditionLanguage,
  updateEmergencyContact,
  updateLocation,
  type CorrectionRequestRow,
  type DeletionRequestRow,
  type IdentityVerificationRow,
  type ProfileRow,
} from "@/lib/profile";

const inputStyle = {
  height: 40,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  paddingHorizontal: 10,
  fontSize: 14,
  color: colors.ink,
} as const;

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return <GroupedListRow title={label} subtitle={value} trailing="none" />;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

const SEX_LABEL: Record<string, string> = { male: "Male", female: "Female" };

/**
 * Identity fields (name, DOB, sex, patient ID) are deliberately read-only,
 * mirroring apps/web/src/app/(dashboard)/account/page.tsx's own comment:
 * there is no self-service edit path for these on web either — a name/DOB/
 * sex change goes through support, not a form a patient can submit alone.
 */
function PersonalDetailsSection({ profile, email }: { profile: ProfileRow; email: string | null }) {
  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>Personal details</SectionLabel>
      <GroupedList>
        <Field label="Full name" value={profile.full_name} />
        <Field label="Date of birth" value={formatDate(profile.date_of_birth)} />
        <Field label="Sex" value={profile.sex ? SEX_LABEL[profile.sex] : null} />
        <Field label="Patient ID" value={profile.patient_number} />
        <Field label="Phone" value={profile.phone} />
        <Field label="Email" value={email} />
      </GroupedList>
      <MutedText>To change your name, date of birth, or sex on file, contact your care team.</MutedText>
    </View>
  );
}

function LocationSection({
  userId,
  profile,
  onSaved,
}: {
  userId: string;
  profile: ProfileRow;
  onSaved: (patch: Partial<ProfileRow>) => void;
}) {
  const [state, setState] = useState(profile.state ?? "");
  const [city, setCity] = useState(profile.city ?? "");
  const [area, setArea] = useState(profile.area ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateLocation(userId, { state, city, area });
      onSaved({ state: state.trim() || null, city: city.trim() || null, area: area.trim() || null });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your location. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>Your location</SectionLabel>
      <MutedText>
        Save where you are. We&apos;ll use it to show nearby labs, vaccination centres, and pharmacies as
        soon as that&apos;s available in your area.
      </MutedText>
      <Card style={{ gap: 10 }}>
        <TextInput
          placeholder="State, e.g. Lagos"
          placeholderTextColor={colors.faint}
          value={state}
          onChangeText={setState}
          style={inputStyle}
        />
        <TextInput
          placeholder="City, e.g. Ikeja"
          placeholderTextColor={colors.faint}
          value={city}
          onChangeText={setCity}
          style={inputStyle}
        />
        <TextInput
          placeholder="Area (optional), e.g. Allen Avenue"
          placeholderTextColor={colors.faint}
          value={area}
          onChangeText={setArea}
          style={inputStyle}
        />
        {error ? <ErrorText>{error}</ErrorText> : null}
        {saved ? <MutedText>Location saved.</MutedText> : null}
        <PrimaryButton title="Save location" onPress={handleSave} loading={saving} />
      </Card>
    </View>
  );
}

function ConditionLanguageSection({
  userId,
  profile,
  onSaved,
}: {
  userId: string;
  profile: ProfileRow;
  onSaved: (patch: Partial<ProfileRow>) => void;
}) {
  const [value, setValue] = useState<"gentle" | "clinical">(
    profile.condition_language_preference === "clinical" ? "clinical" : "gentle"
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(next: "gentle" | "clinical") {
    if (next === value) return;
    const previous = value;
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      await updateConditionLanguage(userId, next);
      onSaved({ condition_language_preference: next });
    } catch (e) {
      setValue(previous);
      setError(e instanceof Error ? e.message : "Couldn't save that just now. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>How we describe your condition</SectionLabel>
      <MutedText>
        Choose the wording we use across your dashboard — a gentler everyday term ("weight") or the
        clinical term ("obesity"). This never changes your actual record.
      </MutedText>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {(["gentle", "clinical"] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === option, checked: value === option }}
            onPress={() => void choose(option)}
            disabled={saving}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: radius.control,
              alignItems: "center",
              backgroundColor: value === option ? colors.brand : colors.groupBg,
              opacity: saving ? 0.6 : 1,
            }}
          >
            <Text style={{ fontSize: 13.5, fontWeight: "700", color: value === option ? "#FFFFFF" : colors.ink }}>
              {option === "gentle" ? "Gentle" : "Clinical"}
            </Text>
          </Pressable>
        ))}
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

function ConsentRow({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 5,
          marginTop: 1,
          borderWidth: 1.5,
          borderColor: checked ? colors.brand : colors.border,
          backgroundColor: checked ? colors.brand : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
      </View>
      <Text style={{ flex: 1, fontSize: 12.5, color: colors.muted, lineHeight: 18 }}>{label}</Text>
    </Pressable>
  );
}

function EmergencyContactSection({
  userId,
  profile,
  onSaved,
}: {
  userId: string;
  profile: ProfileRow;
  onSaved: (patch: Partial<ProfileRow>) => void;
}) {
  const [name, setName] = useState(profile.emergency_contact_name ?? "");
  const [phone, setPhone] = useState(profile.emergency_contact_phone ?? "");
  const [relationship, setRelationship] = useState(profile.emergency_contact_relationship ?? "");
  const [consent, setConsent] = useState(profile.emergency_contact_consent ?? false);
  const [nokName, setNokName] = useState(profile.next_of_kin_name ?? "");
  const [nokPhone, setNokPhone] = useState(profile.next_of_kin_phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setError(null);
    setSaved(false);
    if (phone.trim() && !isValidE164(phone)) {
      setError("Emergency contact phone should look like +2348012345678.");
      return;
    }
    if (nokPhone.trim() && !isValidE164(nokPhone)) {
      setError("Next of kin phone should look like +2348012345678.");
      return;
    }
    if (phone.trim() && !consent) {
      setError("Please confirm your emergency contact has agreed to be contacted in an emergency.");
      return;
    }
    setSaving(true);
    try {
      await updateEmergencyContact(userId, {
        emergencyContactName: name,
        emergencyContactPhone: phone,
        emergencyContactRelationship: relationship,
        emergencyContactConsent: consent,
        nextOfKinName: nokName,
        nextOfKinPhone: nokPhone,
      });
      onSaved({
        emergency_contact_name: name.trim() || null,
        emergency_contact_phone: phone.trim() || null,
        emergency_contact_relationship: relationship.trim() || null,
        emergency_contact_consent: consent,
        next_of_kin_name: nokName.trim() || null,
        next_of_kin_phone: nokPhone.trim() || null,
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your emergency contact. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>Emergency contact &amp; next of kin</SectionLabel>
      <MutedText>
        If you ever report an emergency and don&apos;t respond, we&apos;ll message this person so they can
        reach you.
      </MutedText>
      <Card style={{ gap: 10 }}>
        <TextInput
          placeholder="Emergency contact name"
          placeholderTextColor={colors.faint}
          value={name}
          onChangeText={setName}
          style={inputStyle}
        />
        <TextInput
          placeholder="Emergency contact phone, +2348012345678"
          placeholderTextColor={colors.faint}
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          style={inputStyle}
        />
        <TextInput
          placeholder="Relationship (optional), e.g. Spouse"
          placeholderTextColor={colors.faint}
          value={relationship}
          onChangeText={setRelationship}
          style={inputStyle}
        />
        <ConsentRow
          checked={consent}
          onToggle={() => setConsent((c) => !c)}
          label="I confirm this person has agreed to be contacted by TarragonHealth in an emergency, and I have their permission to share their details for this purpose."
        />
        <SectionDivider />
        <TextInput
          placeholder="Next of kin name (optional)"
          placeholderTextColor={colors.faint}
          value={nokName}
          onChangeText={setNokName}
          style={inputStyle}
        />
        <TextInput
          placeholder="Next of kin phone (optional)"
          placeholderTextColor={colors.faint}
          keyboardType="phone-pad"
          value={nokPhone}
          onChangeText={setNokPhone}
          style={inputStyle}
        />
        {error ? <ErrorText>{error}</ErrorText> : null}
        {saved ? <MutedText>Emergency contact saved.</MutedText> : null}
        <PrimaryButton title="Save emergency contact" onPress={handleSave} loading={saving} />
      </Card>
    </View>
  );
}

const VERIFICATION_LABEL: Record<string, string> = {
  verified: "Verified",
  pending: "Pending review",
  failed: "Couldn't verify — try again",
  not_started: "Not verified",
};

const VERIFICATION_COLOR: Record<string, string> = {
  verified: colors.success,
  pending: colors.status.warn,
  failed: colors.danger,
  not_started: colors.muted,
};

/**
 * Status is read natively (identity_verifications + profiles.identity_verified_at,
 * both RLS-scoped to the caller). Actually submitting a NIN/BVN/document for
 * verification stays on the web page (apps/web's IdentityVerificationCard) —
 * that flow needs a provider round-trip and a service-role write attributed
 * via an RPC (see apps/web/src/app/onboarding/actions.ts), which the mobile
 * app has no server-side counterpart for. This hands off to the system
 * browser, never an embedded WebView, matching how Settings already opens
 * Subscription.
 */
function IdentityVerificationSection({
  profile,
  verification,
}: {
  profile: ProfileRow;
  verification: IdentityVerificationRow | null;
}) {
  const status = verification?.status ?? (profile.identity_verified_at ? "verified" : "not_started");
  const verified = status === "verified";

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>Identity verification</SectionLabel>
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>Status</Text>
          <Text style={{ fontSize: 13, fontWeight: "700", color: VERIFICATION_COLOR[status] }}>
            {VERIFICATION_LABEL[status]}
          </Text>
        </View>
        {!verified ? (
          <>
            <MutedText>
              Adding your NIN, BVN, or a document helps us keep your record secure. This step opens in your
              browser.
            </MutedText>
            <SecondaryButton
              title="Verify identity"
              onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/profile`)}
            />
          </>
        ) : null}
      </Card>
    </View>
  );
}

function ChangePasswordSection() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setError(null);
    setSaved(false);
    if (password.length < 8) {
      setError("At least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setSaved(true);
      setPassword("");
      setConfirmPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update your password. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>Password</SectionLabel>
      <MutedText>Update the password you sign in with.</MutedText>
      <Card style={{ gap: 10 }}>
        <TextInput
          placeholder="New password"
          placeholderTextColor={colors.faint}
          secureTextEntry
          autoComplete="password-new"
          value={password}
          onChangeText={setPassword}
          style={inputStyle}
        />
        <TextInput
          placeholder="Confirm new password"
          placeholderTextColor={colors.faint}
          secureTextEntry
          autoComplete="password-new"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          style={inputStyle}
        />
        {error ? <ErrorText>{error}</ErrorText> : null}
        {saved ? <MutedText>Password updated.</MutedText> : null}
        <PrimaryButton title="Update password" onPress={handleSave} loading={saving} />
      </Card>
    </View>
  );
}

function formatRequestStatus(status: string): string {
  const spaced = status.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const REQUEST_STATUS_COLOR: Record<string, string> = {
  pending: colors.status.warn,
  under_review: colors.brand,
  approved: colors.brand,
  approved_partial: colors.brand,
  approved_full: colors.brand,
  applied: colors.success,
  completed: colors.success,
  denied: colors.danger,
};

function RequestStatusBadge({ status }: { status: string }) {
  const tint = REQUEST_STATUS_COLOR[status] ?? colors.muted;
  return (
    <View style={{ backgroundColor: inkAlpha(0.06), borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 }}>
      <Text style={{ fontSize: 10.5, fontWeight: "700", color: tint }}>{formatRequestStatus(status)}</Text>
    </View>
  );
}

/**
 * Correction/deletion requests are native, direct inserts (RLS-scoped;
 * organisation_id/patient_id/status are re-forced server-side by trigger
 * regardless of what's sent, matching the web hooks in
 * apps/web/src/lib/queries/data-rights.ts). Exporting a machine-readable
 * copy of the record (apps/web/src/app/api/patient/data-export/route.ts) is
 * an authenticated cookie-session file download with no mobile-callable
 * counterpart, so that one action hands off to the system browser instead
 * of being rebuilt natively.
 */
function DataPrivacySection({
  userId,
  organisationId,
  deletionRequests,
  correctionRequests,
  onDeletionCreated,
  onCorrectionCreated,
}: {
  userId: string;
  organisationId: string | null;
  deletionRequests: DeletionRequestRow[];
  correctionRequests: CorrectionRequestRow[];
  onDeletionCreated: (row: DeletionRequestRow) => void;
  onCorrectionCreated: (row: CorrectionRequestRow) => void;
}) {
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [recordDescription, setRecordDescription] = useState("");
  const [whatIsWrong, setWhatIsWrong] = useState("");
  const [requestedChange, setRequestedChange] = useState("");
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  const [deletionOpen, setDeletionOpen] = useState(false);
  const [deletionReason, setDeletionReason] = useState("");
  const [deletionSaving, setDeletionSaving] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);

  async function submitCorrection() {
    if (!organisationId) {
      setCorrectionError("Your account isn't fully set up yet. Contact support.");
      return;
    }
    if (!recordDescription.trim() || !whatIsWrong.trim()) {
      setCorrectionError("Tell us which record, and what's wrong with it.");
      return;
    }
    setCorrectionSaving(true);
    setCorrectionError(null);
    try {
      await createCorrectionRequest(organisationId, userId, {
        recordDescription,
        whatIsWrong,
        requestedChange: requestedChange || undefined,
      });
      onCorrectionCreated({
        id: `local-${Date.now()}`,
        organisation_id: organisationId,
        patient_id: userId,
        record_description: recordDescription,
        what_is_wrong: whatIsWrong,
        requested_change: requestedChange || null,
        status: "pending",
        decision_note: null,
        resolution_note: null,
        reviewed_at: null,
        reviewed_by: null,
        requested_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setCorrectionOpen(false);
      setRecordDescription("");
      setWhatIsWrong("");
      setRequestedChange("");
    } catch (e) {
      setCorrectionError(e instanceof Error ? e.message : "Couldn't submit that just now. Try again.");
    } finally {
      setCorrectionSaving(false);
    }
  }

  async function submitDeletion() {
    if (!organisationId) {
      setDeletionError("Your account isn't fully set up yet. Contact support.");
      return;
    }
    setDeletionSaving(true);
    setDeletionError(null);
    try {
      await createDeletionRequest(organisationId, userId, deletionReason);
      onDeletionCreated({
        id: `local-${Date.now()}`,
        organisation_id: organisationId,
        patient_id: userId,
        reason: deletionReason || null,
        requested_categories: [],
        blocked_categories: [],
        blocked_reason: null,
        status: "pending",
        decision_note: null,
        completed_at: null,
        completed_by: null,
        reviewed_at: null,
        reviewed_by: null,
        requested_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setDeletionOpen(false);
      setDeletionReason("");
    } catch (e) {
      setDeletionError(e instanceof Error ? e.message : "Couldn't submit that just now. Try again.");
    } finally {
      setDeletionSaving(false);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>Data &amp; privacy</SectionLabel>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>Export your data</Text>
        <MutedText>
          Download a machine-readable copy of your record. This opens in your browser, where you&apos;re
          signed in.
        </MutedText>
        <SecondaryButton
          title="Export your data"
          onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/privacy`)}
        />
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>Request a correction</Text>
        <MutedText>
          See something wrong in your record? Tell us what it is. Your care team reviews every request
          before anything changes.
        </MutedText>
        {correctionOpen ? (
          <View style={{ gap: 8 }}>
            <TextInput
              placeholder="Which record? e.g. my date of birth"
              placeholderTextColor={colors.faint}
              value={recordDescription}
              onChangeText={setRecordDescription}
              style={inputStyle}
            />
            <TextInput
              placeholder="What's wrong with it?"
              placeholderTextColor={colors.faint}
              value={whatIsWrong}
              onChangeText={setWhatIsWrong}
              style={inputStyle}
            />
            <TextInput
              placeholder="What should it say instead? (optional)"
              placeholderTextColor={colors.faint}
              value={requestedChange}
              onChangeText={setRequestedChange}
              style={inputStyle}
            />
            {correctionError ? <ErrorText>{correctionError}</ErrorText> : null}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="Submit request" onPress={() => void submitCorrection()} loading={correctionSaving} />
              </View>
              <View style={{ flex: 1 }}>
                <SecondaryButton title="Cancel" onPress={() => setCorrectionOpen(false)} disabled={correctionSaving} />
              </View>
            </View>
          </View>
        ) : (
          <SecondaryButton title="Request a correction" onPress={() => setCorrectionOpen(true)} />
        )}
        {correctionRequests.length > 0 ? (
          <GroupedList>
            {correctionRequests.map((r) => (
              <GroupedListRow
                key={r.id}
                title={r.record_description}
                subtitle={formatDate(r.requested_at) ?? undefined}
                trailing={<RequestStatusBadge status={r.status} />}
              />
            ))}
          </GroupedList>
        ) : null}
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>Request deletion of your data</Text>
        <MutedText>
          You can ask us to delete data we hold about you. Some clinical records must be kept for a
          minimum period under Nigerian healthcare regulation — we&apos;ll explain what can and can&apos;t
          be deleted when we review your request.
        </MutedText>
        {deletionOpen ? (
          <View style={{ gap: 8 }}>
            <TextInput
              placeholder="What would you like deleted, and why? (optional)"
              placeholderTextColor={colors.faint}
              value={deletionReason}
              onChangeText={setDeletionReason}
              style={inputStyle}
            />
            {deletionError ? <ErrorText>{deletionError}</ErrorText> : null}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="Submit request" onPress={() => void submitDeletion()} loading={deletionSaving} />
              </View>
              <View style={{ flex: 1 }}>
                <SecondaryButton title="Cancel" onPress={() => setDeletionOpen(false)} disabled={deletionSaving} />
              </View>
            </View>
          </View>
        ) : (
          <SecondaryButton title="Request deletion" onPress={() => setDeletionOpen(true)} />
        )}
        {deletionRequests.length > 0 ? (
          <GroupedList>
            {deletionRequests.map((r) => (
              <GroupedListRow
                key={r.id}
                title={r.reason || "Deletion request"}
                subtitle={formatDate(r.requested_at) ?? undefined}
                trailing={<RequestStatusBadge status={r.status} />}
              />
            ))}
          </GroupedList>
        ) : null}
      </Card>
    </View>
  );
}

/**
 * Native replacement for the "Profile data" WebView modal — every field
 * here is a real Supabase query/write through the caller's own RLS-scoped
 * session, not a wrapper around apps/web's page. The one deliberate
 * exception is actually submitting a NIN/BVN/document for identity
 * verification, which hands off to the system browser (see
 * IdentityVerificationSection) since that flow needs a server-side provider
 * round-trip the mobile app has no API route for.
 */
export function ProfileScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [verification, setVerification] = useState<IdentityVerificationRow | null>(null);
  const [deletionRequests, setDeletionRequests] = useState<DeletionRequestRow[]>([]);
  const [correctionRequests, setCorrectionRequests] = useState<CorrectionRequestRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("You're not signed in.");
        return;
      }
      setUserId(user.id);
      setEmail(user.email ?? null);
      const [profileRow, latestVerification, deletions, corrections] = await Promise.all([
        loadProfile(user.id),
        loadLatestIdentityVerification(user.id),
        loadDeletionRequests(user.id),
        loadCorrectionRequests(user.id),
      ]);
      setProfile(profileRow);
      setVerification(latestVerification);
      setDeletionRequests(deletions);
      setCorrectionRequests(corrections);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your profile. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  function patchProfile(patch: Partial<ProfileRow>) {
    setProfile((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (error || !profile || !userId) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
        <ErrorText>{error ?? "Couldn't load your profile."}</ErrorText>
        <SecondaryButton title="Try again" onPress={() => void load()} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 18 }}>
      <ScreenTitle>Profile data</ScreenTitle>
      <MutedText>Keep your details, emergency contacts, and care preferences up to date.</MutedText>

      <PersonalDetailsSection profile={profile} email={email} />
      <SectionDivider />
      <LocationSection userId={userId} profile={profile} onSaved={patchProfile} />
      <SectionDivider />
      <ConditionLanguageSection userId={userId} profile={profile} onSaved={patchProfile} />
      <SectionDivider />
      <EmergencyContactSection userId={userId} profile={profile} onSaved={patchProfile} />
      <SectionDivider />
      <IdentityVerificationSection profile={profile} verification={verification} />
      <SectionDivider />
      <ChangePasswordSection />
      <SectionDivider />
      <DataPrivacySection
        userId={userId}
        organisationId={profile.organisation_id}
        deletionRequests={deletionRequests}
        correctionRequests={correctionRequests}
        onDeletionCreated={(row) => setDeletionRequests((prev) => [row, ...prev])}
        onCorrectionCreated={(row) => setCorrectionRequests((prev) => [row, ...prev])}
      />
    </ScrollView>
  );
}
