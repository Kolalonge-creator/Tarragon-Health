import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "How we hold ourselves accountable | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "How we're accountable",
    subtitle:
      "How fast TarragonHealth responds when something looks wrong, and who signed off on those commitments.",
  });
}
