import { ImageResponse } from "next/og";
import { SITE } from "@/lib/marketing/site";

// Default social share card for every marketing page (Next falls back to this
// for Twitter when no twitter-image is present). Drawn entirely in-code so it
// needs no external asset or font fetch.
export const alt = `${SITE.name} — ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BRAND_GREEN = "#0E7C52";
const DEEP_FOREST = "#0A5C3D";
const IVORY = "#FBF7F0";
const GOLD = "#E8B33D";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          background: `linear-gradient(135deg, ${DEEP_FOREST} 0%, ${BRAND_GREEN} 100%)`,
          color: IVORY,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "56px",
              height: "56px",
              borderRadius: "16px",
              background: "rgba(251,247,240,0.15)",
              color: GOLD,
              fontSize: "34px",
              fontWeight: 700,
            }}
          >
            T
          </div>
          <div style={{ fontSize: "34px", fontWeight: 700, letterSpacing: "-0.5px" }}>
            TarragonHealth
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div
            style={{
              fontSize: "76px",
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-2px",
              maxWidth: "900px",
            }}
          >
            Care that stays with you.
          </div>
          <div style={{ fontSize: "34px", color: "rgba(251,247,240,0.85)", maxWidth: "880px" }}>
            Health monitoring for chronic disease, prevention, and care coordination.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            fontSize: "26px",
            color: "rgba(251,247,240,0.75)",
          }}
        >
          <div style={{ width: "48px", height: "4px", borderRadius: "2px", background: GOLD }} />
          For Nigerian families
        </div>
      </div>
    ),
    size,
  );
}
