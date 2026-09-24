import Image from "next/image";

/**
 * Realistic iPhone Pro-line bezel, factored out of app-dashboard-mockup.tsx
 * so every product page can drop in its own real screen (captured from the
 * Expo app or the iOS Simulator against a live QA account) instead of a
 * stylised illustration — same reasoning the brand guide applies to hero
 * photography: a real product screen reads as more credible than a
 * facsimile.
 *
 * `showNotch` is for a screenshot that already has its own OS status bar and
 * Dynamic Island baked into its pixels (a real iOS Simulator capture) — the
 * frame then leaves that area alone rather than drawing a second island on
 * top of it. Screens cropped to start at the app's own header (no OS chrome
 * in the image, e.g. an Android capture) should leave it off (the default);
 * the frame then draws its own iOS-style status bar and Dynamic Island above
 * the screenshot instead, so every product page reads as one consistent,
 * real iPhone regardless of which device the capture came from.
 *
 * Every screenshot this frame has ever been given ends with the app's own
 * bottom tab bar flush against the image's last pixel — there's no blank
 * margin baked into any capture. A bezel that clips its inner screen at the
 * corner radius (the naive approach) then chews into that real tab bar and
 * sits the home-indicator pill directly on top of it. The fix here isn't
 * per-page: the `topSafeAreaPx`/`bottomSafeAreaPx` blank strips absorb the
 * corner rounding on both edges so the rounding only ever eats into blank
 * fill, and the home indicator lives inside the bottom strip instead of
 * overlapping content.
 */
const SCREEN_BG = "#ffffff";
// Every size below is a fraction of frameWidth (never a bare px value) so a
// page that passes a non-default frameWidth still gets a proportional
// bezel, status bar, Dynamic Island, and safe areas — not just a scaled
// screenshot inside fixed-size chrome.
const DEFAULT_FRAME_WIDTH = 280;

export function PhoneMockup({
  src,
  alt,
  width,
  height,
  className,
  frameWidth = DEFAULT_FRAME_WIDTH,
  showNotch = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  frameWidth?: number;
  showNotch?: boolean;
}) {
  const bezel = frameWidth * 0.032; // slim titanium rail, not a thick 2018-era bezel
  const outerRadius = frameWidth * 0.205;
  const innerRadius = frameWidth * 0.175;
  const topSafeAreaPx = frameWidth * 0.03;
  const bottomSafeAreaPx = frameWidth * 0.095;
  // The synthetic status bar and Dynamic Island were tuned by eye at
  // DEFAULT_FRAME_WIDTH; this scale factor keeps them proportional (instead
  // of pinned at that original px size) whenever a caller passes some other
  // frameWidth, matching every other measurement in this component.
  const chromeScale = frameWidth / DEFAULT_FRAME_WIDTH;

  return (
    <div className={className}>
      <div
        className="relative mx-auto shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14),inset_0_1.5px_1px_rgba(255,255,255,0.28),0_36px_64px_-28px_rgba(18,50,75,0.45),0_10px_20px_-12px_rgba(18,50,75,0.3)]"
        style={{
          width: frameWidth,
          padding: bezel,
          borderRadius: outerRadius,
          background:
            "linear-gradient(155deg, #57585b 0%, #3a3b3e 14%, #232326 40%, #131315 72%, #0a0a0b 100%)",
        }}
      >
        {/* physical buttons, protruding from the titanium rail — action
            button + volume rocker on the left, side button + Camera Control
            on the right, matching the current Pro-line silhouette */}
        <span
          aria-hidden
          className="absolute -left-[3px] top-[8%] h-[3%] w-[3px] rounded-l-[3px]"
          style={{ background: "linear-gradient(90deg, #1c1c1e, #3a3a3c)" }}
        />
        <span
          aria-hidden
          className="absolute -left-[3px] top-[16%] h-[6.5%] w-[3px] rounded-l-[3px]"
          style={{ background: "linear-gradient(90deg, #1c1c1e, #3a3a3c)" }}
        />
        <span
          aria-hidden
          className="absolute -left-[3px] top-[24.5%] h-[6.5%] w-[3px] rounded-l-[3px]"
          style={{ background: "linear-gradient(90deg, #1c1c1e, #3a3a3c)" }}
        />
        <span
          aria-hidden
          className="absolute -right-[3px] top-[15%] h-[9%] w-[3px] rounded-r-[3px]"
          style={{ background: "linear-gradient(270deg, #1c1c1e, #3a3a3c)" }}
        />
        <span
          aria-hidden
          className="absolute -right-[3.5px] top-[27%] h-[7.5%] w-[4px] rounded-r-[4px]"
          style={{ background: "linear-gradient(270deg, #232326, #4a4a4d)" }}
        />

        <div
          className="relative w-full overflow-hidden"
          style={{ borderRadius: innerRadius, backgroundColor: SCREEN_BG }}
        >
          {showNotch ? (
            <div style={{ height: topSafeAreaPx, backgroundColor: SCREEN_BG }} />
          ) : (
            <div
              className="relative flex items-center justify-between bg-[#fafafa]"
              style={{
                height: 46 * chromeScale,
                paddingLeft: 26 * chromeScale,
                paddingRight: 26 * chromeScale,
              }}
            >
              <span
                className="font-heading font-bold tracking-tight text-[#0a0a0a]"
                style={{ fontSize: `${0.86 * chromeScale}rem` }}
              >
                9:41
              </span>
              <span className="flex items-center gap-[5px]">
                <svg width="17" height="11" viewBox="0 0 17 11" fill="none" aria-hidden>
                  <rect x="0" y="6" width="3" height="5" rx="0.8" fill="#0a0a0a" />
                  <rect x="4.5" y="4" width="3" height="7" rx="0.8" fill="#0a0a0a" />
                  <rect x="9" y="2" width="3" height="9" rx="0.8" fill="#0a0a0a" />
                  <rect x="13.5" y="0" width="3" height="11" rx="0.8" fill="#0a0a0a" />
                </svg>
                <svg width="15" height="11" viewBox="0 0 15 11" fill="none" aria-hidden>
                  <path d="M7.5 9.6c.5 0 .9.4.9.9s-.4.9-.9.9-.9-.4-.9-.9.4-.9.9-.9Z" fill="#0a0a0a" />
                  <path d="M4.4 7.2a4.4 4.4 0 0 1 6.2 0l-1.3 1.3a2.5 2.5 0 0 0-3.6 0z" fill="#0a0a0a" />
                  <path d="M1.6 4.4a8.3 8.3 0 0 1 11.8 0l-1.3 1.3a6.4 6.4 0 0 0-9.2 0z" fill="#0a0a0a" />
                </svg>
                <svg width="25" height="12" viewBox="0 0 25 12" fill="none" aria-hidden>
                  <rect x="0.75" y="0.75" width="19.5" height="10.5" rx="2.75" stroke="#0a0a0a" strokeWidth="1" />
                  <rect x="2.5" y="2.5" width="16" height="7" rx="1.5" fill="#0a0a0a" />
                  <rect x="21" y="4" width="1.6" height="4" rx="0.8" fill="#0a0a0a" />
                </svg>
              </span>
            </div>
          )}

          <div
            className="w-full overflow-hidden"
            style={{ aspectRatio: `${width} / ${height}` }}
          >
            <Image
              src={src}
              alt={alt}
              width={width}
              height={height}
              className="h-full w-full object-cover object-top"
              sizes={`${frameWidth}px`}
            />
          </div>

          {/* Blank safe-area strip: the app's own tab bar ends flush with
              the screenshot's last pixel, so this is what the bottom corner
              radius (and the home-indicator pill below) actually clips into
              — never the real "Home / Vitals / Meds" row itself. */}
          <div style={{ height: bottomSafeAreaPx, backgroundColor: SCREEN_BG }} />

          {!showNotch && (
            <div
              aria-hidden
              className="absolute left-1/2 -translate-x-1/2 bg-black"
              style={{
                top: 12 * chromeScale,
                height: 28 * chromeScale,
                width: 96 * chromeScale,
                borderRadius: 16 * chromeScale,
              }}
            />
          )}

          <div
            aria-hidden
            className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black/35"
            style={{
              bottom: bottomSafeAreaPx * 0.32,
              height: 5 * chromeScale,
              width: 126 * chromeScale,
            }}
          />
        </div>
      </div>
    </div>
  );
}
