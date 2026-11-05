import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "TarragonHealth Membership";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Membership",
    subtitle: "A plan made for you, results reviewed by a doctor, and a monthly online doctor meeting.",
  });
}
