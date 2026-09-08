import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COUNTRY_CALLING_CODES, E164_GENERIC } from "@tarragon/shared";
import { supabase } from "@/lib/supabase";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, inkAlpha, radius, spacing } from "@/ui/theme";
import { ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  padding: 14,
  fontSize: 16,
  color: colors.ink,
  backgroundColor: colors.card,
} as const;

/**
 * Same source-of-truth problem forgot-password-screen.tsx's duplicated
 * COUNTRY_CALLING_CODES import solves for phone codes: there is no shared
 * validation/reference package this app can pull from yet, so these mirror
 * apps/web/src/lib/validation/password.ts's PASSWORD_MIN_LENGTH (the actual
 * Supabase-enforced rule) and apps/web/src/lib/nigeria-states.ts's list
 * value-for-value (the public signup page duplicates it there too, for the
 * same reason — its own comment explains RLS blocks reading
 * service_regions pre-login). Keep both in sync with their web originals if
 * either changes.
 */
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_RULE_HINT = `At least ${PASSWORD_MIN_LENGTH} characters.`;

const NIGERIAN_STATES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "Abia", label: "Abia" },
  { value: "Adamawa", label: "Adamawa" },
  { value: "Akwa Ibom", label: "Akwa Ibom" },
  { value: "Anambra", label: "Anambra" },
  { value: "Bauchi", label: "Bauchi" },
  { value: "Bayelsa", label: "Bayelsa" },
  { value: "Benue", label: "Benue" },
  { value: "Borno", label: "Borno" },
  { value: "Cross River", label: "Cross River" },
  { value: "Delta", label: "Delta" },
  { value: "Ebonyi", label: "Ebonyi" },
  { value: "Edo", label: "Edo" },
  { value: "Ekiti", label: "Ekiti" },
  { value: "Enugu", label: "Enugu" },
  { value: "Gombe", label: "Gombe" },
  { value: "Imo", label: "Imo" },
  { value: "Jigawa", label: "Jigawa" },
  { value: "Kaduna", label: "Kaduna" },
  { value: "Kano", label: "Kano" },
  { value: "Katsina", label: "Katsina" },
  { value: "Kebbi", label: "Kebbi" },
  { value: "Kogi", label: "Kogi" },
  { value: "Kwara", label: "Kwara" },
  { value: "Lagos", label: "Lagos" },
  { value: "Nasarawa", label: "Nasarawa" },
  { value: "Niger", label: "Niger" },
  { value: "Ogun", label: "Ogun" },
  { value: "Ondo", label: "Ondo" },
  { value: "Osun", label: "Osun" },
  { value: "Oyo", label: "Oyo" },
  { value: "Plateau", label: "Plateau" },
  { value: "Rivers", label: "Rivers" },
  { value: "Sokoto", label: "Sokoto" },
  { value: "Taraba", label: "Taraba" },
  { value: "Yobe", label: "Yobe" },
  { value: "Zamfara", label: "Zamfara" },
  { value: "Abuja", label: "Federal Capital Territory (Abuja)" },
];

/** Same principle as login-screen.tsx's friendlySignInError and
 * forgot-password-screen.tsx's friendly*Error helpers, condensed for the
 * sign-up call — mirrors the cases apps/web/src/lib/auth/auth-error-message.ts
 * handles for its "sign_up" context (anti-enumeration wording included: never
 * confirm whether an address is already registered). */
function friendlySignUpError(rawMessage: string): string {
  const message = rawMessage.toLowerCase();
  if (
    message.includes("already registered") ||
    message.includes("already been registered") ||
    message.includes("user already exists") ||
    message.includes("already exists")
  ) {
    return "We couldn't create an account with those details. If you already have one, sign in instead, or reset your password.";
  }
  if (message.includes("password should be at least") || message.includes("weak")) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (message.includes("rate limit") || message.includes("too many requests")) {
    return "Too many attempts for now. Wait a few minutes and try again.";
  }
  if (message.includes("network") || message.includes("fetch")) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  return "We couldn't create your account just now. Please try again.";
}

/**
 * Native "Create your account" screen (spec: eliminate WebView-wrapped
 * sections from the native app). Mirrors apps/web/src/app/signup/signup-form.tsx
 * and actions.ts field-for-field: first/last name, email, E.164 phone
 * (country code + local number, CLAUDE.md's Non-Negotiable Business Rules),
 * optional state, and password — a plain `supabase.auth.signUp()` call
 * carrying the same auth-metadata keys (`full_name`, `phone`, `state`) that
 * `private.handle_new_user`/`/auth/callback` read to provision the profile,
 * same as the web action does. Every self-serve signup provisions a
 * `patient` profile by default — role/org assignment is admin-only, never a
 * field here, matching the web comment this mirrors.
 *
 * Deliberately NOT carried over from the web flow: the `refCode`/`intent`
 * hidden fields (only ever populated from `?ref=`/`?intent=` query params on
 * the public `/signup` URL — this screen has no equivalent deep-link source
 * today) and the server-side IP/email-scoped rate limiting in actions.ts
 * (Upstash-backed, genuinely server-only — Supabase's own auth rate limits
 * still apply underneath). If a marketing referral link or rate-limiting
 * parity for native ever becomes a real ask, that's follow-up work, not a
 * silent gap in this screen's coverage of the ordinary signup path.
 */
export function SignUpScreen({ onClose }: { onClose: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState<string>(COUNTRY_CALLING_CODES[0].dialCode);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [localPhone, setLocalPhone] = useState("");
  const [stateValue, setStateValue] = useState<string>("");
  const [statePickerOpen, setStatePickerOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const fullPhone = `${countryCode}${localPhone.trim()}`;
  const selectedStateLabel =
    NIGERIAN_STATES.find((s) => s.value === stateValue)?.label ?? "Prefer not to say";

  async function handleSignUp() {
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError("Enter your first and last name.");
      return;
    }
    if (!email.trim().includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (!E164_GENERIC.test(fullPhone)) {
      setError("Enter a valid phone number for the selected country.");
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }

    setLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${PLATFORM_URL}/auth/callback`,
        // Same metadata keys as apps/web/src/app/signup/actions.ts — read by
        // private.handle_new_user / /auth/callback to backfill
        // profiles.full_name/phone/state once the account is confirmed.
        data: {
          full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
          phone: fullPhone,
          ...(stateValue ? { state: stateValue } : {}),
        },
      },
    });
    setLoading(false);
    if (signUpError) {
      setError(friendlySignUpError(signUpError.message));
      return;
    }
    setSuccess(true);
  }

  if (success) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingTop: 56, gap: 16, flexGrow: 1, justifyContent: "center" }}>
          <View style={{ alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: colors.brandTint,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="checkmark" size={26} color={colors.brand} />
            </View>
            <Text style={{ fontSize: 15, color: colors.ink, textAlign: "center" }}>
              Check your email to confirm your account, then sign in.
            </Text>
          </View>
          <SecondaryButton title="Back to sign in" onPress={onClose} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.screen, paddingTop: 56, gap: 12 }}
      >
        <SecondaryButton title="Close" onPress={onClose} />

        <View>
          <Text style={{ fontSize: 22, fontWeight: "700", color: colors.ink }}>
            Create your account
          </Text>
          <MutedText>A couple of minutes to set up. Your care team takes it from there.</MutedText>
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            accessibilityLabel="First name"
            placeholder="First name"
            placeholderTextColor={colors.faint}
            autoCapitalize="words"
            autoComplete="given-name"
            value={firstName}
            onChangeText={setFirstName}
            style={[inputStyle, { flex: 1 }]}
          />
          <TextInput
            accessibilityLabel="Last name"
            placeholder="Last name"
            placeholderTextColor={colors.faint}
            autoCapitalize="words"
            autoComplete="family-name"
            value={lastName}
            onChangeText={setLastName}
            style={[inputStyle, { flex: 1 }]}
          />
        </View>

        <TextInput
          accessibilityLabel="Email"
          placeholder="Email"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
          style={inputStyle}
        />

        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Country code ${countryCode}. Opens the country list.`}
              onPress={() => setCountryPickerOpen(true)}
              style={[inputStyle, { width: 92, justifyContent: "center" }]}
            >
              <Text style={{ fontSize: 16, color: colors.ink }}>{countryCode}</Text>
            </Pressable>
            <TextInput
              accessibilityLabel="Phone number"
              placeholder="8012345678"
              placeholderTextColor={colors.faint}
              keyboardType="phone-pad"
              autoComplete="tel-national"
              value={localPhone}
              onChangeText={setLocalPhone}
              style={[inputStyle, { flex: 1 }]}
            />
          </View>
          <MutedText>
            Just the number after the country code, with no leading zero. For example 8012345678.
          </MutedText>
        </View>

        <View style={{ gap: 6 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`State: ${selectedStateLabel}. Opens the state list.`}
            onPress={() => setStatePickerOpen(true)}
            style={[inputStyle, { justifyContent: "center" }]}
          >
            <Text style={{ fontSize: 16, color: stateValue ? colors.ink : colors.faint }}>
              {stateValue ? selectedStateLabel : "State (optional)"}
            </Text>
          </Pressable>
          <MutedText>
            Helps us show what&apos;s available near you. You can add or change this anytime.
          </MutedText>
        </View>

        <View style={{ gap: 6 }}>
          <View style={{ justifyContent: "center" }}>
            <TextInput
              accessibilityLabel="Password"
              placeholder="Password"
              placeholderTextColor={colors.faint}
              secureTextEntry={!showPassword}
              autoComplete="new-password"
              value={password}
              onChangeText={setPassword}
              style={[inputStyle, { paddingRight: 44 }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showPassword ? "Hide password" : "Show password"}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
              onPress={() => setShowPassword((v) => !v)}
              style={{ position: "absolute", right: 12, height: "100%", justifyContent: "center" }}
            >
              <Ionicons name={showPassword ? "eye-off" : "eye"} size={20} color={colors.faint} />
            </Pressable>
          </View>
          <MutedText>{PASSWORD_RULE_HINT}</MutedText>
        </View>

        {error ? <ErrorText>{error}</ErrorText> : null}
        <PrimaryButton title="Create account" onPress={handleSignUp} loading={loading} />
      </ScrollView>

      <Modal
        visible={countryPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCountryPickerOpen(false)}
      >
        <Pressable
          onPress={() => setCountryPickerOpen(false)}
          style={{ flex: 1, backgroundColor: inkAlpha(0.4), justifyContent: "flex-end" }}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderTopLeftRadius: radius.card,
              borderTopRightRadius: radius.card,
              maxHeight: "60%",
            }}
          >
            <ScrollView contentContainerStyle={{ padding: spacing.screen, gap: 2 }}>
              {COUNTRY_CALLING_CODES.map((country) => (
                <Pressable
                  key={country.iso}
                  accessibilityRole="button"
                  accessibilityLabel={`${country.label}, ${country.dialCode}`}
                  onPress={() => {
                    setCountryCode(country.dialCode);
                    setCountryPickerOpen(false);
                  }}
                  style={{ paddingVertical: 12, flexDirection: "row", justifyContent: "space-between" }}
                >
                  <Text style={{ fontSize: 15, color: colors.ink }}>{country.label}</Text>
                  <Text style={{ fontSize: 15, color: colors.muted }}>{country.dialCode}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={statePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setStatePickerOpen(false)}
      >
        <Pressable
          onPress={() => setStatePickerOpen(false)}
          style={{ flex: 1, backgroundColor: inkAlpha(0.4), justifyContent: "flex-end" }}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderTopLeftRadius: radius.card,
              borderTopRightRadius: radius.card,
              maxHeight: "60%",
            }}
          >
            <ScrollView contentContainerStyle={{ padding: spacing.screen, gap: 2 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Prefer not to say"
                onPress={() => {
                  setStateValue("");
                  setStatePickerOpen(false);
                }}
                style={{ paddingVertical: 12 }}
              >
                <Text style={{ fontSize: 15, color: colors.muted }}>Prefer not to say</Text>
              </Pressable>
              {NIGERIAN_STATES.map((s) => (
                <Pressable
                  key={s.value}
                  accessibilityRole="button"
                  accessibilityLabel={s.label}
                  onPress={() => {
                    setStateValue(s.value);
                    setStatePickerOpen(false);
                  }}
                  style={{ paddingVertical: 12 }}
                >
                  <Text style={{ fontSize: 15, color: colors.ink }}>{s.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
