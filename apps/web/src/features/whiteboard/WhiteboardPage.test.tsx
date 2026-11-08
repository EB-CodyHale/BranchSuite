import type { MeResponse, Whiteboard, WhiteboardResponse } from '@branchsuite/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BranchScopeProvider } from '../../app/BranchScope.js';
import { MeProvider } from '../../app/MeContext.js';
import { keys } from '../../lib/queryKeys.js';
import { board, jsonResponse, meResponse } from '../../test/fixtures.js';
import { ToastProvider } from '../../ui/Toast.js';
import { response, view, whiteboard } from './testFixtures.js';
import { AUTOSAVE_DEBOUNCE_MS } from './useWhiteboardDraft.js';
import { WhiteboardPage } from './WhiteboardPage.js';

const DAY = '/api/branches/br_north/whiteboards/2026-03-02';

interface Call {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}
type Handler = (call: Call) => Response | Promise<Response>;

function mockApi(handlers: Record<string, Handler | Handler[]>) {
  const calls: Call[] = [];
  const queues = new Map(Object.entries(handlers).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const raw = init?.body;
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const call = { method, url, body, headers: { ...(init?.headers as Record<string, string>) } };
    calls.push(call);
    const queue = queues.get(`${method} ${url}`);
    if (queue && queue.length) return (queue.length > 1 ? queue.shift()! : queue[0]!)(call);
    if (method === 'GET' && url.startsWith('/api/branches/br_north/whiteboards?')) return jsonResponse([]);
    if (method === 'GET' && url.startsWith('/api/board')) return jsonResponse(board([]));
    if (method === 'PATCH' && url === '/api/me/preferences') return jsonResponse({});
    return jsonResponse({ error: { code: 'not_found', message: `No mock for ${method} ${url}` } }, 404);
  });
  return calls;
}

function renderPage(me: MeResponse = meResponse()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(keys.me(), me);
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/whiteboard']}>
          <MeProvider me={me}>
            <BranchScopeProvider>
              <WhiteboardPage />
            </BranchScopeProvider>
          </MeProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const flush = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** The PUT a save sends, echoed back as the server copy (with a new updatedAt). */
const echo = (stamp: string) => (call: Call) => {
  const input = call.body as Partial<Whiteboard>;
  const wb = whiteboard({ ...input, updatedAt: stamp } as Partial<Whiteboard>);
  return jsonResponse(response(wb));
};

const blockOrder = () => screen.queryAllByRole('article').map((a) => a.getAttribute('aria-label'));

async function addBlock(label: string) {
  fireEvent.click(screen.getByRole('button', { name: /Add block/ }));
  await flush();
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
  await flush(20);
}

describe('WhiteboardPage (manager editor)', () => {
  beforeEach(() => {
    // 06:00 in Chicago on 2026-03-02: before the default 07:30 window.
    vi.useFakeTimers({ now: new Date('2026-03-02T12:00:00.000Z') });
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds, edits, reorders and deletes blocks with undo, then autosaves once after the debounce', async () => {
    const calls = mockApi({ [`GET ${DAY}`]: () => jsonResponse(response(whiteboard())), [`PUT ${DAY}`]: echo('2026-03-02T12:00:05.000Z') });
    renderPage();
    await flush();
    expect(screen.getByText('Scheduled')).toBeTruthy();
    expect(screen.getByText('Nothing on this whiteboard yet')).toBeTruthy();

    await addBlock('Talking points');
    const first = screen.getByRole('textbox', { name: 'Talking point 1' });
    fireEvent.change(first, { target: { value: 'Welcome back, Jordan' } });
    fireEvent.keyDown(first, { key: 'Enter' });
    await flush();
    const second = screen.getByRole('textbox', { name: 'Talking point 2' });
    expect(document.activeElement).toBe(second);
    fireEvent.change(second, { target: { value: 'Badge photos at 10' } });

    await addBlock('Note');
    expect(blockOrder()).toEqual(['Talking points, block 1 of 2', 'Note, block 2 of 2']);

    fireEvent.click(screen.getByRole('button', { name: 'Move Note block up' }));
    await flush();
    expect(blockOrder()).toEqual(['Note, block 1 of 2', 'Talking points, block 2 of 2']);

    // Keyboard reorder on the drag handle.
    fireEvent.keyDown(screen.getByRole('button', { name: /Reorder Note block/ }), { key: 'ArrowDown' });
    await flush();
    expect(blockOrder()).toEqual(['Talking points, block 1 of 2', 'Note, block 2 of 2']);

    // Debounced: nothing saved yet while edits keep coming.
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Note block' }));
    await flush();
    expect(blockOrder()).toEqual(['Talking points, block 1 of 1']);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await flush();
    expect(blockOrder()).toEqual(['Talking points, block 1 of 2', 'Note, block 2 of 2']);

    await flush(AUTOSAVE_DEBOUNCE_MS - 50);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    await flush(100);
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    const body = puts[0]!.body as { blocks: Array<{ kind: string; items?: Array<{ text: string }> }> };
    expect(body.blocks.map((b) => b.kind)).toEqual(['talking_points', 'note']);
    expect(body.blocks[0]!.items!.map((i) => i.text)).toEqual(['Welcome back, Jordan', 'Badge photos at 10']);
    expect(screen.getByText('All changes saved')).toBeTruthy();
    // The editor keeps the local draft after its own save (no flicker, no reorder).
    expect(blockOrder()).toEqual(['Talking points, block 1 of 2', 'Note, block 2 of 2']);
  });

  it('on a 409 refetches, loads the server copy and notifies', async () => {
    const theirs = whiteboard({
      updatedAt: '2026-03-02T12:00:09.000Z',
      blocks: [{ id: 'b_theirs', kind: 'note', title: 'From Casey', text: 'Truck at 9', tone: 'alert' }],
    });
    const calls = mockApi({
      [`GET ${DAY}`]: [() => jsonResponse(response(whiteboard())), () => jsonResponse(response(theirs))],
      [`PUT ${DAY}`]: () => jsonResponse({ error: { code: 'conflict', message: 'Changed elsewhere.' } }, 409),
    });
    renderPage();
    await flush();
    await addBlock("Today's numbers");
    await flush(AUTOSAVE_DEBOUNCE_MS + 10);
    await flush();

    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'GET' && c.url === DAY)).toHaveLength(2);
    expect(screen.getByText('Someone else changed this whiteboard')).toBeTruthy();
    expect(blockOrder()).toEqual(['Note, block 1 of 1']);
    expect((screen.getByRole('textbox', { name: 'Note title' }) as HTMLInputElement).value).toBe('From Casey');
    expect(screen.getByText('All changes saved')).toBeTruthy();
  });

  it('shows a retry when a save fails for another reason', async () => {
    mockApi({
      [`GET ${DAY}`]: () => jsonResponse(response(whiteboard())),
      [`PUT ${DAY}`]: [() => jsonResponse({ error: { code: 'internal', message: 'Boom.' } }, 500), echo('2026-03-02T12:01:00.000Z')],
    });
    renderPage();
    await flush();
    await addBlock("Today's numbers");
    await flush(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(screen.getByText(/Not saved/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(screen.getByText('All changes saved')).toBeTruthy();
  });

  it('validates image type and size before uploading', async () => {
    const calls = mockApi({ [`GET ${DAY}`]: () => jsonResponse(response(whiteboard())), [`PUT ${DAY}`]: echo('2026-03-02T12:00:05.000Z') });
    const { container } = renderPage();
    await flush();
    await addBlock('Graph / screenshot');
    const input = container.querySelector('input[type=file]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [new File(['GIF89a'], 'anim.gif', { type: 'image/gif' })] } });
    await flush();
    expect(screen.getByText(/Use a PNG, JPEG or WebP image/).getAttribute('role')).toBe('alert');

    const huge = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(huge, 'size', { value: 9 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [huge] } });
    await flush();
    expect(screen.getByText(/That image is 9 MB\. The limit is 8 MB/).getAttribute('role')).toBe('alert');
    expect(calls.some((c) => c.url.endsWith('/media'))).toBe(false);
  });

  it('pasting a screenshot (Ctrl+V) adds a graph block, uploads the raw file and saves the media id', async () => {
    const calls = mockApi({
      [`GET ${DAY}`]: () => jsonResponse(response(whiteboard())),
      [`PUT ${DAY}`]: echo('2026-03-02T12:00:05.000Z'),
      'POST /api/branches/br_north/media': () =>
        jsonResponse(
          {
            id: 'med_shot',
            branchId: 'br_north',
            contentType: 'image/png',
            bytes: 2048,
            width: 1280,
            height: 720,
            fileName: 'image.png',
            sha256: 'a'.repeat(64),
            uploadedBy: 'usr_avery',
            uploadedAt: '2026-03-02T12:00:01.000Z',
          },
          201,
        ),
    });
    renderPage();
    await flush();
    const shot = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'image.png', { type: 'image/png' });
    const editor = screen.getByRole('textbox', { name: 'Whiteboard title' }).closest('div.flex.flex-col.gap-4') as HTMLElement;
    fireEvent.paste(editor, { clipboardData: { files: [shot], items: [], types: ['Files'] } });
    await flush(20);
    await flush();

    expect(blockOrder()).toEqual(['Graph / screenshot, block 1 of 1']);
    const upload = calls.find((c) => c.method === 'POST' && c.url === '/api/branches/br_north/media')!;
    expect(upload.body).toBe(shot);
    expect(upload.headers['content-type']).toBe('image/png');
    expect(upload.headers['x-file-name']).toBe('image.png');
    expect(screen.getByRole('img', { name: 'Uploaded image' }).getAttribute('src')).toBe('blob:preview');

    await flush(AUTOSAVE_DEBOUNCE_MS + 10);
    const put = calls.filter((c) => c.method === 'PUT').at(-1)!;
    expect((put.body as { blocks: Array<{ kind: string; mediaId?: string }> }).blocks).toEqual([expect.objectContaining({ kind: 'image', mediaId: 'med_shot' })]);
  });

  it('Start now saves first, then switches the board live', async () => {
    const live = whiteboard({ live: 'on', updatedAt: '2026-03-02T12:00:30.000Z' });
    const calls = mockApi({
      [`GET ${DAY}`]: () => jsonResponse(response(whiteboard())),
      [`PUT ${DAY}`]: echo('2026-03-02T12:00:05.000Z'),
      [`POST ${DAY}/live`]: () => jsonResponse(response(live, view({ isLive: true }))),
    });
    renderPage();
    await flush();
    await addBlock("Today's numbers");
    fireEvent.click(screen.getByRole('button', { name: 'Start now' }));
    await flush();
    await flush();
    const order = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`);
    expect(order).toEqual([`PUT ${DAY}`, `POST ${DAY}/live`]);
    expect(calls.find((c) => c.url === `${DAY}/live`)!.body).toEqual({ live: 'on' });
    expect(screen.getByText('Live on displays')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'End' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to schedule' })).toBeTruthy();
  });
});

describe('WhiteboardPage (assignment task link)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-03-02T12:00:00.000Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Create inbox task saves pending edits, posts the task and shows the linked state', async () => {
    const wb = whiteboard({
      blocks: [{ id: 'b_as', kind: 'assignments', title: 'Assignments', items: [{ id: 'a1', userId: null, text: 'Call Lakeside about Friday', taskId: null, done: false }] }],
    });
    const linked = whiteboard({
      updatedAt: '2026-03-02T12:00:20.000Z',
      blocks: [{ id: 'b_as', kind: 'assignments', title: 'Assignments', items: [{ id: 'a1', userId: null, text: 'Call Lakeside about Friday!', taskId: 'tsk_9', done: false }] }],
    });
    const calls = mockApi({
      [`GET ${DAY}`]: () => jsonResponse(response(wb)),
      [`PUT ${DAY}`]: echo('2026-03-02T12:00:05.000Z'),
      [`POST ${DAY}/assignments/a1/task`]: () => jsonResponse({ ...response(linked), task: { id: 'tsk_9' } }),
    });
    renderPage();
    await flush();
    fireEvent.change(screen.getByRole('textbox', { name: 'Assignment 1' }), { target: { value: 'Call Lakeside about Friday!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create inbox task for assignment 1' }));
    await flush();
    await flush();
    const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`);
    expect(writes.slice(0, 2)).toEqual([`PUT ${DAY}`, `POST ${DAY}/assignments/a1/task`]);
    expect(calls.find((c) => c.url.endsWith('/task'))!.body).toEqual({ priority: 'normal' });
    expect(screen.getByRole('link', { name: /Task created/ }).getAttribute('href')).toBe('/inbox');
    expect(screen.getByText('Inbox task created')).toBeTruthy();
  });
});

describe('WhiteboardPage (member view)', () => {
  const memberMe = () => meResponse({ user: { role: 'member' } });
  const wb = whiteboard({
    blocks: [
      {
        id: 'b_as',
        kind: 'assignments',
        title: 'Assignments',
        items: [
          { id: 'a_mine', userId: 'usr_avery', text: 'Call back the forklift applicants', taskId: null, done: false },
          { id: 'a_theirs', userId: 'usr_blake', text: 'Restock the lobby forms', taskId: null, done: false },
        ],
      },
    ],
  });
  const wbView = view({
    blocks: [
      {
        id: 'b_as',
        kind: 'assignments',
        title: 'Assignments',
        items: [
          { id: 'a_mine', text: 'Call back the forklift applicants', done: false, person: { name: 'Avery Quinn', initials: 'AQ', marker: 'teal' } },
          { id: 'a_theirs', text: 'Restock the lobby forms', done: false, person: { name: 'Blake Ortiz', initials: 'BO', marker: 'red' } },
        ],
      },
    ],
  });

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-03-02T12:00:00.000Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is read-only, highlights my items and offers Done only on them', async () => {
    const done: WhiteboardResponse = { whiteboard: wb, view: { ...wbView, blocks: [{ ...(wbView.blocks[0] as Extract<typeof wbView.blocks[number], { kind: 'assignments' }>), items: (wbView.blocks[0] as Extract<typeof wbView.blocks[number], { kind: 'assignments' }>).items.map((i) => (i.id === 'a_mine' ? { ...i, done: true } : i)) }] } };
    const calls = mockApi({
      [`GET ${DAY}`]: () => jsonResponse({ whiteboard: wb, view: wbView }),
      [`POST ${DAY}/assignments/a_mine/done`]: () => jsonResponse(done),
    });
    renderPage(memberMe());
    await flush();

    expect(screen.queryByRole('button', { name: /Add block/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start now' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.closest('label')!.textContent).toContain('Call back the forklift applicants');
    const mine = boxes[0]!.closest('li')!;
    expect(mine.hasAttribute('data-own')).toBe(true);
    expect(within(mine).getByText('You')).toBeTruthy();

    fireEvent.click(boxes[0]!);
    await flush();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ done: true });
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });
});
