import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Vaccinations | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Vaccinations",
    subtitle:
      "A personal vaccination schedule for you and your children, reminders when a dose is due, and a doctor-verified certificate you'll never lose.",
  });
}
