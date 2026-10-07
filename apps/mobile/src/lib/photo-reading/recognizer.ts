import type { ScreenTextRecognizer } from "@tarragon/shared";

/**
 * S70 (18.3): where on-device text recognition plugs in.
 *
 * NOTHING IS REGISTERED TODAY, on purpose. Reading numbers off a photo needs a native text recogniser (Google ML Kit on Android,
 * Apple Vision on iOS). Neither is in this build, and adding one means a native dependency, a new EAS build and a runtime version
 * bump, which this session cannot do or test (no device, no emulator, no EAS). So the photo screen works without it: it shows the
 * photo beside empty fields and the patient types what they see. The day a recogniser is added to a build, it is registered from
 * one place (`registerScreenTextRecognizer`, called once at app start) and the screen starts prefilling, with no other change.
 *
 * Rules any recogniser must keep: it runs on the phone, it never uploads the image, it calls no server and no language model.
 */
let registered: ScreenTextRecognizer | null = null;

export function registerScreenTextRecognizer(recognizer: ScreenTextRecognizer | null): void {
  registered = recognizer;
}

export function getScreenTextRecognizer(): ScreenTextRecognizer | null {
  return registered;
}

export type RecognitionOutcome = { kind: "text"; lines: string[] } | { kind: "unavailable" };

/** Never throws. Any recogniser failure is the same as no recogniser: the patient types the numbers. */
export async function recognizeScreenText(imageUri: string): Promise<RecognitionOutcome> {
  const recognizer = registered;
  if (!recognizer) return { kind: "unavailable" };
  try {
    if (!(await recognizer.isAvailable())) return { kind: "unavailable" };
    const lines = await recognizer.recognize(imageUri);
    return lines.length > 0 ? { kind: "text", lines } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
