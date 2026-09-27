/**
 * Design tokens. Defined once here; everything else is generated from them:
 * the fixed palette, the four themes with their roles, the spacing and type
 * scales, and the choices of face and texture. Change a value here and
 * rebuild. Anything marked "to try" is a candidate, not a decision.
 */

/** Fixed palette: never changes with the theme. Structural elements use these. */
export const neutrals = {
  black: "#060606",
  darkest: "#1d1d1d",
  darker: "#282828",
  dark: "#4a4a4a",
  medium: "#d1d5db",
  light: "#e5e7eb",
  /** The brightest text and elements. */
  white: "#e0e0e0",
};

export const semantic = {
  success: "#22c55e",
  warning: "#fad400",
  danger: "#ef4444",
  info: "#06b6d4",
};

/** Roles every theme must define. Accents and highlights use these. */
export const themeRoles = ["primary", "secondary", "accent", "muted", "surface", "surface-anti", "primary-dark"];

export const themes = {
  amber: {
    label: "Amber",
    primary: "#fdc04c",
    secondary: "#ffdb8c",
    accent: "#e6a532",
    muted: "#ffe5a3",
    surface: "#24d6c7",
    "surface-anti": "#072c29",
    "primary-dark": "#b8941a",
  },
  blue: {
    label: "Blue",
    primary: "#2ba5ea",
    secondary: "#5bb8ed",
    accent: "#1f7bb8",
    muted: "#8dcbf0",
    surface: "#22344e",
    "surface-anti": "#e7f7d2",
    "primary-dark": "#1a5c86",
  },
  red: {
    label: "Red",
    primary: "#e63946",
    secondary: "#fe5252",
    accent: "#ff2222",
    muted: "#ff8888",
    surface: "#757575",
    "surface-anti": "#f3cbb7",
    "primary-dark": "#990000",
  },
  green: {
    label: "Green",
    primary: "#7eb141",
    secondary: "#9bc966",
    accent: "#5a8030",
    muted: "#b4d48a",
    surface: "#988469",
    "surface-anti": "#eaf3e5",
    "primary-dark": "#3e5a22",
  },
};

/** Spacing steps in px. Step n is 4n. */
export const spacing = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 10: 40, 12: 48 };

/** Type scale in rem. */
export const text = { xxs: 0.625, xs: 0.75, sm: 0.875, base: 1, lg: 1.125, xl: 1.25, "2xl": 1.5, "3xl": 1.875, "4xl": 2.25 };

export const weights = { lightest: 200, light: 300, normal: 400, semibold: 600, bold: 700, extrabold: 800 };

export const radius = { sm: 2, base: 4, md: 6, lg: 8, full: 999 };

export const shadow = {
  sm: "0 1px 2px 0 rgb(0 0 0 / 0.4)",
  md: "0 4px 8px 0 rgb(0 0 0 / 0.45)",
  lg: "0 8px 24px 0 rgb(0 0 0 / 0.55)",
  /** A recessed field, for inputs and tracks. */
  "sm-inset": "inset 0 1px 2px 0 rgb(0 0 0 / 0.38)",
  "md-inset": "inset 0 2px 5px 0 rgb(0 0 0 / 0.45)",
};

export const motion = { fast: "0.08s", base: "0.15s", slide: "0.26s", step: "0.035s" };

export const font = {
  /** The face used until another is chosen. */
  family: '"Exo 2 Variable", "Exo 2", system-ui, sans-serif',
  rootPx: 15,
};

/**
 * Textures to try. Each is a set of shapes for the same parts, so the screen
 * can change what it is made of without changing how it is laid out: the
 * heading, the button, the stain inside a card, the title in the corner,
 * the ground under everything, the chip (a small mark), and the burst that
 * flies off a button. ground is how strongly the ground shows, in percent;
 * reach is how far a button's shape runs out past the button, in px.
 *
 * A part is named three ways. A plain name is a shape that stretches to fit.
 * { ends } is a bar that must not stretch: its two ends are drawn at a fixed
 * size with solid between them, the way a nine-patch works. The size is
 * --bar, the height of the bar, set by whatever uses it. { end } is the
 * same with one end, at the right. Textures to try, not decisions.
 */
export const textures = {
  paint: {
    label: "Paint",
    note: "thrown and brushed",
    ground: 5,
    reach: 9,
    parts: {
      head: ["stroke-c", "stroke-a", "stroke-b"],
      button: ["dab-a", "dab-b", "dab-c", "dab-d"],
      stain: ["splatter-a", "splatter-b", "splatter-c"],
      title: ["scatter-a"],
      ground: ["ground-a"],
      chip: ["splat-a", "splat-b"],
      burst: ["splat-b"],
    },
  },
  metal: {
    label: "Metal",
    note: "plate, brushed and worn",
    ground: 6,
    reach: 6,
    parts: {
      head: ["metal-head-a", "metal-head-b", "metal-head-c"],
      button: ["metal-button-a", "metal-button-b", "metal-button-c", "metal-button-d"],
      stain: ["metal-stain-a", "metal-stain-b", "metal-stain-c"],
      title: ["metal-title-a"],
      ground: ["metal-ground-a"],
      chip: ["metal-chip-a", "metal-chip-b"],
      burst: ["metal-burst-a"],
    },
  },
  hex: {
    label: "Hex",
    note: "plating that comes apart into cells",
    ground: 4,
    reach: 30,
    parts: {
      head: [{ ends: "hex-head-a" }, { ends: "hex-head-b" }, { ends: "hex-head-c" }],
      button: [{ ends: "hex-button-a" }, { ends: "hex-button-b" }, { ends: "hex-button-c" }, { ends: "hex-button-d" }],
      stain: ["hex-stain-a", "hex-stain-b", "hex-stain-c"],
      title: [{ end: "hex-title-a" }],
      ground: ["hex-ground-a"],
      chip: ["hex-chip-a", "hex-chip-b"],
      burst: ["hex-burst-a"],
    },
  },
};

/**
 * Faces to try, side by side. The first is the one used until another is
 * chosen. All are open fonts, bundled with the app, so nothing is fetched.
 */
export const fonts = {
  "exo-2": { label: "Exo 2", family: font.family, note: "rounded, technical" },
  rajdhani: { label: "Rajdhani", family: '"Rajdhani", system-ui, sans-serif', note: "squared, narrow, technical" },
  "chakra-petch": { label: "Chakra Petch", family: '"Chakra Petch", system-ui, sans-serif', note: "cut corners, machined" },
  saira: { label: "Saira", family: '"Saira Variable", "Saira", system-ui, sans-serif', note: "wide, sporting" },
  barlow: { label: "Barlow", family: '"Barlow", system-ui, sans-serif', note: "plain, signage" },
};

/**
 * Style-mode axes: each axis changes one property of every panel.
 */
export const styleAxes = {
  depth: { none: "none", subtle: shadow.sm, strong: shadow.lg },
  radius: { none: "0px", subtle: `${radius.base}px`, rounded: `${radius.lg}px` },
  texture: { on: "1", off: "0" },
};

export const styleAxisDefaults = { depth: "subtle", radius: "subtle", texture: "on" };

/**
 * The mask library: painted shapes, made by masks/make.py and kept in
 * src/masks. An image carries only the shape; the colour is given where it
 * is used, as the colour behind a mask.
 */
export const masks = {
  path: "/masks",
  names: ["stroke-a", "stroke-b", "stroke-c", "swipe-a", "block-a", "splat-a", "splat-b", "splatter-a", "splatter-b", "splatter-c", "ground-a", "grain-a", "dab-a", "dab-b", "dab-c", "dab-d", "scatter-a", "spray-a", "metal-head-a", "metal-head-b", "metal-head-c", "metal-button-a", "metal-button-b", "metal-button-c", "metal-button-d", "metal-stain-a", "metal-stain-b", "metal-stain-c", "metal-title-a", "metal-ground-a", "metal-chip-a", "metal-chip-b", "metal-burst-a", "hex-head-a", "hex-head-b", "hex-head-c", "hex-button-a", "hex-button-b", "hex-button-c", "hex-button-d", "hex-stain-a", "hex-stain-b", "hex-stain-c", "hex-title-a", "hex-ground-a", "hex-chip-a", "hex-chip-b", "hex-burst-a", "hex-head-a-r", "hex-head-b-r", "hex-head-c-r", "hex-button-a-r", "hex-button-b-r", "hex-button-c-r", "hex-button-d-r"],
};

/**
 * Transforms, as utility classes. A leading "n" is a negative value:
 * skew-x-n14 is skewX(-14deg).
 */
export const transforms = {
  skewX: [-20, -14, -8, 8, 14, 20],
  rotate: [-90, -45, 45, 90, 180],
  scale: [92, 95, 105, 110],
  tiltX: [-12, -6, 6, 12],
  tiltY: [-12, -6, 6, 12],
  perspective: [400, 800, 1200],
};
