// Derives the eight railroad segment sprites (terrain/rail_n.png … rail_nw.png) from
// the road ones the original shipped (terrain/road_*.png, lifted from SP257.PIC).
//
// Civ1's own railroad art isn't in this repo's asset set, and railroads follow exactly
// the road geometry — same eight directional segments, drawn from the tile centre out
// to each neighbour that also carries track (see roadSprites/railSprites in
// Civ1Game.js). So rather than redraw them, this recolours: the road's single brown
// (142,89,40) becomes the near-black of rail, with every other pixel along the segment
// lightened into a sleeper so track reads as track and not merely as a darker road.
//
// Run from games/civ1:  node images/make-rail-sprites.mjs
// It is a one-shot generator, not part of the build — the PNGs it writes are committed.

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const RAIL = [34, 34, 34];       // the rails themselves
const SLEEPER = [168, 160, 148]; // the cross-ties, every other pixel

// ── Minimal PNG read/write: 8-bit RGBA, non-interlaced, which is what these are ──

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function decode(buf) {
  let i = 8, w = 0, h = 0;
  const idat = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i), type = buf.toString('ascii', i + 4, i + 8);
    if (type === 'IHDR') {
      w = buf.readUInt32BE(i + 8); h = buf.readUInt32BE(i + 12);
      const depth = buf[i + 16], color = buf[i + 17], interlace = buf[i + 20];
      if (depth !== 8 || color !== 6 || interlace !== 0) throw new Error('expected 8-bit RGBA, non-interlaced');
    }
    if (type === 'IDAT') idat.push(buf.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4, px = Buffer.alloc(h * stride);
  // Undo the per-scanline filters (PNG spec §9).
  for (let y = 0, pos = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = Buffer.from(raw.subarray(pos, pos + stride)); pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? line[x - 4] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 255;
      else if (filter === 2) line[x] = (line[x] + b) & 255;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    line.copy(px, y * stride);
  }
  return { w, h, px };
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encode({ w, h, px }) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {                        // filter 0 (None) throughout
    raw[y * (stride + 1)] = 0;
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;                            // 8-bit, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Recolour ────────────────────────────────────────────────────────────────────

for (const dir of DIRS) {
  const img = decode(readFileSync(new URL(`./terrain/road_${dir}.png`, import.meta.url)));
  const stride = img.w * 4;
  // Walk the opaque pixels in reading order and alternate rail / sleeper. The segments
  // are a single-pixel-wide run, so reading order IS travel order along the track.
  let n = 0;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const o = y * stride + x * 4;
      if (img.px[o + 3] === 0) continue;
      const [r, g, b] = (n++ % 2) ? SLEEPER : RAIL;
      img.px[o] = r; img.px[o + 1] = g; img.px[o + 2] = b;
    }
  }
  writeFileSync(new URL(`./terrain/rail_${dir}.png`, import.meta.url), encode(img));
  console.log(`rail_${dir}.png  (${n} px)`);
}
