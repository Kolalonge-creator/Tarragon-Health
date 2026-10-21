# LSI-1 research note

- Image tooling: no satori, sharp, canvas or resvg dependency exists in the repo, but `next/og` (satori + resvg, bundled in Next 16) is available in Node route handlers; verified by rendering a PNG with Noto Sans (diacritics and the naira sign print) and checking that `headers` overrides the default cache header. The 500KB bundle limit in the docs is for the edge runtime; these routes run on Node.
- Phone lock screens: the clock and widgets occupy the top third, the flashlight and camera the bottom; the picture keeps both empty. 1170 x 2532 is a common modern phone size; phones crop or scale a wallpaper to fit.
- Mobile saving: the app already has `expo-web-browser` and a bearer-token query pattern for PDFs; the system browser lets the person press and hold an image to save it. Saving into the photo library programmatically needs a media-library native module and a permission, so it was not added.
- `lock_screen_opt_in` already existed (S43) with the shared-phone warning and did nothing; it is now the gate.
- The token travels as a query parameter on the mobile URL, as the existing PDF route does: it is the short-lived access token, never a separate credential (OQ-LSI-1-3).
