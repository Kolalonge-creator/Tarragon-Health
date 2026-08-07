/**
 * Types for `heic-convert`, which ships none.
 *
 * Narrowed to the single call shape lib/lab-reports/heic.ts uses. Declaring
 * only what is used keeps this honest: if a future caller needs the library's
 * `all()` multi-image form, the compiler will say so rather than silently
 * accepting `any` — which is what the alternative (a bare `declare module`)
 * would have done, and which the project's no-`any` rule exists to prevent.
 */
declare module "heic-convert" {
  interface HeicConvertOptions {
    buffer: Buffer | Uint8Array;
    format: "JPEG" | "PNG";
    /** 0 to 1. Only meaningful for JPEG. */
    quality?: number;
  }

  function heicConvert(options: HeicConvertOptions): Promise<ArrayBuffer>;

  export default heicConvert;
}
