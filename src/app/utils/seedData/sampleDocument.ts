import { deflateSync } from "node:zlib";

/*
 * Placeholder verification documents for `npm run seed`.
 * Draws a plain "card" (header bar, photo box, text lines, diagonal SAMPLE
 * stripes) and encodes it as a PNG, so the seed needs no image files and
 * never uses a real person's document.
 */

const WIDTH = 640;
const HEIGHT = 400;

type TRgb = [number, number, number];

// header colour per document, so the admin can tell them apart at a glance
const HEADER_COLOUR: Record<string, TRgb> = {
  NID_FRONT: [22, 101, 52],
  NID_BACK: [21, 94, 117],
  SELFIE: [124, 58, 237],
  TRADE_LICENSE: [194, 65, 12],
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buffer: Buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const inRect = (
  x: number,
  y: number,
  left: number,
  top: number,
  w: number,
  h: number,
) => x >= left && x < left + w && y >= top && y < top + h;

const pixelAt = (x: number, y: number, header: TRgb): TRgb => {
  // 12px border
  if (x < 12 || y < 12 || x >= WIDTH - 12 || y >= HEIGHT - 12)
    return [203, 213, 225];
  if (y < 76) return header;
  // photo box
  if (inRect(x, y, 40, 104, 150, 190)) return [148, 163, 184];
  // "text" lines
  for (const [top, width] of [
    [112, 360],
    [148, 300],
    [184, 340],
    [220, 240],
    [256, 320],
  ]) {
    if (inRect(x, y, 220, top, width, 14)) return [100, 116, 139];
  }
  // diagonal SAMPLE stripes across the lower half
  if (y > 300 && (x + y) % 48 < 10) return [248, 113, 113];
  return [248, 250, 252];
};

export const createSampleDocumentPng = (kind: string) => {
  const header = HEADER_COLOUR[kind] ?? [71, 85, 105];
  const rowLength = WIDTH * 3 + 1;
  const raw = Buffer.alloc(rowLength * HEIGHT);

  for (let y = 0; y < HEIGHT; y++) {
    raw[y * rowLength] = 0; // filter: none
    for (let x = 0; x < WIDTH; x++) {
      const [r, g, b] = pixelAt(x, y, header);
      const offset = y * rowLength + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};
