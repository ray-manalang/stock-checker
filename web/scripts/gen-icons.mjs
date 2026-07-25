// Generate the PWA app icons as real PNGs (no external image lib) so the app is
// installable on iOS (apple-touch-icon) and Chrome (manifest icons). Design: a
// near-black rounded field with a blue "." echoing the brand mark. Run with
// `node scripts/gen-icons.mjs`; writes into public/.

import zlib from "zlib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "..", "public");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const w = size;
  const h = size;
  const bg = [14, 14, 15]; // --surface
  const accent = [94, 162, 255]; // --accent
  const white = [255, 255, 255];
  const radius = size * 0.22;

  const raw = Buffer.alloc((w * 4 + 1) * h);
  // Brand "." — a filled accent dot low-right of a white glyph area; keep it
  // simple: a large accent circle centered, on the dark rounded field.
  const cx = w * 0.5;
  const cy = h * 0.5;
  const rDot = size * 0.16;

  for (let y = 0; y < h; y++) {
    const rowStart = y * (w * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      // Rounded-rect mask (transparent corners).
      const inCorner =
        (x < radius && y < radius && dist(x, y, radius, radius) > radius) ||
        (x > w - radius && y < radius && dist(x, y, w - radius, radius) > radius) ||
        (x < radius && y > h - radius && dist(x, y, radius, h - radius) > radius) ||
        (x > w - radius && y > h - radius && dist(x, y, w - radius, h - radius) > radius);

      let r, g, b, a;
      if (inCorner) {
        [r, g, b, a] = [0, 0, 0, 0];
      } else {
        const d = dist(x, y, cx, cy);
        if (d < rDot) [r, g, b, a] = [...accent, 255];
        else if (d < rDot * 1.35) [r, g, b, a] = [...white, 40];
        else [r, g, b, a] = [...bg, 255];
      }
      const o = rowStart + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function dist(x, y, cx, cy) {
  return Math.hypot(x - cx, y - cy);
}

fs.mkdirSync(PUBLIC, { recursive: true });
for (const size of [192, 512, 180]) {
  const name = size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`;
  fs.writeFileSync(path.join(PUBLIC, name), png(size));
  console.log("wrote", name);
}
