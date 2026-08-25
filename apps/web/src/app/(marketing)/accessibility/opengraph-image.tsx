import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Accessibility Statement | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Accessibility Statement",
    subtitle:
      "TarragonHealth's commitment to an accessible website and platform, and how to report a problem.",
  });
}
