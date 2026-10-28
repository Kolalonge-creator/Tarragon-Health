import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { asLocale, t } from "@tarragon/i18n";
import type { SectionId } from "@/lib/sections";
import { TOUR_BODY_KEYS, TOURS_SEEN_KEY, helpTextFor, isTourTab, parseSeen, serializeSeen, tourToOffer, type TourTab } from "@/lib/screen-help";
import { useUiLanguage } from "@/lib/ui-language";
import { useLegacyColors } from "@/ui/design";
import { Card, MutedText, SecondaryButton } from "@/ui/legacy-kit";

/**
 * "What is this?" under the top bar of a screen, and a one-time offer of a short tour on the four bottom tabs (spec D.2).
 * Both are words on the screen, so they work with no sound, no recording and a screen reader. Nothing plays by itself and nothing
 * covers the screen: the row is one line until the person taps it. A screen with no mapped help shows no row (lib/screen-help.ts).
 */
export function ScreenHelp({ section }: { section: SectionId }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const help = helpTextFor(section);
  const [open, setOpen] = useState(false);
  const [offer, setOffer] = useState<TourTab | null>(null);
  const [touring, setTouring] = useState<TourTab | null>(null);

  // Collapse the help when the person moves to another screen; look for a tour to offer on the four tabs.
  useEffect(() => {
    setOpen(false);
    setTouring(null);
    // Clear first: otherwise the previous tab's offer stays on screen (and "Show me" would open the wrong tab's tour) until the read below returns.
    setOffer(null);
    // Only the four tour tabs can have an offer, so the other screens do no storage read at all.
    if (!isTourTab(section)) return;
    let live = true;
    void AsyncStorage.getItem(TOURS_SEEN_KEY)
      .then((raw) => {
        if (live) setOffer(tourToOffer(section, parseSeen(raw)));
      })
      .catch(() => {
        // An unreadable store offers the tour once more, which costs one tap to dismiss.
        if (live) setOffer(tourToOffer(section, new Set()));
      });
    return () => {
      live = false;
    };
  }, [section]);

  async function markSeen(tab: TourTab) {
    setOffer(null);
    setTouring(null);
    try {
      const raw = await AsyncStorage.getItem(TOURS_SEEN_KEY);
      const seen = parseSeen(raw);
      seen.add(tab);
      await AsyncStorage.setItem(TOURS_SEEN_KEY, serializeSeen(seen));
    } catch {
      // Not saved: the offer may come back once, which is harmless.
    }
  }

  if (!help && !offer && !touring) return null;
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 6, gap: 8 }}>
      {offer && !touring ? (
        <Card style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>
            {t("tour.offer_title", locale)}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <SecondaryButton title={t("tour.show", locale)} onPress={() => setTouring(offer)} />
            <SecondaryButton title={t("tour.not_now", locale)} onPress={() => void markSeen(offer)} />
          </View>
        </Card>
      ) : null}
      {touring ? (
        <Card style={{ gap: 8 }}>
          <MutedText>{t(TOUR_BODY_KEYS[touring], locale)}</MutedText>
          <SecondaryButton title={t("tour.got_it", locale)} onPress={() => void markSeen(touring)} />
        </Card>
      ) : null}
      {help ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={t("help.what_is_this", locale)}
            accessibilityHint={t("help.what_is_this_hint", locale)}
            onPress={() => setOpen((v) => !v)}
            style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}
          >
            <Text style={{ fontSize: 14, fontWeight: "600", color: colors.brand, textDecorationLine: "underline" }}>
              {t("help.what_is_this", locale)}
            </Text>
          </Pressable>
          {open ? (
            <Card style={{ gap: 8 }}>
              <MutedText>{help}</MutedText>
              <SecondaryButton title={t("help.close", locale)} onPress={() => setOpen(false)} />
            </Card>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
