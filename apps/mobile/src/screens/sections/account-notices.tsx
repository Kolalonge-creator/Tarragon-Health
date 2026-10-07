import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { t, type MessageKey } from "@tarragon/i18n";
import {
  CARE_ACCESS_CATEGORIES,
  completeHandover,
  confirmProxySetup,
  declineProxySetup,
  loadMyHandover,
  loadPendingProxySetups,
  type CareAccessCategory,
  type HandoverState,
  type PendingProxySetup,
} from "@/lib/proxy";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const colors = useLegacyColors();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onChange(!checked)} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }}>
      <View style={{ width: 22, height: 22, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: checked ? colors.brand : "transparent" }}>
        {checked && <Text style={{ color: "#fff", fontSize: 14 }}>✓</Text>}
      </View>
      <Text style={{ flex: 1, fontSize: 13.5, color: colors.ink }}>{label}</Text>
    </Pressable>
  );
}

/** The parent's confirmation of "Set up for my parent". Every box starts unticked: share nothing unless they choose. */
function ProxyRequestCard({ setup, onDone }: { setup: PendingProxySetup; onDone: () => void }) {
  const colors = useLegacyColors();
  const name = setup.requesterFirstName || "Someone";
  const [chosen, setChosen] = useState<CareAccessCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function answer(accept: boolean) {
    setBusy(true);
    setError(null);
    const result = accept ? await confirmProxySetup(setup.id, chosen) : await declineProxySetup(setup.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(t(accept ? "proxy.confirm.done" : "proxy.confirm.declined", "en", { name }));
    onDone();
  }

  if (message) {
    return (
      <Card>
        <Text accessibilityRole="text" style={{ fontSize: 13.5, color: colors.ink }}>{message}</Text>
      </Card>
    );
  }
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("proxy.confirm.title", "en", { name })}</Text>
      <MutedText>{t("proxy.confirm.body", "en", { name })}</MutedText>
      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{t("proxy.confirm.categories_label", "en", { name })}</Text>
      {CARE_ACCESS_CATEGORIES.map((category) => (
        <Check
          key={category}
          label={t(`care_category.${category}` as MessageKey)}
          checked={chosen.includes(category)}
          onChange={(v) => setChosen((c) => (v ? [...c, category] : c.filter((x) => x !== category)))}
        />
      ))}
      <MutedText>{t("proxy.confirm.none_note", "en", { name })}</MutedText>
      {error && <ErrorText>{error}</ErrorText>}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <PrimaryButton title={t("proxy.confirm.confirm")} onPress={() => void answer(true)} loading={busy} />
        <SecondaryButton title={t("proxy.confirm.decline")} onPress={() => void answer(false)} disabled={busy} />
      </View>
    </Card>
  );
}

/** A young person's own hand-over at 18. Everyone not ticked loses access when they finish. */
function HandoverCard({ state, onDone }: { state: HandoverState; onDone: () => void }) {
  const colors = useLegacyColors();
  const [keep, setKeep] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function finish() {
    setBusy(true);
    setError(null);
    const result = await completeHandover(keep);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(true);
    onDone();
  }

  if (done) {
    return (
      <Card>
        <Text style={{ fontSize: 13.5, color: colors.ink }}>{t("handover.done")}</Text>
      </Card>
    );
  }
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("handover.title")}</Text>
      <MutedText>{t("handover.body")}</MutedText>
      {state.guardians.length === 0 ? (
        <MutedText>{t("handover.nobody")}</MutedText>
      ) : (
        <>
          {state.guardians.map((g) => (
            <Check key={g.id} label={t("handover.keep", "en", { name: g.firstName })} checked={keep.includes(g.id)} onChange={(v) => setKeep((k) => (v ? [...k, g.id] : k.filter((x) => x !== g.id)))} />
          ))}
          <MutedText>{t("handover.keep_note")}</MutedText>
        </>
      )}
      <MutedText>{t("handover.consent_notice")}</MutedText>
      {error && <ErrorText>{error}</ErrorText>}
      <PrimaryButton title={t("handover.finish")} onPress={() => void finish()} loading={busy} />
    </Card>
  );
}

/**
 * Things that need a person's answer before anything else on their account: a request from someone who wants to help look
 * after them (they see a first name only and every box starts unticked), and a hand-over of their own profile at 18.
 * Nothing renders when there is nothing waiting. A failed read shows nothing rather than a guess; the next open asks again.
 */
export function AccountNotices({ acting }: { acting: boolean }) {
  const [setups, setSetups] = useState<PendingProxySetup[]>([]);
  const [handover, setHandover] = useState<HandoverState>({ pending: false, guardians: [] });

  const load = useCallback(async () => {
    const [s, h] = await Promise.all([loadPendingProxySetups(), loadMyHandover()]);
    if (s.ok) setSetups(s.data);
    setHandover(h);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (acting) return null;
  return (
    <View style={{ gap: 12 }}>
      {setups.map((s) => (
        <ProxyRequestCard key={s.id} setup={s} onDone={() => void load()} />
      ))}
      {handover.pending && <HandoverCard state={handover} onDone={() => void load()} />}
    </View>
  );
}
