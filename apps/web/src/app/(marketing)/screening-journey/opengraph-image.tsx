import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Screening Journey | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Screening Journey",
    subtitle:
      "See exactly which health screenings are recommended for your age and sex, and walk through each one step by step.",
  });
}
