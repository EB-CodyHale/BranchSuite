import { describe, expect, it } from 'vitest';
import { addDays, dayKeyOf, daysBetween, isDayKey, shortDay, todayKey } from './time.js';

const CHI = 'America/Chicago';

describe('todayKey / dayKeyOf', () => {
  it('uses the branch time zone, not UTC', () => {
    // 03:30 UTC on Mar 10 is still Mar 9 in Chicago (CDT, UTC-5).
    expect(todayKey(CHI, new Date('2026-03-10T03:30:00Z'))).toBe('2026-03-09');
    expect(todayKey('UTC', new Date('2026-03-10T03:30:00Z'))).toBe('2026-03-10');
    expect(dayKeyOf('2026-01-15T05:59:59Z', CHI)).toBe('2026-01-14'); // CST, UTC-6
    expect(dayKeyOf('2026-01-15T06:00:00Z', CHI)).toBe('2026-01-15');
  });

  it('handles the spring-forward DST boundary in America/Chicago', () => {
    // DST starts 2026-03-08 at 02:00 local (08:00 UTC).
    expect(dayKeyOf('2026-03-08T05:59:00Z', CHI)).toBe('2026-03-07');
    expect(dayKeyOf('2026-03-08T06:00:00Z', CHI)).toBe('2026-03-08');
    expect(dayKeyOf('2026-03-09T04:59:00Z', CHI)).toBe('2026-03-08'); // 23:59 CDT
    expect(dayKeyOf('2026-03-09T05:00:00Z', CHI)).toBe('2026-03-09');
  });

  it('handles the fall-back DST boundary in America/Chicago', () => {
    // DST ends 2026-11-01 at 02:00 local; the day is 25 hours long.
    expect(dayKeyOf('2026-11-01T04:59:00Z', CHI)).toBe('2026-10-31');
    expect(dayKeyOf('2026-11-01T05:00:00Z', CHI)).toBe('2026-11-01');
    expect(dayKeyOf('2026-11-02T05:59:00Z', CHI)).toBe('2026-11-01'); // 23:59 CST
    expect(dayKeyOf('2026-11-02T06:00:00Z', CHI)).toBe('2026-11-02');
  });

  it('accepts offsets in ISO input', () => {
    expect(dayKeyOf('2026-06-30T23:30:00-05:00', CHI)).toBe('2026-06-30');
  });

  it('throws on an invalid timestamp or time zone', () => {
    expect(() => dayKeyOf('not a date', CHI)).toThrow(RangeError);
    expect(() => todayKey('Mars/Olympus_Mons', new Date())).toThrow(RangeError);
  });
});

describe('daysBetween', () => {
  it('counts calendar days across DST changes', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
  });
  it('handles month and year rollovers and leap years', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
  });
  it('is negative when the target is earlier', () => {
    expect(daysBetween('2026-03-10', '2026-03-01')).toBe(-9);
    expect(daysBetween('2026-03-10', '2026-03-10')).toBe(0);
  });
  it('rejects invalid keys', () => {
    expect(() => daysBetween('2026-02-30', '2026-03-01')).toThrow(RangeError);
    expect(() => daysBetween('2026-3-1', '2026-03-01')).toThrow(RangeError);
  });
});

describe('addDays', () => {
  it('rolls months and years', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(addDays('2026-03-07', 0)).toBe('2026-03-07');
  });
  it('rejects invalid input', () => {
    expect(() => addDays('2026-13-01', 1)).toThrow(RangeError);
    expect(() => addDays('2026-03-01', 1.5)).toThrow(RangeError);
  });
});

describe('shortDay', () => {
  it('formats without leading zeros', () => {
    expect(shortDay('2026-09-04')).toBe('9/4');
    expect(shortDay('2026-12-25')).toBe('12/25');
  });
  it('throws on invalid keys', () => {
    expect(() => shortDay('garbage')).toThrow(RangeError);
  });
});

describe('isDayKey', () => {
  it('accepts real dates only', () => {
    expect(isDayKey('2026-03-08')).toBe(true);
    expect(isDayKey('2028-02-29')).toBe(true);
    expect(isDayKey('2026-02-29')).toBe(false);
    expect(isDayKey('2026-04-31')).toBe(false);
    expect(isDayKey('2026-00-10')).toBe(false);
    expect(isDayKey('2026-3-8')).toBe(false);
    expect(isDayKey('2026-03-08T00:00')).toBe(false);
    expect(isDayKey('')).toBe(false);
    expect(isDayKey(20260308)).toBe(false);
    expect(isDayKey(null)).toBe(false);
  });
});
