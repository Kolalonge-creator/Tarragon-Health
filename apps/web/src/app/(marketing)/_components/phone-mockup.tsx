import Image from "next/image";

/**
 * Realistic iPhone bezel, factored out of app-dashboard-mockup.tsx so every
 * product page can drop in its own real screen (captured from the Expo app
 * or the iOS Simulator against a live QA account) instead of a stylised
 * illustration — same reasoning the brand guide applies to hero photography:
 * a real product screen reads as more credible than a facsimile.
 *
 * `showNotch` is for a screenshot that already has its own OS status bar and
 * Dynamic Island baked into its pixels (a real iOS Simulator capture) — the
 * frame then only overlays a matching Dynamic Island shape to blend it into
 * the bezel's rounded top corner. Screens cropped to start at the app's own
 * header (no OS chrome in the image, e.g. an Android capture) should leave
 * it off (the default); the frame then draws its own iOS-style status bar
 * above the screenshot instead, so every product page reads as one
 * consistent, real iPhone regardless of which device the capture came from.
 */
export function PhoneMockup({
  src,
  alt,
  width,
  height,
  className,
  frameWidth = 280,
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
  return (
    <div className={className}>
      <div
        className="relative mx-auto rounded-[54px] p-[12px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14),inset_0_1.5px_1px_rgba(255,255,255,0.28),0_36px_64px_-28px_rgba(18,50,75,0.45),0_10px_20px_-12px_rgba(18,50,75,0.3)]"
        style={{
          width: frameWidth,
          background:
            "linear-gradient(155deg, #57585b 0%, #3a3b3e 14%, #232326 40%, #131315 72%, #0a0a0b 100%)",
        }}
      >
        {/* physical buttons, protruding from the titanium rail */}
        <span
          aria-hidden
          className="absolute -left-[3px] top-[11%] h-[4%] w-[3px] rounded-l-[3px]"
          style={{ background: "linear-gradient(90deg, #1c1c1e, #3a3a3c)" }}
        />
        <span
          aria-hidden
          className="absolute -left-[3px] top-[17%] h-[7%] w-[3px] rounded-l-[3px]"
          style={{ background: "linear-gradient(90deg, #1c1c1e, #3a3a3c)" }}
        />
        <span
          aria-hidden
          className="absolute -left-[3px] top-[26%] h-[7%] w-[3px] rounded-l-[3px]"
          style={{ background: "linear-gradient(90deg, #1c1c1e, #3a3a3c)" }}
        />
        <span
          aria-hidden
          className="absolute -right-[3px] top-[20%] h-[11%] w-[3px] rounded-r-[3px]"
          style={{ background: "linear-gradient(270deg, #1c1c1e, #3a3a3c)" }}
        />

        <div className="relative w-full overflow-hidden rounded-[42px] bg-warm-ivory">
          {showNotch ? null : (
            <div className="relative flex h-[46px] items-center justify-between bg-[#fafafa] px-[26px]">
              <span className="font-heading text-[0.86rem] font-bold tracking-tight text-[#0a0a0a]">
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

          <div
            aria-hidden
            className="absolute left-1/2 top-[12px] h-[28px] w-[96px] -translate-x-1/2 rounded-[16px] bg-black"
          />

          <div
            aria-hidden
            className="absolute bottom-[9px] left-1/2 h-[5px] w-[126px] -translate-x-1/2 rounded-full bg-black/35"
          />
        </div>
      </div>
    </div>
  );
}
