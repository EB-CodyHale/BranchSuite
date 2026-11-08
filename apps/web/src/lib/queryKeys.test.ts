import { describe, expect, it } from 'vitest';
import { boardKeyIncludes, keys } from './queryKeys.js';

describe('query keys', () => {
  it('produces the same board key regardless of branch order or duplicates', () => {
    expect(keys.board(['b2', 'b1'])).toEqual(keys.board(['b1', 'b2', 'b1']));
    expect(keys.board(['b1'])).not.toEqual(keys.board(['b1', 'b2']));
  });

  it('does not mutate the caller array', () => {
    const input = ['z', 'a'];
    keys.board(input);
    keys.tasks('branch', input);
    expect(input).toEqual(['z', 'a']);
  });

  it('nests every entity under its root prefix so root invalidation reaches it', () => {
    const startsWith = (key: readonly unknown[], prefix: readonly unknown[]) => prefix.every((p, i) => JSON.stringify(key[i]) === JSON.stringify(p));
    expect(startsWith(keys.board(['b1']), keys.boardRoot())).toBe(true);
    expect(startsWith(keys.tasks('combined', ['b1'], '2026-03-02'), keys.tasksRoot())).toBe(true);
    expect(startsWith(keys.candidates('b1', 'archived'), keys.candidatesRoot('b1'))).toBe(true);
    expect(startsWith(keys.orderHistory('b1', 'o1'), keys.ordersRoot('b1'))).toBe(true);
    expect(startsWith(keys.closedOrders('b1'), keys.ordersRoot('b1'))).toBe(true);
    expect(startsWith(keys.wallLegend('b1'), [keys.wallRoot()[0], 'b1'])).toBe(true);
    expect(startsWith(keys.wallPreview('b1'), [keys.wallRoot()[0], 'b1'])).toBe(true);
    expect(startsWith(keys.users('b1'), keys.usersRoot())).toBe(true);
  });

  it('keeps distinct parameters in distinct caches', () => {
    expect(keys.tasks('branch', ['b1'])).not.toEqual(keys.tasks('personal', ['b1']));
    expect(keys.tasks('branch', ['b1'])).not.toEqual(keys.tasks('branch', ['b1'], '2026-03-01'));
    expect(keys.candidates('b1')).toEqual(keys.candidates('b1', 'active'));
    expect(keys.users()).not.toEqual(keys.users('b1'));
    expect(keys.taskMessages('s', 't')).toEqual(['taskMessages', 's', 't']);
  });

  it('separates the wall device feed from staff wall caches', () => {
    expect(keys.wallFeed()[0]).not.toBe(keys.wallRoot()[0]);
  });

  it('detects whether a board key covers a branch', () => {
    expect(boardKeyIncludes(keys.board(['b1', 'b2']), 'b2')).toBe(true);
    expect(boardKeyIncludes(keys.board(['b1']), 'b2')).toBe(false);
    expect(boardKeyIncludes(keys.accounts('b2'), 'b2')).toBe(false);
  });
});
