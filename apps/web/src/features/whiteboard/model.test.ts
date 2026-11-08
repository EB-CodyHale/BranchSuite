import { WHITEBOARD_LIMITS } from '@branchsuite/shared';
import { describe, expect, it } from 'vitest';
import { huddleState, imageFromTransfer, moveItem, newBlock, noteSegments, toUpsertInput, validateImageFile, windowError, windowLabel, type WhiteboardDraft } from './model.js';
import { whiteboard } from './testFixtures.js';

const draft = (blocks: WhiteboardDraft['blocks']): WhiteboardDraft => ({ title: '  Monday huddle ', window: { start: '07:30', end: '08:15' }, orderLabels: 'name', blocks });

describe('toUpsertInput', () => {
  it('drops empty items and images without an upload, trims text', () => {
    const out = toUpsertInput(
      draft([
        { id: 'b1', kind: 'talking_points', title: 'Points', items: [{ id: 'i1', text: '  Safety first ' }, { id: 'i2', text: '   ' }] },
        { id: 'b2', kind: 'assignments', title: 'Assignments', items: [{ id: 'a1', userId: null, text: '', taskId: null, done: false }] },
        { id: 'b3', kind: 'image', title: '', mediaId: '', caption: '' },
        { id: 'b4', kind: 'image', title: 'Graph', mediaId: 'med_1', caption: ' Fill rate ' },
      ]),
    );
    expect(out.title).toBe('Monday huddle');
    expect(out.blocks).toEqual([
      { id: 'b1', kind: 'talking_points', title: 'Points', items: [{ id: 'i1', text: 'Safety first' }] },
      { id: 'b2', kind: 'assignments', title: 'Assignments', items: [] },
      { id: 'b4', kind: 'image', title: 'Graph', mediaId: 'med_1', caption: 'Fill rate' },
    ]);
  });

  it('caps note text at the limit', () => {
    const out = toUpsertInput(draft([{ id: 'n', kind: 'note', title: '', text: 'x'.repeat(WHITEBOARD_LIMITS.maxNoteText + 50), tone: 'neutral' }]));
    expect((out.blocks![0] as { text: string }).text).toHaveLength(WHITEBOARD_LIMITS.maxNoteText);
  });
});

describe('newBlock', () => {
  it('creates every kind with unique ids', () => {
    const a = newBlock('talking_points');
    const b = newBlock('talking_points');
    expect(a.id).not.toBe(b.id);
    expect(a.kind).toBe('talking_points');
    expect(newBlock('metrics').title).toBe("Today's numbers");
    expect(newBlock('image')).toMatchObject({ kind: 'image', mediaId: '' });
  });
});

describe('moveItem', () => {
  it('moves and clamps', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

describe('validateImageFile', () => {
  it('accepts PNG/JPEG/WebP up to 8 MB', () => {
    expect(validateImageFile({ type: 'image/png', size: 1000 })).toBeNull();
    expect(validateImageFile({ type: 'image/webp', size: WHITEBOARD_LIMITS.maxImageBytes })).toBeNull();
  });
  it('refuses other types and oversize files with a friendly message', () => {
    expect(validateImageFile({ type: 'image/gif', size: 10 })).toMatch(/PNG, JPEG or WebP/);
    expect(validateImageFile({ type: 'application/pdf', size: 10 })).toMatch(/PNG, JPEG or WebP/);
    expect(validateImageFile({ type: 'image/jpeg', size: WHITEBOARD_LIMITS.maxImageBytes + 1 })).toMatch(/limit is 8 MB/);
  });
});

describe('imageFromTransfer', () => {
  it('finds a pasted screenshot in clipboard items', () => {
    const file = new File(['x'], 'image.png', { type: 'image/png' });
    const data = { files: [] as unknown as FileList, items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }, { kind: 'file', type: 'image/png', getAsFile: () => file }] as unknown as DataTransferItemList };
    expect(imageFromTransfer(data)).toBe(file);
    expect(imageFromTransfer({ files: [] as unknown as FileList, items: [] as unknown as DataTransferItemList })).toBeNull();
  });
});

describe('window', () => {
  it('labels and validates', () => {
    expect(windowLabel({ start: '07:30', end: '08:15' })).toBe('7:30–8:15');
    expect(windowLabel({ start: '12:00', end: '13:05' })).toBe('12:00–1:05');
    expect(windowError({ start: '08:15', end: '07:30' })).toMatch(/end after it starts/);
    expect(windowError({ start: '', end: '07:30' })).toMatch(/both times/);
    expect(windowError({ start: '07:30', end: '08:15' })).toBeNull();
  });
});

describe('huddleState', () => {
  const tz = 'America/Chicago';
  // 2026-03-02 is CST (UTC-6): 13:45Z = 07:45 local.
  const at = (iso: string) => new Date(iso);
  it('auto: live inside the window on its day only', () => {
    const wb = whiteboard();
    expect(huddleState(wb, tz, at('2026-03-02T13:45:00Z'))).toBe('live');
    expect(huddleState(wb, tz, at('2026-03-02T13:00:00Z'))).toBe('scheduled');
    expect(huddleState(wb, tz, at('2026-03-02T14:15:00Z'))).toBe('off'); // 08:15 = end, exclusive
    expect(huddleState(wb, tz, at('2026-03-01T13:45:00Z'))).toBe('scheduled');
    expect(huddleState(wb, tz, at('2026-03-03T13:45:00Z'))).toBe('off');
  });
  it('on / off override the window', () => {
    expect(huddleState(whiteboard({ live: 'on' }), tz, at('2026-03-02T20:00:00Z'))).toBe('live');
    expect(huddleState(whiteboard({ live: 'on' }), tz, at('2026-03-01T20:00:00Z'))).toBe('scheduled');
    expect(huddleState(whiteboard({ live: 'off' }), tz, at('2026-03-02T13:45:00Z'))).toBe('off');
  });
});

describe('noteSegments', () => {
  it('turns "- " lines into bullet lists and keeps paragraphs', () => {
    expect(noteSegments('Heads up\nline two\n\n- one\n- two\nAfter')).toEqual([
      { kind: 'para', text: 'Heads up\nline two' },
      { kind: 'para', text: '' },
      { kind: 'bullets', items: ['one', 'two'] },
      { kind: 'para', text: 'After' },
    ]);
  });
  it('never produces markup from text', () => {
    expect(noteSegments('<b>bold</b>')).toEqual([{ kind: 'para', text: '<b>bold</b>' }]);
  });
});
