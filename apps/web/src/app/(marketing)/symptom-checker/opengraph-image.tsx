import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Symptom Checker | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Symptom Checker",
    subtitle:
      "A free, anonymous starting point: tell us what you're noticing, get a suggested next step.",
  });
}
