import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Chronic care | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Chronic care",
    subtitle:
      "Ongoing monitoring for hypertension, diabetes, and weight management: readings, medication, labs, and doctor review on one record.",
  });
}
