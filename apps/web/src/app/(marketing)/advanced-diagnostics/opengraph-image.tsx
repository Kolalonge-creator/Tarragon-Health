import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Advanced Diagnostics | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Advanced Diagnostics",
    subtitle:
      "Whole-body and targeted imaging referrals, coordinated by Tarragon and read by your doctor. Coming soon.",
  });
}
