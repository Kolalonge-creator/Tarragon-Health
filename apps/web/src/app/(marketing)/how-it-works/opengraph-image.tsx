import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "How TarragonHealth works";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "How it works",
    subtitle: "Your profile, a plan made for you, results reviewed by a doctor, and follow-up all year.",
  });
}
