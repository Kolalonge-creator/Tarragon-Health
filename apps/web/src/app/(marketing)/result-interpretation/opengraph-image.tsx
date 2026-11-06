import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "TarragonHealth: Understand your laboratory results";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Understand your laboratory results",
    subtitle: "Upload a result from any laboratory in Nigeria. Anything abnormal reaches a doctor.",
  });
}
