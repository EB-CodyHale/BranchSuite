/** Test-only whiteboard fixtures. Fictional data only: no real clients, people or pay. */
import type { Whiteboard, WhiteboardResponse, WhiteboardView } from '@branchsuite/shared';

export const T = '2026-03-02T13:00:00.000Z';

export function whiteboard(overrides: Partial<Whiteboard> = {}): Whiteboard {
  return {
    createdAt: T,
    updatedAt: T,
    createdBy: 'usr_avery',
    updatedBy: 'usr_avery',
    id: 'wb_br_north_2026-03-02',
    branchId: 'br_north',
    date: '2026-03-02',
    title: 'Morning huddle',
    window: { start: '07:30', end: '08:15' },
    live: 'auto',
    orderLabels: 'name',
    blocks: [],
    ...overrides,
  };
}

export function view(overrides: Partial<WhiteboardView> = {}): WhiteboardView {
  return { date: '2026-03-02', title: 'Morning huddle', window: { start: '07:30', end: '08:15' }, isLive: false, blocks: [], ...overrides };
}

export function response(wb: Whiteboard | null, v: WhiteboardView | null = wb ? view({ title: wb.title, date: wb.date, window: wb.window }) : null): WhiteboardResponse {
  return { whiteboard: wb, view: v };
}

/** A view with one block of every kind. */
export function fullView(): WhiteboardView {
  return view({
    isLive: true,
    blocks: [
      { id: 'b_tp', kind: 'talking_points', title: 'Talking points', items: [{ id: 'i1', text: 'Welcome back, Jordan' }, { id: 'i2', text: 'Badge photos at 10' }] },
      {
        id: 'b_as',
        kind: 'assignments',
        title: 'Assignments',
        items: [
          { id: 'a1', text: 'Call the second-shift no-shows', done: true, person: { name: 'Blake Ortiz', initials: 'BO', marker: 'red' } },
          { id: 'a2', text: 'Restock the lobby forms', done: false, person: null },
        ],
      },
      {
        id: 'b_po',
        kind: 'priority_orders',
        title: 'Priority orders',
        items: [
          {
            label: 'Lakeside Foods',
            client: { code: 'K7', color: 'w1', glyph: 'diamond' },
            role: 'Forklift operator',
            roleCategory: 'forklift',
            shift: '2nd',
            toFill: 4,
            total: 6,
            startingSoon: 2,
            note: 'Client visit Thursday',
          },
        ],
      },
      { id: 'b_img', kind: 'image', title: 'Fill rate', caption: 'Fill rate by week', mediaUrl: '/api/wall/media/med_1', width: 1600, height: 900 },
      { id: 'b_note', kind: 'note', title: '', text: 'Wear high-vis on the dock\n- Gloves on\n- Eyes up', tone: 'safety' },
      { id: 'b_m', kind: 'metrics', title: "Today's numbers", metrics: { orders: 9, openings: 31, toFill: 17, tentative: 3, startingSoon: 5, aging: 2 } },
    ],
  });
}
