import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Our partners | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Our partners",
    subtitle:
      "The real, current partnerships behind TarragonHealth, why we won't take capitation, and how we price.",
  });
}
