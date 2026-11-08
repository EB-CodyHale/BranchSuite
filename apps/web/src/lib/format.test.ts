import { describe, expect, it } from 'vitest';
import { dayLabel, formatMoney, formatPayRate, pluralize, relativeAge, weekdayOf } from './format.js';

describe('format', () => {
  it('formats money and pay rates', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50');
    expect(formatPayRate(19.5)).toBe('$19.50/hr');
    expect(formatPayRate(null)).toBe('—');
  });

  it('formats compact relative ages', () => {
    const now = new Date('2026-03-10T12:00:00Z');
    expect(relativeAge('2026-03-10T11:59:30Z', now)).toBe('just now');
    expect(relativeAge('2026-03-10T11:15:00Z', now)).toBe('45m');
    expect(relativeAge('2026-03-10T07:00:00Z', now)).toBe('5h');
    expect(relativeAge('2026-03-07T12:00:00Z', now)).toBe('3d');
    expect(relativeAge('2026-02-17T12:00:00Z', now)).toBe('3w');
  });

  it('labels days relative to the branch today', () => {
    expect(dayLabel('2026-03-02', '2026-03-02')).toBe('Today');
    expect(dayLabel('2026-03-03', '2026-03-02')).toBe('Tomorrow');
    expect(dayLabel('2026-03-01', '2026-03-02')).toBe('Yesterday');
    expect(dayLabel('2026-03-05', '2026-03-02')).toBe('Thu 3/5');
    expect(weekdayOf('2026-11-08')).toBe('Sun');
  });

  it('pluralizes counts', () => {
    expect(pluralize(1, 'opening')).toBe('1 opening');
    expect(pluralize(1200, 'opening')).toBe('1,200 openings');
  });
});
