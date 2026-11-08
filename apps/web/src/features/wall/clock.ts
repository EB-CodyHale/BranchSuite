/** Branch-local clock formatting for the wall header. Falls back to the device zone for an unknown zone. */
import { useEffect, useState } from 'react';

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone });
  } catch {
    return new Intl.DateTimeFormat('en-US', options);
  }
}

export interface ClockParts {
  /** "2:45" */
  time: string;
  /** "PM" */
  period: string;
  /** "Sunday, November 8" */
  date: string;
}

export function clockParts(now: Date, timeZone: string): ClockParts {
  const parts = formatter(timeZone, { hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(now);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
  const period = parts.find((p) => p.type === 'dayPeriod')?.value.toUpperCase() ?? '';
  const date = formatter(timeZone, { weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  return { time: `${hour}:${minute}`, period, date };
}

/** "2:41 PM" in the branch zone; used for "last updated". */
export function shortTime(at: Date, timeZone?: string): string {
  return formatter(timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, { hour: 'numeric', minute: '2-digit', hour12: true }).format(at);
}

/** Current time, refreshed every `intervalMs` (the clock shows minutes, so 5 s keeps it accurate). */
export function useNow(intervalMs = 5000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
