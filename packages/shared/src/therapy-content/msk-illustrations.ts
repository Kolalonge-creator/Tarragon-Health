/**
 * S96: simple original line drawings for the MSK exercises. Drawn for this project from plain shapes; no third-party image, font or file.
 *
 * Each drawing is DATA (lines, circles and arrows on a 120 by 80 grid), not a file, so:
 *  - it is bundled with the app code and works offline with nothing to download or cache separately;
 *  - the web renders it as inline SVG and the phone renders the same shapes with react-native-svg, so the two cannot differ;
 *  - the colours are chosen by the screen (body = text colour, move = accent), so light and dark mode both stay readable.
 * `renderMskSvg` returns the markup as a string (used by the web and by the tests); `mskShapesForNative` returns the shapes.
 * A drawing is a stick figure with the movement shown by an arrow. Every drawing has alt text written for a person who cannot see it.
 */

export type Pt = readonly [number, number];
export type MskShape =
  | { readonly t: "c"; readonly role: "body"; readonly x: number; readonly y: number; readonly r: number }
  | { readonly t: "l"; readonly role: "body" | "prop"; readonly p: readonly Pt[] }
  | { readonly t: "a"; readonly role: "move"; readonly p: readonly Pt[] };

export const MSK_VIEWBOX = { width: 120, height: 80 } as const;

const head = (x: number, y: number, r = 6): MskShape => ({ t: "c", role: "body", x, y, r });
const body = (...p: Pt[]): MskShape => ({ t: "l", role: "body", p });
const prop = (...p: Pt[]): MskShape => ({ t: "l", role: "prop", p });
const move = (...p: Pt[]): MskShape => ({ t: "a", role: "move", p });
const ground = (y: number): MskShape => prop([4, y], [116, y]);

/** Lying on the back, head on the left, knees bent. */
const lyingKneesBent: MskShape[] = [
  ground(72),
  head(14, 66),
  body([21, 69], [62, 69]),
  body([62, 69], [78, 52], [90, 69], [97, 69]),
  body([26, 66], [46, 66]),
];

/** Hands and knees, facing left. */
const fourPoint: MskShape[] = [
  ground(72),
  head(20, 32),
  body([27, 36], [57, 34], [84, 40]),
  body([30, 37], [30, 72]),
  body([84, 40], [84, 72], [104, 72]),
];

const standing = (x = 60): MskShape[] => [
  ground(78),
  head(x, 12),
  body([x, 18], [x, 46]),
  body([x, 24], [x - 4, 35], [x - 2, 43]),
  body([x, 46], [x, 62], [x, 77], [x + 7, 77]),
];

export const MSK_DRAWINGS: Readonly<Record<string, readonly MskShape[]>> = {
  knee_rock: [...lyingKneesBent, move([66, 40], [90, 40]), move([90, 40], [66, 40])],
  pelvic_tilt: [...lyingKneesBent, move([46, 58], [46, 66])],
  cat_camel: [
    ground(72),
    head(20, 36),
    body([27, 40], [45, 28], [66, 28], [84, 42]),
    body([30, 41], [30, 72]),
    body([84, 42], [84, 72], [104, 72]),
    move([56, 18], [56, 10]),
    move([56, 52], [56, 60]),
  ],
  bridge: [
    ground(72),
    head(12, 66),
    body([19, 69], [62, 50]),
    body([62, 50], [80, 46], [92, 69], [99, 69]),
    move([62, 38], [62, 26]),
  ],
  bird_dog: [
    ground(72),
    head(20, 32),
    body([27, 36], [57, 34], [84, 40]),
    body([30, 37], [30, 72]),
    body([84, 40], [84, 72]),
    body([27, 36], [6, 34]),
    body([84, 40], [108, 38]),
    move([112, 30], [112, 20]),
  ],
  sit_to_stand: [
    ground(78),
    prop([38, 50], [80, 50]),
    prop([38, 50], [38, 30]),
    prop([40, 50], [40, 78]),
    prop([78, 50], [78, 78]),
    head(52, 14),
    body([52, 20], [52, 46]),
    body([52, 46], [72, 46], [72, 77]),
    body([52, 26], [64, 36]),
    move([98, 62], [98, 34]),
  ],
  walk: [
    ground(78),
    head(48, 12),
    body([48, 18], [48, 46]),
    body([48, 24], [40, 36]),
    body([48, 24], [56, 36]),
    body([48, 46], [58, 62], [56, 77]),
    body([48, 46], [38, 62], [30, 77]),
    move([76, 40], [104, 40]),
  ],
  chin_tuck: [
    head(54, 24, 10),
    body([54, 34], [54, 46]),
    body([54, 46], [54, 78]),
    body([34, 48], [74, 48]),
    move([92, 24], [72, 24]),
  ],
  neck_turn: [
    head(60, 22, 10),
    body([60, 32], [60, 46]),
    body([36, 48], [84, 48]),
    body([60, 48], [60, 78]),
    body([60, 22], [60, 28]),
    move([44, 20], [26, 20]),
    move([76, 20], [94, 20]),
  ],
  neck_side_tilt: [
    head(68, 24, 10),
    body([66, 34], [60, 46]),
    body([36, 48], [84, 48]),
    body([60, 48], [60, 78]),
    move([96, 12], [100, 26]),
  ],
  shoulder_roll: [
    head(60, 18, 9),
    body([60, 27], [60, 46]),
    body([34, 38], [86, 38]),
    body([60, 46], [60, 78]),
    move([24, 28], [24, 40]),
    move([96, 40], [96, 28]),
  ],
  blade_squeeze: [
    head(60, 16, 9),
    body([60, 25], [60, 62]),
    body([36, 34], [84, 34]),
    body([36, 34], [26, 48], [38, 54]),
    body([84, 34], [94, 48], [82, 54]),
    move([22, 56], [34, 56]),
    move([98, 56], [86, 56]),
  ],
  neck_press: [
    head(48, 24, 10),
    body([48, 34], [48, 46]),
    body([48, 46], [48, 78]),
    body([30, 48], [66, 48]),
    body([76, 28], [78, 44], [62, 52]),
    body([76, 28], [60, 22]),
    move([92, 24], [76, 24]),
  ],
  heel_slide: [
    ground(72),
    head(14, 66),
    body([21, 69], [62, 69]),
    body([62, 69], [100, 69]),
    body([62, 69], [76, 54], [88, 69]),
    move([90, 62], [104, 62]),
  ],
  quad_set: [
    ground(72),
    head(14, 66),
    body([21, 69], [62, 69]),
    body([62, 69], [104, 69]),
    { t: "c", role: "body", x: 84, y: 66, r: 3 },
    move([84, 48], [84, 58]),
  ],
  straight_leg_raise: [
    ground(72),
    head(14, 66),
    body([21, 69], [62, 69]),
    body([62, 69], [78, 52], [88, 69]),
    body([62, 69], [102, 50]),
    move([106, 62], [106, 40]),
  ],
  mini_squat: [
    ground(78),
    prop([36, 6], [36, 78]),
    head(44, 12),
    body([42, 18], [42, 44]),
    body([42, 44], [62, 54], [58, 77], [66, 77]),
    body([42, 24], [52, 34]),
    move([90, 40], [90, 58]),
  ],
  step_up: [
    ground(78),
    prop([66, 62], [100, 62]),
    prop([66, 62], [66, 78]),
    prop([100, 62], [100, 78]),
    head(48, 12),
    body([48, 18], [48, 44]),
    body([48, 44], [70, 52], [76, 61]),
    body([48, 44], [48, 60], [48, 77]),
    body([48, 24], [44, 36]),
    move([110, 54], [110, 36]),
  ],
  calf_raise: [
    ground(78),
    prop([30, 20], [30, 78]),
    head(52, 12),
    body([52, 18], [52, 46]),
    body([52, 46], [52, 70], [58, 74], [62, 70]),
    body([52, 26], [34, 30]),
    move([76, 66], [76, 50]),
  ],
  clamshell: [
    ground(74),
    head(12, 56),
    body([19, 60], [58, 62]),
    body([58, 62], [82, 58], [64, 68]),
    body([58, 60], [84, 44], [66, 62]),
    move([92, 52], [92, 36]),
  ],
  hip_abduction_standing: [
    ground(78),
    prop([22, 36], [22, 78]),
    prop([14, 36], [34, 36]),
    head(60, 12),
    body([60, 18], [60, 44]),
    body([60, 24], [40, 34]),
    body([60, 44], [60, 62], [60, 77], [67, 77]),
    body([60, 44], [78, 62], [84, 74]),
    move([92, 56], [106, 66]),
  ],
  marching: [
    ...standing(50),
    body([50, 46], [70, 48], [70, 62]),
    move([90, 62], [90, 44]),
  ],
};

export const MSK_DRAWING_ALT: Readonly<Record<string, string>> = {
  knee_rock: "Side view of a person lying on their back with knees bent and feet flat. Arrows show the knees rocking gently from side to side.",
  pelvic_tilt: "Side view of a person lying on their back with knees bent. An arrow shows the lower back pressing gently down towards the floor.",
  cat_camel: "Side view of a person on hands and knees. One arrow shows the back arching up, another shows it sagging gently down.",
  bridge: "Side view of a person lying on their back with knees bent and hips lifted so the body makes a straight slope from shoulders to knees. An arrow points up at the hips.",
  bird_dog: "Side view of a person on hands and knees with one arm stretched forward and the opposite leg stretched back, back kept flat.",
  sit_to_stand: "Side view of a person sitting on a chair with an arrow beside them pointing up to show standing up.",
  walk: "Side view of a person walking, with an arrow pointing forward.",
  chin_tuck: "Side view of the head and shoulders. An arrow shows the chin gliding straight back, as if making a double chin, with the head level.",
  neck_turn: "Front view of the head and shoulders. Arrows point left and right to show turning the head gently to each side.",
  neck_side_tilt: "Front view of the head and shoulders with the head tilted a little to one side and an arrow showing the ear moving towards the shoulder.",
  shoulder_roll: "Front view of the shoulders. Arrows show the shoulders lifting up and rolling back and down.",
  blade_squeeze: "Back view of a person with elbows bent. Arrows point in towards the spine to show the shoulder blades squeezing together.",
  neck_press: "Side view of a person with a hand on their forehead. An arrow shows the head pressing gently against the hand without moving.",
  heel_slide: "Side view of a person lying on their back. One leg is straight, the other knee is bent, and an arrow shows the heel sliding away along the floor.",
  quad_set: "Side view of a person lying on their back with a small rolled towel under one knee and an arrow showing the knee pressing down onto it.",
  straight_leg_raise: "Side view of a person lying on their back, one knee bent with the foot flat, the other leg straight and lifted off the floor. An arrow points up.",
  mini_squat: "Side view of a person with their back against a wall, knees slightly bent, and an arrow pointing down to show lowering a little way.",
  step_up: "Side view of a person stepping one foot up onto a low step, with an arrow pointing up.",
  calf_raise: "Side view of a person standing with a hand on a wall, heels lifted off the floor, and an arrow pointing up.",
  clamshell: "Side view of a person lying on their side with knees bent and feet together. An arrow shows the top knee lifting away like a clam opening.",
  hip_abduction_standing: "Front view of a person standing and holding a chair back, with one leg moving out to the side. An arrow points outwards.",
  marching: "Side view of a person standing and lifting one knee in front, with an arrow pointing up.",
};

const round = (n: number): number => Math.round(n * 10) / 10;

/** Two short strokes forming the head of an arrow at the last point of a path. */
export function arrowHead(p: readonly Pt[]): readonly [Pt, Pt, Pt] | null {
  if (p.length < 2) return null;
  const [x1, y1] = p[p.length - 2] as Pt;
  const [x2, y2] = p[p.length - 1] as Pt;
  const a = Math.atan2(y2 - y1, x2 - x1);
  const len = 5;
  const spread = Math.PI / 6;
  return [
    [round(x2 - len * Math.cos(a - spread)), round(y2 - len * Math.sin(a - spread))],
    [x2, y2],
    [round(x2 - len * Math.cos(a + spread)), round(y2 - len * Math.sin(a + spread))],
  ];
}

const points = (p: readonly Pt[]): string => p.map(([x, y]) => `${x},${y}`).join(" ");

export interface MskSvgColours {
  readonly body: string;
  readonly prop: string;
  readonly move: string;
}

export const MSK_DEFAULT_COLOURS: MskSvgColours = { body: "currentColor", prop: "currentColor", move: "#0E7C52" };

/** The shapes a native screen draws. Unknown key returns an empty list (the screen then shows the text steps only). */
export function mskShapesForNative(key: string): readonly MskShape[] {
  return MSK_DRAWINGS[key] ?? [];
}

/** SVG markup for one drawing, or null for an unknown key. Decorative to a screen reader when `labelled` is false. */
export function renderMskSvg(key: string, colours: MskSvgColours = MSK_DEFAULT_COLOURS): string | null {
  const shapes = MSK_DRAWINGS[key];
  if (!shapes) return null;
  const alt = MSK_DRAWING_ALT[key] ?? "";
  const parts: string[] = [];
  for (const s of shapes) {
    if (s.t === "c") {
      parts.push(`<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="none" stroke="${colours.body}" stroke-width="2.5"/>`);
    } else if (s.t === "l") {
      const c = s.role === "prop" ? colours.prop : colours.body;
      const w = s.role === "prop" ? 1.5 : 2.5;
      parts.push(`<polyline points="${points(s.p)}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${s.role === "prop" ? ' opacity="0.55"' : ""}/>`);
    } else {
      parts.push(`<polyline points="${points(s.p)}" fill="none" stroke="${colours.move}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`);
      const h = arrowHead(s.p);
      if (h) parts.push(`<polyline points="${points(h)}" fill="none" stroke="${colours.move}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  }
  const escaped = alt.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MSK_VIEWBOX.width} ${MSK_VIEWBOX.height}" role="img" aria-label="${escaped}"><title>${escaped}</title>${parts.join("")}</svg>`;
}
