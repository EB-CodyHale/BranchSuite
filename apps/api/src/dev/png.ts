/**
 * DEV ONLY: a minimal PNG encoder (8-bit RGB, no interlace) for the seed's chart image.
 * Avoids shipping a binary fixture; output is a valid PNG that browsers and sniffImage accept.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export type Rgb = readonly [number, number, number];

export function encodePng(width: number, height: number, pixel: (x: number, y: number) => Rgb): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // bit depth 8, color type RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A simple bar chart ("fill rate, last 5 days"): fictional values, white background, gridlines. */
export function seedChartPng(values: readonly number[] = [62, 71, 68, 80, 86]): Buffer {
  const width = 480;
  const height = 270;
  const pad = 30;
  const plotH = height - pad * 2;
  const slot = (width - pad * 2) / values.length;
  const bar: Rgb = [29, 78, 216];
  const grid: Rgb = [226, 232, 240];
  const axis: Rgb = [100, 116, 139];
  return encodePng(width, height, (x, y) => {
    if (y === height - pad && x >= pad && x <= width - pad) return axis;
    if (x === pad && y >= pad && y <= height - pad) return axis;
    const i = Math.floor((x - pad) / slot);
    const inSlot = x > pad && i >= 0 && i < values.length && (x - pad) % slot > slot * 0.2 && (x - pad) % slot < slot * 0.8;
    if (inSlot) {
      const top = height - pad - Math.round((plotH * (values[i] as number)) / 100);
      if (y >= top && y < height - pad) return bar;
    }
    if (y > pad && y < height - pad && (height - pad - y) % Math.round(plotH / 4) === 0) return grid;
    return [255, 255, 255];
  });
}
