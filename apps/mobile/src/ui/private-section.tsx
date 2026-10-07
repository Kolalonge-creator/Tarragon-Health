import { useState, type ReactNode } from "react";
import { Text, TextInput, View } from "react-native";
import { PIN_PROBLEM_TEXT, getPrivateLockConfig } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { supabase } from "@/lib/supabase";
import { usePrivateLock, type PrivateLockApi } from "@/lib/private-lock";
import { requestRecoveryCode, verifyRecoveryCode, type RecoveryAuth } from "@/lib/private-lock-recovery";
import { useLegacyColors, useTextInputStyle, useTheme, placeholderColorFor } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

/**
 * PrivateSection (mobile, S66): the reusable gate for any section whose content must stay private on a shared phone. Cycle uses it now;
 * pregnancy, postnatal and other private sections wrap their body in the same component (S67 to S69). Same API as the web component.
 *
 *   <PrivateSection accountId={userId} title="Your tracker" outside={<DangerSigns />}>...private content...</PrivateSection>
 *
 *  - `outside`   emergency and danger-sign content that must never be locked. Rendered in every state, holds no personal data.
 *  - `children`  rendered only once unlocked (or when the person turned the lock off on purpose).
 * Optional but ON BY DEFAULT; re-asked after the app has been in the background longer than `private_section.lock` allows; a forgotten PIN
 * is recovered with a code sent to the account's own phone (or email), which clears only the PIN on this device. Separate from the
 * whole-app biometric lock in lib/app-lock.ts.
 */
export function PrivateSection({ accountId, title, outside, children }: { accountId: string; title: string; outside?: ReactNode; children: ReactNode }) {
  const lock = usePrivateLock(accountId);
  const colors = useLegacyColors();
  return (
    <View style={{ gap: 16 }}>
      {outside}
      {lock.status === "loading" && (
        <Card>
          <MutedText>{COPY.loading}</MutedText>
        </Card>
      )}
      {lock.status === "needs_setup" && <SetupCard title={title} lock={lock} />}
      {lock.status === "locked" && <UnlockCard title={title} lock={lock} />}
      {(lock.status === "unlocked" || lock.status === "disabled") && (
        <>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12 }}>
            {lock.status === "unlocked" ? (
              <>
                <Text onPress={() => void lock.lock()} style={{ color: colors.brandPressed, fontWeight: "700", fontSize: 13 }}>
                  {COPY.lockNow}
                </Text>
                <Text onPress={() => void lock.turnOff()} style={{ color: colors.muted, fontWeight: "600", fontSize: 13 }}>
                  {COPY.turnOffLock}
                </Text>
              </>
            ) : (
              <Text onPress={() => void lock.resetAfterReverification()} style={{ color: colors.muted, fontWeight: "600", fontSize: 13 }}>
                {COPY.turnOnLock}
              </Text>
            )}
          </View>
          {children}
        </>
      )}
    </View>
  );
}

function PinInput({ value, onChange, label, max, disabled }: { value: string; onChange: (v: string) => void; label: string; max: number; disabled?: boolean }) {
  const { scheme } = useTheme();
  const colors = useLegacyColors();
  const style = useTextInputStyle();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardAppearance={scheme}
        placeholderTextColor={placeholderColorFor(scheme)}
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, ""))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={max}
        editable={!disabled}
        style={style}
      />
    </View>
  );
}

function SetupCard({ title, lock }: { title: string; lock: PrivateLockApi }) {
  const cfg = getPrivateLockConfig();
  const colors = useLegacyColors();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(alsoBiometric: boolean) {
    if (pin !== confirm) return setError(COPY.pinsDiffer);
    setBusy(true);
    const r = await lock.setupPin(pin, alsoBiometric);
    setBusy(false);
    if (!r.ok) setError(r.reason === "storage_failed" || r.reason === "biometric_unavailable" ? COPY.storageFailed : PIN_PROBLEM_TEXT[r.reason]);
  }

  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{title}</Text>
      <MutedText>{COPY.setupIntro}</MutedText>
      <PinInput value={pin} onChange={setPin} label={COPY.newPin} max={cfg.pinMaxDigits} />
      <PinInput value={confirm} onChange={setConfirm} label={COPY.confirmPin} max={cfg.pinMaxDigits} />
      <MutedText>{COPY.pinHelp.replace("{min}", String(cfg.pinMinDigits)).replace("{max}", String(cfg.pinMaxDigits))}</MutedText>
      {error && <ErrorText>{error}</ErrorText>}
      <PrimaryButton title={COPY.setPin} loading={busy} disabled={pin.length < cfg.pinMinDigits} onPress={() => void save(false)} />
      {lock.biometricAvailable && <SecondaryButton title={COPY.setPinAndBiometric} disabled={busy || pin.length < cfg.pinMinDigits} onPress={() => void save(true)} />}
      <SecondaryButton title={COPY.noLock} onPress={() => void lock.turnOff()} />
    </Card>
  );
}

function UnlockCard({ title, lock }: { title: string; lock: PrivateLockApi }) {
  const cfg = getPrivateLockConfig();
  const colors = useLegacyColors();
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const lockedOut = lock.lockoutSeconds > 0;
  const hasBiometric = lock.method === "biometric" || lock.method === "pin_and_biometric";
  const hasPin = lock.method === "pin" || lock.method === "pin_and_biometric";

  if (forgot) return <RecoveryCard lock={lock} onBack={() => setForgot(false)} />;

  async function submit() {
    const r = await lock.unlockWithPin(pin);
    setPin("");
    if (r.ok) return setMessage(null);
    if (r.reason === "locked_out") return setMessage(COPY.lockedOut.replace("{seconds}", String(r.retryAfterSeconds)));
    if (r.reason === "wrong_pin") return setMessage(COPY.wrongPin);
    setMessage(COPY.storageFailed);
  }

  async function biometric() {
    const r = await lock.unlockWithBiometric();
    if (!r.ok) setMessage(hasPin ? COPY.biometricFailedUsePin : COPY.biometricFailed);
  }

  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{title}</Text>
      <MutedText>{COPY.unlockIntro}</MutedText>
      {hasPin && <PinInput value={pin} onChange={setPin} label={COPY.enterPin} max={cfg.pinMaxDigits} disabled={lockedOut} />}
      {(message || lockedOut) && <ErrorText>{lockedOut ? COPY.lockedOut.replace("{seconds}", String(lock.lockoutSeconds)) : (message ?? "")}</ErrorText>}
      {hasPin && <PrimaryButton title={COPY.open} disabled={lockedOut || pin.length < cfg.pinMinDigits} onPress={() => void submit()} />}
      {hasBiometric && <SecondaryButton title={COPY.useBiometric} onPress={() => void biometric()} />}
      <SecondaryButton title={COPY.forgotPin} onPress={() => setForgot(true)} />
    </Card>
  );
}

function RecoveryCard({ lock, onBack }: { lock: PrivateLockApi; onBack: () => void }) {
  const colors = useLegacyColors();
  const [userId, setUserId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const auth = supabase.auth as unknown as RecoveryAuth;

  async function send() {
    setBusy(true);
    setError(null);
    const r = await requestRecoveryCode(auth);
    setBusy(false);
    if (r.kind === "sent") setUserId(r.userId);
    else setError(t(r.key));
  }

  async function verify() {
    if (!userId) return;
    setBusy(true);
    setError(null);
    const r = await verifyRecoveryCode(auth, code, userId);
    if (r.kind === "verified") {
      await lock.resetAfterReverification();
      setBusy(false);
      return;
    }
    setBusy(false);
    setError(t(r.key));
  }

  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{COPY.recoveryTitle}</Text>
      <MutedText>{COPY.recoveryIntro}</MutedText>
      {!userId ? (
        <PrimaryButton title={COPY.sendCode} loading={busy} onPress={() => void send()} />
      ) : (
        <>
          <PinInput value={code} onChange={setCode} label={COPY.codeLabel} max={6} />
          <PrimaryButton title={COPY.verifyCode} loading={busy} disabled={code.length < 6} onPress={() => void verify()} />
        </>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <SecondaryButton title={COPY.backToPin} onPress={onBack} />
    </Card>
  );
}

// The same words as the web component (apps/web/src/components/private-section/copy.ts). English only (D-14); no em dashes.
const COPY = {
  loading: "Opening...",
  setupIntro: "This part of the app is private. Choose a PIN so that only you can open it on this device. You can turn this off if you prefer.",
  newPin: "New PIN",
  confirmPin: "Type it again",
  pinHelp: "Use {min} to {max} numbers. You will be asked for it each time you come back.",
  pinsDiffer: "The two PINs are not the same. Try again.",
  setPin: "Set PIN",
  setPinAndBiometric: "Set PIN and use fingerprint or face as well",
  noLock: "No lock, thanks",
  storageFailed: "This device could not save your PIN. Try again, or turn the lock off.",
  unlockIntro: "Enter your PIN to open this part of the app.",
  enterPin: "PIN",
  open: "Open",
  useBiometric: "Use fingerprint or face",
  wrongPin: "That PIN is not right. Try again.",
  lockedOut: "Too many tries. Wait {seconds} seconds and try again.",
  biometricFailed: "That did not work. Try again.",
  biometricFailedUsePin: "That did not work. Try again, or use your PIN.",
  forgotPin: "I forgot my PIN",
  lockNow: "Lock now",
  turnOffLock: "Turn off the lock",
  turnOnLock: "Turn the lock on",
  recoveryTitle: "Reset your PIN",
  recoveryIntro: "We will send a code to the phone number on your account, or to your email if you have no phone. Nothing you have saved is lost: only the PIN on this device is cleared.",
  sendCode: "Send me a code",
  codeLabel: "6 digit code",
  verifyCode: "Check code",
  backToPin: "Back",
} as const;
