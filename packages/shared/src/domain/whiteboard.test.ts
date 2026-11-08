import { describe, expect, it } from 'vitest';
import { zWhiteboard, type Whiteboard, type WhiteboardBlock } from '../whiteboard.js';
import { accountLite, opening, order, person } from './fixtures.test-util.js';
import {
  copyWhiteboardBlocks,
  isWhiteboardLive,
  nextModeChange,
  sniffImage,
  toWhiteboardView,
  validateWhiteboard,
  type WhiteboardViewContext,
} from './whiteboard.js';

const CHI = 'America/Chicago';
const at = (iso: string) => new Date(iso);

function board(over: Partial<Whiteboard> = {}): Whiteboard {
  return zWhiteboard.parse({
    id: 'wb_br_1_2026-03-10',
    branchId: 'br_1',
    date: '2026-03-10',
    window: { start: '07:30', end: '08:15' },
    live: 'auto',
    blocks: [],
    createdAt: '2026-03-09T20:00:00.000Z',
    updatedAt: '2026-03-09T20:00:00.000Z',
    createdBy: 'usr_mgr',
    updatedBy: 'usr_mgr',
    ...over,
  });
}

describe('isWhiteboardLive', () => {
  // 2026-03-10 is CDT (UTC-5): 07:30 local = 12:30Z, 08:15 local = 13:15Z.
  const wb = board();

  it('auto: inclusive start, exclusive end', () => {
    expect(isWhiteboardLive(wb, CHI, at('2026-03-10T12:29:59.999Z'))).toBe(false);
    expect(isWhiteboardLive(wb, CHI, at('2026-03-10T12:30:00.000Z'))).toBe(true);
    expect(isWhiteboardLive(wb, CHI, at('2026-03-10T13:00:00.000Z'))).toBe(true);
    expect(isWhiteboardLive(wb, CHI, at('2026-03-10T13:14:59.999Z'))).toBe(true);
    expect(isWhiteboardLive(wb, CHI, at('2026-03-10T13:15:00.000Z'))).toBe(false);
  });

  it('is never live on another date, whatever the live setting', () => {
    for (const live of ['auto', 'on', 'off'] as const) {
      const b = board({ live });
      expect(isWhiteboardLive(b, CHI, at('2026-03-09T12:45:00.000Z')), live).toBe(false);
      expect(isWhiteboardLive(b, CHI, at('2026-03-11T12:45:00.000Z')), live).toBe(false);
    }
  });

  it('uses the branch-local date, not the UTC date', () => {
    // 2026-03-11T03:00Z is still 2026-03-10 22:00 in Chicago.
    expect(isWhiteboardLive(board({ live: 'on' }), CHI, at('2026-03-11T03:00:00.000Z'))).toBe(true);
    // 2026-03-10T04:00Z is 2026-03-09 23:00 in Chicago.
    expect(isWhiteboardLive(board({ live: 'on' }), CHI, at('2026-03-10T04:00:00.000Z'))).toBe(false);
  });

  it("'on' is live all day on its date, outside the window", () => {
    const b = board({ live: 'on' });
    expect(isWhiteboardLive(b, CHI, at('2026-03-10T06:00:00.000Z'))).toBe(true); // 01:00 local
    expect(isWhiteboardLive(b, CHI, at('2026-03-10T22:00:00.000Z'))).toBe(true); // 17:00 local
  });

  it("'off' is never live, even inside the window", () => {
    expect(isWhiteboardLive(board({ live: 'off' }), CHI, at('2026-03-10T12:45:00.000Z'))).toBe(false);
  });

  it('follows the local clock across the spring-forward day (2026-03-08, CST -> CDT)', () => {
    const b = board({ date: '2026-03-08' });
    // After the change: 07:30 CDT = 12:30Z.
    expect(isWhiteboardLive(b, CHI, at('2026-03-08T12:30:00.000Z'))).toBe(true);
    expect(isWhiteboardLive(b, CHI, at('2026-03-08T13:20:00.000Z'))).toBe(false);
    // The day before, 07:30 CST = 13:30Z.
    const prev = board({ date: '2026-03-07' });
    expect(isWhiteboardLive(prev, CHI, at('2026-03-07T12:30:00.000Z'))).toBe(false);
    expect(isWhiteboardLive(prev, CHI, at('2026-03-07T13:30:00.000Z'))).toBe(true);
  });

  it('follows the local clock across the fall-back day (2026-11-01, CDT -> CST)', () => {
    const b = board({ date: '2026-11-01' });
    expect(isWhiteboardLive(b, CHI, at('2026-11-01T12:30:00.000Z'))).toBe(false); // 06:30 CST
    expect(isWhiteboardLive(b, CHI, at('2026-11-01T13:30:00.000Z'))).toBe(true); // 07:30 CST
    expect(isWhiteboardLive(b, CHI, at('2026-11-01T14:14:00.000Z'))).toBe(true);
    expect(isWhiteboardLive(b, CHI, at('2026-11-01T14:15:00.000Z'))).toBe(false);
  });

  it('works in other zones (half-hour offsets, southern hemisphere, UTC)', () => {
    const b = board();
    // Kolkata UTC+5:30: 07:30 local = 02:00Z.
    expect(isWhiteboardLive(b, 'Asia/Kolkata', at('2026-03-10T01:59:00.000Z'))).toBe(false);
    expect(isWhiteboardLive(b, 'Asia/Kolkata', at('2026-03-10T02:00:00.000Z'))).toBe(true);
    // Sydney in March is AEDT UTC+11: 07:30 local on 03-10 = 2026-03-09T20:30Z.
    expect(isWhiteboardLive(b, 'Australia/Sydney', at('2026-03-09T20:30:00.000Z'))).toBe(true);
    expect(isWhiteboardLive(b, 'Australia/Sydney', at('2026-03-10T20:30:00.000Z'))).toBe(false);
    expect(isWhiteboardLive(b, 'UTC', at('2026-03-10T07:30:00.000Z'))).toBe(true);
    expect(isWhiteboardLive(b, 'UTC', at('2026-03-10T08:15:00.000Z'))).toBe(false);
  });
});

describe('nextModeChange', () => {
  const wb = board();
  it('points at window start before the window and window end inside it', () => {
    expect(nextModeChange(wb, CHI, at('2026-03-10T10:00:00.000Z'))).toBe('2026-03-10T12:30:00.000Z');
    expect(nextModeChange(wb, CHI, at('2026-03-10T12:30:00.000Z'))).toBe('2026-03-10T13:15:00.000Z');
    expect(nextModeChange(wb, CHI, at('2026-03-10T13:15:00.000Z'))).toBeNull();
  });

  it('is null for no board, another date, or a manual setting', () => {
    expect(nextModeChange(null, CHI, at('2026-03-10T10:00:00.000Z'))).toBeNull();
    expect(nextModeChange(wb, CHI, at('2026-03-11T10:00:00.000Z'))).toBeNull();
    expect(nextModeChange(board({ live: 'on' }), CHI, at('2026-03-10T10:00:00.000Z'))).toBeNull();
    expect(nextModeChange(board({ live: 'off' }), CHI, at('2026-03-10T10:00:00.000Z'))).toBeNull();
  });

  it('is DST-correct on both change days', () => {
    expect(nextModeChange(board({ date: '2026-03-08' }), CHI, at('2026-03-08T06:00:00.000Z'))).toBe('2026-03-08T12:30:00.000Z');
    expect(nextModeChange(board({ date: '2026-11-01' }), CHI, at('2026-11-01T05:00:00.000Z'))).toBe('2026-11-01T13:30:00.000Z');
  });

  it('agrees with isWhiteboardLive for a window that starts inside the spring-forward gap', () => {
    const b = board({ date: '2026-03-08', window: { start: '02:15', end: '03:30' } });
    const next = nextModeChange(b, CHI, at('2026-03-08T07:00:00.000Z')); // 01:00 CST
    expect(next).toBe('2026-03-08T08:00:00.000Z'); // clock jumps 01:59 CST -> 03:00 CDT
    expect(isWhiteboardLive(b, CHI, at('2026-03-08T07:59:00.000Z'))).toBe(false);
    expect(isWhiteboardLive(b, CHI, at(next!))).toBe(true);
  });

  it('flips isWhiteboardLive exactly at the returned instant', () => {
    for (const now of ['2026-03-10T05:00:00.000Z', '2026-03-10T12:40:00.000Z']) {
      const next = new Date(nextModeChange(wb, CHI, at(now))!);
      const before = new Date(next.getTime() - 1);
      expect(isWhiteboardLive(wb, CHI, before)).not.toBe(isWhiteboardLive(wb, CHI, next));
    }
  });
});

describe('validateWhiteboard', () => {
  const blocks: WhiteboardBlock[] = [
    { id: 'b1', kind: 'talking_points', title: 'Talking points', items: [{ id: 'i1', text: 'Hello' }] },
    { id: 'b2', kind: 'assignments', title: 'Assignments', items: [{ id: 'i2', userId: null, text: 'Call', taskId: null, done: false }] },
    { id: 'b3', kind: 'image', title: '', mediaId: 'med_1', caption: '' },
  ];

  it('accepts a valid board', () => {
    expect(validateWhiteboard({ window: { start: '07:30', end: '08:15' }, blocks }, new Set(['med_1']))).toEqual([]);
  });

  it('rejects an empty or inverted window', () => {
    expect(validateWhiteboard({ window: { start: '08:15', end: '08:15' }, blocks: [] }, new Set())).toHaveLength(1);
    expect(validateWhiteboard({ window: { start: '09:00', end: '08:15' }, blocks: [] }, new Set())).toHaveLength(1);
  });

  it('rejects duplicate block ids and item ids across blocks', () => {
    const dupBlock = [...blocks, { id: 'b1', kind: 'metrics', title: 'x' } as WhiteboardBlock];
    expect(validateWhiteboard({ window: { start: '07:30', end: '08:15' }, blocks: dupBlock }, new Set(['med_1'])).join(' ')).toMatch(/b1/);
    const dupItem: WhiteboardBlock[] = [
      { id: 'b1', kind: 'talking_points', title: '', items: [{ id: 'same', text: 'a' }] },
      { id: 'b2', kind: 'assignments', title: '', items: [{ id: 'same', userId: null, text: 'b', taskId: null, done: false }] },
    ];
    expect(validateWhiteboard({ window: { start: '07:30', end: '08:15' }, blocks: dupItem }, new Set())).toEqual(['Duplicate item id same.']);
  });

  it('rejects image blocks whose media is unknown', () => {
    expect(validateWhiteboard({ window: { start: '07:30', end: '08:15' }, blocks }, new Set())).toHaveLength(1);
  });
});

describe('toWhiteboardView', () => {
  const NOW = at('2026-03-10T12:45:00.000Z'); // 07:45 CDT
  const acc = accountLite({ id: 'acc_1', name: 'Northwind Fabrication', wall: { code: 'K7', color: 'w1', glyph: 'diamond' } });
  const other = accountLite({ id: 'acc_2', branchId: 'br_2', name: 'Elsewhere Inc', wall: { code: 'Z9', color: 'w2', glyph: 'circle' } });
  const orders = [
    order({
      id: 'ord_a',
      role: 'Forklift operator',
      note: 'SECRET NOTE',
      payRate: 19.5,
      openings: [
        opening({ id: 'l1' }),
        opening({ id: 'l2', state: 'tentative', initials: 'AB' }),
        opening({ id: 'l3', state: 'committed', initials: 'CD', startDate: '2026-03-11' }),
        opening({ id: 'l4', state: 'committed', initials: 'EF', startDate: '2026-04-30' }),
      ],
    }),
    order({ id: 'ord_closed', status: 'closed' }),
    order({ id: 'ord_draft', status: 'draft' }),
    order({ id: 'ord_paused', status: 'paused', role: 'Packer' }),
    order({ id: 'ord_other', branchId: 'br_2', accountId: 'acc_2' }),
  ];
  const ctx = (over: Partial<WhiteboardViewContext> = {}): WhiteboardViewContext => ({
    timeZone: CHI,
    now: NOW,
    orders,
    accounts: [acc, other],
    people: [person({ id: 'usr_1', name: 'Robin Sample', initials: 'RS', marker: 'green' })],
    mediaUrl: (id) => (id === 'med_1' ? `/api/wall/media/${id}` : null),
    media: new Map([['med_1', { width: 640, height: 360 }]]),
    ...over,
  });

  const full = board({
    blocks: [
      { id: 'tp', kind: 'talking_points', title: 'Talking points', items: [{ id: 't1', text: 'Safety first' }] },
      { id: 'tp_empty', kind: 'talking_points', title: 'Empty', items: [] },
      {
        id: 'as',
        kind: 'assignments',
        title: 'Assignments',
        items: [
          { id: 'a1', userId: 'usr_1', text: 'Call Northwind', taskId: 'task_1', done: true },
          { id: 'a2', userId: null, text: 'Everyone: badges', taskId: null, done: false },
          { id: 'a3', userId: 'usr_gone', text: 'Unknown person', taskId: null, done: false },
        ],
      },
      {
        id: 'po',
        kind: 'priority_orders',
        title: 'Priority orders',
        items: [
          { orderId: 'ord_a', note: 'Push hard' },
          { orderId: 'ord_closed', note: '' },
          { orderId: 'ord_draft', note: '' },
          { orderId: 'ord_missing', note: '' },
          { orderId: 'ord_other', note: '' },
          { orderId: 'ord_paused', note: '' },
        ],
      },
      { id: 'po_skipped', kind: 'priority_orders', title: 'All skipped', items: [{ orderId: 'ord_closed', note: '' }] },
      { id: 'img', kind: 'image', title: 'Fill rate', mediaId: 'med_1', caption: 'Last week' },
      { id: 'img_gone', kind: 'image', title: 'Gone', mediaId: 'med_gone', caption: '' },
      { id: 'note', kind: 'note', title: 'Safety', text: '- Gloves\n- Glasses', tone: 'safety' },
      { id: 'met', kind: 'metrics', title: "Today's numbers" },
    ],
  });

  it('resolves every block kind and omits empty or unresolvable blocks', () => {
    const view = toWhiteboardView(full, ctx());
    expect(view.isLive).toBe(true);
    expect(view.date).toBe('2026-03-10');
    expect(view.window).toEqual({ start: '07:30', end: '08:15' });
    expect(view.blocks.map((b) => b.id)).toEqual(['tp', 'as', 'po', 'img', 'note', 'met']);

    const as = view.blocks.find((b) => b.kind === 'assignments');
    expect(as?.kind === 'assignments' && as.items).toEqual([
      { id: 'a1', text: 'Call Northwind', done: true, person: { name: 'Robin Sample', initials: 'RS', marker: 'green' } },
      { id: 'a2', text: 'Everyone: badges', done: false, person: null },
      { id: 'a3', text: 'Unknown person', done: false, person: null },
    ]);

    const po = view.blocks.find((b) => b.kind === 'priority_orders');
    expect(po?.kind === 'priority_orders' && po.items).toEqual([
      {
        label: 'Northwind Fabrication',
        client: { code: 'K7', color: 'w1', glyph: 'diamond' },
        role: 'Forklift operator',
        roleCategory: 'forklift',
        shift: '1st',
        toFill: 2,
        total: 4,
        startingSoon: 1,
        note: 'Push hard',
      },
      expect.objectContaining({ role: 'Packer', toFill: 1, total: 1 }),
    ]);

    const img = view.blocks.find((b) => b.kind === 'image');
    expect(img).toEqual({ id: 'img', kind: 'image', title: 'Fill rate', caption: 'Last week', mediaUrl: '/api/wall/media/med_1', width: 640, height: 360 });

    const met = view.blocks.find((b) => b.kind === 'metrics');
    // Active orders of br_1 only: ord_a.
    expect(met?.kind === 'metrics' && met.metrics).toMatchObject({ orders: 1, openings: 4, toFill: 2, tentative: 1, startingSoon: 1 });
    expect(view.blocks.find((b) => b.kind === 'note')).toEqual({ id: 'note', kind: 'note', title: 'Safety', text: '- Gloves\n- Glasses', tone: 'safety' });
  });

  it("uses wall codes instead of account names when orderLabels = 'code'", () => {
    const view = toWhiteboardView({ ...full, orderLabels: 'code' }, ctx());
    const json = JSON.stringify(view);
    expect(json).not.toContain('Northwind Fabrication');
    const po = view.blocks.find((b) => b.kind === 'priority_orders');
    expect(po?.kind === 'priority_orders' && po.items[0]?.label).toBe('K7');
  });

  it('never copies ids, notes, pay or other-branch data', () => {
    const json = JSON.stringify(toWhiteboardView(full, ctx()));
    for (const s of ['ord_a', 'acc_1', 'SECRET NOTE', '19.5', 'Elsewhere', 'usr_1', 'task_1', 'med_gone', 'l3']) expect(json, s).not.toContain(s);
  });

  it('reports isLive false outside the window', () => {
    expect(toWhiteboardView(full, ctx({ now: at('2026-03-10T15:00:00.000Z') })).isLive).toBe(false);
  });

  it('uses image dimensions only when known', () => {
    const view = toWhiteboardView(full, ctx({ media: new Map() }));
    expect(view.blocks.find((b) => b.kind === 'image')).toMatchObject({ width: null, height: null });
  });
});

describe('copyWhiteboardBlocks', () => {
  it('keeps ids and content, resets assignment state, and does not alias the source', () => {
    const src: WhiteboardBlock[] = [
      { id: 'b1', kind: 'assignments', title: 'A', items: [{ id: 'i1', userId: 'usr_1', text: 'x', taskId: 'task_1', done: true }] },
      { id: 'b2', kind: 'talking_points', title: 'T', items: [{ id: 'i2', text: 'y' }] },
    ];
    const copy = copyWhiteboardBlocks({ blocks: src });
    expect(copy).toEqual([
      { id: 'b1', kind: 'assignments', title: 'A', items: [{ id: 'i1', userId: 'usr_1', text: 'x', taskId: null, done: false }] },
      { id: 'b2', kind: 'talking_points', title: 'T', items: [{ id: 'i2', text: 'y' }] },
    ]);
    (copy[1] as { items: { text: string }[] }).items[0]!.text = 'changed';
    expect((src[1] as { items: { text: string }[] }).items[0]!.text).toBe('y');
    expect((src[0] as { items: { done: boolean }[] }).items[0]!.done).toBe(true);
  });
});

// ---------- image fixtures (real minimal headers) ----------

function u32be(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}
function pngHeader(w: number, h: number): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, // IHDR length + type
    ...u32be(w), ...u32be(h), 8, 6, 0, 0, 0,
    0, 0, 0, 0, // crc (not checked)
  ]);
}
function jpegHeader(w: number, h: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0 JFIF
    0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, // tiny DQT stub
    0xff, 0xc4, 0x00, 0x04, 0x00, 0x00, // DHT (must not be mistaken for SOF)
    0xff, 0xc2, 0x00, 0x11, 0x08, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, // SOF2
    0xff, 0xd9,
  ]);
}
function riff(chunk: string, payload: number[]): Uint8Array {
  const body = [...'WEBP'].map((c) => c.charCodeAt(0)).concat([...chunk].map((c) => c.charCodeAt(0)), [payload.length, 0, 0, 0], payload);
  return Uint8Array.from([...'RIFF'].map((c) => c.charCodeAt(0)).concat([body.length & 255, (body.length >> 8) & 255, 0, 0], body));
}
const webpLossy = (w: number, h: number) => riff('VP8 ', [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, w & 255, (w >> 8) & 0x3f, h & 255, (h >> 8) & 0x3f, 0, 0]);
function webpLossless(w: number, h: number): Uint8Array {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  return riff('VP8L', [0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255, 0]);
}
function webpExtended(w: number, h: number): Uint8Array {
  const W = w - 1;
  const H = h - 1;
  return riff('VP8X', [0x10, 0, 0, 0, W & 255, (W >> 8) & 255, (W >> 16) & 255, H & 255, (H >> 8) & 255, (H >> 16) & 255]);
}

describe('sniffImage', () => {
  it('reads PNG type and IHDR dimensions', () => {
    expect(sniffImage(pngHeader(1280, 720))).toEqual({ contentType: 'image/png', width: 1280, height: 720 });
  });

  it('reads JPEG type and SOF dimensions, skipping DHT', () => {
    expect(sniffImage(jpegHeader(800, 600))).toEqual({ contentType: 'image/jpeg', width: 800, height: 600 });
  });

  it('reads all three WebP flavors', () => {
    expect(sniffImage(webpLossy(320, 240))).toEqual({ contentType: 'image/webp', width: 320, height: 240 });
    expect(sniffImage(webpLossless(1000, 500))).toEqual({ contentType: 'image/webp', width: 1000, height: 500 });
    expect(sniffImage(webpExtended(4000, 3000))).toEqual({ contentType: 'image/webp', width: 4000, height: 3000 });
  });

  it('identifies the type even when dimensions are unreadable', () => {
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toEqual({ contentType: 'image/jpeg', width: null, height: null });
    expect(sniffImage(pngHeader(10, 10).subarray(0, 12))).toEqual({ contentType: 'image/png', width: null, height: null });
  });

  it('rejects non-images and spoofed content', () => {
    const text = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(sniffImage(text).contentType).toBeNull();
    expect(sniffImage(new TextEncoder().encode('GIF89a......')).contentType).toBeNull();
    expect(sniffImage(new TextEncoder().encode('%PDF-1.7')).contentType).toBeNull();
    // RIFF but not WEBP (e.g. WAV).
    expect(sniffImage(new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WAVEfmt ')).contentType).toBeNull();
    expect(sniffImage(new Uint8Array()).contentType).toBeNull();
    // A truncated PNG signature is not a PNG.
    expect(sniffImage(pngHeader(10, 10).subarray(0, 7)).contentType).toBeNull();
  });
});
