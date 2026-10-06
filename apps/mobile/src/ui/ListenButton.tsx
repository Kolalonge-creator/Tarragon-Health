import { useCallback, useEffect, useState } from "react";
import { Button } from "@/ui/kit";
import { getAudioService } from "@/lib/audio/service";
import { t, type MessageKey } from "@tarragon/i18n";

/**
 * "Listen" for a clip (S32). It shows only when the clip would really play: recorded, signed off, and an audio
 * engine registered. Until then it renders nothing, so no screen shows a button that cannot work; the text beside
 * it is always the same words the voice says (clinical-wording.json). Audio never plays on its own (low-data rule).
 */
export function ListenButton({ clipId, lang }: { clipId: string | null; lang: "en" }) {
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let live = true;
    setReady(false);
    if (clipId) {
      void getAudioService()
        .canPlayClips([clipId], lang)
        .then((ok) => live && setReady(ok))
        .catch(() => {});
    }
    return () => {
      live = false;
      getAudioService().stop();
    };
  }, [clipId, lang]);

  const press = useCallback(() => {
    if (!clipId) return;
    if (playing) {
      getAudioService().stop();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    void getAudioService()
      .playClips([clipId], lang)
      .catch(() => {})
      .finally(() => setPlaying(false));
  }, [clipId, lang, playing]);

  if (!clipId || !ready) return null;
  return <Button title={t((playing ? "audio.stop" : "audio.listen") as MessageKey, lang)} variant="secondary" fullWidth={false} onPress={press} />;
}
