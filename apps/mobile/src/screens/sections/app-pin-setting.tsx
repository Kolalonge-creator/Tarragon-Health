import { useState } from "react";
import { Text, View } from "react-native";
import { PIN_PROBLEM_TEXT, getPrivateLockConfig } from "@tarragon/shared";
import { usePrivateLock } from "@/lib/private-lock";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { PinInput } from "@/ui/private-section";

const COPY = {
  title: "App PIN",
  intro:
    "Add a PIN of your own, so that knowing your phone's passcode is not enough to open TarragonHealth. It works with App lock: once a PIN is set, the PIN is how you open the app.",
  set: "Set an app PIN",
  newPin: "New PIN",
  confirmPin: "Type it again",
  pinHelp: "Use {min} to {max} numbers.",
  pinsDiffer: "The two PINs are not the same. Try again.",
  save: "Save PIN",
  storageFailed: "This device could not save your PIN. Try again.",
  on: "Your app PIN is on. You will be asked for it each time you open the app.",
  lockOff: "App lock is turned off, so the PIN is not asked for. Turn App lock on to use it.",
  forgot: "If you forget it, choose \"I forgot my PIN\" on the lock screen. We send a code to your phone or email, and only the PIN on this device is cleared.",
  turnOff: "Turn off the PIN",
  currentPin: "Your PIN",
  confirmOff: "Turn off",
  cancel: "Cancel",
  wrongPin: "That PIN is not right. Try again.",
  lockedOut: "Too many tries. Wait {seconds} seconds and try again.",
} as const;

/**
 * Settings control for the optional app PIN (audit 1.17). Shown once App lock is on. Setting a PIN makes the PIN the way into the
 * app (see AppLockScreen); turning it off needs the PIN again, so someone holding an unlocked phone cannot quietly remove it.
 */
export function AppPinSetting({ accountId, appLockEnabled, onPinSet }: { accountId: string; appLockEnabled: boolean; onPinSet: () => void }) {
  const cfg = getPrivateLockConfig();
  const colors = useLegacyColors();
  const lock = usePrivateLock(accountId, "app");
  const [mode, setMode] = useState<"idle" | "setup" | "turnoff">("idle");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (lock.status === "loading") return null;
  const hasPin = lock.status === "locked" || lock.status === "unlocked";

  const reset = () => {
    setMode("idle");
    setPin("");
    setConfirm("");
    setError(null);
  };

  async function save() {
    if (pin !== confirm) return setError(COPY.pinsDiffer);
    setBusy(true);
    const r = await lock.setupPin(pin, false);
    setBusy(false);
    if (!r.ok) return setError(r.reason === "storage_failed" || r.reason === "biometric_unavailable" ? COPY.storageFailed : PIN_PROBLEM_TEXT[r.reason]);
    onPinSet();
    reset();
  }

  async function turnOff() {
    setBusy(true);
    const r = await lock.unlockWithPin(pin);
    if (!r.ok) {
      setBusy(false);
      setPin("");
      return setError(r.reason === "locked_out" ? COPY.lockedOut.replace("{seconds}", String(r.retryAfterSeconds)) : COPY.wrongPin);
    }
    await lock.turnOff();
    setBusy(false);
    reset();
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{COPY.title}</Text>
      {hasPin ? (
        <>
          <MutedText>{COPY.on}</MutedText>
          {appLockEnabled ? null : <MutedText>{COPY.lockOff}</MutedText>}
          <MutedText>{COPY.forgot}</MutedText>
          {mode === "turnoff" ? (
            <View style={{ gap: 10 }}>
              <PinInput value={pin} onChange={setPin} label={COPY.currentPin} max={cfg.pinMaxDigits} />
              {error ? <ErrorText>{error}</ErrorText> : null}
              <PrimaryButton title={COPY.confirmOff} loading={busy} disabled={pin.length < cfg.pinMinDigits} onPress={() => void turnOff()} />
              <SecondaryButton title={COPY.cancel} onPress={reset} />
            </View>
          ) : (
            <SecondaryButton title={COPY.turnOff} onPress={() => setMode("turnoff")} />
          )}
        </>
      ) : mode === "setup" ? (
        <View style={{ gap: 10 }}>
          <PinInput value={pin} onChange={setPin} label={COPY.newPin} max={cfg.pinMaxDigits} />
          <PinInput value={confirm} onChange={setConfirm} label={COPY.confirmPin} max={cfg.pinMaxDigits} />
          <MutedText>{COPY.pinHelp.replace("{min}", String(cfg.pinMinDigits)).replace("{max}", String(cfg.pinMaxDigits))}</MutedText>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <PrimaryButton title={COPY.save} loading={busy} disabled={pin.length < cfg.pinMinDigits} onPress={() => void save()} />
          <SecondaryButton title={COPY.cancel} onPress={reset} />
        </View>
      ) : (
        <>
          <MutedText>{COPY.intro}</MutedText>
          <SecondaryButton title={COPY.set} onPress={() => setMode("setup")} />
        </>
      )}
    </Card>
  );
}
