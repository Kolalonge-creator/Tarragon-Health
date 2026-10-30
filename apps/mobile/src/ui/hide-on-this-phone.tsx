import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { isHiddenOnDevice, setHiddenOnDevice, type HideableCard, type LockStorage } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { secureStoreLockStorage } from "@/lib/private-lock";
import { Card, ErrorText, MutedText, SecondaryButton } from "@/ui/legacy-kit";

/**
 * "Hide on this phone" (UI-B change 6), the phone peer of the web component. A per-card, per-account, per-device switch kept in the
 * same SecureStore the PrivateSection lock uses. It deletes nothing, changes nobody else's access and is not a lock (showing the card
 * again needs no PIN; a PIN is PrivateSection's job). A storage that cannot be read leaves the card visible. The placeholder does not
 * say what is hidden, and nothing is drawn until the stored choice has been read, so a hidden card never flashes.
 */
export function HideOnThisPhone({ accountId, card, children, storage = secureStoreLockStorage }: { accountId: string; card: HideableCard; children: ReactNode; storage?: LockStorage }) {
  const [hidden, setHidden] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void isHiddenOnDevice(storage, accountId, card).then((h) => {
      if (alive) setHidden(h);
    });
    return () => {
      alive = false;
    };
  }, [storage, accountId, card]);

  async function change(next: boolean) {
    const ok = await setHiddenOnDevice(storage, accountId, card, next);
    setFailed(!ok);
    if (ok) setHidden(next);
  }

  if (hidden === null) return null;
  if (hidden) {
    return (
      <Card style={{ gap: 8 }}>
        <MutedText>{t("uib.hide.hidden")}</MutedText>
        <SecondaryButton title={t("uib.hide.show")} onPress={() => void change(false)} />
        {failed && <ErrorText>{t("common.try_again")}</ErrorText>}
      </Card>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <SecondaryButton title={t("uib.hide.action")} onPress={() => void change(true)} />
      <MutedText>{t("uib.hide.note")}</MutedText>
      {failed && <ErrorText>{t("common.try_again")}</ErrorText>}
      {children}
    </View>
  );
}
