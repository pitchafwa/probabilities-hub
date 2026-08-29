// Generate home-screen / PWA icons (PNG) from the same 3-bar mark as the favicon.
// Pure Node — no image libraries. Run once and commit the PNGs:
//     node scripts/make-icons.mjs
//
// Writes: apple-touch-icon.png (180), assets/icon-192.png, assets/icon-512.png

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- minimal PNG writer (8-bit RGBA, single IDAT) ---------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- draw the mark ---------------------------------------------------------
const BG = [10, 13, 16, 255];
const GREEN = [46, 204, 113, 255];
const AMBER = [232, 179, 57, 255];
const RED = [229, 83, 61, 255];
const AMBER_DIM = [138, 106, 34, 255];

// geometry in a 180-unit design space, scaled to `size`
const BARS = [
  { x: 25, w: 34, h: 62, c: GREEN },
  { x: 73, w: 34, h: 112, c: AMBER },
  { x: 121, w: 34, h: 84, c: RED },
];
const BASE_Y = 146;

function makeIcon(size) {
  const s = size / 180;
  const px = Buffer.alloc(size * size * 4);
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = c[3];
  };
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++)
      for (let x = Math.round(x0); x < Math.round(x1); x++) put(x, y, c);
  };

  rect(0, 0, size, size, BG);
  for (const b of BARS) rect(b.x * s, (BASE_Y - b.h) * s, (b.x + b.w) * s, BASE_Y * s, b.c);
  rect(21 * s, (BASE_Y + 3) * s, 159 * s, (BASE_Y + 7) * s, AMBER_DIM); // baseline

  return encodePNG(size, px);
}

const targets = [
  [180, join(ROOT, "apple-touch-icon.png")],
  [192, join(ROOT, "assets", "icon-192.png")],
  [512, join(ROOT, "assets", "icon-512.png")],
];
for (const [size, path] of targets) {
  writeFileSync(path, makeIcon(size));
  console.log(`wrote ${path} (${size}x${size})`);
}
