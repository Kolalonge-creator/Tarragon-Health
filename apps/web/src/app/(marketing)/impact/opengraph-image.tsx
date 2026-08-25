import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Our impact | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Our impact",
    subtitle:
      "Platform-wide numbers on what TarragonHealth's monitoring and doctor review actually catches, updated daily.",
  });
}
