import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "TarragonHealth for healthcare professionals";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "For healthcare professionals",
    subtitle: "Signed protocols, named accountability, and technology that does the paperwork.",
  });
}
