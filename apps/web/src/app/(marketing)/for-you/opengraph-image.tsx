import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "For you | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "For you",
    subtitle:
      "Doctor-reviewed monitoring for hypertension, diabetes, and weight management, preventive screening, medication support, and lab coordination on one record.",
  });
}
