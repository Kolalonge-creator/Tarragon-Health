import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Contact | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Join TarragonHealth",
    subtitle: "Request an employer health plan, or talk to us about HMO partnerships.",
  });
}
