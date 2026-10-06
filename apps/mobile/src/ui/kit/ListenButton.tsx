import { useEffect, useRef, useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import type { Lang, Phrase } from "@tarragon/audio";
import { getAudioService } from "@/lib/audio/service";
import { Button } from "./Button";

interface ListenButtonProps {
  /** The clips to say, in order. Or a stitched reading (`phrase`). */
  clipIds?: readonly string[];
  phrase?: Phrase;
  lang: Lang;
}

/**
 * "Listen" for a message that is already on the screen. The words are never replaced by the audio, so a person
 * with no sound, a missing clip or a screen reader still has everything. The accessibility label and hint are
 * plain English on purpose: a screen reader reads them in the phone's own voice.
 *
 * Changing the language or leaving the screen stops the clip.
 */
export function ListenButton({ clipIds, phrase, lang }: ListenButtonProps) {
  const [playing, setPlaying] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      getAudioService().stop();
    };
  }, []);

  useEffect(() => {
    getAudioService().stop(); // a language switch ends whatever is playing in the old language
  }, [lang]);

  const label = (key: "audio.listen" | "audio.stop") => t(key, "en" as Locale);

  const onPress = async () => {
    const service = getAudioService();
    if (playing) {
      service.stop();
      return;
    }
    setPlaying(true);
    try {
      if (phrase) await service.playPhrase(phrase, lang);
      else if (clipIds) await service.playClips(clipIds, lang);
    } finally {
      if (alive.current) setPlaying(false);
    }
  };

  return <Button title={label(playing ? "audio.stop" : "audio.listen")} onPress={onPress} variant="ghost" fullWidth={false} accessibilityHint={t("audio.listen_hint", "en")} />;
}
