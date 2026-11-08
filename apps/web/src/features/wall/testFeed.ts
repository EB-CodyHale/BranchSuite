/** Test-only wall fixtures. Fictional data only: no real clients, people or pay. */
import type { WallFeed, WallOpening, WallOrder } from '@branchsuite/shared';

export function wallOrder(overrides: Partial<WallOrder> = {}): WallOrder {
  return {
    key: 'k_1',
    client: { code: 'K7', color: 'w1', glyph: 'diamond' },
    clientName: null,
    role: 'Forklift operator',
    roleCategory: 'forklift',
    shift: '2nd',
    schedule: 'M-F · 2:00p-10:30p',
    pay: null,
    location: null,
    isPriority: false,
    paused: false,
    owner: { marker: 'teal', initials: null },
    openings: [
      { state: 'open', mark: null, startsSoon: false },
      { state: 'open', mark: null, startsSoon: false },
    ],
    toFill: 2,
    ...overrides,
  };
}

export const opening = (state: WallOpening['state'], mark: string | null = null, startsSoon = false): WallOpening => ({ state, mark, startsSoon });

export function wallFeed(orders: WallOrder[] = [wallOrder()], overrides: Partial<WallFeed> = {}): WallFeed {
  const toFill = orders.reduce((n, o) => n + o.toFill, 0);
  return {
    mode: 'board',
    branch: { name: 'Riverbend', timeZone: 'America/Chicago' },
    generatedAt: '2026-03-02T15:00:00.000Z',
    today: '2026-03-02',
    settings: { theme: 'dark', pageSeconds: 15, headline: 'Now hiring — ask the front desk', candidateDisplay: 'marks', payDisplay: 'hidden', clientDisplay: 'code' },
    totals: { orders: orders.length, openings: orders.reduce((n, o) => n + o.openings.length, 0), toFill, startingSoon: 0 },
    orders,
    ...overrides,
  };
}
