// Generates Android launcher icons (adaptive + legacy + monochrome) from a vector SVG.
//
// Usage:
//   node scripts/generate-android-icons.mjs [--ratio 0.8] [--bg "#D1D4DC"] [--shape "#072723"]
//                                           [--src public/assets/hl-dark-green.svg]
//                                           [--res android/app/src/main/res]
//
// The SVG must contain ONLY the shape (transparent background): only its
// silhouette (alpha channel) is used, the fill color is defined by --shape.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

// ---- 0. Options -------------------------------------------------------------
const argv = process.argv.slice(2);

/** Reads `--name value` from the CLI, or returns the default. */
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};

const SRC = opt('src', 'public/assets/hl-dark-green.svg');
const RES = opt('res', 'android/app/src/main/res');
// Largest dimension of the shape / diameter of the visible circle
const RATIO = parseFloat(opt('ratio', '0.82'));
// Size (px) of the master render, before downscaling to each target size
const MASTER = 2048;

const HEX_RE = /^#?[0-9a-f]{6}$/i;

/** "#RRGGBB" -> [r, g, b] */
const hex = (h) => {
  if (!HEX_RE.test(h)) throw new Error(`Invalid color: "${h}" (expected #RRGGBB)`);
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};

/** [r, g, b] -> "#RRGGBB" */
const toHex = (c) =>
  '#' +
  c
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

const bgColor = hex(opt('bg', '#F1EFE9')); // icon background color
const shapeColor = hex(opt('shape', '#072723')); // icon shape color

if (!Number.isFinite(RATIO) || RATIO <= 0 || RATIO > 1) {
  throw new Error(`Invalid --ratio: "${opt('ratio', '0.8')}" (expected a number in ]0, 1])`);
}
if (!fs.existsSync(SRC)) throw new Error(`SVG not found: ${SRC}`);
if (!fs.existsSync(RES)) {
  throw new Error(`Res folder not found: ${RES} (did you run "npx cap add android" first?)`);
}

console.log('Android icon generation');
console.log(`  source : ${SRC}`);
console.log(`  output : ${RES}`);
console.log(`  bg     : ${toHex(bgColor)}`);
console.log(`  shape  : ${toHex(shapeColor)}`);
console.log(`  ratio  : ${RATIO}`);

// ---- 1. Master render of the SVG + silhouette extraction --------------------
console.log('\n[1/3] Rendering SVG and extracting silhouette...');

const svgBuf = fs.readFileSync(SRC);
const meta = await sharp(svgBuf).metadata();

// Pick a rasterization density so the vector is rendered sharply at MASTER px
// (sharp rasterizes SVGs at 72 dpi by default, which would be blurry).
const density = Math.min(
  2400,
  Math.max(72, Math.ceil((72 * MASTER) / Math.max(meta.width, meta.height))),
);
console.log(`  SVG size ${meta.width}x${meta.height}, rasterization density ${density} dpi`);

// Render, then keep only the alpha channel (1 byte per pixel = the shape mask)
const { data, info } = await sharp(svgBuf, { density })
  .resize(MASTER, MASTER, { fit: 'inside', kernel: 'lanczos3' })
  .ensureAlpha()
  .extractChannel('alpha')
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
console.log(`  master mask ${W}x${H}`);

// Bounding box of the shape (alpha > threshold) + opacity sanity check
let x0 = W,
  x1 = -1,
  y0 = H,
  y1 = -1;
let opaqueEverywhere = true;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const a = data[y * W + x];
    if (a < 250) opaqueEverywhere = false;
    if (a > 8) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
}
if (x1 < 0) throw new Error('The SVG is fully transparent: no shape detected.');
if (opaqueEverywhere) {
  throw new Error(
    'The SVG is fully opaque (solid background?): remove the background and keep only the shape.',
  );
}

// Tightly cropped mask (1 channel)
const cw = x1 - x0 + 1,
  ch = y1 - y0 + 1;
const alphaCrop = Buffer.alloc(cw * ch);
for (let y = 0; y < ch; y++)
  data.copy(alphaCrop, y * cw, (y + y0) * W + x0, (y + y0) * W + x0 + cw);
console.log(`  shape bounding box ${cw}x${ch} (at ${x0},${y0})`);

// ---- 2. Rendering helpers ---------------------------------------------------
/**
 * Recolored shape whose largest dimension equals `size * fraction`,
 * centered on a transparent `size` x `size` canvas.
 * Returns a sharp pipeline (PNG).
 */
async function renderShape(color, size, fraction) {
  const box = Math.round(size * fraction);
  const scale = box / Math.max(cw, ch);
  const w = Math.max(1, Math.round(cw * scale));
  const h = Math.max(1, Math.round(ch * scale));

  // Downscale the mask. NOTE: resize() outputs 3 channels even for a 1-channel
  // raw input, so extractChannel(0) is required to get a true 1-channel buffer
  // (otherwise joinChannel() below reads it misaligned -> horizontal stripes).
  const alpha = await sharp(alphaCrop, { raw: { width: cw, height: ch, channels: 1 } })
    .resize(w, h, { kernel: 'lanczos3' })
    .extractChannel(0)
    .raw()
    .toBuffer();

  // Solid color image + downscaled mask as alpha channel = recolored shape
  const shape = await sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: { r: color[0], g: color[1], b: color[2] },
    },
  })
    .joinChannel(alpha, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();

  // Center on a transparent canvas
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: shape, left: Math.round((size - w) / 2), top: Math.round((size - h) / 2) },
    ])
    .png();
}

/** Legacy icon: background-colored disc + centered shape. */
async function renderLegacy(size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${toHex(bgColor)}"/></svg>`;
  const shape = await (await renderShape(shapeColor, size, RATIO)).toBuffer();
  return sharp(Buffer.from(svg))
    .composite([{ input: shape }])
    .png();
}

// ---- 3. Writing files -------------------------------------------------------
console.log('\n[2/3] Cleaning previous launcher icons...');

// Remove old icons, including those generated by @capacitor/assets
let removed = 0;
for (const dir of fs.readdirSync(RES)) {
  if (!dir.startsWith('mipmap-')) continue;
  for (const f of fs.readdirSync(path.join(RES, dir))) {
    if (f.startsWith('ic_launcher')) {
      fs.rmSync(path.join(RES, dir, f));
      removed++;
    }
  }
}
console.log(`  removed ${removed} file(s)`);

console.log('\n[3/3] Generating icons...');

// The visible circle is 72dp on a 108dp adaptive layer
const FG_FRACTION = RATIO * (72 / 108);

// density -> [legacy size px, adaptive layer size px]
const dens = {
  mdpi: [48, 108],
  hdpi: [72, 162],
  xhdpi: [96, 216],
  xxhdpi: [144, 324],
  xxxhdpi: [192, 432],
};

for (const [k, [legacy, adaptive]] of Object.entries(dens)) {
  const dir = path.join(RES, `mipmap-${k}`);
  fs.mkdirSync(dir, { recursive: true });

  // Legacy icons (square + round share the same circular render)
  const leg = await (await renderLegacy(legacy)).toBuffer();
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), leg);
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), leg);

  // Adaptive foreground (colored) and monochrome (themed icons, Android 13+)
  await (
    await renderShape(shapeColor, adaptive, FG_FRACTION)
  ).toFile(path.join(dir, 'ic_launcher_fg.png'));
  await (
    await renderShape([0, 0, 0], adaptive, FG_FRACTION)
  ).toFile(path.join(dir, 'ic_launcher_mono.png'));

  console.log(`  mipmap-${k}: legacy ${legacy}px, adaptive ${adaptive}px`);
}

// Adaptive icon descriptors (Android 8+)
const any = path.join(RES, 'mipmap-anydpi-v26');
fs.mkdirSync(any, { recursive: true });
const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_bg" />
    <foreground android:drawable="@mipmap/ic_launcher_fg" />
    <monochrome android:drawable="@mipmap/ic_launcher_mono" />
</adaptive-icon>
`;
fs.writeFileSync(path.join(any, 'ic_launcher.xml'), xml);
fs.writeFileSync(path.join(any, 'ic_launcher_round.xml'), xml);
console.log('  mipmap-anydpi-v26: ic_launcher.xml, ic_launcher_round.xml');

// Background color resource referenced by the adaptive icon
fs.mkdirSync(path.join(RES, 'values'), { recursive: true });
fs.writeFileSync(
  path.join(RES, 'values', 'ic_launcher_bg.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_bg">${toHex(bgColor)}</color>\n</resources>\n`,
);
console.log(`  values/ic_launcher_bg.xml (${toHex(bgColor)})`);

console.log(
  `\nDone. SVG ${SRC}, bg ${toHex(bgColor)}, shape ${toHex(shapeColor)}, ratio ${RATIO} -> ${RES}`,
);
