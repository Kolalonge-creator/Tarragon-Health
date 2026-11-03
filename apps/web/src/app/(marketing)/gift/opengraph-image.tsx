import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Give the gift of health | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Give the gift of health",
    subtitle:
      "Buy a parent or family member a named health check they can use whenever suits them.",
  });
}
