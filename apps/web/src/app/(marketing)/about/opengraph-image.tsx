import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "About | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "About",
    subtitle:
      "Why TarragonHealth exists: continuity of care between doctor visits, for Nigerians and the people who love them.",
  });
}
