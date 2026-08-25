import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Physical Activity Intensity Calculator | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Activity Intensity Calculator",
    subtitle:
      "Estimate calories burned and see how your session counts toward WHO's weekly activity guideline. Free, no sign-up required.",
  });
}
