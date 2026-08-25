import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "BMI & Calorie Calculator | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "BMI & Calorie Calculator",
    subtitle:
      "See your body mass index range and an estimated daily calorie target. Free, no sign-up required.",
  });
}
