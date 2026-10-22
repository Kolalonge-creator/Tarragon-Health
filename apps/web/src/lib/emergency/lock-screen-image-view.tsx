import type { LockScreenModel } from "./lock-screen-image";
import { LOCK_SCREEN_IMAGE } from "./lock-screen-image";

/**
 * The picture itself, as JSX for `next/og`'s ImageResponse (satori: flexbox only, every element with children needs `display: flex`, inline styles only).
 * High contrast on a plain dark ground so it stays readable behind a phone's clock and notifications. The top part is left empty for the clock.
 */
const TONE = {
  plain: { bg: "#FFFFFF", fg: "#0B1F2E", label: "#4A5B68" },
  alert: { bg: "#FDE8E8", fg: "#7A0F0F", label: "#7A0F0F" },
  caution: { bg: "#FFF4D6", fg: "#5C3D00", label: "#7A5200" },
} as const;

export function LockScreenCardImage({ model, qrDataUri }: { model: LockScreenModel; qrDataUri: string | null }) {
  return (
    <div
      style={{
        width: LOCK_SCREEN_IMAGE.width,
        height: LOCK_SCREEN_IMAGE.height,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#0B1F2E",
        color: "#FFFFFF",
        fontFamily: "Noto Sans",
        paddingTop: LOCK_SCREEN_IMAGE.topSafe,
        paddingBottom: LOCK_SCREEN_IMAGE.bottomSafe,
        paddingLeft: 70,
        paddingRight: 70,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 30, letterSpacing: 4, textTransform: "uppercase", opacity: 0.85 }}>{model.title}</div>
        <div style={{ display: "flex", fontSize: 68, fontWeight: 700, marginTop: 8 }}>{model.name}</div>
        {model.identity ? <div style={{ display: "flex", fontSize: 30, marginTop: 6, opacity: 0.9 }}>{model.identity}</div> : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: 26 }}>
        {model.rows.map((row) => {
          const tone = TONE[row.tone];
          return (
            <div
              key={row.key}
              style={{ display: "flex", flexDirection: "column", backgroundColor: tone.bg, color: tone.fg, borderRadius: 18, padding: "20px 26px", marginBottom: 14 }}
            >
              <div style={{ display: "flex", fontSize: 24, letterSpacing: 2, textTransform: "uppercase", color: tone.label }}>{row.label}</div>
              {row.lines.map((line, i) => (
                <div key={i} style={{ display: "flex", fontSize: i === 0 ? 40 : 30, fontWeight: i === 0 ? 700 : 400, marginTop: i === 0 ? 4 : 2 }}>
                  {line}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {model.notShared ? <div style={{ display: "flex", fontSize: 28, fontWeight: 700, marginTop: 4 }}>{model.notShared}</div> : null}

      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 24, opacity: 0.85, maxWidth: qrDataUri ? 640 : 1000 }}>
          {model.footer.map((line, i) => (
            <div key={i} style={{ display: "flex", marginTop: i === 0 ? 0 : 4 }}>
              {line}
            </div>
          ))}
        </div>
        {qrDataUri ? (
          <div style={{ display: "flex", backgroundColor: "#FFFFFF", padding: 14, borderRadius: 14 }}>
            {/* satori draws a plain <img>; next/image does not apply here */}
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
            <img src={qrDataUri} width={250} height={250} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
