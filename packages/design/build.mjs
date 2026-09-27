/**
 * Generates dist/index.css and dist/tokens.json from src/tokens.mjs plus the
 * hand-written base and component styles. No dependencies.
 *
 * The cascade order: element defaults, utility classes, fixed palette,
 * components, then themes.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as t from "./src/tokens.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");
mkdirSync(out, { recursive: true });

const lines = [];
const emit = (s = "") => lines.push(s);
const section = (name) => emit(`\n/* === ${name} === */`);
// A picture's address carries a mark of what is in it. A browser keeps a
// picture by its address, so a picture that has changed needs a new one.
const picture = (name) => {
  const mark = createHash("sha1").update(readFileSync(join(here, "src", "masks", `${name}.png`))).digest("hex").slice(0, 8);
  return `url("${t.masks.path}/${name}.png?v=${mark}")`;
};
const marked = (css) => css.replace(/url\("\/masks\/([a-z0-9-]+)\.png"\)/g, (_, name) => picture(name));
const alpha = (value, pct) => `color-mix(in srgb, ${value} ${pct}%, transparent)`;

// --------------------------------------------------------------- tokens
section("Tokens");
emit(":root {");
for (const [k, v] of Object.entries({ ...t.neutrals, ...t.semantic })) emit(`  --${k}: ${v};`);
for (const [k, v] of Object.entries(t.spacing)) emit(`  --space-${k}: ${v}px;`);
for (const [k, v] of Object.entries(t.text)) emit(`  --text-${k}: ${v}rem;`);
for (const [k, v] of Object.entries(t.radius)) emit(`  --radius-${k}: ${v}px;`);
for (const [k, v] of Object.entries(t.shadow)) emit(`  --shadow-${k}: ${v};`);
for (const [k, v] of Object.entries(t.motion)) emit(`  --motion-${k}: ${v};`);
emit(`  --font-family: ${t.font.family};`);
emit("}");

// ----------------------------------------------------------------- base
emit(readFileSync(join(here, "src", "base.css"), "utf8").replace("__ROOT_PX__", String(t.font.rootPx)));

// ------------------------------------------------------------ utilities
section("Utilities: layout");
const layout = {
  block: "display: block",
  inline: "display: inline",
  "inline-block": "display: inline-block",
  flex: "display: flex",
  "inline-flex": "display: inline-flex",
  grid: "display: grid",
  hidden: "display: none",
  relative: "position: relative",
  absolute: "position: absolute",
  fixed: "position: fixed",
  "flex-row": "flex-direction: row",
  "flex-col": "flex-direction: column",
  "flex-wrap": "flex-wrap: wrap",
  "flex-grow": "flex-grow: 1",
  "flex-shrink": "flex-shrink: 1",
  "flex-auto": "flex: 1 1 auto",
  "items-start": "align-items: flex-start",
  "items-center": "align-items: center",
  "items-end": "align-items: flex-end",
  "items-baseline": "align-items: baseline",
  "justify-start": "justify-content: flex-start",
  "justify-center": "justify-content: center",
  "justify-end": "justify-content: flex-end",
  "justify-between": "justify-content: space-between",
  "justify-around": "justify-content: space-around",
  "justify-evenly": "justify-content: space-evenly",
  "w-full": "width: 100%",
  "h-full": "height: 100%",
  "min-w-0": "min-width: 0",
  clip: "overflow: hidden",
  "cursor-pointer": "cursor: pointer",
  "cursor-default": "cursor: default",
};
for (const [k, v] of Object.entries(layout)) emit(`.${k} { ${v}; }`);

section("Utilities: spacing");
const sides = { "": [""], x: ["-left", "-right"], y: ["-top", "-bottom"], t: ["-top"], r: ["-right"], b: ["-bottom"], l: ["-left"] };
for (const [prefix, prop] of [["p", "padding"], ["m", "margin"]]) {
  for (const [side, suffixes] of Object.entries(sides)) {
    for (const k of Object.keys(t.spacing)) {
      emit(`.${prefix}${side}-${k} { ${suffixes.map((s) => `${prop}${s}: var(--space-${k})`).join("; ")}; }`);
    }
  }
}
for (const k of Object.keys(t.spacing)) emit(`.gap-${k} { gap: var(--space-${k}); }`);

section("Utilities: type");
for (const k of Object.keys(t.text)) emit(`.text-${k} { font-size: var(--text-${k}); }`);
for (const [k, v] of Object.entries(t.weights)) emit(`.font-${k} { font-weight: ${v}; }`);
emit(".font-italic { font-style: italic; }");
for (const a of ["left", "center", "right"]) emit(`.text-${a} { text-align: ${a}; }`);
emit(".text-upper { text-transform: uppercase; }");
emit(".text-none { text-transform: none; }");
emit(".tabular { font-variant-numeric: tabular-nums; }");

// No border utilities: nothing here draws an edge around anything.
section("Utilities: radius, shadow");
emit(".rounded-sm { border-radius: var(--radius-sm); }");
emit(".rounded { border-radius: var(--radius-base); }");
emit(".rounded-md { border-radius: var(--radius-md); }");
emit(".rounded-lg { border-radius: var(--radius-lg); }");
emit(".rounded-full { border-radius: var(--radius-full); }");
for (const k of Object.keys(t.shadow)) emit(`.box-shadow-${k} { box-shadow: var(--shadow-${k}); }`);

// -------------------------------------------------------------- palette
section("Palette: fixed colours");
const colourClasses = (name, value) => {
  emit(`.bg-${name} { background-color: ${value}; }`);
  emit(`.text-${name} { color: ${value}; }`);
  emit(`.bg-${name}-alpha { background-color: ${alpha(value, 50)}; }`);
  emit(`.text-${name}-alpha { color: ${alpha(value, 50)}; }`);
};
for (const k of Object.keys({ ...t.neutrals, ...t.semantic })) colourClasses(k, `var(--${k})`);
for (const k of ["black", "dark", "darkest"]) emit(`.bg-${k}-semi-alpha { background-color: ${alpha(`var(--${k})`, 73)}; }`);

// ----------------------------------------------------------- components
emit(marked(readFileSync(join(here, "src", "components.css"), "utf8")));

// --------------------------------------------------------------- themes
section("Themes: role values. The web analogue of @media (theme: x)");
for (const [id, theme] of Object.entries(t.themes)) {
  const selector = id === "amber" ? ':root, [data-theme="base"]' : `[data-theme="${id}"]`;
  emit(`${selector} {`);
  for (const role of t.themeRoles) emit(`  --${role}: ${theme[role]};`);
  emit("}");
}
section("Themes: role classes");
for (const role of t.themeRoles) colourClasses(role, `var(--${role})`);
emit(".box-shadow-glow { box-shadow: 0 0 20px color-mix(in srgb, var(--primary) 31%, transparent); }");
emit(".bg-gradient_primary-accent { background: linear-gradient(135deg, var(--primary), var(--accent)); }");
emit(".bg-gradient_primary-alpha { background: linear-gradient(135deg, var(--primary), transparent); }");

section("Utilities: transform");
const signed = (n) => (n < 0 ? `n${-n}` : String(n));
for (const n of t.transforms.skewX) emit(`.skew-x-${signed(n)} { transform: skewX(${n}deg); }`);
for (const n of t.transforms.rotate) emit(`.rotate-${signed(n)} { transform: rotate(${n}deg); }`);
for (const n of t.transforms.scale) emit(`.scale-${n} { transform: scale(${n / 100}); }`);
for (const n of t.transforms.tiltX) emit(`.tilt-x-${signed(n)} { transform: rotateX(${n}deg); }`);
for (const n of t.transforms.tiltY) emit(`.tilt-y-${signed(n)} { transform: rotateY(${n}deg); }`);
for (const n of t.transforms.perspective) emit(`.perspective-${n} { perspective: ${n}px; }`);
emit(".origin-left { transform-origin: left center; }");
emit(".origin-right { transform-origin: right center; }");
emit(".origin-top { transform-origin: center top; }");
emit(".origin-bottom { transform-origin: center bottom; }");

section("Faces to try");
for (const [id, f] of Object.entries(t.fonts)) emit(`[data-font="${id}"] { --font-family: ${f.family}; }`);

section("Ink: shapes from the mask library");
for (const name of t.masks.names) emit(`.ink-${name} { --mask: ${picture(name)}; }`);

section("Textures to try: the same parts, in a different material");
for (const [id, texture] of Object.entries(t.textures)) {
  emit(`${id === "paint" ? ":root, " : ""}[data-texture="${id}"] {`);
  emit(`  --ground-strength: ${texture.ground}%;`);
  emit(`  --reach: ${texture.reach}px;`);
  const image = picture;
  const solid = "linear-gradient(#000, #000)";
  for (const [part, shapes] of Object.entries(texture.parts)) {
    shapes.forEach((shape, i) => {
      const name = typeof shape === "string" ? shape : (shape.ends ?? shape.end);
      // The picture alone, for a use that places it itself.
      emit(`  --shape-${part}-${i + 1}: ${image(name)};`);
      // The picture as it is to be laid on.
      const laid = shape.ends
        ? `${image(name)} left center / calc(var(--bar, 40px) * 1.5) var(--bar, 40px) no-repeat, ${image(`${name}-r`)} right center / calc(var(--bar, 40px) * 1.5) var(--bar, 40px) no-repeat, ${solid} center / calc(100% - var(--bar, 40px) * 2.5) calc(var(--bar, 40px) * 0.72) no-repeat`
        : shape.end
          ? `${image(name)} right center / auto 100% no-repeat, ${solid} left center / calc(100% - var(--run, 700px)) 100% no-repeat`
          : `${image(name)} center / 100% 100% no-repeat`;
      emit(`  --mask-${part}-${i + 1}: ${laid};`);
    });
  }
  emit("}");
}
for (const [part, names] of Object.entries(t.textures.paint.parts)) {
  names.forEach((_, i) => emit(`.ink-${part}-${i + 1} { --mask: var(--shape-${part}-${i + 1}); --laid: var(--mask-${part}-${i + 1}); }`));
}

section("Style-mode axes");
for (const [axis, values] of Object.entries(t.styleAxes)) {
  for (const [name, value] of Object.entries(values)) {
    const isDefault = t.styleAxisDefaults[axis] === name;
    emit(`${isDefault ? ":root, " : ""}.${axis}-${name} { --panel-${axis}: ${value}; }`);
  }
}

const css = `/* Generated by packages/design/build.mjs. Edit src/tokens.mjs, src/base.css or src/components.css. */\n${lines.join("\n")}\n`;
writeFileSync(join(out, "index.css"), css, "utf8");

const { neutrals, semantic, themes, themeRoles, spacing, text, weights, radius, shadow, motion, font, styleAxes, styleAxisDefaults, transforms, masks, fonts, textures } = t;
writeFileSync(
  join(out, "tokens.json"),
  JSON.stringify({ neutrals, semantic, themes, themeRoles, spacing, text, weights, radius, shadow, motion, font, styleAxes, styleAxisDefaults, transforms, masks, fonts, textures }, null, 2) + "\n",
  "utf8",
);

console.log(`design: wrote dist/index.css (${(css.length / 1024).toFixed(1)} kB) and dist/tokens.json`);
