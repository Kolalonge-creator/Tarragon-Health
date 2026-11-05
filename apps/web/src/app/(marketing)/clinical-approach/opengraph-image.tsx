import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "TarragonHealth: our clinical approach";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Our clinical approach",
    subtitle: "Technology that helps, with doctors who decide.",
  });
}
